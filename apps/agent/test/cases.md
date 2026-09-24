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
| T1 | 模板-有结果 | 搜索请假模板 | template-creator | template | template_search 被调用并返回结果 | ✅ | 返回 `请假申请单`（人事类） |
| T2 | 模板-无结果 | 搜索 xyzabc123 模板 | template-creator | template | 回复"暂无"且不调 form 工具 | ✅ | 只调 template_search，回复"模板市场暂无相关模板" |
| T3 | 模板-强信号让位 | 在模板页说"帮我设计一个表单" | template-creator | form-designer | 切到 form-designer，且不擅自调 form_assemble_schema | ✅ | 09-20：**切到了 form-designer**（未调工具，只反问），与当时期望冲突（见 3.4）。**09-21 拍板改用例期望**：承认「设计…表单」是强信号，切走是对的；复测 `agent=form-designer`、工具=[]（只反问，未擅自建表） |
| W1 | 流程-创建 | 创建三级审批流(组长→经理→总监) | workflow-node | workflow | flow_create + flow_validate 被调用 | ✅ | `['flow_create','flow_validate']` |
| W2 | 流程-DAG校验 | 创建有环的流程 | workflow-node | workflow | flow_validate 返回 hasCycle | ✅ | **用例改法**：模型会直接凭描述拒绝建环流程、根本不调工具；改为把有环定义显式给它校验 → `Flow validation FAILED: 1 errors` |
| R1 | 路由-页面优先 | 在模板页说"你好" | template-creator | template | 模板助手回复，不变成其他 | ✅ | status.agent=template |
| R2 | 路由-跨页面 | 在表单页说"搜索请假模板" | form-builder | template | 切换到模板助手 | ✅ | 强信号覆盖页面 → template |
| R3 | 路由-表单信号 | 在流程页说"设计一个报销信息填写表" | workflow-node | form-designer | 不因为"审批"关键词误判为 workflow | ✅ | 切到 form-designer，未误判 |
| R4 | 路由-短消息 | 在任意页面说"在吗" | 任意 | 页面Agent | 保持页面 Agent 不改变 | ✅ | 数据分析页说"在吗"仍为 submission（注：原注"任意"我按最易误判页取） |
| C1 | 跨领域编排 | 基于客服模板创建表单并配审批流 | form-builder | 多步 plan | plan 生成，多步执行 | ✅ | plan 三步全跑完：`template_search → form_assemble_schema →(继续) validate →(继续) form_save+flow_create+flow_validate →(继续) flow_save`。**需一路点「继续」推进计划** |
| E1 | 错误-缺参数 | LLM调用 form_assemble_schema 不传 fields | form-builder | form-designer | 返回明确错误+重试，不超过3次失败 | ➖ | 无法从外部强制：模型明确拒绝"故意省略必填参数"。单测也未覆盖这条路径（见 3.6） |
| E2 | 错误-缺Token | 不登录直接调 agent | - | - | 返回 401 而非 500 | ✅ | 无 token → HTTP 401 |
| E3 | 错误-Server断连 | Server 未启动时调 template_search | template-creator | template | 提示"后端未启动"而非模糊错误 | ➖ | 需要把 apps/server 停掉才能测（代码路径在 context.service.ts:42 把 ECONNREFUSED 转成"后端服务未启动或不可达"） |
| D1 | SSE-流式 | 会产出文字的提示词（如"你能做什么？"） | form-builder | form-designer | delta 事件逐 token 到达，且只包含模型输出 | ✅ | 09-20：**langgraph 下 0 条 delta**（纯文字回复也一样；legacy 同场景 72 条）（见 3.2）。**09-21 复测通过**：168 条 delta / 290 字符，无提示词泄漏。原输入的"创建留言表"模型直接调工具、没有文字可流，已换成纯文字提示词（见 3.2） |
| D2 | SSE-打字动画 | 创建表单 | form-builder | form-designer | 加载中显示圆点，回答完毕消失 | 🖐 | 依赖 D1（D1 已通）；属 DOM 表现，需浏览器确认 |
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

## 三、实测发现（按严重度）

### 3.1 F3 追加字段会丢字段 —— P0（2026-09-21 已修，待浏览器复看）
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

