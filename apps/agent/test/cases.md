| # | 场景 | 输入 | 页面 | 期望 Agent | 期望行为 | 状态 |

|----|------|------|------|-----------|---------|------|

| F1 | 表单-基础创建 | 创建客户登记表(姓名/手机/邮箱) | form-builder | form-designer | form\_assemble\_schema 被调用且 fields 不为空 | ⬜ |

| F2 | 表单-校验失败 | 创建表单，用不存在的控件类型 xyz | form-builder | form-designer | form\_validate\_schema 返回 type 不合法 | ⬜ |

| F3 | 表单-追加字段 | 已有表单，说"加一个备注字段" | form-builder | form-designer | form\_assemble 的 fields 包含原有+新字段 | ⬜ |

| F4 | 表单-tip-text | 创建表单包含提示文字"请如实填写" | form-builder | form-designer | props.text 不为空 | ⬜ |

| T1 | 模板-有结果 | 搜索请假模板 | template-creator | template | template\_search 被调用并返回结果 | ⬜ |

| T2 | 模板-无结果 | 搜索 xyzabc123 模板 | template-creator | template | 回复"暂无"且不调 form 工具 | ⬜ |

| T3 | 模板-不越界 | 在模板页说"帮我设计一个表单" | template-creator | template | 不调 form\_assemble\_schema | ⬜ |

| W1 | 流程-创建 | 创建三级审批流(组长→经理→总监) | workflow-node | workflow | flow\_create + flow\_validate 被调用 | ⬜ |

| W2 | 流程-DAG校验 | 创建有环的流程 | workflow-node | workflow | flow\_validate 返回 hasCycle | ⬜ |

| R1 | 路由-页面优先 | 在模板页说"你好" | template-creator | template | 模板助手回复，不变成其他 | ⬜ |

| R2 | 路由-跨页面 | 在表单页说"搜索请假模板" | form-builder | template | 切换到模板助手 | ⬜ |

| R3 | 路由-表单信号 | 在流程页说"设计一个报销信息填写表" | workflow-node | form-designer | 不因为"审批"关键词误判为 workflow | ⬜ |

| R4 | 路由-短消息 | 在任意页面说"在吗" | 任意 | 页面Agent | 保持页面 Agent 不改变 | ⬜ |

| C1 | 跨领域编排 | 基于客服模板创建表单并配审批流 | form-builder | 多步 plan | plan 生成，多步执行 | ⬜ |

| E1 | 错误-缺参数 | LLM调用 form\_assemble\_schema 不传 fields | form-builder | form-designer | 返回明确错误+重试，不超过3次失败 | ⬜ |

| E2 | 错误-缺Token | 不登录直接调 agent | - | - | 返回 401 而非 500 | ⬜ |

| E3 | 错误-Server断连 | Server 未启动时调 template\_search | template-creator | template | 提示"后端未启动"而非模糊错误 | ⬜ |

| D1 | SSE-流式 | 创建表单 | form-builder | form-designer | delta 事件逐 token 到达 | ⬜ |

| D2 | SSE-打字动画 | 创建表单 | form-builder | form-designer | 加载中显示圆点，回答完毕消失 | ⬜ |

| D3 | SSE-工具调用 | 创建表单 | form-builder | form-designer | tool\_start/tool\_result 事件正确显示 | ⬜ |

