/**
 * FieldACLInterceptor — 字段级访问控制拦截器
 *
 * 在数据提交/更新时，校验用户是否有权限修改特定字段。
 * 流程：
 *   1. 从 JWT 提取用户角色
 *   2. 读取目标表单的 Schema
 *   3. 遍历 Schema 中每个字段的 acl 定义
 *   4. 过滤掉用户无权编辑的字段值 → 返回 403 或静默过滤
 *
 * 用法：在 Controller 方法上加 @UseInterceptors(FieldACLInterceptor)
 */

import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
  ForbiddenException, Logger,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class FieldACLInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FieldACLInterceptor.name)

  constructor(private prisma: PrismaClient) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest()
    const user = request.user // JWT 解析后的 { userId, email, roles? }
    const body = request.body

    if (!body?.data || !user?.roles?.length) {
      // 没有角色信息 → 放行（匿名提交或权限信息缺失）
      return next.handle()
    }

    // 从请求路径中提取 formId
    const formId = request.params.formId
    if (!formId) return next.handle()

    try {
      const form = await this.prisma.form.findUnique({
        where: { id: formId },
        select: { schema: true },
      })

      if (!form?.schema) return next.handle()

      const schema = form.schema as any
      const fields = schema.fields || []
      const userRoles: string[] = user.roles || []

      // 收集用户无权编辑的字段
      const blockedFields: string[] = []
      this.collectRestrictedFields(fields, userRoles, body.data, blockedFields)

      if (blockedFields.length > 0) {
        this.logger.warn(
          `用户 ${user.userId} 尝试修改无权字段: ${blockedFields.join(', ')}`,
        )

        // 策略选择：静默过滤 or 拒绝请求
        // 此处选择静默过滤（删除无权字段后继续处理）
        for (const key of blockedFields) {
          delete body.data[key]
        }
      }
    } catch (e) {
      this.logger.error('FieldACLInterceptor error:', e)
      // 出错时放行，不阻塞正常流程
    }

    return next.handle()
  }

  /**
   * 递归遍历 Schema 中的所有字段，收集用户无权编辑的字段
   */
  private collectRestrictedFields(
    fields: any[],
    userRoles: string[],
    submittedData: Record<string, any>,
    blockedFields: string[],
  ): void {
    for (const field of fields) {
      if (field.acl) {
        // 检查 viewable
        if (field.acl.viewable?.length) {
          const canView = field.acl.viewable.some((r: string) => userRoles.includes(r))
          if (!canView && field.key && field.key in submittedData) {
            blockedFields.push(field.key)
          }
        }

        // 检查 editable
        if (field.acl.editable?.length) {
          const canEdit = field.acl.editable.some((r: string) => userRoles.includes(r))
          if (!canEdit && field.key && field.key in submittedData) {
            blockedFields.push(field.key)
          }
        }
      }

      // 递归子字段
      if (field.children?.length) {
        this.collectRestrictedFields(field.children, userRoles, submittedData, blockedFields)
      }
    }
  }
}
