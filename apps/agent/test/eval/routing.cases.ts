import type { AgentKey } from '../../src/modules/graph/agent-state'
import type { Script } from '../harness/fakes'

/**
 * eval 用例：只锁**确定性**行为（路由落在哪个 agent、是否跨领域、计划步骤序列），
 * 不锁 LLM 兜底质量（那个靠真机探针抽样，见手册 §3.1）。
 *
 * `cases` 关联 `docs/AGENT_MANUAL_TEST_CASES.md` 的用例编号，便于双向追溯。
 */
export interface EvalCase {
  name: string
  cases?: string
  input: string
  page: string
  /** 同一会话里先发的用户消息（按序）；用来构造跨轮 / pendingClarification 场景 */
  prior?: string[]
  /** 覆盖默认脚本（默认 `[{content:'好的'}]`）；按 think 顺序给出 */
  script?: Script
  expect: {
    agent: AgentKey
    isCrossDomain?: boolean
    planAgents?: AgentKey[]
  }
}

/** 追尾追问那句话，用来让上一轮以「提问收尾」从而写入 pendingClarification */
const ASK_SCRIPT: Script = [{ content: '请问要分析哪张表？' }, { content: '好的' }]

export const routingCases: EvalCase[] = [
  {
    name: 'F1 表单页建表 → form-designer',
    cases: 'F1',
    input: '创建客户登记表(姓名/手机/邮箱)',
    page: 'form-builder',
    expect: { agent: 'form-designer', isCrossDomain: false, planAgents: ['form-designer'] },
  },
  {
    name: 'R1 页面优先：模板页说「你好」仍留 template',
    cases: 'R1',
    input: '你好',
    page: 'template-creator',
    expect: { agent: 'template', isCrossDomain: true, planAgents: ['template', 'form-designer'] },
  },
  {
    name: 'R2 跨页面：表单页说「搜索请假模板」→ template',
    cases: 'R2',
    input: '搜索请假模板',
    page: 'form-builder',
    expect: { agent: 'template', isCrossDomain: true, planAgents: ['template', 'form-designer'] },
  },
  {
    name: 'R3 表单强信号：流程页说「设计一个…表」→ form-designer（不被审批词误判）',
    cases: 'R3',
    input: '设计一个报销信息填写表',
    page: 'workflow-node',
    expect: { agent: 'form-designer', isCrossDomain: false, planAgents: ['form-designer'] },
  },
  {
    name: 'R4 短消息：数据分析页说「在吗」保持 submission',
    cases: 'R4',
    input: '在吗',
    page: 'data-analysis',
    expect: { agent: 'submission', isCrossDomain: false, planAgents: ['submission'] },
  },
  {
    name: 'W1 流程创建 → workflow',
    cases: 'W1',
    input: '创建三级审批流(组长→经理→总监)',
    page: 'workflow-node',
    expect: { agent: 'workflow', isCrossDomain: false, planAgents: ['workflow'] },
  },
  {
    name: 'T3 强信号让位：模板页说「帮我设计一个表单」→ form-designer',
    cases: 'T3',
    input: '帮我设计一个表单',
    page: 'template-creator',
    expect: { agent: 'form-designer', isCrossDomain: false, planAgents: ['form-designer'] },
  },
  {
    name: 'C1 跨领域：模板+流程+创建 → 三步计划',
    cases: 'C1',
    input: '搜索请假模板，基于它创建表单并配一个审批流程',
    page: 'form-builder',
    expect: { agent: 'template', isCrossDomain: true, planAgents: ['template', 'form-designer', 'workflow'] },
  },
  {
    name: '§2.9 复现：数据分析会话补「教职工信息表单」仍落 submission（pending 沿用）',
    cases: 'M1',
    input: '教职工信息表单',
    page: 'data-analysis',
    prior: ['分析本月提交数据'],
    script: ASK_SCRIPT,
    expect: { agent: 'submission', isCrossDomain: false, planAgents: ['submission'] },
  },
  {
    name: '§2.9 反例：同一会话里强信号「创建一个三级审批流程」仍切 workflow',
    cases: 'M2',
    input: '创建一个三级审批流程',
    page: 'data-analysis',
    prior: ['分析本月提交数据'],
    script: ASK_SCRIPT,
    expect: { agent: 'workflow', isCrossDomain: false, planAgents: ['workflow'] },
  },
  {
    name: 'S1 只读分析：数据分析页说「删掉…记录」仍落 submission',
    cases: 'S1',
    input: '把那条客户反馈记录删掉',
    page: 'data-analysis',
    expect: { agent: 'submission', isCrossDomain: false, planAgents: ['submission'] },
  },
]
