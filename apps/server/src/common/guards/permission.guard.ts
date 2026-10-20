import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger, SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaClient } from '@prisma/client'
import { AuditService } from '../../modules/audit/audit.service'

export const REQUIRED_PERMISSION_KEY = 'requiredPermission'

export const RequiredPermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission)

const ALL_PERMISSION_KEYS = new Set([
  'form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'form:delete',
  'submission:view', 'submission:delete', 'submission:export',
  'analytics:view',
  'template:create', 'template:edit', 'template:delete',
  'workflow:manage', 'workflow:edit', 'workflow:publish', 'workflow:unpublish', 'workflow:delete',
  'task:approve', 'task:reject', 'task:transfer',
  'member:invite', 'member:role', 'member:remove',
  'role:create', 'role:edit', 'role:delete',
  'audit:view', 'audit:export', 'audit:cleanup',
])

const LABEL_MAP: Record<string, string> = {
  'form:create': '新建表单', 'form:edit': '修改表单', 'form:delete': '删除表单',
  'form:publish': '发布表单', 'form:archive': '归档表单', 'form:copy': '复制表单',
  'submission:view': '查看表单数据',
  'submission:delete': '删除表单数据', 'submission:export': '导出表单数据',
  'analytics:view': '查看数据分析',
  'template:create': '创建模板', 'template:edit': '修改模板', 'template:delete': '删除模板',
  'workflow:manage': '新建流程', 'workflow:edit': '修改流程',
  'workflow:publish': '发布流程', 'workflow:unpublish': '撤回流程', 'workflow:delete': '删除流程',
  'task:approve': '通过审批', 'task:reject': '驳回审批', 'task:transfer': '转交审批',
  'member:invite': '邀请成员', 'member:role': '修改成员角色', 'member:remove': '移除成员',
  'role:create': '新建角色', 'role:edit': '编辑角色权限', 'role:delete': '删除角色',
  'audit:view': '查看审计日志', 'audit:export': '导出审计日志', 'audit:cleanup': '清理审计日志',
}

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name)

  constructor(
    private reflector: Reflector,
    private prisma: PrismaClient,
    private audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.userId) return false

    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION_KEY, [context.getHandler(), context.getClass()])
    if (!required) return true

    // 解析 workspaceId（阶段 6 / S1.3，堵「伪造 wsId」）
    // - 先试资源作用域（带 formId/id/instanceId）：以**资源真实所属** workspace 为准，
    //   忽略客户端 query/body 传入的 workspaceId —— 否则可拿别的空间 id 蒙混成员校验。
    // - 解析不到就退回 JWT 里**可信**的 workspaceId，其次才是路径参数/客户端值。
    //   `:id` 并不总是资源 id：/workspaces/:id/members/:userId 的 :id 是工作空间 id、
    //   /workspaces/:wsId/roles/:id 的 :id 是角色 id，资源解析必然落空。不退回的话这些路由的
    //   权限校验一律 403「无法确定工作空间上下文」，而该文案含「工作空间」会被前端拦截器
    //   当成「成员身份失效」→ 清掉当前空间并强制跳首页。
    const resourceScopedId = request.params.formId || request.params.id || request.params.instanceId
    let wsId: string | undefined
    if (resourceScopedId) wsId = await this.resolveWorkspaceId(request)
    if (!wsId) {
      wsId = request.user?.workspaceId
        || request.params.wsId || request.params.workspaceId
        || request.query?.workspaceId || request.body?.workspaceId
    }

    if (!wsId) {
      throw new ForbiddenException('无法确定工作空间上下文')
    }

    // 查成员 + RBAC 角色
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: wsId, userId: user.userId } },
    })
    if (!member) {
      this.writeDeniedAudit(request, user.userId, wsId, required, 'not_member')
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

    this.writeDeniedAudit(request, user.userId, wsId, required, 'insufficient_permission')
    throw new ForbiddenException(`权限不足：需要「${LABEL_MAP[required] || required}」权限`)
  }

  /** 权限拒绝审计（fire-and-forget，不影响拒绝语义；失败仅记日志） */
  private writeDeniedAudit(
    request: any,
    userId: string,
    workspaceId: string,
    required: string,
    reason: string,
  ) {
    const xff = request?.headers?.['x-forwarded-for']
    const ip = typeof xff === 'string' && xff ? xff.split(',')[0].trim() : request?.ip || undefined
    void this.audit
      .log({
        workspaceId,
        userId,
        action: 'auth.permission_denied',
        resourceType: 'Permission',
        details: { required, reason },
        ip,
      })
      .catch((e) => this.logger.warn(`权限拒绝审计写入失败：${e?.message ?? e}`))
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
