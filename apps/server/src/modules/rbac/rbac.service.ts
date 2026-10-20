import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { CacheService } from '../cache/cache.service'

const ROLE_MAP: Record<string, string> = {
  owner: '创建者',
  editor: '编辑者',
  viewer: '查看者',
}

/** 全部权限点集合——用于判断是否等于全权限 */
const ALL_PERMISSION_KEYS = [
  'form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'form:delete',
  'submission:view', 'submission:delete', 'submission:export',
  'analytics:view',
  'template:create', 'template:edit', 'template:delete',
  'workflow:manage', 'workflow:edit', 'workflow:publish', 'workflow:unpublish', 'workflow:delete',
  'task:approve', 'task:reject', 'task:transfer',
  'member:invite', 'member:role', 'member:remove',
  'role:create', 'role:edit', 'role:delete',
  'audit:view', 'audit:export', 'audit:cleanup',
]

const KNOWN_PERMISSIONS = new Set(ALL_PERMISSION_KEYS)

/** 权限 key → 矩阵中的序号，用于排序 */
const PERMISSION_ORDER = new Map(ALL_PERMISSION_KEYS.map((k, i) => [k, i]))

/** 权限集合是否等价（顺序无关）——用来判断系统角色是否被改动过 */
function samePermissions(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (Array.isArray(v) ? [...(v as string[])].sort().join('\u0000') : '')
  return norm(a) === norm(b)
}

/** 过滤已从权限矩阵中移除的脏权限，并按矩阵顺序排序 */
function cleanPermissions(permissions: unknown): string[] {
  const arr = Array.isArray(permissions) ? permissions as string[] : []
  if (arr.length === 0) return arr
  if (arr.includes('*')) return ['*']
  return arr
    .filter(p => KNOWN_PERMISSIONS.has(p))
    .sort((a, b) => (PERMISSION_ORDER.get(a) ?? 999) - (PERMISSION_ORDER.get(b) ?? 999))
}

@Injectable()
export class RbacService {
  constructor(
    private prisma: PrismaClient,
    private cache: CacheService,
  ) {}

