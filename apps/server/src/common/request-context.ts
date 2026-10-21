import { AsyncLocalStorage } from 'async_hooks'

interface RequestContext {
  userId?: string
  workspaceId?: string
  ip?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/** NestJS 中间件：提取 userId / workspaceId 并绑定到请求上下文 */
export function useContextMiddleware(req: any, _res: any, next: () => void) {
  const ctx: RequestContext = {
    ip: req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress,
  }
  // JWT 守卫会注入 user 对象到 req
  if (req.user) {
    ctx.userId = req.user.userId || req.user.sub
    ctx.workspaceId = req.user.workspaceId
  }
  // 部分接口在 query/body 中传 workspaceId
  if (!ctx.workspaceId) {
    ctx.workspaceId = req.query?.workspaceId || req.body?.workspaceId || req.params?.workspaceId
  }
  storage.run(ctx, next)
}
