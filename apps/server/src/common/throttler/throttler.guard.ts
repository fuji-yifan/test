import { Inject, Injectable, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  ThrottlerGuard,
  getOptionsToken,
  getStorageToken,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler'

/**
 * 全局限流守卫（阶段 6 / S6.1）。
 *
 * **默认关**：`RATE_LIMIT_ENABLED !== 'true'` 时 `canActivate` 直接放行 —— 行为与「没装限流」逐字节一致。
 * 打开后按**工作空间 → 用户 → IP** 分级限流（多租户下避免一个大客户挤掉全站）。默认超限即 HTTP 429。
 *
 * 计数器存储由 `ThrottlerModule` 注入（Redis 有则 Redis、无则内存，见 `RedisThrottlerStorage`）。
 */
@Injectable()
export class InfraThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.RATE_LIMIT_ENABLED !== 'true') return true
    return super.canActivate(context)
  }

  /** 分级 tracker：登录用户按工作空间聚合、其次按用户、匿名按 IP。 */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const workspaceId = req?.user?.workspaceId
    if (workspaceId) return `ws:${workspaceId}`
    const userId = req?.user?.userId
    if (userId) return `user:${userId}`
    return `ip:${req?.ip ?? 'unknown'}`
  }
}
