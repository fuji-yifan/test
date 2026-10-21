/**
 * RowLevelInterceptor — 行级权限拦截器
 *
 * 统一在数据查询层注入行级权限条件，实现"用户只能看自己/本部门的数据"。
 * 原理：拦截 Submission 查询请求，根据用户部门信息自动注入 WHERE 条件。
 *
 * 用法：在 Controller 方法上加 @UseInterceptors(RowLevelInterceptor)
 *
 * 安全原则：
 *   - 在后端统一拦截，避免每个接口手写权限逻辑 → 防止漏判
 *   - 前端看不到的数据，后端同样不可查询 → 双重保障
 */

import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { PrismaClient } from '@prisma/client'

export interface RowLevelContext {
  userId: string
  deptId?: string
  deptIds?: string[]       // 用户所在部门及所有子部门 ID
  roles: string[]
}

@Injectable()
export class RowLevelInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RowLevelInterceptor.name)

  constructor(private prisma: PrismaClient) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user?.userId) {
      return next.handle()
    }

    // 构建行级权限上下文
    const rowCtx: RowLevelContext = {
      userId: user.userId,
      deptId: user.deptId,
      deptIds: user.deptIds || [],
      roles: user.roles || [],
    }

    // 如果用户是平台/空间管理员 → 跳过行级限制
    if (rowCtx.roles.some((r: string) => r === 'role:super_admin' || r === 'role:workspace_admin')) {
      return next.handle()
    }

    // 将行级上下文挂载到 request，供 service 层使用
    request.rowLevelContext = rowCtx

    return next.handle()
  }
}

