import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaClient } from '@prisma/client'

export const REQUIRED_PERMISSION_KEY = 'requiredPermission'
export const RequiredPermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission)

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions'
export const RequiredPermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions)

const ALL_PERMISSION_KEYS = new Set([
  'form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'form:delete',
  'submission:view', 'submission:edit', 'submission:delete', 'submission:export',
  'analytics:view',
  'template:create', 'template:edit', 'template:delete',
  'workflow:manage', 'workflow:edit', 'workflow:delete', 'workflow:start', 'workflow:withdraw', 'workflow:remove',
  'task:approve', 'task:reject', 'task:transfer',
  'member:invite', 'member:role', 'member:remove',
  'role:create', 'role:edit', 'role:delete',
  'audit:view', 'audit:export', 'audit:cleanup',
  'webhook:manage', 'upload:manage',
])

const LABEL_MAP: Record<string, string> = {
  'form:create': '新建表单', 'form:edit': '修改表单', 'form:delete': '删除表单',
  'form:publish': '发布表单', 'form:archive': '归档表单', 'form:copy': '复制表单',
  'submission:view': '查看表单数据', 'submission:edit': '编辑表单数据',
  'submission:delete': '删除表单数据', 'submission:export': '导出表单数据',
  'analytics:view': '查看数据分析',
  'template:create': '创建模板', 'template:edit': '修改模板', 'template:delete': '删除模板',
  'workflow:manage': '新建流程', 'workflow:edit': '修改流程', 'workflow:delete': '删除流程',
  'workflow:start': '启动流程', 'workflow:withdraw': '撤回流程', 'workflow:remove': '删除流程实例',
  'task:approve': '通过审批', 'task:reject': '驳回审批', 'task:transfer': '转交审批',
  'member:invite': '邀请成员', 'member:role': '修改成员角色', 'member:remove': '移除成员',
  'role:create': '新建角色', 'role:edit': '编辑角色权限', 'role:delete': '删除角色',
  'audit:view': '查看审计日志', 'audit:export': '导出审计日志', 'audit:cleanup': '清理审计日志',
  'webhook:manage': '管理 Webhook', 'upload:manage': '管理文件',
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.userId) return false

    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (!required) return true

    // 解析 workspaceId
    let wsId = request.params.wsId || request.params.workspaceId
      || request.query?.workspaceId || request.body?.workspaceId

    if (!wsId) {
      wsId = await this.resolveWorkspaceId(request)
    }

    if (!wsId) {
      throw new ForbiddenException('无法确定工作空间上下文')
    }

    // 查成员 + RBAC 角色
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: wsId, userId: user.userId } },
    })
    if (!member) {
      throw new ForbiddenException('您不是该工作空间的成员')
    }

    // owner 拥有所有权限
    if (member.role === 'owner') return true

    // 查该成员在 RBAC 中分配的角色权限
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.userId, role: { workspaceId: wsId } },
      include: { role: true },
    })

    const perms = new Set<string>()
    for (const ur of userRoles) {
      const p = (ur.role.permissions as string[]) || []
      if (p.includes('*')) return true
      for (const key of p) {
        if (ALL_PERMISSION_KEYS.has(key)) perms.add(key)
      }
    }

    if (perms.has(required)) return true

    throw new ForbiddenException(`权限不足：需要「${LABEL_MAP[required] || required}」权限`)
  }

  private async resolveWorkspaceId(request: any): Promise<string | undefined> {
    const resourceId = request.params.formId || request.params.id || request.params.instanceId
    if (!resourceId) return undefined

    const queries = [
      () => this.prisma.form.findUnique({ where: { id: resourceId }, select: { workspaceId: true } }),
      () => this.prisma.processDefinition.findUnique({ where: { id: resourceId }, select: { workspaceId: true } }),
      async () => {
        const inst = await this.prisma.processInstance.findUnique({
          where: { id: resourceId }, include: { definition: { select: { workspaceId: true } } },
        })
        return inst?.definition ?? null
      },
    ]
    for (const q of queries) {
      try {
        const result = await q()
        if (result && 'workspaceId' in result && result.workspaceId) return result.workspaceId
      } catch { /* ignore */ }
    }
    return undefined
  }
}
