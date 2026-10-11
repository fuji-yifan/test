# Agent 手测用例

图例：✅ 通过 ｜ ❌ 跑了但不通过 ｜ 🖐 必须人工在浏览器点 ｜ ➖ 无法从外部强制触发

## 一、主用例表

实测环境（2026-09-20 首测，2026-09-21、09-22、09-24 复测）：agent:3002 + server:3000 + 本机 MySQL formpu 全栈在跑；用真实用户 token 走 `POST /api/v1/agent/chat`（SSE），写入落在名为 `ceshi` 的测试空间。2026-09-24 起只跑 LangGraph —— legacy 引擎与 `AGENT_ENGINE` 开关一并删除（见 3.11）。

状态列 = 2026-09-21/09-22 复测后的结果；「实测」列保留 09-20 的原始记录，改动过的行注明复测结论。

多表用例（F5–F8）由 `/mnt/d/agent-e2e/probe_worksheet.py` 驱动，证据落在 `D:\agent-e2e\evidence-worksheet\`，落库核对用 `db_forms.js`（列每张表的字段 key）。

| # | 场景 | 输入 | 页面 | 期望 Agent | 期望行为 | 状态 | 实测（2026-09-20；复测见备注） |
|----|------|------|------|-----------|---------|------|------|
| F1 | 表单-基础创建 | 创建客户登记表(姓名/手机/邮箱) | form-builder | form-designer | form_assemble_schema 被调用且 fields 不为空 | ✅ | 调 1 次，fields=3；停在 schema-review 检查点 |
| F2 | 表单-校验失败 | 创建表单，用不存在的控件类型 xyz | form-builder | form-designer | form_validate_schema 返回 type 不合法 | ✅ | **用例改法**：模型不会照做产出非法 type，改为把含 `type:"xyz"` 的 schema 显式给它校验 → `Schema validation FAILED: 1 errors` |
| F3 | 表单-追加字段 | 已有表单，说"加一个备注字段" | form-builder | form-designer | form_assemble 的 fields 包含原有+新字段 | ✅ | 09-20：**丢字段**，追加后 fields 只剩 `['备注']`（见 3.1）。**09-21 复测通过**：追加后入参仍是 `['备注']`，但工具内按 key 合并，检查点产物 fields=`['姓名','手机号','备注']`，原有字段保住 |
| F4 | 表单-tip-text | 创建表单包含提示文字"请如实填写" | form-builder | form-designer | props.text 不为空 | ✅ | `form_assemble_schema` 入参 text="请如实填写" |
| T1 | 模板-有结果 | 搜索请假模板 | template-creator | template→form-designer | template_search 返回结果，并接着由表单设计助手落库 | ✅ | 搜索段返回 `请假申请单`（人事类）。**09-29 起不再停在模板侧**：模板 Agent 没有 form_save，路由把请求扩成两步（见 3.14）—— 09-29 真机复测 ✅：一路点「继续」后表单真的出现在「表单管理」 |
| T2 | 模板-无结果 | 搜索 xyzabc123 模板 | template-creator | template | 回复"暂无"且不调 form 工具 | ✅ | 只调 template_search，回复"模板市场暂无相关模板"。**09-29 真机首测 ❌ → 当天修完复测 ✅**：首测时同一会话先聊过模板，再问搜不到的关键词，第二步照样跑 `form_assemble_schema`、照着**上一轮的模板**建了张「客户信息登记表」（见 3.15）；修复后复测只调一次 `template_search`，无检查点、无表单卡片 |
| T4 | **模板-独立落库**（新增） | 寻找客户相关表单 | template-creator | template→form-designer | 两步计划，`form_save` 真的把表写进当前空间 | ✅ | 09-29 修 3.14 前：模板助手回「已为你找到并创建好表单 ✅」但表单管理里什么都没有。修后共 **3 个检查点**（instantiate-approval → schema-review → space-approval）；**09-29 真机复测 ✅**：最后一步选「加入当前空间」后表单管理里真的多了这张表 |
| T3 | 模板-强信号让位 | 在模板页说"帮我设计一个表单" | template-creator | form-designer | 切到 form-designer，且不擅自调 form_assemble_schema | ✅ | 09-20：**切到了 form-designer**（未调工具，只反问），与当时期望冲突（见 3.4）。**09-21 拍板改用例期望**：承认「设计…表单」是强信号，切走是对的；复测 `agent=form-designer`、工具=[]（只反问，未擅自建表） |
| W1 | 流程-创建 | 创建三级审批流(组长→经理→总监) | workflow-node | workflow | flow_create + flow_validate 被调用 | ✅ | `['flow_create','flow_validate']` |
| W2 | 流程-DAG校验 | 创建有环的流程 | workflow-node | workflow | flow_validate 返回 hasCycle | ✅ | **用例改法**：模型会直接凭描述拒绝建环流程、根本不调工具；改为把有环定义显式给它校验 → `Flow validation FAILED: 1 errors` |
| R1 | 路由-页面优先 | 在模板页说"你好" | template-creator | template | 模板助手回复，不变成其他 | ✅ | status.agent=template。09-29 补的模板→落库两步不影响本条：模板助手对「你好」不调工具、不产生产物，第二步因上游产物缺失被跳过。**09-29 强版本复测 ✅**：同一会话里先聊过模板（留下草稿）再发「你好」——模板助手回复、0 次工具调用、无检查点、无表单卡片，服务端只有一条「计划步骤 2(form-designer) 引用的上游产物缺失，跳过该步骤」 |
| R2 | 路由-跨页面 | 在表单页说"搜索请假模板" | form-builder | template | 切换到模板助手 | ✅ | 强信号覆盖页面 → template。09-29 起 `route.isCrossDomain=true` 且带两步计划（`steps=['template','form-designer']`），agent 仍是 template |
| R3 | 路由-表单信号 | 在流程页说"设计一个报销信息填写表" | workflow-node | form-designer | 不因为"审批"关键词误判为 workflow | ✅ | 切到 form-designer，未误判 |
| R4 | 路由-短消息 | 在任意页面说"在吗" | 任意 | 页面Agent | 保持页面 Agent 不改变 | ✅ | 数据分析页说"在吗"仍为 submission（注：原注"任意"我按最易误判页取） |
| C1 | 跨领域编排 | 基于客服模板创建表单并配审批流 | form-builder | 多步 plan | plan 生成，多步执行 | ✅ | plan 三步全跑完：`template_search → form_assemble_schema →(继续) validate →(继续) form_save+flow_create+flow_validate →(继续) flow_save`。**需一路点「继续」推进计划** |
| E1 | 错误-缺参数 | LLM调用 form_assemble_schema 不传 fields | form-builder | form-designer | 返回明确错误+重试，不超过3次失败 | ✅ | 模型拒绝照做，拆两层验（见 3.6）：**文案层已验**（HTTP 直打工具端点，拿到 `参数错误：…。请按正确格式重试。`）；**级联层**由 `graph-flow.spec.ts` 多条单测覆盖（第 3 次失败才 `[DEGRADE]`、错一次再成功不误报、两个工具都降级则放弃本轮），真机侧与 3.11 同一段代码 |
| E2 | 错误-缺Token | 不登录直接调 agent | - | - | 返回 401 而非 500 | ✅ | 无 token → HTTP 401 |
| E3 | 错误-Server断连 | Server 未启动时调 template_search | template-creator | template | 提示"后端未启动"而非模糊错误 | ✅ | 09-24 已测：把 agent 的 `SERVER_API_BASE_URL` 指到没人听的端口后调 template_search（代码路径在 context.service.ts:42 把 ECONNREFUSED 转成"后端服务未启动或不可达"）。**注意别真去停 apps/server** —— 同属一个 turbo，会连带收掉 web/agent，理由见 3.13 |
| D1 | SSE-流式 | 会产出文字的提示词（如"你能做什么？"） | form-builder | form-designer | delta 事件逐 token 到达，且只包含模型输出 | ✅ | 09-20：**langgraph 下 0 条 delta**（纯文字回复也一样；legacy 同场景 72 条）（见 3.2）。**09-21 复测通过**：168 条 delta / 290 字符，无提示词泄漏。原输入的"创建留言表"模型直接调工具、没有文字可流，已换成纯文字提示词（见 3.2） |
| D2 | SSE-打字动画 | 创建表单 | form-builder | form-designer | 加载中显示圆点，回答完毕消失 | ✅ | 依赖 D1（D1 已通）；09-24 浏览器确认通过（见第四节） |
| D3 | SSE-工具调用 | 创建表单 | form-builder | form-designer | tool_start/tool_result 事件正确显示 | ✅ | `form_assemble_schema` 1 组 start/result；C1 场景下 3 组 |
| H1 | **HITL 检查点链路**（原表缺失） | 创建表单 → 继续 → 继续 | form-builder | form-designer | 生成结构→问是否可行→预览→问是否加入空间 | ✅ | 链路成立：`assemble →检查点1(带产物)→ 继续 → validate →检查点2"是否加入当前空间" → 继续 → form_save`。**偏离**：第二段实际是 validate 不是预览（见 3.3） |
| S1 | **只读数据分析**（新增） | 数据分析页说"把那条客户反馈记录删掉" | data-analysis | submission | 拒绝写操作、不调任何工具 | ✅ | 0 次工具调用，回复"我是只读的分析 Agent…请到对应的表单页面手动操作" |
| S2 | **任务页默认身份**（新增） | chat/sync 传 scenario=workflow-node | /tasks | workflow | 任务页默认给流程助手 | ✅ | targetAgent=workflow |
| S3 | **未知场景回落**（新增） | chat/sync 传 scenario=brand-new-page | - | form-designer | 回落 form-designer 并告警 | ✅ | targetAgent=form-designer（告警只在服务端日志，外部不可见） |
| F5 | **同会话第二张新表**（新增） | 建客户登记表 → "再帮我做一个员工登记表" | form-builder | form-designer | 工作台两条 entry，第一张不被合并 | ✅ | 09-22：`f1 客户登记表(3) + f2 员工登记表(3)`；第二次 tool_result 是"已生成…包含 3 个字段"（新建分支，没吃旧表字段）。旧版这里是 9→19 混表 |
| F6 | **一轮内建两张表**（新增） | "同时创建客户登记表和员工登记表：客户表含客户名称、联系人；员工表含姓名、工号" | form-builder | form-designer | 一轮内两次 assemble、两条 entry | ✅ | 09-22：2 次 assemble（target=`客户登记表`/`员工登记表`），两次 summary 都是"已生成…"，最终 `f1(2)+f2(2)` 字段各自成套。**共 3 个检查点**：两张表的 schema-review 各点一次"继续"，之后还会撞上"是否加入当前空间" |
| F7 | **保存 A 后再保存 B 不覆盖**（新增） | 建客户登记表并保存 → 建员工登记表并保存 | form-builder | form-designer | 库中新增 2 行，A 内容不被 B 覆盖 | ✅ | 09-22 查库：2 行、字段各自完整（客户 6 / 员工 8），两次 summary 都是 `saved`（B 没拿到 A 的 formId）。旧版这里 B 会静默覆盖 A |
| F8 | **改字段后再保存 = 更新同一行**（新增） | 建报名统计表并保存 → "再加入一个家庭住址字段"并保存 | form-builder | form-designer | 第二次 `form_save` 带 formId，更新同一行 | ✅ | 09-22：第一次 summary `saved`；第二次 `updated` 且产物 formId 不变；查库该行 `versions=2`、`fields=3`，**没有新增行** |
| F9 | **会话-新消息抢占**（新增） | 上一条没答检查点就直接发下一条（连发三条） | form-builder | form-designer | 不再回 SESSION_BUSY，执行权自动交给新消息 | ✅ | 09-22：旧版第三条必回 `SESSION_BUSY` + `stopReason:'locked'`（前端「会话正在执行中，请等待完成」，见 3.7）。改抢占后由 `probe_preempt.py`（并发两条）+ `probe_takeover.py`（第 3 条卡住时发第 4 条）验证：不再出现 error 事件，新消息照常跑到检查点。09-22 复测：3.8 修掉后「上一轮卡住」已不复现，抢占后同一会话的第三条消息也正常（不再留下卡死的会话） |
| F10 | **精简/删除字段**（新增） | 建教职工信息登记表（17 字段）→ "缩减至10个字段" | form-builder | form-designer | 字段真的被删到 10 个，卡片/检查点产物同步 | ✅ | 09-22：修复前模型照做只回了 10 个字段，但工具按 key 合并**只增不减** → 仍是 17 个，卡片与用户要求不符（见 3.9）。改增量契约后（见 3.10）模型只发 `{target:'f1', removeFields:[要删的 key]}`，`已更新表单"…"，删除 7 个字段，共 10 个字段`，检查点产物同步 |
| F11 | **改字段属性/选项不丢配置**（新增） | 建 5 字段表（含 radio 选项与必填）→ "精简到 3 个字段" → "用工性质加一个选项：返聘" | form-builder | form-designer | 保留下来的字段选项与必填一个不丢；改选项只动那一个字段 | ✅ | 09-22 `probe_ops.py`：精简后 `formWorksheet` 里的保留字段仍是 `name r1 / employment_type o4 / gender o2`（修前必是 o0/r0），加选项后 employment_type o5、其余字段未动（见 3.10） |

## 二、自动化测试（单测）

`vitest`，2026-10-11 实测 **10 个文件 / 851 条全绿**，`tsc --noEmit` 干净（注意 `tsconfig.json` 只 include `src/**/*`，spec 不在类型检查范围内）。

跑法（WSL1 起不了 node，借 Windows node）：`cmd.exe /c "cd /d D:\frontend\低代码平台\apps\agent && npx vitest run"`。

CI（阶段 2 起）：`.github/workflows/agent.yml` 起 MySQL service 后 `pnpm test`（turbo → agent/sdk vitest）+ agent `tsc`。

| 文件 | 条数 | 主要锁什么 |
|---|---|---|
| `test/checkpoint-saver.spec.ts` | 718 | 自研 MySQL checkpointer 的序列化与回填 |
| `test/graph-flow.spec.ts` | 35 | 编排主链路：路由 / 多步计划 / 检查点 / 错误恢复级联 / 上游产物缺失跳步 / 跨轮草稿隔离 / 会话记忆（3.6、3.13、3.14、3.15 的单测侧证据） |
| `test/worksheet.spec.ts` | 21 | 会话级工作台：多表寻址与增量契约（3.9、3.10） |
| `test/conversation-state.spec.ts` | 20 | 状态栏 `buildStateBar` / `detectClarification` / 记忆块拼接（阶段 1） |
| `test/langgraph-turn.spec.ts` | 15 | SSE 方言、`stopReason`、error code 过滤（3.5、3.13） |
| `test/form-assemble-schema.spec.ts` | 14 | 按 key 合并字段（3.1） |
| `test/tool-bridge.spec.ts` | 8 | 工具桥接与大结果截断（3.11） |
| `test/session-preempt.spec.ts` | 5 | 执行权抢占（3.7） |
| `test/tool-registry.spec.ts` | 4 | 工具注册与风险等级 |
| `test/eval/eval.spec.ts` | 11 | **确定性路由回归网**（阶段 2）：只用 `route.agent` / `isCrossDomain` / `plan.steps` 断言，见下 |

### 2.1 eval 用例 ↔ 主用例表 对照

`test/eval/routing.cases.ts` 的每条用例都带 `cases` 字段指向主用例表编号（反之此表列出 eval 用例名），改路由/提示词后 eval 变红可直接定位。

| eval 用例名 | 对应主用例 | 锁的行为 |
|---|---|---|
| F1 表单页建表 → form-designer | F1 | 页面身份建表 |
| R1 页面优先：模板页说「你好」仍留 template | R1 | 弱输入不换身份 |
| R2 跨页面：表单页说「搜索请假模板」→ template | R2 | 强信号覆盖页面 + 模板落库两步 |
| R3 表单强信号：流程页说「设计一个…表」→ form-designer | R3 | 不被「审批」弱信号误判 |
| R4 短消息：数据分析页说「在吗」保持 submission | R4 | 短消息不换身份 |
| W1 流程创建 → workflow | W1 | 流程强信号 |
| T3 强信号让位：模板页说「帮我设计一个表单」→ form-designer | T3 | 强信号让位（沿用改期望后的口径） |
| C1 跨领域：模板+流程+创建 → 三步计划 | C1 | 三步计划序列 |
| M1 数据分析会话补「教职工信息表单」仍落 submission | （手册 §2.9 复现） | pendingClarification 沿用，不误建表 |
| M2 同一会话里强信号「创建一个三级审批流程」仍切 workflow | （手册 §2.9 反例） | 记忆不盖过强信号 |
| S1 数据分析页说「删掉…记录」仍落 submission | S1 | 只读领域不被写指令带偏 |

## 三、实测发现（按严重度）

### 3.1 F3 追加字段会丢字段 —— P0（09-21 修，09-22 工作台改造后已复看）
`form_assemble_schema` 是**整表重建**，不合并（`form-assemble-schema.tool.ts:30-52` 直接 `args.fields.map(...)`）。model 侧 prompt 要求"原有全部字段 + 新增字段"（`form-designer.prompt.ts`「修改已有表单」段），并明确说"上一轮成功创建的 schema 就是你当前的起点，直接从对话中取 fields 字段即可"。

实测这个前提不成立：第一轮创建完客户登记表后（停在 schema-review 检查点），第二轮说"加一个备注字段"，模型输出只有 `['备注']`，**姓名/手机号被抹掉**；另一次跑模型干脆回"目前对话里还没有创建过表单"。

同源问题：`getCurrentSchema` 是死代码 —— 定义在 `DesignerView.vue:282`，但 `DefaultLayout.vue:176` 传给 ChatPanel 的只有 `visible/scenario/workspaceId`，agent 侧也没有任何地方读 `context.currentSchema`。所以"后续对话将基于此表单"这句 UI 文案承诺的机制并未接通，模型只能靠对话历史猜，而检查点中断后历史里恰好没有。

**修法（2026-09-20 拍板，09-21 复测通过）**：不打通 `getCurrentSchema`，也不只改 prompt，而是**在 `form_assemble_schema` 工具内按 key 合并字段**。工具新增 `existingSchema` 入参 + `mergeFields()`；草稿 schema 由 `ToolCallContext.currentSchema` 注入（图侧是 `subgraph.factory` 的 `toolCtx` 带草稿，legacy 侧 `base.agent` 取 `session.metadata.draftSchema`）。
复测：追加"备注"后检查点产物 fields=`['姓名','手机号','备注']`。模型侧入参仍然只有新字段（`['备注']`），所以**合并必须留在工具里**，prompt 靠不住。
新增单测 `test/form-assemble-schema.spec.ts`（4 条合并用例）。

**2026-09-21 追加：按 key 合并只是兜底，模型看不到草稿才是病根。** 上面的复测通过是撞运气 —— 那张表恰好是「姓名/手机号」，模型凭空猜也会挑中同样的 key。换成领域字段就露馅：会话里建了 `报名统计表`（9 字段：活动名称/活动日期/活动地点/报名人姓名/…），第二轮说"再加入一个家庭住址字段"，模型回传的是它凭空造的通用人员表（姓名/手机号/性别/出生日期/身份证号/电子邮箱/家庭住址/备注），只有 `field_name`/`field_phone`/`field_remark` 三个 key 撞上，其余 5 个当新字段追加 → **9→14，用户看到的是一堆没要过的字段**。

病根在 `subgraph.factory.ts` 的 `prepare`：每轮都重建 `messages`（只剩 system + 用户这一句），上一轮 tool_call 里那份 schema 随历史一起没了。prompt 里"直接从对话中取 fields 字段即可"这句是**假的**——对话里没有。

**修法**：`AgentSpec` 新增可选 `draftHint`，`prepare` 有草稿时把字段清单（key/name/type + 标题）拼进本轮第一条 HumanMessage；目前只有 form-designer 实现。prompt「修改已有表单」段同步改成指向这份注入的草稿。工具里的按 key 合并保留当兜底。
复测：9 字段的表追加"家庭住址"→ 入参照抄全部 9 个 key + `field_address`，产物 10 个字段（原有字段一字未改）。

**已解决（2026-09-22，会话级表单工作台）**：同一会话里要**另一张新表**（如"再帮我做一个员工请假表"）时，旧版工具会无条件把草稿合并进去 → 19 个字段、混了两张表。根因是「草稿」只有单槽位（`drafts['form-designer'].data` 一个 schema），工作台只认识"当前这一张表"，靠 prompt 打补丁救不回来。

**修法**：新增会话级工作台 `graph/worksheet.ts`（`FormWorksheet{forms[],focusKey}`，每条 entry 带会话内 `key`），图状态加 `formWorksheet` channel；`prepare` 把整份【会话中的表单】清单（key/标题/全部字段）拼进 SystemMessage 尾部，不再重放原始对话历史；工具新增 `target` 参数，**解析放在 `act` 节点**，`tool-bridge` 只在解析到「改已有表」时才注入 `existingSchema`/`formId`，**建新表一律不给** —— 整表重建，不再串表。

顺带修掉一个更严重的隐藏 bug：`tool-bridge` 原先把 `savedFormId`（上次保存的表单 id）无条件注入之后任何 `form_save`，而 `form_save` 的「创建 vs 更新」只看 `args.formId` → 同会话里保存过表 A 再建表 B，**B 会静默覆盖 A**。现在只对解析到的那张已落库表注入。

验收见 F5/F6/F7/F8；单测见 `worksheet.spec.ts`(19) 与 `graph-flow.spec.ts` 的多表三例。旧探针 `probe_merge.py` 仍可复跑，但它只能观察单轮合并行为，多表场景请用 `probe_worksheet.py`。

**历史记录（已无对照物）**：改造当时多表能力只做在 LangGraph 侧，legacy 路径 `ctx.formWorksheet === undefined`、`formTarget` 恒为空，仍是单槽草稿 + 无条件合并，所以 F5–F8 在 legacy 下必然失败、当时不作为验收项。legacy 已于 2026-09-24 删除（见 3.11），这条差异不复存在。

### 3.2 langgraph 下没有 token 流 —— P1（2026-09-21 已修）
`graph-runner.service.ts:118` 只转发 `meta.langgraph_node` 以 `agent_` 开头的 token chunk；但 LLM 实际是在**子图内部**的 `think` 节点调用的（`subgraph.factory.ts:134,201`），`langgraph_node` 是 `'think'`，过滤器把所有 chunk 都丢掉了 → 一条 delta 都没有。legacy 的 `base.agent.ts:145` 正常发 delta。

**修法（09-20 拍板「放宽过滤」，09-21 复测修正）**：过滤条件改成同时看 `langgraph_checkpoint_ns`（图侧身份是 `agent_form_designer:xxx|think:yyy`）。

放宽后踩了一个坑，必须记下来：`streamMode: 'messages'` **不只推 LLM 的 token**，任何写进 `messages` channel 的消息都会被推出来 —— prepare 写进去的 `SystemMessage`+`HumanMessage`、act 写进去的 `ToolMessage` 结果。实测 D1 那轮 3 条 delta 全是不该出现的内容：**2931 字符的系统提示词**、用户自己的消息、tool_result JSON，全部会被前端逐字打进助手气泡。现在加了 `AIMessageChunk.isInstance(msg)` 只认 assistant 的流式分片（`graph-runner.service.ts:119`），复测：文字轮 168 条逐 token delta 且无泄漏；工具直呼轮（无文字可流）自然 0 条。

**用例改法**：D1 原来的输入"创建一个简单的留言表…"会让模型直接调 `form_assemble_schema`、没有文字可流，测不到"逐 token"。已换成必定走纯文字回复的提示词，并在断言里加了"delta 不得含系统提示词"的底线检查。

**usage（09-20 拍板顺带回填，09-21 补完）**：think 节点回填 `usageOf(res)` 只对正常收尾有效 —— 表单流程几乎每轮都挂在检查点上，而**挂起的子图补丁不会冒泡到父图**，父图 `values.usage` 仍是旧值，所以中断轮一直是 `0/0`。现在 gate 把 `state.usage` 塞进 interrupt 载荷（`InterruptPayload.usage`），`graph-runner` 的中断分支优先读它。复测：正常收尾轮 `2278/177`、中断轮 `13647/792`，不再是 0/0。

### 3.3 检查点文案与实际不符 —— P2（2026-09-21 已修）
`schema-review` 检查点文案原写"表单结构已生成，这个结构是否可行？（继续则进入预览）"，但实际第二段执行的是 `form_validate_schema`；`form_preview` 全程没被调用过（form-designer 的 prompt 工作流是 assemble → validate → save，压根没提预览）。

**修法**：只删括号里那句，改成"表单结构已生成，这个结构是否可行？"（`agent-catalog.ts` 的 `schema-review.prompt`）。没有去接 `form_preview` —— 用户拍板的是「不要承诺预览」，不是「真的加预览」。

### 3.4 T3：模板页的"设计一个表单"会切身份 —— 2026-09-21 拍板：改期望，不改路由
路由设计是"提示词强信号覆盖页面身份"，而「设计…表单」正是 form-designer 的强信号（`router.service.ts:23`），所以模板页说这句话会切到 form-designer。行为与设计自洽，与当时的用例期望冲突。

**拍板结论：承认切走是对的，强信号规则不动，改用例期望。** 复测 `agent=form-designer`、工具调用为空（只反问"请描述你想创建的表单"），未擅自建表。

### 3.5 两个引擎的 SSE 方言不一致 —— P2，已随 legacy 删除归档

| 字段 | langgraph | legacy |
|---|---|---|
| `status.agent` | agent key（`form-designer`） | scenario key（`form-builder`） |
| `meta.activeAgent` | agent key | 展示名（`Submission Agent`） |

前端 `ChatPanel.vue` 的 `AGENT_LABEL` 是按 agent key 建的，所以在 legacy 下 `form-builder` / `workflow-node` 查不到标签、状态栏会显示原始字符串。langgraph 侧是对的，**不需要改任何代码**。

2026-09-24 legacy 引擎整体删除（见 3.11）后本项已无对照物，`status.agent` / `meta.activeAgent` 只可能是 agent key —— 归档，不是待办。

### 3.6 E1 缺参数错误 —— 2026-09-24 拆两层验完（原 P2）

原先的问题是这条路径**推不动**：模型明确拒绝"故意省略必填参数"，单测里也只有工具执行失败的透传。09-24 拆成两层分别验：

**文案层（已验，`D:\agent-e2e\probe_e1.py`）** —— 参数校验的报错文案不必经过模型，直接 HTTP 打工具端点（`POST /api/v1/agent/tools/:name`，走 `ToolGateway` → `ToolRegistry.call`，与图侧是同一条 zod 路径）：

```
form_validate_schema  {"schema": 123}      → 参数错误：schema: Expected object, received number。请按正确格式重试。
form_validate_schema  {"schema": "not-json"} → 参数错误：schema: Expected object, received string。请按正确格式重试。
form_assemble_schema  {"fields": "oops"}   → 参数错误：fields: Expected array, received string。请按正确格式重试。
flow_create           {"nodes": "oops"}    → 参数错误：name: Required; nodes: Expected array, received string; edges: Required。请按正确格式重试。
```

返回的 `summary` **就是编排层回灌给模型的那句 ToolMessage**（`tool.registry.ts:162-165`）；最后一条还证明多字段错误按 `; ` 聚合。两个坑：端点响应有**双层壳**（全局拦截器在 controller 自己的 `{code,data,…}` 外又包一层，真实载荷在 `data.data`）；`error: 'validation_error'` 分类**不出现在端点响应里**（controller 只回 `ok/result/summary`），只有图侧 `bridge.run` 看得到。

**级联层（已验，`graph-flow.spec.ts` 3 条）** —— 「重试不超过 3 次」由 `subgraph.factory.ts:504-538` 保证，且这段分支**对 `validation_error` 与 `execution_error` 是同一段代码**，差别只在多发不发一个 `RETRY`/`DEGRADE` 事件（这两个 code 前端本就过滤，见 `useAgentChat.ts:311`）。所以真机侧的 3.11（不存在的 formId 连试 3 次）已经覆盖了级联本身。单测锁死：第 3 次失败才换 `[DEGRADE]` 回灌、失败一次后再成功不误报 `DEGRADE`、第二个工具也跨阈值时放弃本轮（`gaveUp`，见 3.13）（绿，日志里能看到 `工具多次降级（degradeCount=2），收尾本轮`）。

**没做的**：改成 `z.record(z.string())` 注入式专测 `validation_error` 版级联 —— 需要 rebuild + 重启，收益只是换掉事件里的 error code，判断为不值。

### 3.7 连发消息报「会话正在执行中」—— P1（2026-09-22 已修 + 复测）
用户实操：第一个检查点没答就发第二条、第二个检查点没答就发第三条，第三条报「会话正在执行中，请等待完成」。

原因：`hub.controller.ts` 用 `SessionService.lock()`（内存布尔锁）串行化同一会话，`lock()` 失败就直接回 `SESSION_BUSY` + `stopReason:'locked'`。**悬挂检查点本身不撞锁** —— `langgraph-turn.service.ts` 早就有「有未答复中断就先 `resume(abort)` 再跑新消息」的分支（`langgraph-turn.service.ts:130-135`）。撞锁的是「上一轮还在执行」：它自己卡住（见 3.8）、或客户端断开后服务端仍在跑，锁就没释放。

改法（锁改抢占式，「开始新一段对话 = 上一段自动作废」）：
- `SessionService` 新增 `inflight: Map<sessionId, AbortController>` 作为权威（`acquireRun` / `releaseRun`），替换 `lock`/`unlock`。新消息进来时先 `abort()` 上一轮并等它让出执行权（最多 15s），等不到就强制接管 —— 那一刻上一轮的 signal 已 abort，不会再写有效状态。
- `releaseRun` 只在**仍是持有者**时解锁：被抢占的那一轮退出时什么都不做，否则会把新一轮的锁清掉、放进第三个并发请求。
- `hub.controller.ts` 删掉 `SESSION_BUSY` 分支，`AbortController` 提前创建并同时服务两个引擎（legacy 的 `runOrchestrationLoop` 改为收 `signal`）。
- `langgraph-turn.service.ts` 捕获到中止信号时按「被抢占」记 log，不再写 `FATAL`。
- 前端 `useAgentChat.sendMessage` 发新消息前先 `abort()` 上一轮的 fetch，并把 `abortController` 的清零/`isLoading` 收敛限定在自己那一轮（原来直接覆盖 `abortController`，会留僵尸请求、且旧请求退出时会把新一轮的句柄和 loading 状态一起抹掉）。

**复测（2026-09-22，真机全栈）**：`probe_preempt.py` —— A 先发、1.5s 后 B 同会话并发，旧版 B 必回 `SESSION_BUSY`，现在 B 无 error 事件、拿到检查点；`probe_takeover.py` —— 第 3 条卡住（占着执行权）时发第 4 条，第 4 条最终正常跑完并落「已更新表单…」。单测 `test/session-preempt.spec.ts` 5 条覆盖抢占/被抢占者不解锁/正常释放。

### 3.8 检查点回填沿 parent 链递归 → 查询数指数爆炸，执行权被占住数分钟 —— P1（2026-09-22 已修）

**现象**：`probe_slow.py` 连发三条（都不答检查点），第 3 条 `[+32.7s] tool_result` → `[+272.1s] confirm_required`，中间 4 分钟只有一个「表单结构已生成…」的检查点卡片迟到。第 3.7 节的抢占改动上线后，这种「上一轮还在跑」会把执行权一直占着。

**定位过程（临时埋点，已删）**：在 `drive()` 的 stream 前后 / `getState()` 前后、以及 `MysqlExecutor.query|execute` 上 append 到 `D:\agent-e2e\drive-trace.log`（agent 的 stdout 在用户终端里读不到）。结论与最初的猜测相反 —— **不是 stream 迭代器不关闭**：
- `stream-end` 正常结束（chunks=493）；
- 卡的是紧随其后的 `graph.getState()`：`dt=256122ms`；
- 埋点期间查询号涨到 **563,297**（每秒上千次小 SELECT，全是 `SELECT * FROM graph_checkpoints …` + `… graph_checkpoint_writes` 成对出现）；
- 进程 HTTP 照常应答（`/health` 3ms），`information_schema.processlist` 里没有长查询 —— 所以既不是 LLM 挂住，也不是某条 SQL 慢，而是**发起了海量条数**。

**根因**：`MysqlCheckpointSaver.backfillChannels()` 为了回填「有版本但本次 delta 没存值」的 channel，沿 parent 链调了 `this.getTuple(parent)`；而 `getTuple` 会 `hydrate` → 又调 `backfillChannels`。每深一层就把整条链重走一遍，工作量按 **2^链长** 翻倍。链长随对话轮次每轮涨几个（一轮约 4~6 个父图检查点），于是 getState 耗时按轮次翻十倍：实测 18ms → 229ms → 3.5s → 54s → 256s。LangGraph 1.4.15 的 `channelsFromCheckpoint()` 还会调 `getDeltaChannelHistory()`（基类实现是每跳一次 `getTuple`），把这个倍数再乘一遍。

**改法**：`backfillChannels` 改为**逐跳直接读原始行**（`SELECT * … WHERE checkpoint_id = ?` 后用该行自己的 `channel_values`/`channel_versions` 判定），不再递归调 `getTuple`。语义等价：`channel_versions` 每个 checkpoint 都存全量，而原实现取的 `parentValues[ch]` 本来最终就来自某一行的原始值；「版本一致才回填」这个条件用原始行判定丝毫不弱。指数降为线性。

**复测（2026-09-22，真机全栈）**：同一条 `probe_slow.py` 三条从 `3.0s / 2.8s / 272.1s` 变成 `2.9s / 1.9s / 2.3s`；埋点文件从 98 万行降到 4163 行，`getState` 稳定在 8~29ms 不再随轮次增长；强制抢占（A 跑 0.4s 后发 B、再发 C）三轮全程无 error，会话没有卡死。官方一致性套件 `checkpoint-saver.spec.ts` 718 项、全量 786 条均绿，`tsc --noEmit` 干净。

### 3.9 精简/删除字段被静默忽略（工具只增不减）—— 2026-09-22 已修

**现象**：用户建了「教职工信息登记表」（15 字段），接着说「缩减至10个字段」。模型照做了 —— `target='f1'`、只回传 10 个字段 —— 但检查点卡片还是 15 个字段，`tool_result` 是 `已生成表单"…"，包含 15 个字段`。用户问「第二次对话要求缩减字段，没有落实是为什么」。

**根因**：`form-assemble-schema.tool.ts` 的 `mergeFields()` 是**并集**语义 —— 按 key 命中就更新、新 key 就追加，**没有删除路径**。这是当初修 F3（模型只回新增字段 → 原有字段被整表覆盖）时引入的代价：方向反过来的「删」就完全没了表达能力。

**为什么不能自动判**：删除意图在结构上不可分 —— 「返回 17 个里的 10 个」是精简，「返回 17 个里的 1 个」可能只是改一个字段（用户说「把手机号改成必填」），两者都是已有 key 的子集，没有可靠判别特征。若按「无新 key 即整表替换」，后一种会把表砍成 1 个字段，等于 F3 换个姿势复发。所以**必须由模型显式声明**。

**修法**：给 `form_assemble_schema` 加可选参数 `replaceFields`（默认 false，行为完全不变）：
- `replaceFields=true` → `fields` 是这张表**最终要保留的完整字段列表**，已有字段里没被列出的删掉；保留字段沿用原顺序与原 id，新增的追加在末尾。
- 空 `fields` + `replaceFields=true` 视为模型漏传，忽略删除（否则会把表清空）。
- summary 如实反映增/删：`已更新表单"X"，删除 M 个字段，共 N 个字段`（原来是只要没新增就一律说「已生成…包含 N 个字段」，把更新说成了新建，也盖住了这次 bug）。
- 配套：`form-designer.prompt.ts` 新增「精简/删除字段」小节、`worksheet.ts` 的表清单指令各加一条；`tool.registry.ts` 的 DeepSeek 参数拍平兜底里把 `replaceFields` 一起带上（否则偶发拍平会让删除静默失效）。**参数必须声明进 `inputSchema`**，否则 `zodToSchema` 生成的 JSON Schema 里没有它，模型看不到（`target` 踩过同样的坑）。

**复测（2026-09-22，真机全栈）**：17 字段建表 → 「缩减至10个字段」→ 模型传 `replaceFields=true`、`已更新表单"…"，删除 7 个字段，共 10 个字段`、检查点产物 10 → 「再加一个紧急联系人字段」回到默认合并、`新增 1 个字段，共 11 个字段`（加字段路径无回归）。单测 `form-assemble-schema.spec.ts` 从 4 条加到 9 条；全量 791 条绿，`tsc --noEmit` 干净。

**注意（对外可见的证据口径变了）**：`tool_result` 的 `已生成` 现在**严格表示首次创建**（`existingFields` 为空）；凡是走了已有表的更新（含模型重述全部字段的幂等调用）一律是 `已更新…`。原来「更新但没新增字段」也会说 `已生成`，拿 `已生成/已更新` 判「编排层有没有注入 existingSchema」时要按新口径看。

**同日改契约**：`replaceFields` 已被 `removeFields` 取代 —— 见 3.10，让模型回抄「要保留的完整列表」本身就是丢配置的通道。

### 3.10 精简字段时选项与必填被抄丢（`replaceFields` 的代价）—— 2026-09-22 已修

**现象**：用户建「教职工信息表」（19 字段，含 select/radio）→「字段缩减至10个」→「去掉入职日期这个字段」，接着问「用工性质的选项怎么丢失了」。

**证据**（`sess_txsajd5t2pff` 的 `formWorksheet` channel，用新增探针 `db_ws2.js` 解出来；o=选项数，r=必填）：

| 时刻 | 字段数 | 各字段 options/required |
|---|---|---|
| 08:52:16 建档 | 19 | gender o2 / dept o7 / title o5 / edu o5 / employ_type o4 / status o4，name r1 |
| 08:52:31 精简至10 | 10 | o2/o5/o4/o3/o3 —— 还在（那一次模型自己补了选项） |
| 08:52:51 去掉入职日期 | 9 | **全部 o0/r0** ← 丢失现场（用工性质 = employ_type） |
| 08:53:20 「选项怎么丢失了」 | 9 | o2/o6/o5/o4/o4 恢复，name 的必填也恢复 |

**根因**（两条叠加）：① 注入的【会话中的表单】清单每个字段只印 `key= name= type=`，模型看不见 options/required，没得照抄；② `mergeFields` 命中同 key 时是 `{ ...next, id: f.id }` —— 拿模型这次给的字段**整体替换**，它没提的 `props.options` / `rules` 直接归零。`replaceFields` 要求模型回抄整张表，把这个放大成常态。

**修法（增量契约）**：
- `fields` 变成**字段补丁**：`name`/`type` 也改成 optional；命中已有 key 时**以原字段为底**，只覆盖模型显式给出的属性（`mergeField`）。于是「把手机号改成必填」只需传 `{key, required}`，其余属性一个不动。
- 删除改用 `removeFields`（填**要删的**那几个 key），`replaceFields` 删除。**模型从此不必回抄整张表** —— 回抄是唯一会丢配置的操作。
- 清单补上语义：每行带 `required` 与 `options=label:value|…`（17 字段表 738 → 1093 字符；选项超 12 个截断成「…共 N 项」）。模型看得见，才既保得住也改得动。
- 类型改成不吃选项的控件（select→input）时顺手清掉残留 options；`removeFields` 里点了不存在的 key 会在 summary 里如实报「未找到」，不静默。

**顺带修掉的坑**：`tool.registry.ts` 的 DeepSeek 参数修复里有条「args 中嵌套了 schema 对象 → 提取 fields」——编排层注入的 `existingSchema` 正是「带 fields 的对象」，于是「只删两个字段」的调用被回填成整表 `fields`，summary 里冒出假的「修改 N 个字段」。已把 `existingSchema` 排除出这条分支。

**复测（2026-09-22，真机全栈 `probe_ops.py`）**：建 5 字段表（姓名必填 / 用工性质 radio 4 项 / 性别 radio 2 项 / 入职日期 / 备注）→「精简到 3 个字段，只保留姓名、用工性质和性别」→ 模型只发 `{target:'f1', removeFields:['field_hire_date','field_remark']}`，`已更新表单"…"，删除 2 个字段，共 3 个字段`；`formWorksheet` 落库为 **name r1 / employment_type o4 / gender o2 —— 必填与选项一个没丢** → 「用工性质的选项再加一个：返聘」→ `修改 1 个字段，共 3 个字段`，该字段 o5、另两个字段 r1/o2 未动。单测 `form-assemble-schema.spec.ts` 14 条（含照抄 08:52:51 真实输入的回归）、`worksheet.spec.ts` 21 条；全量 798 条绿，`tsc --noEmit` 干净。

### 3.11 迁移时漏掉的三处能力（2026-09-24 已补）—— P1

排查「彻底移除 legacy」的可行性时逐条比对 `base.agent.ts`，发现图侧漏了三件事（都属静默退化，不报错）：

1. **工具结果不截断**。`MAX_TOOL_RESULT_CHARS`（默认 8000）迁移后只有 legacy 的 `base.agent` 读过，图侧 `tool-bridge.ts` 的 `formatResult` 是 `JSON.stringify` 全量。`template_search` / `data_query` 这类大 JSON 会整段进 messages。已把 legacy 的 `summarizeToolResult` 口径（头尾各留一半 + 标出截掉多少）搬进 `formatResult`；只影响 LLM 看到的 ToolMessage，SSE 的 `tool_result` 与前端预览卡片数据源都不经过它。
2. **同一工具可以无限重试**。legacy 数「同一工具连续错几次」，超 `MAX_RETRIES`（默认 2）后把回灌的失败改成 `[DEGRADE]` 换方案提示，超 `MAX_DEGRADE`（默认 1）整体收尾；图侧原先只有「失败回一条 ToolMessage」，模型能一直重试同一个坏工具。已加 `toolErrors` / `degradeCount` 两个 channel 复刻这条级联（成功即清零，所以「错一次又成功」不会累积）。**这条级联 2026-09-24 又重做了一轮：计数公式有 bug、跨轮不清零、放弃出口语义不一致，见 3.13。**
3. **没有熔断**。legacy 的 `LlmStreamService` 有「连续失败 5 次 → 熔断 30s」；图侧 `LangGraphLlmService` 直接 `bindTools` 没有这层。已在 `withTools` 外包一层同参数的熔断。

**对外可见差异（对前端是兼容的）**：新增/恢复了 5 个 `error` 事件的 code —— `RETRY`（参数校验失败）/`RETRYING`（模型调用失败重试）/`DEGRADE`/`CIRCUIT_BREAKER`（以及当天还短暂存在的 `FALLBACK`，已于同日删除，见 3.13）。前三个前端本来就按「内部修正，不提示」过滤（`useAgentChat.ts` 的 `case 'error'`），只有 `CIRCUIT_BREAKER` 会显示成错误文案。**「放弃本轮」不再走 `error` 事件**，改用 `done.stopReason = 'giveup'` + 助手气泡表达。

**同日（2026-09-24）legacy 已删除**：`hub.controller.ts` 的 legacy 分支（`runOrchestrationLoop` / `pickAgent` / `buildStepMessage` / `getArtifactType` / `confirmCallId` / `chatSync` 的 legacy 分支）、`hub.service.ts`、`hub.state-bar.ts`、`base.agent.ts` + 4 个 `*.agent.ts`、`llm.client.ts`、`llm.stream.ts` 全部移除；`AGENT_ENGINE` 开关、`engineConfig`、`validateEnv()` 里的校验、`.env.example` 的对应行也随之删掉。`CheckpointService.enabled` 不再看开关（恒为启用，缺 `AGENT_DATABASE_URL` 直接报错）。浏览器手测（F10/F11/F5/F6/F9 + 文字落位 + 流程卡片非表单分支 + 3.11 的错误恢复）已全绿后才执行删除。

**验证**：`graph-flow.spec.ts` 加 3 条（超上限才降级 / 失败后成功不误报 / 两个工具都降级则放弃本轮）、`tool-bridge.spec.ts` 加 1 条（截断），全量 **802 条绿**（随后 3.13 又加 4 条，现为 806，见第二节），`tsc --noEmit` 干净。

### 3.12 legacy 为什么不能当"安全基线" —— 已随删除归档

删除前 `base.agent.ts` 里一直是无条件注入 `savedFormId`（`form_save` 判断创建/更新只看 `args.formId` → 保存表 A 后再建表 B 会**静默覆盖 A**）与单槽 `draftSchema` 注入，这两个都是图侧 09-22 修掉的。所以它在退场前保的是「旧行为」而不是「已验证正确的行为」，不能当成回归对照的基准 —— 这也是当初下决心删掉而不是长期并行的原因。legacy 已于 2026-09-24 删除（见 3.11），本节仅作归档。

### 3.13 「放弃本轮」的收尾语义（2026-09-24 重做）

排查开放项时把 FALLBACK 这条出口完整跟了一遍，发现三个问题（前两个是真 bug）：

1. **重试计数跨轮不清零**。`toolErrors` / `degradeCount` 只在子图 `act` 里写，`routerNode` 与 `prepare` 都不重置。图状态按 `thread_id`（= 会话）持久化，上一轮的失败额度会带进下一轮 —— 用户换个说法重试，模型第一次调同一个工具失败就直接吃 `[DEGRADE]`，白丢两次「让你自己修」的机会。
2. **单工具反复失败永远到不了收尾**。旧公式用「刚跨过重试上限」判定（`previouslyDegraded = prev > maxRetries`），同一个工具只要一直不成功，第 4 次起该值恒为真，`degradeCount` 卡在 1，而触发条件是 `degradeCount > 1` —— 永不成立。**`agent-state.ts` 当时的注释却写着「反复坏掉的工具最终仍会触发收尾」，注释与代码不符**；真正的兜底其实是每个 agent 的 `maxIterations: 8`。新公式按「连续失败满 `maxRetries+1` 次」记一次（`Math.floor` 差分），单工具第 3、6 次各记一次。
3. **两个「我做不到」长得完全不一样**。工具失败那条发 `error{code:'FALLBACK'}` + `halted: true`（前端渲染红 banner，同时助手气泡又是同一句话 → 同一句出现两遍）；轮次用尽那条反而被当成**正常完成**（不发 error、不置标志、`stopReason: 'completed'`），多步计划会带着缺失的产物继续空跑后面的步骤。

**改法（`gaveUp` 统一出口）**：新增 `gaveUp` channel，与 `halted` 分工 —— `halted` = 用户主动中断（检查点点「中断」/ 拒绝风险确认），`gaveUp` = 系统放弃（工具反复失败 / 轮次用尽）。父图三处判断（`planDriver` / `nextAfterPlanDriver` / `planAdvance`）都读 `halted || gaveUp`：都停整条计划、不推进、不登记产物。对外：`gaveUp` → `stopReason: 'giveup'`、`metadata.phase = 'gave_up'`、`activeSubAgent = null`，**不再下发 `error` 事件**（放弃的文案本身是给用户的建议，不是系统故障，红条会让人以为平台坏了）。日志与单测通过内部 `aggregate` 事件的 `gaveUp` 字段观察。

**踩到的坑（reducer 语义）**：重置只能靠「写空值」，而写空值只对**替换**语义的 channel 有效。`degradeCount` 本来就是替换（能清），`toolErrors` 当时是 **merge**（写 `{}` 只算空增量，清不掉）→ 改成替换。安全性依据：`act` 是唯一写入者，且每次都写**全量 map**。`checkpointDone` 也是 append 语义、同样清不掉，但它按 `toolCallId` 归零、不影响本轮重试预算，**本次刻意不动**。

**明确不做：放弃后重新路由（C2）**。三类失败里只有「这件事本来就该别的 agent 做」这类重路由有用，而这一类本该在 `router.decide` 第一次就判对（它已有 `isCrossDomain` 与多步 plan 能力）；烧掉 3+ 次工具调用后再回头重判，等于承认第一次判错，收益小于代价。

**验证**：`graph-flow.spec.ts` 重写原 FALLBACK 用例 + 新增 4 条（跨轮额度不残留 / 单工具连续失败满 6 次也收尾 / 轮次用尽与工具失败同一个出口 / 多步计划第一步放弃后后续步骤不执行且产物不登记），全量 **806 条绿**，`tsc --noEmit` 干净（注意 `tsconfig.json` 只 include `src/**/*`，spec 不在 tsc 范围内）。**真机三条也已走完（2026-09-24）**：① 放弃出口（气泡只有一条、无红条、终端有 `工具多次降级（degradeCount=1），收尾本轮`）；② 多步计划第一步放弃后 `flow_*` 工具一个未出现；③ 检查点「中断」回归（气泡仍是「已按你的要求中断」，没被 gaveUp 抢走）。

**真机怎么造这几条（踩过的坑，别再照抄旧配方）**：
- **别让模型去试一个不存在的 formId** —— 表单助手 prompt 的寻址契约就是「只认会话工作台里的 key/标题」，它会**直接拒绝**、一个工具都不调，于是没有任何失败可以计数（09-24 实测）。
- 正确做法是**让工具真的执行失败**：`apps/agent/.env` 里把 `SERVER_API_BASE_URL` 改成一个没人听的端口（如 `http://localhost:3999`），前端与 server 都照常，只有 agent 出站调用打不通。配合 `MAX_RETRIES=0` / `MAX_DEGRADE=0`（第一次失败即放弃），一次点击就能验完；验后必须改回 `:3000` 并删掉那两行。
- **不要停 apps/server**：server/web/agent 是同一个 `turbo run dev` 的子任务，杀掉 server 会让 turbo 把另外两个也收掉，而且前端页面本身就依赖 :3000。
- **多步计划要挑对话**：别用「搜索请假模板，基于它创建表单并配一个审批流程」—— 它的第一步是 template，而 `template_search` 会自己 catch 错误当成功返回，永远不失败。用「创建一个客户登记表，并配一个审批流程」（第一步是 form-designer，`form_save` 才会真失败）。
- **`phase='gave_up'` / `activeSubAgent=null` 查不了库**：`SESSION_STORE=memory`，session metadata 不落任何地方，前端也不消费 `phase`（`useAgentChat.ts` 的 `done` 分支只清 status）。`stopReason` 同理只在 SSE 里，界面看不到。

