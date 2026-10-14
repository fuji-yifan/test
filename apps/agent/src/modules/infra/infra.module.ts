import { Global, Module } from '@nestjs/common'
import { PolicyEngineService } from './policy-engine.service'
import { TracingService } from './tracing.service'
import { GuardrailsService } from './guardrails.service'

/**
 * 外部基建适配模块（阶段 6）。
 *
 * 收纳所有「可选外部服务」的适配器：每个都 **env-gated、未配置即 no-op**，命名沿用仓内
 * `AgentRedisModule` / `AgentCacheModule` 的 `@Global()` 惯例（审计同款横切关注点），
 * 免去逐模块 import。切片 1 策略引擎、切片 2 追踪、切片 3 护栏。
 */
@Global()
@Module({
  providers: [PolicyEngineService, TracingService, GuardrailsService],
  exports: [PolicyEngineService, TracingService, GuardrailsService],
})
export class InfraModule {}
