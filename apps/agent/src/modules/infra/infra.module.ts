import { Global, Module } from '@nestjs/common'
import { PolicyEngineService } from './policy-engine.service'

/**
 * 外部基建适配模块（阶段 6）。
 *
 * 收纳所有「可选外部服务」的适配器：每个都 **env-gated、未配置即 no-op**，命名沿用仓内
 * `AgentRedisModule` / `AgentCacheModule` 的 `@Global()` 惯例（审计同款横切关注点），
 * 免去逐模块 import。切片 1 先落策略引擎；后续切片追加追踪 / 护栏。
 */
@Global()
@Module({
  providers: [PolicyEngineService],
  exports: [PolicyEngineService],
})
export class InfraModule {}