**顺带清掉的死配置**：`.env` 的 `MAX_ITERATIONS` 原先读进 `configuration.ts` 的 `context.maxIterations` 后无人消费，图里用的是 `agent-catalog.ts` 里每个 agent 硬编码的 `maxIterations: 8`（数值相同，行为无差异）。2026-09-24 已把这条 env 与 config 一并删除。所以「轮次用尽」那条出口仍然没法用 env 触发 —— 要造这条得直接改 catalog 里的 `maxIterations`。

### 3.14 模板助手说「已创建好表单」，表单管理里却没有 —— 2026-09-29 已修

**症状**：在模板市场页说「寻找客户相关表单」，助手回「已为你找到并创建好表单 ✅（模板名称：客户信息表…）」，但「表单管理」里一张都没有。

**根因不是话术，是能力缺口**：模板 Agent 的工具只有 `template_search` / `template_get_detail` / `template_validate` / `template_instantiate`，**没有 `form_save`**。`template_instantiate` 只是按模板在会话里拼一份 schema（`template-instantiate.tool.ts`），一步都没落库。而路由只给「模板 + 流程 + 创建」这类跨领域表达才拼多步计划，单步的模板请求（`agent-graph.service.ts` 的 `routerNode` 包成 1 步 `[template]`）跑完就结束 —— 落库的表单设计助手从头到尾没参与。

