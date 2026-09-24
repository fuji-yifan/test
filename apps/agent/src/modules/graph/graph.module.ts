import { Module } from '@nestjs/common'
import { ToolsModule } from '../harness/tools.module'
import { SessionModule } from '../session/session.module'
import { CheckpointModule } from './checkpoint.module'
import { LangChainToolBridge } from './tool-bridge.service'
import { AgentCatalogService } from './agent-catalog'
import { RouterService } from './router.service'
import { PlanService } from './plan.service'
import { AgentSubgraphFactory } from './subgraph.factory'
import { AgentGraphService } from './agent-graph.service'
import { GraphRunnerService } from './graph-runner.service'

/**
 * LangGraph 编排模块。
 *
 * 结构：router（页面+提示词路由）→ planDriver（按计划分发）→ 领域子图（ReAct +
 * 声明式 HITL 检查点）→ planAdvance（登记产物/推进）→ aggregate。
 * 领域 Agent 的声明集中在 AgentCatalogService，加 Agent 只需要改那一处。
 */
@Module({
  imports: [ToolsModule, SessionModule, CheckpointModule],
  providers: [
    LangChainToolBridge,
    AgentCatalogService,
    PlanService,
    RouterService,
    AgentSubgraphFactory,
    AgentGraphService,
    GraphRunnerService,
  ],
  exports: [
    LangChainToolBridge,
    AgentCatalogService,
    PlanService,
    RouterService,
    AgentGraphService,
    GraphRunnerService,
  ],
})
export class AgentGraphModule {}