**已知差异：legacy 引擎不支持多表**（用户已确认，不属回归）。legacy 路径下 `ctx.formWorksheet === undefined`、`formTarget` 恒为空，注入行为与改造前一致 —— 仍是单槽草稿 + 无条件合并，F5–F8 在 legacy 下必然失败，**不作为验收项**。

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

### 3.5 两个引擎的 SSE 方言不一致 —— P2
| 字段 | langgraph | legacy |
|---|---|---|
| `status.agent` | agent key（`form-designer`） | scenario key（`form-builder`） |
| `meta.activeAgent` | agent key | 展示名（`Submission Agent`） |

前端 `ChatPanel.vue` 的 `AGENT_LABEL` 是按 agent key 建的，所以在 legacy 下 `form-builder` / `workflow-node` 查不到标签、状态栏会显示原始字符串。langgraph 侧是对的。

### 3.6 E1 无覆盖 —— P2
缺参数的错误路径（ToolRegistry 的 zod + 参数修复）既无法从外部强制触发，单测里也没有对应用例（`tool-bridge.spec.ts` 只覆盖了工具执行失败的透传）。

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
2. **同一工具可以无限重试**。legacy 数「同一工具连续错几次」，超 `MAX_RETRIES`（默认 2）后把回灌的失败改成 `[DEGRADE]` 换方案提示，超 `MAX_DEGRADE`（默认 1）整体收尾（`FALLBACK`）；图侧原先只有「失败回一条 ToolMessage」，模型能一直重试同一个坏工具。已加 `toolErrors` / `degradeCount` 两个 channel 复刻这条级联（成功即清零，所以「错一次又成功」不会累积）。
3. **没有熔断**。legacy 的 `LlmStreamService` 有「连续失败 5 次 → 熔断 30s」；图侧 `LangGraphLlmService` 直接 `bindTools` 没有这层。已在 `withTools` 外包一层同参数的熔断。

**对外可见差异（对前端是兼容的）**：新增/恢复了 4 个 `error` 事件的 code —— `RETRY`（参数校验失败）/`RETRYING`（模型调用失败重试）/`DEGRADE`/`FALLBACK`/`CIRCUIT_BREAKER`。前四个前端本来就按「内部修正，不提示」过滤（`useAgentChat.ts` 的 `case 'error'`），只有后两个会显示成错误文案。

**同日（2026-09-24）legacy 已删除**：`hub.controller.ts` 的 legacy 分支（`runOrchestrationLoop` / `pickAgent` / `buildStepMessage` / `getArtifactType` / `confirmCallId` / `chatSync` 的 legacy 分支）、`hub.service.ts`、`hub.state-bar.ts`、`base.agent.ts` + 4 个 `*.agent.ts`、`llm.client.ts`、`llm.stream.ts` 全部移除；`AGENT_ENGINE` 开关、`engineConfig`、`validateEnv()` 里的校验、`.env.example` 的对应行也随之删掉。`CheckpointService.enabled` 不再看开关（恒为启用，缺 `AGENT_DATABASE_URL` 直接报错）。浏览器手测（F10/F11/F5/F6/F9 + 文字落位 + 流程卡片非表单分支 + 3.11 的错误恢复）已全绿后才执行删除。

**验证**：`graph-flow.spec.ts` 加 3 条（超上限才降级 / 失败后成功不误报 / 两个工具都降级则收尾并上报 FALLBACK）、`tool-bridge.spec.ts` 加 1 条（截断），全量 **802 条绿**，`tsc --noEmit` 干净。

### 3.12 legacy 为什么不能当"安全基线" —— 已随删除归档

删除前 `base.agent.ts` 里一直是无条件注入 `savedFormId`（`form_save` 判断创建/更新只看 `args.formId` → 保存表 A 后再建表 B 会**静默覆盖 A**）与单槽 `draftSchema` 注入，这两个都是图侧 09-22 修掉的。所以它在退场前保的是「旧行为」而不是「已验证正确的行为」，不能当成回归对照的基准 —— 这也是当初下决心删掉而不是长期并行的原因。legacy 已于 2026-09-24 删除（见 3.11），本节仅作归档。