**改法（两条）**：

1. **模板请求一律补一步表单设计助手**。`router.service.ts` 新增 `withFormHandoff`：确定性路由里凡是落到 `template` 且还没有计划的结论（强信号覆盖、页面身份兜底），以及 `decide()` 里 LLM 兜底给出的单步 `template`，都补上 `templateFormPlan` → `[template, form-designer]`，落库交给拥有 `form_save` 的设计助手（它自带「这个表单是否加入当前空间？」检查点）。已有计划（跨领域模板/流程）不重复编排。
2. **上游产物缺失就跳过整步**。`PlanService.hasUnresolvedRefs(step, artifacts)`：这一步的 input 里有 `$N...` 引用、且**全部**解析为空，说明产物链断了；`planDriver` 用 while 循环推进 `stepIndex` 跳过这类步骤（写 warn 日志，并把跳过的 id 记进 `completedSteps`，免得收敛报告显示成「漏做了一步」）。没有这条的话，模板没搜到结果时第二步的 `$1.schema` 是 null，设计助手会拿着空引用照常执行，**凭空造一张跟请求无关的表**。
   - 判「全部为空」而不是「有一个为空」：input 里常混着 `description` 这种常量，只有引用整体落空才说明断链。
   - 这条只对「全空」生效，所以 T2（无结果）、R1（模板页说"你好"）都自然退化成原来的单步行为。