  /** 清理脏数据：确保每个成员只有一个 RBAC 角色，且与 WorkspaceMember.role 一致 */
  private async normalizeMemberRoles(workspaceId: string) {
    // 防御：工作空间已被删除则跳过
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })
    if (!ws) return

    const [members, workspaceRoles] = await Promise.all([
      this.prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } }),
      this.prisma.role.findMany({ where: { workspaceId }, select: { id: true, name: true, permissions: true, isSystem: true } }),
    ])

    // 将旧的"管理员"系统角色重命名为"创建者"
    const legacyAdminRole = workspaceRoles.find(
      (r) => r.isSystem && r.name === '管理员' && Array.isArray(r.permissions) && r.permissions.includes('*'),
    )
    if (legacyAdminRole) {
      await this.prisma.role.update({ where: { id: legacyAdminRole.id }, data: { name: '创建者' } })
      legacyAdminRole.name = '创建者'
    }

    // 修正旧的"编辑者"被错误标记为系统角色
    const legacyEditorRole = workspaceRoles.find((r) => r.isSystem && r.name === '编辑者')
    if (legacyEditorRole) {
      await this.prisma.role.update({ where: { id: legacyEditorRole.id }, data: { isSystem: false } })
      legacyEditorRole.isSystem = false
    }

    // "查看者"的权限恒为空（系统角色的定义）：这里只是兜底把历史脏数据抹平。
    // 闸口在写入口 updateRole —— 那边直接 403，所以不会再出现「改得动、刷新就没了」；
    // 前端也据此把矩阵里这一行锁掉。
    const legacyViewerRole = workspaceRoles.find(
      (r) => r.isSystem && r.name === ROLE_MAP.viewer && Array.isArray(r.permissions) && (r.permissions as string[]).length > 0,
    )
    if (legacyViewerRole) {
      await this.prisma.role.update({ where: { id: legacyViewerRole.id }, data: { permissions: [] } })
      ;(legacyViewerRole as any).permissions = []
    }

    // 补建缺失的系统角色（旧空间可能没有自动创建）
    const hasCreator = workspaceRoles.some(r => r.name === '创建者')
    const hasViewer = workspaceRoles.some(r => r.name === '查看者')
    if (!hasCreator) {
      const r = await this.prisma.role.create({ data: { workspaceId, name: '创建者', permissions: ['*'], isSystem: true } })
      workspaceRoles.push(r)
    }
    if (!hasViewer) {
      const r = await this.prisma.role.create({ data: { workspaceId, name: '查看者', permissions: [], isSystem: true } })
      workspaceRoles.push(r)
    }

    const roleIds = workspaceRoles.map((r) => r.id)
    const memberIds = members.map((m) => m.userId)

    // 清理孤儿 UserRole：用户已不在工作空间但残留的角色分配
    await this.prisma.userRole.deleteMany({
      where: { roleId: { in: roleIds }, userId: { notIn: memberIds } },
    })

    // 确保每个成员有且仅有一个正确的 RBAC 角色
    for (const m of members) {
      const current = await this.prisma.userRole.findMany({ where: { userId: m.userId, roleId: { in: roleIds } } })
      const targetRole = workspaceRoles.find((r) => r.name === (ROLE_MAP[m.role] ?? m.role))
      const ok = current.length === 1 && targetRole && current[0].roleId === targetRole.id
      if (!ok) {
        await this.prisma.userRole.deleteMany({ where: { userId: m.userId, roleId: { in: roleIds } } })
        if (targetRole) {
          await this.prisma.userRole.create({ data: { userId: m.userId, roleId: targetRole.id } })
        }
      }
    }
    // 清除所有受影响成员的权限缓存
    for (const m of members) {
      await this.cache.invalidateUserPermissions(workspaceId, m.userId)
    }
  }

  async listRoles(workspaceId: string) {
    await this.normalizeMemberRoles(workspaceId)
    const roles = await this.prisma.role.findMany({
      where: { workspaceId },
      include: { users: true },
    })
    // 过滤并清理已从权限矩阵中删除的脏权限（如 submission:create）
    for (const role of roles) {
      const raw = role.permissions
      const cleaned = cleanPermissions(raw)
      if (JSON.stringify(raw) !== JSON.stringify(cleaned)) {
        await this.prisma.role.update({
          where: { id: role.id },
          data: { permissions: cleaned },
        })
        role.permissions = cleaned
      }
    }
    return roles
  }

  async createRole(workspaceId: string, dto: { name: string; permissions: string[] }) {
    // 禁止创建第二个拥有全部权限的角色
    if (dto.permissions.includes('*') || dto.permissions.length >= ALL_PERMISSION_KEYS.length) {
      throw new ForbiddenException('已存在拥有全部权限的创建者角色，不可再新建全权限角色')
    }
    return this.prisma.role.create({
      data: { workspaceId, name: dto.name, permissions: dto.permissions },
    })
  }

  async updateRole(id: string, dto: { name?: string; permissions?: string[] }) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')

    // 系统角色（创建者 / 查看者）一概不可编辑，owner 也不行：
    // 名字是查表键 —— ROLE_MAP 在 syncRbacRole / normalizeMemberRoles 里按名字找角色，
    // 改名会让该角色下所有成员的 RBAC 分配静默落空；权限同理（创建者恒为 *、查看者恒为空）。
    // 判定放在写入口，不再靠 normalizeMemberRoles 读时抹掉（那样前端会先乐观显示"已更新"、
    // 刷新后被还原，看起来像随机失效）。
    if (role.isSystem) {
      if (dto.name !== undefined && dto.name.trim() !== role.name) {
        throw new ForbiddenException(`系统角色「${role.name}」的名称不可修改`)
      }
      if (dto.permissions !== undefined && !samePermissions(dto.permissions, role.permissions)) {
        throw new ForbiddenException(`系统角色「${role.name}」的权限不可修改`)
      }
      return role // 传了同值，视为无变化，不必写库
    }

    // 禁止将其他角色升级为全权限（创建者角色已存在且唯一）
    const isAllPerm = dto.permissions?.includes('*') || (dto.permissions && dto.permissions.length >= ALL_PERMISSION_KEYS.length)
    if (isAllPerm) {
      const currentPerms: string[] = Array.isArray(role.permissions) ? role.permissions as string[] : []
      const alreadyHasAll = currentPerms.includes('*') || currentPerms.length >= ALL_PERMISSION_KEYS.length
      if (!alreadyHasAll) {
        throw new ForbiddenException('已存在拥有全部权限的创建者角色，不可将其他角色升级为全权限')
      }
    }
    const result = await this.prisma.role.update({ where: { id }, data: dto })
    // 失效该角色下所有用户的权限缓存
    if (role) {
      await this.cache.invalidateUserPermissions(role.workspaceId)
    }
    return result
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')
    // 系统角色不可删除（对所有人，含 owner）：删掉创建者就没人拥有全权限，删掉查看者
    // 会让 syncRbacRole 找不到目标角色而给成员留下空权限
    if (role.isSystem) throw new ForbiddenException(`系统角色「${role.name}」不可删除`)
    const result = await this.prisma.role.delete({ where: { id } })
    if (role) {
      await this.cache.invalidateUserPermissions(role.workspaceId)
    }
    return result
  }

  async assignRole(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } })
    const result = await this.prisma.userRole.create({
      data: { userId, roleId },
    })
    if (role) {
      await this.cache.invalidateUserPermissions(role.workspaceId, userId)
    }
    return result
  }

  async revokeRole(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } })
    const result = await this.prisma.userRole.delete({
      where: { userId_roleId: { userId, roleId } },
    })
    if (role) {
      await this.cache.invalidateUserPermissions(role.workspaceId, userId)
    }
    return result
  }

  async getUserPermissions(workspaceId: string, userId: string): Promise<string[]> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!membership) return []

    if (membership.role === 'owner') {
      return ['*']
    }

    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    })

    const permissions = new Set<string>()
    for (const ur of userRoles) {
      const perms = (ur.role.permissions as string[]) || []
      if (perms.includes('*')) {
        return ['*']
      } else {
        perms.forEach((p) => { if (KNOWN_PERMISSIONS.has(p)) permissions.add(p) })
      }
    }
    return Array.from(permissions).sort(
      (a, b) => (PERMISSION_ORDER.get(a) ?? 999) - (PERMISSION_ORDER.get(b) ?? 999),
    )
  }

  /** 获取工作空间权限矩阵（所有角色 × 所有权限点） */
  async getPermissionMatrix(workspaceId: string) {
    await this.normalizeMemberRoles(workspaceId)
    const roles = await this.prisma.role.findMany({
      where: { workspaceId },
      include: { users: { include: { user: { select: { id: true, email: true, nickname: true } } } } },
    })

    // 过滤已从权限矩阵中删除的脏权限
    for (const role of roles) {
      role.permissions = cleanPermissions(role.permissions)
    }

    // 预定义的所有权限点（与审计日志操作对齐）
    const allPermissions = [
      { key: 'form:create', label: '新建表单', group: '表单' },
      { key: 'form:edit', label: '修改表单', group: '表单' },
      { key: 'form:publish', label: '发布表单', group: '表单' },
      { key: 'form:archive', label: '归档表单', group: '表单' },
      { key: 'form:copy', label: '复制表单', group: '表单' },
      { key: 'form:delete', label: '删除表单', group: '表单' },
      { key: 'submission:view', label: '查看表单数据', group: '数据' },
      { key: 'submission:delete', label: '删除表单数据', group: '数据' },
      { key: 'submission:export', label: '导出表单数据', group: '数据' },
      { key: 'analytics:view', label: '查看数据分析', group: '数据' },
      { key: 'template:create', label: '创建模板', group: '模板' },
      { key: 'template:edit', label: '修改模板', group: '模板' },
      { key: 'template:delete', label: '删除模板', group: '模板' },
      { key: 'workflow:manage', label: '新建流程', group: '流程' },
      { key: 'workflow:edit', label: '修改流程', group: '流程' },
      { key: 'workflow:publish', label: '发布流程', group: '流程' },
      { key: 'workflow:unpublish', label: '撤回流程', group: '流程' },
      { key: 'workflow:delete', label: '删除流程', group: '流程' },
      { key: 'task:approve', label: '通过审批', group: '任务' },
      { key: 'task:reject', label: '驳回审批', group: '任务' },
      { key: 'task:transfer', label: '转交审批', group: '任务' },
      { key: 'member:invite', label: '邀请成员', group: '成员' },
      { key: 'member:role', label: '修改成员角色', group: '成员' },
      { key: 'member:remove', label: '移除成员', group: '成员' },
      { key: 'role:create', label: '新建角色', group: '角色' },
      { key: 'role:edit', label: '编辑角色权限', group: '角色' },
      { key: 'role:delete', label: '删除角色', group: '角色' },
      { key: 'audit:view', label: '查看审计日志', group: '日志' },
      { key: 'audit:export', label: '导出审计日志', group: '日志' },
      { key: 'audit:cleanup', label: '清理审计日志', group: '日志' },
    ]

    // permissionsLocked 是给前端的锁行信号：系统角色的权限恒由系统固定（创建者 *、查看者空），
    // 矩阵里整行不给点，避免点了才被服务端 403
    return {
      roles: roles.map((r) => ({ ...r, permissionsLocked: r.isSystem })),
      allPermissions,
    }
  }

  /** 获取默认系统角色定义 */
  getDefaultRoles() {
    return [
      {
        name: 'form_editor',
        label: '表单编辑者',
        permissions: ['form:create', 'form:edit', 'form:publish', 'form:copy', 'submission:view'],
      },
      {
        name: 'form_viewer',
        label: '表单查看者',
        permissions: ['submission:view'],
      },
      {
        name: 'data_admin',
        label: '数据管理员',
        permissions: ['submission:view', 'submission:export', 'submission:delete'],
      },
      {
        name: 'workflow_admin',
        label: '流程管理员',
        permissions: ['task:approve', 'task:reject', 'workflow:manage'],
      },
    ]
  }
}
