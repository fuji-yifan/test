import { Global, Module } from '@nestjs/common'
import { AgentRedisModule } from './redis.module'
import { ToolResultCache } from './tool-cache.service'

/**
 * Agent 缓存模块（阶段 4 / 4.5）。@Global：ToolGateway 需要注入 ToolResultCache，
 * 避免在 harness/tools.module 里再显式 import。
 */
@Global()
@Module({
  imports: [AgentRedisModule],
  providers: [ToolResultCache],
  exports: [ToolResultCache],
})
export class AgentCacheModule {}