**话术同步**（`template.prompt.ts`）：加了「边界（重要）」段 —— 明说 `template_instantiate` 不写进表单管理、落库由后续设计助手完成，且**不许说「已创建好表单」**，只能说「已按模板准备好表单结构」。光改路由不改这句话，用户在落库完成前仍会读到「已创建」。

**UX 代价**：一次模板建表要走 **3 个检查点** —— `instantiate-approval`（用这个模板）→ `schema-review`（结构是否可行）→ `space-approval`（是否加入当前空间）。比表单助手独立建表多一次确认，换来的是「模板请求也真能落库」。

**验证**：`graph-flow.spec.ts` +4 条（单步模板请求补两步计划 / `hasUnresolvedRefs` 单元 / 模板没搜到结果时跳过落库步骤 / 跨轮草稿不得替本轮开路），全量 **814 条绿**（8 个文件），`tsc --noEmit` 干净，改动文件 eslint 0 error。**真机 2026-09-29 全部复测 ✅**：T1/T4（模板建表真的进「表单管理」）、T2（无结果不建表）、R1 强版本（闲聊不被拖进落库）。

### 3.15 跨轮残留的草稿让「没搜到」也能建表 —— 2026-09-29 已修（T2 真机抓到）

**症状**：同 3.14 的改动上线后，同一会话里先聊过模板、再问一个搜不到的关键词（T2：`搜索 xyzabc123 模板`），助手仍会回「已更新表单"客户信息登记表"，修改 9 个字段，共 9 个字段」——**照着上一轮的模板又建了一张表**。

