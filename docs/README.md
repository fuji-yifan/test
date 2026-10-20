# 文档索引

> 更新：2026-10-19。状态标记：✅ 已完成/现行有效 · ◐ 部分完成 · ⏳ 待做 · 🗄 历史归档

| 文档 | 内容 | 状态 |
|---|---|---|
| [AGENT_IMPROVEMENT_PLAN.md](./AGENT_IMPROVEMENT_PLAN.md) | Agent 改进落地手册：阶段 0–8 设计、可行性核查、回滚开关、真机灰度清单 | ✅ 在手范围全部完成并合入 `master`；真机灰度见 §7.2 |
| [AGENT_IMPROVEMENT_SUMMARY.md](./AGENT_IMPROVEMENT_SUMMARY.md) | 交付视角总结：外部基建配置、前端验收步骤、需本人执行的命令 | ✅ 功能均已落地；待 push 与灰度 |
| [AGENT_BACKLOG.md](./AGENT_BACKLOG.md) | 后续待做：阶段 7 D3/D4/D5、8.5 RAG、MCP；含明确不做清单（SOPS 等） | ⏳ 以后再做 |
| [HITL_CHECKPOINTS.md](./HITL_CHECKPOINTS.md) | 人机确认（检查点）文案与语义总表（9 声明式 + 2 动态） | ✅ 现行有效 |
| [OPA_INTEGRATION.md](./OPA_INTEGRATION.md) | 阶段 6 / S3.1 外部策略引擎（OPA）接入与排错 | ✅ 已接入并本地验证 |
| [dev-logs/](./dev-logs/) | 按日期记录的历史开发日志 | 🗄 历史归档，只读 |

## 当前结论（2026-10-19）

- 阶段 **0–8 的在手范围全部完成**，14 个阶段分支均已合入 `master`（线性历史）。
- 全量验证：agent `vitest` **1072 全绿**（33 文件）+ server/agent/web 三端 `tsc` 干净。
- **未 push、未灰度**；真机灰度清单见 `AGENT_IMPROVEMENT_PLAN.md` §7.2。
- **明确不做**：SOPS、S1.2 RLS（MySQL N/A）、模型层优化。
- **以后再做**：阶段 7 D3/D4/D5、8.5 RAG、MCP —— 详见 `AGENT_BACKLOG.md`。
