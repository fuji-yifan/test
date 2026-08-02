/**
 * PermissionGuard — 组合权限守卫（RBAC + ABAC）
 *
 * 使用方式：在 Controller 方法上加 @UseGuards(PermissionGuard) 和 @RequiredPermission('form:edit')
 *
 * 五级权限模型：
 *   L1 平台级 → super_admin 拥有所有权限
 *   L2 应用/工作空间级 → workspace owner 拥有空间内所有权限
 *   L3 表单级 → 具体权限点如 form:edit, form:delete
 *   L4 行级 → RowLevelInterceptor 处理
 *   L5 字段级 → FieldACLInterceptor 处理
 *
 * 判定流程：
 *   RBAC 判定（角色 → 权限点）
 *     └─ 通过 → ABAC 判定（属性 → 策略）
 *          └─ 通过 → 放行
 *  任一失败 → 403
 */

import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger, SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaClient } from '@prisma/client'
import { CacheService } from '../../modules/cache/cache.service'

// ==================== 装饰器 ====================

/** 定义接口所需的权限点 */
export const REQUIRED_PERMISSION_KEY = 'requiredPermission'
export const RequiredPermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission)

/** 定义接口所需的权限点列表（任一满足即可） */
export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions'
export const RequiredPermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions)

// ==================== 守卫 ====================

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name)

  constructor(
    private reflector: Reflector,
    private prisma: PrismaClient,
    private cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.userId) return false

    // 从装饰器获取所需权限
    const requiredPermission = this.reflector.get<string>(
      REQUIRED_PERMISSION_KEY,
      context.getHandler(),
    )
    const requiredPermissions = this.reflector.get<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      context.getHandler(),
    )

    // 无权限要求 → 放行
    if (!requiredPermission && (!requiredPermissions || requiredPermissions.length === 0)) {
      return true
    }

    let workspaceId = request.params.wsId || request.params.workspaceId

    // 如果路径中没有 workspaceId，尝试从 :id 参数（workspace 路由）或资源推断
    if (!workspaceId) {
      // 检查 :id 是否为 workspace ID（如 /workspaces/:id/members 等路由）
      if (request.params.id) {
        const ws = await this.prisma.workspace.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        })
        if (ws) workspaceId = ws.id
      }
      if (!workspaceId) {
        workspaceId = await this.resolveWorkspaceId(request)
      }
    }

    // === L1 平台级 → super_admin 拥有所有权限 ===
    if (user.roles?.includes('role:super_admin')) {
      return true
    }

    // === L2 工作空间级 → workspace owner 拥有所有权限 ===
    if (workspaceId) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: user.userId,
          },
        },
      })
      if (membership?.role === 'owner') {
        return true
      }
    }

    // === L3 表单级 RBAC 判定 ===
    const userPermissions = await this.getUserPermissions(workspaceId, user.userId)

    const labelMap: Record<string, string> = {
      'form:create': '新建表单', 'form:edit': '修改表单', 'form:delete': '删除表单',
      'form:publish': '发布表单', 'form:archive': '归档表单', 'form:copy': '复制表单',
      'submission:create': '提交表单数据', 'submission:view': '查看表单数据',
      'submission:delete': '删除表单数据', 'submission:export': '导出表单数据',
      'analytics:view': '查看数据分析',
      'template:create': '创建模板', 'template:edit': '修改模板', 'template:delete': '删除模板',
      'workflow:manage': '新建固有流程', 'workflow:edit': '修改固有流程', 'workflow:delete': '删除固有流程',
      'workflow:start': '发起我的流程', 'workflow:withdraw': '撤回我的流程', 'workflow:remove': '删除我的流程',
      'task:approve': '通过审批', 'task:reject': '驳回审批', 'task:transfer': '转交审批',
      'member:invite': '添加成员', 'member:role': '修改成员角色', 'member:remove': '移除成员',
      'role:create': '新建角色', 'role:edit': '编辑角色权限', 'role:delete': '删除角色',
      'audit:view': '查看审计日志', 'audit:export': '导出审计日志',
    }
    const resolveLabel = (k: string) => labelMap[k] || k

    if (requiredPermission) {
      if (!userPermissions.includes(requiredPermission) && !userPermissions.includes('*')) {
        throw new ForbiddenException(`权限不足：需要「${resolveLabel(requiredPermission)}」权限`)
      }
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasAny = requiredPermissions.some(
        (p) => userPermissions.includes(p) || userPermissions.includes('*'),
      )
      if (!hasAny) {
        throw new ForbiddenException(`权限不足：需要${requiredPermissions.map(resolveLabel).join('或')}中的任一权限`)
      }
    }

    // === ABAC 判定（扩展点） ===
    // 此处可根据用户属性（部门、地区、职级）做进一步判定
    // 例如："只能编辑本部门的数据"

    return true
  }

  /** 从资源 ID 反查 workspaceId */
  private async resolveWorkspaceId(request: any): Promise<string | undefined> {
    const formId = request.params.id || request.params.formId
    if (formId) {
      try {
        const form = await this.prisma.form.findUnique({
          where: { id: formId },
          select: { workspaceId: true },
        })
        return form?.workspaceId
      } catch { /* ignore */ }
    }
    return undefined
  }

  private async getUserPermissions(workspaceId: string | undefined, userId: string): Promise<string[]> {
    // 无工作空间上下文 → 拒绝（不给任何权限）
    if (!workspaceId) return []

    // 尝试从 Redis 缓存获取权限
    const cached = await this.cache.getUserPermissions(workspaceId, userId)
    if (cached !== null) return cached

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!membership) return []
    if (membership.role === 'owner') {
      await this.cache.setUserPermissions(workspaceId, userId, ['*'])
      return ['*']
    }

    // 查询该用户在此工作空间所属 RBAC 角色的权限
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, role: { workspaceId } },
      include: { role: true },
    })

    const permissions = new Set<string>()
    for (const ur of userRoles) {
      const perms = (ur.role.permissions as string[]) || []
      perms.forEach((p) => permissions.add(p))
    }
    const result = Array.from(permissions)

    await this.cache.setUserPermissions(workspaceId, userId, result)
    return result
  }
}