**为什么 3.14 的跳步保护没兜住**：`hasUnresolvedRefs` 判的是 `artifacts['1']`，而 `artifacts` 是每轮重建的（`routerNode` 里清空）——**但它是从 `state.drafts` 重建的**，`drafts` 却是 **merge 语义、跨轮从 checkpoint 恢复**的。第二轮 template_search 返回 0 条时 `extractArtifact` 返回 null、`drafts['template']` 纹丝不动，`planAdvance` 于是把**上一轮那份** TemplateArtifact 登记成 `artifacts['1']`，`$1.schema` 解析得到上一轮的模板 → 第二步照跑。

单轮、新会话都测不出来（`drafts` 还是空的），只有「同一会话先聊过模板」才复发 —— 所以它躲过了 3.14 的三条单测，被真机 T2 抓到。修法见下，并补了跨轮单测。

**改法**：新增 `turnDraftAgents` channel（**替换语义**，`routerNode` 每轮清空），`act` 写出 `draftUpdate` 时登记 `spec.key`；`planAdvance` 只登记**本轮**写过草稿的 Agent 的产物。

**为什么不直接把 `drafts` 每轮清空**：`drafts` 有两处**故意**跨轮使用 —— `prepare` 用它给「有草稿没工作台」的旧线程补种 `formWorksheet`（`subgraph.factory.ts` 的 `seedFromDraft`），`toolCtx` 用它给 `form_assemble_schema` 传 `currentSchema`。而且它是 merge 语义，写 `{}` 只会被当成空增量（3.13 踩过的同一个坑）。所以分工保留：`drafts` 存内容（跨轮），`turnDraftAgents` 只记「这一轮写过」。

