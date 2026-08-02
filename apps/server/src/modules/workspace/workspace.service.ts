import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { CacheService } from '../cache/cache.service'

/** WorkspaceMember.role → RBAC 角色名映射 */
const ROLE_MAP: Record<string, string> = {
  owner: '创建者',
  editor: '编辑者',
  viewer: '查看者',
}

@Injectable()
export class WorkspaceService {
  constructor(
    private prisma: PrismaClient,
    private cache: CacheService,
  ) {}

  /** 同步成员工作空间角色到 RBAC UserRole 表 */
  private async syncRbacRole(workspaceId: string, userId: string, wsRole: string) {
    const workspaceRoles = await this.prisma.role.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    })
    const roleIds = workspaceRoles.map((r) => r.id)

    // 先移除该用户在工作空间下所有旧 RBAC 角色
    await this.prisma.userRole.deleteMany({
      where: { userId, roleId: { in: roleIds } },
    })

    // 分配对应 RBAC 角色
    const rbacRoleName = ROLE_MAP[wsRole]
    const targetRole = workspaceRoles.find((r) => r.name === rbacRoleName)
    if (targetRole) {
      await this.prisma.userRole.create({
        data: { userId, roleId: targetRole.id },
      })
    }
    // 清除权限缓存，下次请求时重新计算
    await this.cache.invalidateUserPermissions(workspaceId, userId)
  }

  async list(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      include: { workspace: true },
    })
    const items = memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }))

    // 确保用户至少有一个工作空间
    if (items.length === 0) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      const name = (user?.nickname || user?.email || '用户') + ' 的工作空间'
      const slug = `ws-${userId.substring(0, 8)}-${Math.random().toString(36).slice(2, 6)}`
      const ws = await this.prisma.workspace.create({
        data: {
          name,
          slug,
          members: { create: { userId, role: 'owner' } },
          roles: {
            create: [
              { name: '创建者', permissions: ['*'], isSystem: true },
              { name: '查看者', permissions: [], isSystem: true },
            ],
          },
        },
      })
      await this.syncRbacRole(ws.id, userId, 'owner')
      items.push({ ...ws, role: 'owner' })
    }

    return items
  }

  async create(userId: string, dto: { name: string; remark?: string }) {
    // slug 自动生成：名称 + 随机后缀，避免不同用户创建同名空间时冲突
    const baseSlug = dto.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '') || 'workspace'
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug,
        remark: dto.remark || null,
        members: {
          create: { userId, role: 'owner' },
        },
        roles: {
          create: [
            { name: '创建者', permissions: ['*'], isSystem: true },
            { name: '查看者', permissions: [], isSystem: true },
          ],
        },
      },
    })
    // 将创建者关联到 RBAC 创建者角色
    await this.syncRbacRole(workspace.id, userId, 'owner')
    return workspace
  }

  async getById(id: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } })
    if (!workspace) throw new NotFoundException('工作空间不存在')
    return workspace
  }

  async update(id: string, dto: { name?: string; remark?: string; logoUrl?: string; settings?: any }) {
    return this.prisma.workspace.update({ where: { id }, data: dto })
  }

  async remove(id: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    })
    if (!member || member.role !== 'owner') {
      throw new ForbiddenException('只有创建者可以删除工作空间')
    }
    return this.prisma.workspace.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  }

  async leave(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!member) throw new NotFoundException('不是该工作空间成员')
    if (member.role === 'owner') {
      throw new ForbiddenException('创建者不能退出，请删除工作空间')
    }
    // 清理 RBAC 角色，防止孤儿记录
    const workspaceRoles = await this.prisma.role.findMany({
      where: { workspaceId }, select: { id: true },
    })
    await this.prisma.userRole.deleteMany({
      where: { userId, roleId: { in: workspaceRoles.map(r => r.id) } },
    })
    return this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }

  async listMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, nickname: true, avatarUrl: true } } },
    })
  }

  async addMember(workspaceId: string, dto: { email: string; role: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new NotFoundException('用户不存在')
    const member = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: dto.role },
    })
    await this.syncRbacRole(workspaceId, user.id, dto.role)
    return member
  }

  async removeMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!member) throw new NotFoundException('成员不存在')
    if (member.role === 'owner') throw new ForbiddenException('不能移出工作空间创建者')

    const workspaceRoles = await this.prisma.role.findMany({
      where: { workspaceId }, select: { id: true },
    })
    await this.prisma.userRole.deleteMany({
      where: { userId, roleId: { in: workspaceRoles.map(r => r.id) } },
    })
    return this.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    })
  }

  async updateMemberRole(workspaceId: string, userId: string, role: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!member) throw new NotFoundException('成员不存在')
    if (member.role === 'owner') throw new ForbiddenException('不能修改工作空间创建者的角色')

    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role },
    })
    await this.syncRbacRole(workspaceId, userId, role)
    return member
  }
}
