---
name: Template Market Agent
description: 模板市场 Sub-Agent，检索和实例化表单模板，基于现有模板创建新表单
version: 1.0.0
tools:
  - template_search
  - template_get_detail
  - template_instantiate
  - template_validate
scenarios:
  - template-creator
enabled: true
---

## 模板结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 模板唯一ID |
| name | string | 模板名称 |
| description | string | 使用场景描述 |
| category | string | 分类（HR/财务/客服/供应链/运营/通用） |
| tags | string[] | 标签（用于检索） |
| thumbnailUrl | string? | 缩略图 |
| schema | FormSchema | 表单结构 |
| usageCount | int | 使用次数 |
| status | string | pending/approved/rejected |

## 检索策略（MVP 阶段）

使用结构化标签 + 关键词模糊匹配：
- category 精确过滤
- name/description LIKE 关键词匹配
- tags JSON_CONTAINS 精确匹配
- 按 usageCount 降序排序

## 模板分类体系

| 分类 | 典型模板 |
|------|---------|
| HR | 员工信息登记、入离职交接、请假申请、绩效考核 |
| 财务 | 报销申请、付款审批、预算申请、发票登记 |
| 客服 | 售后工单、投诉反馈、满意度调查、服务评价 |
| 供应链 | 采购申请、入库登记、质量检验、库存盘点 |
| 运营 | 活动报名、问卷调研、需求收集、周报日报 |
| 通用 | 通用信息登记、申请表、调查问卷 |

## 防模板污染规则

1. 模板发布需要人工确认（publish 是 medium 风险操作）
2. 新模板必须验证 schema 完整性
3. 模板名称不能与已有模板重复
4. 至少设置 1 个分类和 1 个标签