**验证**：新增单测「上一轮的模板草稿不能替这一轮的落库步骤开路」（两轮同一会话：第一轮实例化出草稿并走到设计助手检查点，第二轮搜不到 → 断言 `gateway.calls` 里第二个 `template_search` 之后没有任何 form 工具）。修复前该用例失败（`interrupted.checkpointId === 'schema-review'`，toolCallId `c5`），修复后全量 **814 条绿**。**真机 2026-09-29 复测 ✅**：T2（同会话先聊模板再搜无结果关键词）与 R1 强版本（同会话留草稿后发「你好」）都只调一次 `template_search`、无检查点、无表单卡片。

## 四、人工验证（2026-09-24 已全部走完）

这一节原先列的是「自动测不了、只能人看」的项。截至 2026-09-24 全部有了结论，下面按验证方式归档 —— 以后新增 DOM 改动时，请把新项加回来。

| 项 | 验证方式 | 结果 |
|---|---|---|
| D2 打字动画（加载圆点 / 答完消失） | 浏览器 | ✅ |
| 预览卡片在检查点待答复时自动展开、答完收起 | 浏览器 | ✅ |
| 回执轮不出用户气泡（文字原地续写在带卡片的那条消息里） | 浏览器 | ✅ |
| E3 Server 断连提示 | 让 agent 出站地址不可达后调 template_search（详见 3.13 的注意事项） | ✅ |
| 放弃出口（原 FALLBACK）：工具失败到收尾时无红条、气泡只有一条 | 浏览器 + `SERVER_API_BASE_URL` 指死端口 + `MAX_RETRIES=0/MAX_DEGRADE=0`（见 3.13） | ✅ |
| 多步计划第一步放弃：后续步骤不再执行、不登记产物 | 浏览器（同上配置） | ✅ |
| 检查点「中断」回归：仍是 `halted`，没被 gaveUp 抢走 | 浏览器 | ✅ |
| E1 缺参数错误（明确错误文案 + 重试不超过 3 次） | HTTP 直打工具端点 + 单测（见 3.6） | ✅ |
| F5/F6 多行摘要卡片：两行分别点开是**各自那张表**、只有一张表时仍是单行 | 浏览器 | ✅ |
| 非表单分支回归：流程页建三级审批流，流程卡片仍按老样子折叠 | 浏览器 | ✅ |
| F9 抢占：上一条还在跑时发下一条，界面不出现「会话正在执行中，请等待完成」 | 浏览器 | ✅ |
| F10 精简字段：卡片字段数与点开预览都真的变成 10 个 | 浏览器 | ✅ |
| F11 改字段不丢配置：留下的 select/radio 仍带选项、必填仍有红星；加「返聘」只多一项 | 浏览器 | ✅ |
| 3.11 的错误恢复：必然失败的工具连试 3 次，界面不出现 RETRY/DEGRADE，也不出现红 banner（放弃以助手气泡收尾，`stopReason: 'giveup'`） | 浏览器 | ✅（当天验的是 FALLBACK 红条版本；09-24 重做后见 3.13，红条已删） |