## 四、仍需人工验证

**已人工验证（2026-09-24，删除 legacy 前的那次浏览器手测）**：F5/F6 多行摘要卡片（两行分别点开是各自那张表、单表时仍是单行）、非表单分支回归（流程页三级审批流，流程卡片仍折叠）、F9 抢占、F10 精简字段计数、F11 选项与必填保留、回执轮文字落位（不出用户气泡）、3.11 的错误恢复文案 —— 均已通过，不再单列。

以下是真没验过、或需要特殊前置条件的：

| 项 | 为什么不能自动验 |
|---|---|
| D2 打字动画 | 依赖 D1（D1 已通），且是 DOM 表现 |
| 预览卡片在检查点待答复时自动展开、答完收起 | DOM 表现 |
| E3 Server 断连提示 | 需要把 apps/server 停掉 |
| E1 缺参数错误 | 模型拒绝照做；需单测或注入路径 |

## 五、实测写入的数据（09-21、09-22、09-24 均已清理）

所有写入都落在 workspace `ceshi`（`2636ca19-d5d7-4a83-b2eb-a678633e7b0e`，owner `a375921c-…`）。两轮实测（09-20 首测 + legacy 回归，09-21 复测）累计新增 17 行，名字如「客户登记表」「留言表」「客服工单」「客服工单表」「报销信息填写表」，按 `workspace_id` 分组核对全部落在 `ceshi`。

**已于 2026-09-21 全部删除**（`D:\agent-e2e\db_cleanup.js`，先 dry-run 再 `--apply`）：forms 从 86 回到基线 **69**，form_versions 从 196 回到基线 **179**，该空间 submissions=0。

**2026-09-24 的浏览器手测写到了另一个空间**：`员工信息登记表`（`7a4a5f65-0488-42de-9d37-ee8add2dc403`，v1→v2，`field_status` 选项 3→4，即 F11 那只真机证据）与 `工单信息表`（`c1b129a8-d8d5-4533-9d2a-adfc1bc6ef47`）都建在 workspace `test`（`ab718c8d-1990-49c4-a2c0-a768c159a985`），**不是 `ceshi`** —— 照原样跑默认的 `db_cleanup.js` 会显示「ceshi 空间 forms=0」而白跑。已按 **form id 白名单**精确删除（`db_cleanup.js --forms=<id1>,<id2>`，不碰该空间里 09-15 起的历史数据）：forms 71→**69**、form_versions 182→**179**，回到基线。`db_cleanup.js` 因此新增了 `--forms=` 模式，默认无参时行为不变（仍删 `ceshi` 空间）。

> 注意 `db_*.js` 是 Node 脚本，用 `node D:\agent-e2e\db_cleanup.js` 跑；用 `python` 会报 `SyntaxError: invalid character '。'`。

form_save 的落库已按"必须查 formpu.forms 新行"核对：新行存在且 `schema` 的 fields 完整，**两轮都没有复现"假成功"**。

**2026-09-22（F5–F8）**：F5/F6 在"是否加入当前空间"处选「先不加入」，不落库。F7 落 2 行（客户登记表 6 字段 / 员工登记表 8 字段，两个不同 id）、F8 落 1 行（报名统计表，`versions=2` 说明第二次是更新而非新增）。跑完已 `--apply` 清回基线 **forms=69 / form_versions=179**，该空间 forms=0。

**F7 的查库结论就是"静默覆盖"这个隐藏 bug 的反证**：旧版这里只会剩 1 行、名字是后建的那张、字段是两张表混起来的；现在两行并存、字段各自完整。

**2026-09-22（F11 / 3.10 增量契约）**：`probe_ops.py` 全程不在检查点上点按钮（走抢占分支），也没在"是否加入当前空间"处选加入，所以**一行都没落库**，跑完查库仍是基线 **forms=69 / form_versions=179**（`db_cleanup.js` dry-run 复核）。字段级证据取自 `formWorksheet` channel，新探针 `db_ws2.js <thread_id>` 把该 channel 的写入解成「字段 key/type[o选项数,r必填数]」逐版打印 —— 查「选项有没有丢」用这个，比翻 checkpoint 原始 blob 省事。
