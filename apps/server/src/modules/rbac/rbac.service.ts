import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { CacheService } from '../cache/cache.service'

const ROLE_MAP: Record<string, string> = {
  owner: '管理员',
  editor: '编辑者',
  viewer: '查看者',
}

@Injectable()
export class RbacService {
  constructor(
    private prisma: PrismaClient,
    private cache: CacheService,
  ) {}

  /** 清理脏数据：确保每个成员只有一个 RBAC 角色，且与 WorkspaceMember.role 一致 */
  private async normalizeMemberRoles(workspaceId: string) {
    const [members, workspaceRoles] = await Promise.all([
      this.prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } }),
      this.prisma.role.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    ])
    const roleIds = workspaceRoles.map((r) => r.id)
    const memberIds = members.map((m) => m.userId)

    // 清理孤儿 UserRole：用户已不在工作空间但残留的角色分配
    await this.prisma.userRole.deleteMany({
      where: { roleId: { in: roleIds }, userId: { notIn: memberIds } },
    })

    // 确保每个成员有且仅有一个正确的 RBAC 角色
    for (const m of members) {
      const current = await this.prisma.userRole.findMany({ where: { userId: m.userId, roleId: { in: roleIds } } })
      const targetRole = workspaceRoles.find((r) => r.name === ROLE_MAP[m.role])
      const ok = current.length === 1 && targetRole && current[0].roleId === targetRole.id
      if (!ok) {
        await this.prisma.userRole.deleteMany({ where: { userId: m.userId, roleId: { in: roleIds } } })
        if (targetRole) {
          await this.prisma.userRole.create({ data: { userId: m.userId, roleId: targetRole.id } })
        }
      }
    }
  }

  async listRoles(workspaceId: string) {
    await this.normalizeMemberRoles(workspaceId)
    return this.prisma.role.findMany({
      where: { workspaceId },
      include: { users: true },
    })
  }

  async createRole(workspaceId: string, dto: { name: string; permissions: string[] }) {
    return this.prisma.role.create({
      data: { workspaceId, name: dto.name, permissions: dto.permissions },
    })
  }

  async updateRole(id: string, dto: { name?: string; permissions?: string[] }, userId?: string) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')
    if (role.isSystem) {
      const isOwner = await this.isWorkspaceOwner(role.workspaceId, userId)
      if (!isOwner) throw new ForbiddenException('系统角色不能编辑')
    }
    const result = await this.prisma.role.update({ where: { id }, data: dto })
    // 失效该角色下所有用户的权限缓存
    if (role) {
      await this.cache.invalidateUserPermissions(role.workspaceId)
    }
    return result
  }

  async deleteRole(id: string, userId?: string) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')
    if (role.isSystem) {
      const isOwner = await this.isWorkspaceOwner(role.workspaceId, userId)
      if (!isOwner) throw new ForbiddenException('系统角色不能删除')
    }
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

  private async isWorkspaceOwner(workspaceId: string, userId?: string): Promise<boolean> {
    if (!userId) return false
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    return member?.role === 'owner'
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
      perms.forEach((p) => permissions.add(p))
    }
    return Array.from(permissions)
  }

  /** 获取工作空间权限矩阵（所有角色 × 所有权限点） */
  async getPermissionMatrix(workspaceId: string) {
    await this.normalizeMemberRoles(workspaceId)
    const roles = await this.prisma.role.findMany({
      where: { workspaceId },
      include: { users: { include: { user: { select: { id: true, email: true, nickname: true } } } } },
    })

    // 预定义的所有权限点（与审计日志操作对齐）
    const allPermissions = [
      { key: 'form:create', label: '新建表单', group: '表单' },
      { key: 'form:edit', label: '修改表单', group: '表单' },
      { key: 'form:publish', label: '发布表单', group: '表单' },
      { key: 'form:archive', label: '归档表单', group: '表单' },
      { key: 'form:copy', label: '复制表单', group: '表单' },
      { key: 'form:delete', label: '删除表单', group: '表单' },
      { key: 'submission:create', label: '提交表单数据', group: '数据' },
      { key: 'submission:view', label: '查看表单数据', group: '数据' },
      { key: 'submission:delete', label: '删除表单数据', group: '数据' },
      { key: 'submission:export', label: '导出表单数据', group: '数据' },
      { key: 'analytics:view', label: '查看数据分析', group: '数据' },
      { key: 'template:create', label: '创建模板', group: '模板' },
      { key: 'template:edit', label: '修改模板', group: '模板' },
      { key: 'template:delete', label: '删除模板', group: '模板' },
      { key: 'workflow:manage', label: '新建固有流程', group: '流程' },
      { key: 'workflow:edit', label: '修改固有流程', group: '流程' },
      { key: 'workflow:delete', label: '删除固有流程', group: '流程' },
      { key: 'workflow:start', label: '发起我的流程', group: '流程' },
      { key: 'workflow:withdraw', label: '撤回我的流程', group: '流程' },
      { key: 'workflow:remove', label: '删除我的流程', group: '流程' },
      { key: 'task:approve', label: '通过审批', group: '任务' },
      { key: 'task:reject', label: '驳回审批', group: '任务' },
      { key: 'task:transfer', label: '转交审批', group: '任务' },
      { key: 'member:invite', label: '添加成员', group: '成员' },
      { key: 'member:role', label: '修改成员角色', group: '成员' },
      { key: 'member:remove', label: '移除成员', group: '成员' },
      { key: 'role:create', label: '新建角色', group: '角色' },
      { key: 'role:edit', label: '编辑角色权限', group: '角色' },
      { key: 'role:delete', label: '删除角色', group: '角色' },
      { key: 'audit:view', label: '查看审计日志', group: '日志' },
      { key: 'audit:export', label: '导出审计日志', group: '日志' },
    ]

    return { roles, allPermissions }
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
        permissions: ['workflow:approve', 'workflow:manage'],
      },
    ]
  }
}
