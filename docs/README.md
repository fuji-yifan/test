# 文档索引

> 更新：2026-10-21。状态标记：✅ 已完成/现行有效 · ◐ 部分完成 · ⏳ 待做 · 🗄 历史归档

| 文档 | 内容 | 状态 |
|---|---|---|
| [AGENT_IMPROVEMENT_PLAN.md](./AGENT_IMPROVEMENT_PLAN.md) | Agent 改进落地手册：阶段 0–8 设计、可行性核查、回滚开关、真机灰度清单 | ✅ 在手范围全部完成并合入 `master`；真机灰度见 §7.2 |
| [AGENT_IMPROVEMENT_SUMMARY.md](./AGENT_IMPROVEMENT_SUMMARY.md) | 交付视角总结：外部基建配置、前端验收步骤、需本人执行的命令 | ✅ 功能均已落地，已 push 并完成灰度 |
| [AGENT_MANUAL_TEST_CASES.md](./AGENT_MANUAL_TEST_CASES.md) | Agent 手测用例清单与实测结论台账（F/T/W/R/C/E/D/H/S 编号） | ✅ 现行有效 |
| [HITL_CHECKPOINTS.md](./HITL_CHECKPOINTS.md) | 人机确认（检查点）文案与语义总表（9 声明式 + 2 动态） | ✅ 现行有效 |
| [OPA_INTEGRATION.md](./OPA_INTEGRATION.md) | 阶段 6 / S3.1 外部策略引擎（OPA）接入与排错 | ✅ 已接入并本地验证 |
| [TECHNICAL_DESIGN_V3.md](./TECHNICAL_DESIGN_V3.md) | 平台技术设计与实现规划 V3.1（整体架构、数据模型、模块设计） | 🗄 设计基线 |
| [dev-logs/](./dev-logs/) | 按日期记录的历史开发日志 | 🗄 历史归档，只读 |

## 当前结论（2026-10-20）

- 阶段 **0–8 的在手范围全部完成**，14 个阶段分支均已合入 `master`（线性历史）。
- 全量验证：agent `vitest` **1101 全绿**（34 文件）+ server/agent/web 三端 `tsc` 干净。
- 已 push（`e39afed`）并完成真机灰度（`SESSION_STORE=mysql`）；灰度清单见 `AGENT_IMPROVEMENT_PLAN.md` §7.2。
