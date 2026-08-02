import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { getRequestContext } from '../request-context'

/**
 * 在 Auth Guard 之后运行，将已认证的用户信息写入 AsyncLocalStorage 审计上下文。
 * 供 Prisma 审计中间件读取，自动记录操作人。
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest()
    const ctx = getRequestContext()
    if (ctx && req.user) {
      ctx.userId = req.user.userId || req.user.sub
      // 从 URL params / body 提取 workspaceId
      ctx.workspaceId =
        req.params?.wsId ||
        req.params?.workspaceId ||
        req.query?.workspaceId ||
        req.body?.workspaceId ||
        ctx.workspaceId
    }
    return next.handle()
  }
}