## 五、实测写入的数据（09-21、09-22、09-24 均已清理）

所有写入都落在 workspace `ceshi`（`2636ca19-d5d7-4a83-b2eb-a678633e7b0e`，owner `a375921c-…`）。两轮实测（09-20 首测 + legacy 回归，09-21 复测）累计新增 17 行，名字如「客户登记表」「留言表」「客服工单」「客服工单表」「报销信息填写表」，按 `workspace_id` 分组核对全部落在 `ceshi`。

**已于 2026-09-21 全部删除**（`D:\agent-e2e\db_cleanup.js`，先 dry-run 再 `--apply`）：forms 从 86 回到基线 **69**，form_versions 从 196 回到基线 **179**，该空间 submissions=0。

**2026-09-24 的浏览器手测写到了另一个空间**：`员工信息登记表`（`7a4a5f65-0488-42de-9d37-ee8add2dc403`，v1→v2，`field_status` 选项 3→4，即 F11 那只真机证据）与 `工单信息表`（`c1b129a8-d8d5-4533-9d2a-adfc1bc6ef47`）都建在 workspace `test`（`ab718c8d-1990-49c4-a2c0-a768c159a985`），**不是 `ceshi`** —— 照原样跑默认的 `db_cleanup.js` 会显示「ceshi 空间 forms=0」而白跑。已按 **form id 白名单**精确删除（`db_cleanup.js --forms=<id1>,<id2>`，不碰该空间里 09-15 起的历史数据）：forms 71→**69**、form_versions 182→**179**，回到基线。`db_cleanup.js` 因此新增了 `--forms=` 模式，默认无参时行为不变（仍删 `ceshi` 空间）。

