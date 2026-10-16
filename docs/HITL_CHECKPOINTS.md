# HITL 检查点文案总表

对话过程中所有「停下来问用户」的人机交互点。**改文案只改 `label`，不要动 `value`** ——
`value`（`continue` / `abort` / `confirm` / 表 key）是前端回传 `confirmAction` 后走哪条分支的依据，
改了会直接断掉确认链路。

## 一、声明式检查点

定义在 `apps/agent/src/modules/graph/agent-catalog.ts`，每个 Agent 的 `spec.checkpoints` 数组里。

| # | Agent | id | 触发时机 | 文案（prompt） | 按钮 label | 备注 |
|---|---|---|---|---|---|---|
| 1 | form-designer | `schema-review` | `form_assemble_schema` 成功后 | 表单结构已生成，下方可查看预览<br />这个结构是否可行？ | 没问题 / 再改一版 | 随中断载荷带 `artifact`，前端在待答复期间把它渲染成产物卡片并**默认展开**（所以「可点击」只在收起后才有意义） |
| 2 | form-designer | `space-approval` | `form_save` 执行前 | 表单已就绪，是否保存到当前空间？ | 保存 / 暂不保存 | `coversRisk`；带 `artifact` 与字段级 `diff` |
| 3 | form-designer | `rollback-approval` | `form_rollback` 执行前 | 是否将这张表单回滚到上一版本<br />（追加为新版本） | 确认 / 取消 | `coversRisk`（回滚也是写库，追加新版本） |
| 4 | form-designer | `delete-approval` | `form_delete` 执行前 | 是否删除这张表单<br />（移入回收站，可由管理员恢复） | 确认 / 取消 | `coversRisk`；破坏性操作 |
| 5 | form-designer | `version-delete-approval` | `form_version_delete` 执行前 | 是否删除这个历史版本<br />（移入回收站，可由管理员恢复） | 确认 / 取消 | `coversRisk`；破坏性操作 |
| 6 | workflow | `save-approval` | `flow_save` 执行前 | 流程定义已就绪，下方可查看预览<br />是否确认保存？ | 保存/ 暂不保存 | `coversRisk`；带 `artifact` |
| 7 | workflow | `bind-form-approval` | `flow_bind_form` 执行前 | 是否把表单关联到这个流程？<br />（关联只是意向，发布后才真正生效） | 关联 / 取消 | `coversRisk` |
| 8 | workflow | `publish-approval` | `flow_publish` 执行前 | 是否发布这个流程？<br />发布后，开始节点关联的表单被提交时会自动发起本流程。 | 发布 / 暂不发布 | `coversRisk`；高风险动作，发布才会让表单绑定真正生效 |
| 9 | template | `instantiate-approval` | `template_instantiate` 执行前 | 已选中该模板，下方可查看预览<br />是否用它生成表单？ | 生成 / 暂不生成 | `coversRisk`；带 `artifact` |

submission（数据分析）是只读 Agent，没有检查点。

## 二、动态检查点

代码里拼出来的，没有声明式 `CheckpointDef`。定义在 `apps/agent/src/modules/graph/subgraph.factory.ts`。

| # | 类型 | 触发时机 | 文案（prompt） | 按钮 label | 备注 |
|---|---|---|---|---|---|
| 10 | `disambiguate` | 会话里有多张同名表、`target` 指不明时（`subgraph.factory.ts:526-542`） | 会话中有 {N} 张「{目标}」，请选择要{动作}哪一张 | 每张表的 `标题（key，已保存?）` | label 必须带 key：重名即标题相同，只靠标题分不清 |
| 11 | `tool_confirm` | 工具网关判定该工具需确认、且没有被上面的检查点 `coversRisk` 顶掉时的兜底（`subgraph.factory.ts:575-592`） | 该操作需要你确认后才会执行 | 确认执行 / 取消 | 风险门兜底；不点工具名，工具与风险由默认展开的工具调用列表披露 |

## 三、术语

- **陈述式**：先陈述「现在是什么状态」，再说「下方有什么可用」，不用「是否…？」反问句。
- **`beforeTool` / `afterTool`**：检查点在某个工具执行前 / 成功后触发。
- **`coversRisk`**：`continue` 同时充当该工具的风险放行，避免对同一次调用连问两遍。
- **`artifact`**：随中断载荷下发的待审产物，前端据此渲染预览卡片（第 1、2、6、9 处有）。
- **`diff`**：表单保存前的字段级改动清单（仅第 2 处）。
