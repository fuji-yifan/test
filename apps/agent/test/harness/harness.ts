import { ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { AgentCatalogService } from '../../src/modules/graph/agent-catalog'
import { RouterService } from '../../src/modules/graph/router.service'
import { PlanService } from '../../src/modules/graph/plan.service'
import { AgentSubgraphFactory } from '../../src/modules/graph/subgraph.factory'
import { AgentGraphService } from '../../src/modules/graph/agent-graph.service'
import { GraphRunnerService, type GraphEvent } from '../../src/modules/graph/graph-runner.service'
import { LangChainToolBridge } from '../../src/modules/graph/tool-bridge.service'
import { FakeGateway, FakeRegistry, ScriptedLlm, type Script } from './fakes'

export interface Harness {
  runner: GraphRunnerService
  gateway: FakeGateway
  llm: ScriptedLlm
  events: GraphEvent[]
  sessionId: string
}

/**
 * 构造 harness 的工厂。**checkpoint saver 由调用方注入**——各 spec 自建自己的 MySQL
 * 临时库（`getSaver` 在 beforeAll 之后才被读取，故可传闭包）。
 * 这样同一套 harness 既服务 graph-flow.spec，也服务 eval.spec，且不把库绑定写死。
 */
export function createBuildHarness(getSaver: () => unknown) {
  return function buildHarness(
    script: Script,
    overrides?: {
      catalogSpec?: any
      config?: Record<string, unknown>
      memories?: any[]
      /** 假的 ContextService：验「工作空间里已保存的表」按名称载入 */
      context?: any
    },
  ): Harness {
    const registry = new FakeRegistry() as any
    const gateway = new FakeGateway()
    // 假配置：错误恢复阈值与 .env.example 默认一致；可用 overrides.config 覆盖/补充
    const config = {
      get: (key: string) =>
        ({
          'context.maxRetries': 2,
          'context.maxDegrades': 1,
          'context.maxToolResultTokens': 2000,
          'context.maxToolResultChars': 8000,
          ...(overrides?.config ?? {}),
        } as Record<string, unknown>)[key],
    } as any
    const bridge = new LangChainToolBridge(registry, gateway as any, config)
    const skills = { getAllMeta: () => [], loadFull: () => null } as any
    const catalog = new AgentCatalogService(skills, registry)
    if (overrides?.catalogSpec) {
      catalog.list = () => [overrides.catalogSpec]
    }
    const llm = new ScriptedLlm(script)
    const subgraphs = new AgentSubgraphFactory(bridge, llm as any, registry, skills, config, overrides?.context)
    const router = new RouterService(catalog, llm as any)
    const plan = new PlanService()
    const checkpoint = { enabled: true, get saver() { return getSaver() } } as any
    // 假长期记忆：recall 回 overrides.memories（默认空），写入/删除为 no-op
    const memory = {
      retrieve: async () => overrides?.memories ?? [],
      available: async () => (overrides?.memories?.length ?? 0) > 0,
      list: async () => overrides?.memories ?? [],
      remove: async () => false,
      extractAndStore: async () => undefined,
    } as any
    const graphs = new AgentGraphService(router, plan, catalog, subgraphs, checkpoint, config, memory)
    const sessions = {
      updateMetadata: async () => undefined,
      addMessage: async () => undefined,
    } as any
    const runner = new GraphRunnerService(graphs, sessions)
    return { runner, gateway, llm, events: [], sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  }
}

/** 最小 submission spec：不带任何检查点，专门用来验工具失败后的错误恢复级联 */
export function submissionSpec(toolNames: string[], maxIterations = 8) {
  return {
    key: 'submission',
    label: 'Submission Agent',
    scenario: 'data-analysis',
    toolNames,
    serverTools: toolNames,
    maxIterations,
    systemPrompt: () => 'submission',
    extractArtifact: () => null,
    checkpoints: [],
  }
}

/** 某次 think 收到的上下文里，ToolMessage 的文本内容 */
export function toolContentsOf(msgs: BaseMessage[]): string[] {
  return msgs.filter((m) => ToolMessage.isInstance(m)).map((m) => String((m as ToolMessage).content))
}

export async function runTurn(h: Harness, message: string, scenario = 'form-builder', workspaceId = 'w1') {
  const events: GraphEvent[] = []
  const result = await h.runner.run({
    sessionId: h.sessionId,
    userId: 'u1',
    workspaceId,
    userToken: 'tok',
    message,
    pageContext: { scenario },
    onEvent: (e) => events.push(e),
  })
  h.events = events
  return result
}

export async function resumeTurn(h: Harness, resume: unknown, workspaceId = 'w1') {
  const events: GraphEvent[] = []
  const result = await h.runner.resume({
    sessionId: h.sessionId,
    userId: 'u1',
    workspaceId,
    userToken: 'tok',
    resume,
    onEvent: (e) => events.push(e),
  })
  h.events = events
  return result
}