> 注意 `db_*.js` 是 Node 脚本，用 `node D:\agent-e2e\db_cleanup.js` 跑；用 `python` 会报 `SyntaxError: invalid character '。'`。

form_save 的落库已按"必须查 formpu.forms 新行"核对：新行存在且 `schema` 的 fields 完整，**两轮都没有复现"假成功"**。

**2026-09-22（F5–F8）**：F5/F6 在"是否加入当前空间"处选「先不加入」，不落库。F7 落 2 行（客户登记表 6 字段 / 员工登记表 8 字段，两个不同 id）、F8 落 1 行（报名统计表，`versions=2` 说明第二次是更新而非新增）。跑完已 `--apply` 清回基线 **forms=69 / form_versions=179**，该空间 forms=0。

**F7 的查库结论就是"静默覆盖"这个隐藏 bug 的反证**：旧版这里只会剩 1 行、名字是后建的那张、字段是两张表混起来的；现在两行并存、字段各自完整。

**2026-09-22（F11 / 3.10 增量契约）**：`probe_ops.py` 全程不在检查点上点按钮（走抢占分支），也没在"是否加入当前空间"处选加入，所以**一行都没落库**，跑完查库仍是基线 **forms=69 / form_versions=179**（`db_cleanup.js` dry-run 复核）。字段级证据取自 `formWorksheet` channel，新探针 `db_ws2.js <thread_id>` 把该 channel 的写入解成「字段 key/type[o选项数,r必填数]」逐版打印 —— 查「选项有没有丢」用这个，比翻 checkpoint 原始 blob 省事。

**2026-09-24（3.13 放弃出口真机三条）**：三条都没走到 `form_save`（① 指死端口后工具必然失败、② 多步计划第一步就放弃、③ 检查点中断），**一行都没落库**。`db_cleanup.js` dry-run：`forms=69 / form_versions=179`，`ceshi` 空间 forms=0，与基线一致。
