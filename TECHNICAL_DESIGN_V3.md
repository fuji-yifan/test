# 低代码平台 — 技术设计与实现规划 V3.1

> **定位**：面向中小企业的通用低代码业务搭建平台 — 让非技术人员通过拖拽设计表单、配置流程和权限，零代码搭建请假、报销、CRM、工单等内部应用。
> **核心命题**：如何用一份 JSON Schema 同时驱动 UI 渲染、数据校验、字段联动、权限过滤、流程流转与版本追溯。
> **技术栈**：Vue 3 + Element Plus + NestJS + MySQL + Prisma
> **项目名**：FormX（原 Formpu）

---

## 目录

- [1. 项目定位与差异化](#1-项目定位与差异化)
- [2. 功能清单与优先级](#2-功能清单与优先级)
- [3. 系统架构](#3-系统架构)
- [4. 核心引擎设计](#4-核心引擎设计)
- [5. 流程引擎设计](#5-流程引擎设计)
- [6. 多层权限模型](#6-多层权限模型)
- [7. 表达式引擎](#7-表达式引擎)
- [8. Schema 版本管理](#8-schema-版本管理)
- [9. 其他功能模块](#9-其他功能模块)
- [10. 架构决策记录](#10-架构决策记录)
- [11. 开发里程碑](#11-开发里程碑)

---

## 1. 项目定位与差异化

### 1.1 一句话定位

**「FormX — 面向中小企业的通用低代码业务搭建平台」**

让非技术人员通过拖拽设计表单、配置流程和权限，零代码搭建请假、报销、CRM、工单等内部应用，替代 Excel 与零散 SaaS。

### 1.2 简历话术

> "系统设计 + 全栈 + 多引擎" 的综合项目，比 CRUD 管理系统高一个量级。

### 1.3 核心差异化

| 维度 | 传统 CRUD 后台 | FormX 低代码平台 |
|---|---|---|
| **表单** | 硬编码每个表单 | JSON Schema 驱动，拖拽搭建 |
| **流程** | if-else 写死 | 可配置流程引擎（BPMN 子集） |
| **权限** | 接口加注解 | 五级权限（平台→应用→表单→行→字段） |
| **联动** | 写一堆 onChange | 表达式引擎 + 依赖图自动推导 |
| **版本** | 改了上线完事 | Schema 快照 + 兼容渲染，历史数据不丢 |
| **扩展** | 改源码 | 开放 API + Webhook + 应用模板市场 |

---

## 2. 功能清单与优先级

### 2.1 第一梯队：核心深度（必做）

| 模块 | 功能点 | 技术亮点 |
|---|---|---|
| **表单设计器** | 拖拽组件、自由定位、栅格吸附、子表嵌套、字段联动、校验规则 | JSON Schema 驱动渲染、DesignerEngine 纯逻辑引擎、碰撞检测、撤销/重做 |
| **流程引擎** | 提交→审批→条件分支→会签/或签→撤回/驳回/加签，流程版本管理 | BPMN 2.0 子集、状态机、并发安全、流程回溯 |
| **权限引擎（五级）** | 平台→应用→表单→行级→字段级；RBAC + ABAC 混合 | 部门树递归、数据脱敏、中间件统一拦截 |
| **规则/表达式引擎** | 字段公式（IF/SUM/LOOKUP）、跨字段校验、动态显隐 | 自研 Lexer + Parser 递归下降、AST 解释执行、沙箱安全 |

### 2.2 第二梯队：加分项

| 模块 | 功能点 |
|---|---|
| **仪表盘/报表** | 拖拽式图表配置、聚合统计、透视表、数据导出 |
| **应用市场** | 内置模板（请假/报销/CRM/工单），一键安装 |
| **Webhook + 开放 API** | 外部系统推送、第三方数据接入、HMAC 签名 |
| **消息中心** | 待办提醒、邮件/站内信通知 |
| **操作日志 & 审计** | 谁改了什么、版本回滚（AOP 自动记录） |
| **多端适配** | PC + 移动 H5 响应式 |

### 2.3 第三梯队：未来规划

| 功能 | 说明 |
|---|---|
| **国际化 (i18n)** | Schema 预留 `locale` 字段 |
| **PWA 离线** | Service Worker 缓存 |
| **K8s 部署** | 简历可写"支持容器化" |

---

## 3. 系统架构

### 3.1 Monorepo 目录结构

```
formx/
├── apps/
│   ├── web/                              # 统一 SPA 入口
│   │   ├── layouts/                       # DefaultLayout / BlankLayout / RenderLayout
│   │   ├── router/                        # 路由表 + 权限守卫 (beforeEach)
│   │   ├── views/
│   │   │   ├── auth/                      # LoginView / RegisterView
│   │   │   ├── home/                      # HomeView（工作台）
│   │   │   ├── designer/                  # DesignerView + Canvas + PropertyPanel
│   │   │   ├── renderer/                  # PublicFormView / PreviewOnly / SubmitSuccess
│   │   │   ├── admin/                     # FormList / DataList / Member / Role / Audit / Webhook
│   │   │   ├── workflow/                  # 【新增】流程设计器 + 流程图预览
│   │   │   ├── dashboard/                 # 【新增】仪表盘配置 + 渲染
│   │   │   └── error/                     # 403 / 404
│   │   ├── stores/                        # auth / workspace / app / workflow
│   │   ├── components/                    # 公共组件
│   │   └── bridge/                        # Element Plus 适配器注册
│   │
│   └── server/                            # NestJS 后端
│       ├── modules/
│       │   ├── auth/                      # 认证（JWT + 刷新Token）
│       │   ├── form/                      # 表单 CRUD + Schema 版本管理
│       │   ├── submission/                # 表单提交 + 数据查询
│       │   ├── workflow/                  # 【新增】流程定义 + 流程实例 + 任务
│       │   ├── rbac/                      # 角色权限管理
│       │   ├── workspace/                 # 工作空间 + 成员
│       │   ├── audit/                     # 操作审计日志
│       │   ├── webhook/                   # Webhook 管理 + 异步投递
│       │   ├── template/                  # 应用模板市场
│       │   ├── dashboard/                 # 【新增】仪表盘数据聚合
│       │   └── notification/              # 【新增】消息通知
│       └── common/                        # Guards / Filters / Interceptors / Decorators
│
├── packages/
│   └── sdk/                               # @formx/sdk
│       ├── types/                         # JSON Schema / 流程定义 类型
│       ├── registry/                      # ComponentRegistry 全局控件注册表
│       ├── engine/
│       │   ├── designer-engine/           # HistoryStack / SelectionModel / DragDropManager
│       │   ├── renderer-engine/           # ValidationPipeline / DependencyGraph / ACLFilter
│       │   ├── workflow-engine/           # 【新增】状态机 / 条件评估 / 会签逻辑
│       │   ├── expression-engine/         # Lexer + Parser + 内置函数
│       │   └── compatibility-adapter/     # 版本兼容渲染适配器
│       ├── api/                           # API 客户端封装
│       └── utils/                         # schema-utils / linkage-engine
│
├── docker-compose.dev.yml                 # MySQL + Redis + MinIO
├── turbo.json
└── package.json
```

### 3.2 分层架构图

```
┌──────────────────────────────────────────────┐
│       Web 前端（设计器 + 运行态 + 管理后台）       │
│       Vue 3 + Element Plus + Pinia            │
└──────────────────┬───────────────────────────┘
                   │ HTTPS / JWT
┌──────────────────▼───────────────────────────┐
│     API Gateway（NestJS Guards 鉴权/限流）      │
│     JwtAuthGuard → WorkspaceGuard → ACLGuard  │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│            业务服务层 (NestJS Modules)          │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │表单服务  │ │流程引擎   │ │权限服务(RBAC) │  │
│  └─────────┘ └──────────┘ └──────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │规则引擎  │ │报表服务   │ │消息通知       │  │
│  └─────────┘ └──────────┘ └──────────────┘  │
│  ┌─────────┐ ┌──────────┐                   │
│  │Webhook  │ │审计日志   │                   │
│  └─────────┘ └──────────┘                   │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│         基础设施层                              │
│  MySQL 8 + Redis + MinIO + BullMQ            │
└──────────────────────────────────────────────┘
```

### 3.3 数据流

```
                    ┌─────────────┐
                    │ JSON Schema  │  ← 唯一真相源 (SSOT)
                    └──────┬──────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Designer   │    │  Renderer   │    │   Server    │
│  搭建/编辑   │    │  填写/预览   │    │  校验/存储   │
│  自由定位    │    │  递归渲染    │    │  权限过滤    │
│  拖拽排序    │    │  联动执行    │    │  流程流转    │
└─────────────┘    └─────────────┘    └─────────────┘
```

---

## 4. 核心引擎设计

> 引擎（Engine）是纯 TypeScript 逻辑，不依赖任何 UI 框架。
> 这是整个平台最核心的架构决策——引擎与视图彻底分离。

### 4.1 DesignerEngine（搭建引擎）

搭建引擎管理设计态的**状态、操作和约束**，与 Vue 组件完全解耦。

```typescript
// ==================== DesignerEngine 核心接口 ====================

interface IDesignerEngine {
  // --- 状态查询 ---
  readonly schema: FormSchema
  readonly selectedFieldId: string | null
  readonly isDirty: boolean

  // --- 选区模型 ---
  selection: SelectionModel

  // --- 历史栈 ---
  history: HistoryStack

  // --- 拖拽管理 ---
  dragDrop: DragDropManager

  // --- 操作 ---
  addField(parentId: string | null, index: number, fieldType: string): FieldSchema
  removeField(fieldId: string): void
  moveField(fieldId: string, targetParentId: string | null, targetIndex: number): void
  updateFieldProps(fieldId: string, props: Record<string, any>): void
  updateFieldMeta(fieldId: string, meta: Partial<FieldMeta>): void

  // --- Schema 读写 ---
  loadSchema(schema: FormSchema): void
  getSchema(): FormSchema

  // --- 事件钩子 ---
  on(event: 'field:added' | 'field:removed' | 'field:moved' | 'schema:changed', handler: Function): void
}

// ==================== 选区模型 ====================

interface SelectionModel {
  readonly selectedId: string | null
  readonly selectedField: FieldSchema | null

  select(id: string | null): void
  /** 多选模式（批量删除/复制） */
  selectRange(ids: string[]): void
  clear(): void
}

// ==================== 历史栈（撤销/重做） ====================

interface HistoryStack {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly depth: number

  push(state: FormSchema): void
  undo(): FormSchema | null
  redo(): FormSchema | null
  clear(): void
}
// 实现要点：
// - 最大深度 50（防止内存膨胀）
// - 使用 structuredClone 深拷贝（快照不可变性）
// - 新操作分支丢弃 redo 栈（符合主流编辑器习惯）
// - 与 designer store 通过事件解耦，引擎不依赖 Pinia

// ==================== 拖拽管理器 ====================

interface DragDropManager {
  readonly isDragging: boolean
  readonly dragSource: DragSource | null

  /** 从组件面板开始拖拽 */
  startDrag(source: DragSource): void
  /** 画布内自由移动（改变 x, y 坐标） */
  reposition(fieldId: string, x: number, y: number): void
  /** 画布内拖拽排序 */
  reorder(fieldId: string, targetIndex: number): void
  /** 跨容器拖拽（画布 → 布局容器） */
  moveToContainer(fieldId: string, containerId: string, index: number): void
  /** 碰撞检测：检查目标位置是否与已有控件重叠 */
  checkCollision(x: number, y: number, width: number, height: number, excludeFieldId?: string): boolean
  /** 自动找空位：重叠时计算最近的可用位置 */
  findNearestVacant(x: number, y: number, width: number, height: number): { x: number; y: number }
  /** 结束拖拽 */
  endDrag(): void
}

interface DragSource {
  type: 'palette' | 'canvas'
  componentType?: string       // palette 拖出时：控件类型
  fieldId?: string             // canvas 内移动时：源字段 ID
  parentId: string | null
  index: number
}

// ==================== 画布自由定位 ====================

/** 已有实现特性 */
interface CanvasFreePositioning {
  /** 所有控件统一绝对定位，基于 x/y 坐标 */
  /** 面板拖入时在松手位置直接放置，重叠则自动找空位 */
  /** 碰撞检测应用于全部控件（8px 缓冲） */
  /** 4px 防抖阈值：鼠标微动不触发定位切换 */
  /** 背景参考网格（20px 间距），可开关 */
  /** 拖拽中直改响应式对象（不触发 history），松手后一次性保存快照 */
}
```

### 4.2 RendererEngine（渲染引擎）

渲染引擎接收一份 Schema，产出**表单运行时**：数据管理、校验执行、联动计算、显隐判断、权限过滤。

```typescript
// ==================== RendererEngine 核心接口 ====================

interface IRendererEngine {
  // --- 数据管理 ---
  getValue(fieldPath: string): any
  setValue(fieldPath: string, value: any): void
  getFormData(): Record<string, any>
  resetForm(): void

  // --- 校验管道 ---
  validate(fieldPath?: string): Promise<ValidationResult>
  validateAll(): Promise<ValidationResult[]>
  clearValidation(fieldPath?: string): void

  // --- 字段订阅 ---
  watch(fieldPath: string, callback: (newValue: any, oldValue: any) => void): () => void
  unwatch(fieldPath: string): void

  // --- 显隐计算 ---
  getVisibleFields(): FieldSchema[]

  // --- 联动执行 ---
  triggerLinkage(changedFieldPath: string): LinkageResult[]

  // --- 子表单 ---
  addSubFormRow(fieldPath: string, data?: Record<string, any>): number
  removeSubFormRow(fieldPath: string, rowIndex: number): void

  // --- 权限过滤 ---
  filterByACL(fields: FieldSchema[], userRoles: string[]): FieldSchema[]
  canEdit(fieldPath: string, userRoles: string[]): boolean
  canView(fieldPath: string, userRoles: string[]): boolean
}

// ==================== 校验管道 ====================

interface ValidationPipeline {
  register(name: string, validator: FieldValidator): void
  execute(field: FieldSchema, value: any, context: ValidationContext): Promise<Error[]>
}

interface FieldValidator {
  type: 'required' | 'pattern' | 'min' | 'max' | 'minLength'
      | 'maxLength' | 'email' | 'url' | 'custom' | 'async'
  validate(value: any, rule: ValidationRule, ctx: ValidationContext): Error | null | Promise<Error | null>
}

// ==================== 依赖图（字段联动核心） ====================

interface DependencyGraph {
  /** 注册依赖：fieldA 的变化会影响 fieldB */
  addDependency(sourceFieldPath: string, targetFieldPath: string, linkageRule: LinkageRule): void
  /** 当 fieldPath 变化时，获取所有受影响的字段 */
  getAffectedFields(fieldPath: string): AffectedField[]
  /** 拓扑排序检测循环依赖 */
  detectCycle(): string[][] | null
}
```

### 4.3 Component Bridge（UI 库解耦）

```
Schema type: "input"  ──→  ComponentBridge.resolve("input")
                                    │
                        ┌───────────┴───────────┐
                        │  ElementPlusAdapter    │  ← 当前实现
                        │  AntDesignAdapter      │  ← 未来可扩展
                        │  NaiveUIAdapter        │  ← 未来可扩展
                        └───────────────────────┘
```

不直接在 Renderer 中 hardcode Element Plus 组件。通过 Component Bridge（适配器模式）映射 Schema 控件类型到具体 UI 组件。UI 库可替换，第三方可通过 npm 包注册自定义控件。

---

## 5. 流程引擎设计

> 这是平台从"表单工具"升级到"业务平台"的关键模块。
> 目标：实现 BPMN 2.0 的核心子集，支持企业审批场景。

### 5.1 核心概念

```
流程定义 (ProcessDefinition)  ──1:N──→  流程实例 (ProcessInstance)
                                            │
                                      ┌─────┴─────┐
                                      │           │
                                   节点实例      任务实例
                                 (NodeInstance)  (TaskInstance)
```

| 概念 | 说明 |
|---|---|
| **ProcessDefinition** | 流程模板：定义有哪些节点、连线、条件 |
| **ProcessInstance** | 一次具体流程运行：谁发起的、当前到哪了 |
| **NodeInstance** | 流程中的节点：开始、审批、条件分支、结束 |
| **TaskInstance** | 待办任务：分配给谁、状态（待处理/已通过/已驳回） |

### 5.2 支持的节点类型（BPMN 2.0 子集）

| 节点类型 | 说明 | 面试要点 |
|---|---|---|
| **开始节点** | 流程起点 | — |
| **结束节点** | 流程终点 | — |
| **审批节点** | 单人审批/多人审批 | 可配置审批人（固定/动态/角色） |
| **条件分支** | 根据表单数据走不同路径 | 表达式引擎驱动（如 `amount > 10000`） |
| **并行分支** | 同时发起多条路径 | **会签**（所有人通过才通过） |
| **汇合节点** | 多条路径汇聚 | **或签**（任一通过即可） |
| **子流程** | 嵌套另一个流程 | 复用已有流程定义 |

### 5.3 流程操作

| 操作 | 说明 |
|---|---|
| **提交** | 发起流程实例 |
| **审批通过** | 当前任务完成，流转到下一节点 |
| **审批驳回** | 驳回（到上一节点/到发起人/到指定节点） |
| **撤回** | 发起人在下一节点处理前可撤回 |
| **加签** | 当前审批人加一个协办人 |
| **转交** | 当前审批人转让给其他人 |
| **催办** | 发送提醒通知 |

### 5.4 状态机设计

```
每个流程实例的状态流转：

  [草稿] ──提交──→ [审批中] ──通过──→ [已完成]
                    │    │
                    │    ├──驳回──→ [已驳回]
                    │    │
                    │    └──撤回──→ [已撤回]
                    │
                    └──超时──→ [已超时]
```

```typescript
// 状态机核心接口
interface WorkflowStateMachine {
  /** 当前状态 */
  readonly currentState: ProcessState

  /** 允许的转换 */
  getAvailableTransitions(): StateTransition[]

  /** 执行转换 */
  transition(transition: StateTransition, context: TransitionContext): Promise<ProcessState>

  /** 是否可以转换到目标状态 */
  canTransition(to: ProcessState): boolean
}

enum ProcessState {
  DRAFT = 'draft',
  APPROVING = 'approving',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
  TIMEOUT = 'timeout',
}
```

### 5.5 会签/或签实现

```typescript
// 会签：所有审批人都通过才算通过
interface CountersignStrategy {
  type: 'all' | 'any' | 'ratio'
  /** ratio 模式：百分比通过即可，如 0.6 表示 60% */
  ratio?: number

  evaluate(approvals: ApprovalResult[]): 'approved' | 'rejected' | 'pending'
}

// 示例：部门经理 + HR 双重审批
const node: ApprovalNode = {
  type: 'approval',
  strategy: { type: 'all' },            // 会签：两人都通过
  assignees: ['${deptManager}', '${hr}'], // 动态解析审批人
}
```

### 5.6 流程版本管理

```
流程 V1（生产中）         流程 V2（草稿）
      │                       │
      │  正在运行的实例        │  新实例使用
      │  继续用 V1             │  V2 流程
      ▼                       ▼
  不受 V2 修改影响          V2 发布后成为新默认版本
```

**原则**：已发起的流程实例永远用发起时的流程版本运行到底。修改流程定义不影响进行中的实例。

### 5.7 数据库设计要点

```sql
-- 流程定义表
process_definitions (
  id, workspace_id, name, version, status (draft/published/archived),
  definition_json (JSON: 节点+连线+条件),
  created_at, updated_at
)

-- 流程实例表
process_instances (
  id, definition_id, definition_version,
  form_id, form_submission_id,
  initiator_id, current_state, current_nodes (JSON: 当前活跃节点),
  created_at, updated_at
)

-- 任务实例表
task_instances (
  id, instance_id, node_id,
  assignee_id, status (pending/approved/rejected/transferred),
  comment, created_at, processed_at
)
```

### 5.8 面试话术

> "流程引擎实现了 BPMN 2.0 核心子集：审批、条件分支、会签、或签、加签、撤回。
> 每个流程实例绑定发起时的流程版本，修改流程定义不影响运行中的实例。
> 会签/或签通过策略模式实现，支持全票/任意/比率三种通过规则。"

---

## 6. 多层权限模型

> 这是"多层权限"的核心，五级权限树：

```
平台管理员 (Super Admin)
 └── 应用管理员 (App Admin)
      └── 表单管理员 (Form Admin)
           └── 行级权限 (Row-level：只能看本部门/自己的数据)
                └── 字段级权限 (Field-level：隐藏薪资/金额字段)
```

### 6.1 五级权限详解

| 级别 | 控制粒度 | 实现方式 | 示例 |
|---|---|---|---|
| **L1 平台级** | 整个平台功能 | RBAC 角色绑定菜单/按钮 | 超级管理员、普通用户 |
| **L2 应用级** | 应用可见性 | 工作空间成员角色 | 只能访问"HR 工作空间" |
| **L3 表单级** | 表单 CRUD | 表单级权限点 | 可编辑"请假表"但不能删除 |
| **L4 行级** | 数据行可见范围 | SQL 拦截器注入 WHERE 条件 | 部门经理只看本部门数据 |
| **L5 字段级** | 字段可见/可编辑 | Schema ACL + 响应过滤 | 隐藏"薪资"字段 |

### 6.2 RBAC + ABAC 混合模型

```typescript
// RBAC：角色 → 权限点
const rbac = {
  roles: ['super_admin', 'workspace_admin', 'form_editor', 'viewer'],
  permissions: [
    'form:create', 'form:edit', 'form:delete', 'form:publish',
    'submission:view', 'submission:export',
    'member:invite', 'member:remove',
    'workflow:approve', 'workflow:reject',
  ],
  // 角色-权限映射
  rolePermissions: {
    workspace_admin: ['form:*', 'submission:*', 'member:*', 'workflow:*'],
    form_editor: ['form:create', 'form:edit', 'submission:view'],
    viewer: ['submission:view'],
  }
}

// ABAC：属性维度
interface ABACContext {
  user: { id: string; deptId: string; position: string; region: string }
  resource: { type: 'form' | 'submission'; id: string; ownerDeptId: string }
  action: 'read' | 'write' | 'delete'
}

// 行级权限策略：部门隔离
const rowLevelPolicy = {
  name: 'department-isolation',
  evaluate: (ctx: ABACContext) => {
    // 同部门 → 可读；跨部门 → 不可见
    if (ctx.user.deptId === ctx.resource.ownerDeptId) return 'allow'
    // 上级部门 → 可读（部门树递归）
    if (isAncestorDept(ctx.user.deptId, ctx.resource.ownerDeptId)) return 'allow'
    return 'deny'
  }
}
```

### 6.3 行级权限 SQL 拦截（重点）

```typescript
// 在 ORM 层统一注入，避免每个接口手写
// Prisma 中间件示例：
prisma.$use(async (params, next) => {
  if (params.model === 'FormSubmission' && params.action === 'findMany') {
    const userDeptIds = await getUserDepartmentTree(ctx.user.deptId)
    // 自动注入：只查本部门及子部门的数据
    params.args.where = {
      ...params.args.where,
      deptId: { in: userDeptIds },
    }
  }
  return next(params)
})
```

### 6.4 字段级 ACL

```json
{
  "key": "salary",
  "type": "input-number",
  "name": "薪资",
  "acl": {
    "viewable":  ["role:hr", "role:manager"],
    "editable":  ["role:hr"]
  }
}
```

**双重保障**：
- **前端**：RendererEngine.filterByACL() 在渲染前过滤字段
- **后端**：FieldACLInterceptor 在提交时校验，非授权字段提交 → 403

### 6.5 权限执行链

```
请求进入
  │
  ▼
JwtAuthGuard          ← 认证：你是谁？
  │
  ▼
WorkspaceGuard        ← 空间成员校验
  │
  ▼
PermissionGuard       ← RBAC：你有 "form:edit" 权限吗？
  │
  ▼
RowLevelInterceptor   ← 行级：SQL 注入 WHERE dept_id IN (...)
  │
  ▼
FieldACLInterceptor   ← 字段级：过滤 body 中的非授权字段
  │
  ▼
Controller / Service
```

### 6.6 面试话术

> "权限模型采用 RBAC + ABAC 混合：RBAC 控制菜单和按钮级权限，ABAC 通过部门树递归实现行级数据隔离。
> 行级权限在 ORM 层统一拦截——Prisma 中间件自动注入 WHERE 条件，避免每个接口手写，防止漏判。
> 字段级 ACL 嵌入 JSON Schema，前端渲染和后端提交双重校验。
> 性能方面：部门树预计算 + Redis 缓存权限判定结果，避免每次请求都递归查库。"

---

## 7. 表达式引擎

> 低代码平台的灵魂。没有独立的表达式引擎，"联动规则"就写死在代码里。

### 7.1 定位

```
Context（表单当前数据）           Expression（Schema 中定义的规则）
────────────────────────         ──────────────────────────────
{                                  "dept === 'finance' && amount > 10000"
  dept: 'finance',
  amount: 15000                   ┌────────────────┐
}                                 │ ExpressionEngine│
                                  │  .evaluate()   │
                                  └───────┬────────┘
                                          │
                                          ▼
                                    boolean: true
```

### 7.2 实现架构

```
表达式: "age > 18 && gender === 'male'"
    │
    ▼
┌──────────┐
│  Lexer   │  词法分析 → Token 流
└────┬─────┘
     │
     ▼
┌──────────┐
│  Parser  │  递归下降语法分析 + 解释执行
└────┬─────┘  优先级: 逻辑 → 比较 → 算术 → 一元 → 函数调用 → 原子
     │
     ▼
  → 求值结果
```

### 7.3 安全性

- **沙箱隔离**：不访问 `window/global/document/this`
- **无 IO**：不能执行 `fetch/import/require/setTimeout`
- **无原型链攻击**：不支持 `__proto__` / `constructor` 访问
- **语法白名单**：仅支持定义的 Token 类型
- **容错**：解析失败返回语义安全的默认值

### 7.4 应用场景

| 场景 | 表达式示例 | 引擎角色 |
|---|---|---|
| **条件显隐** | `projectType === 'external'` | 显隐判断 |
| **字段联动** | `amount > 10000 → disabled(max=50000)` | 联动触发 |
| **跨字段校验** | `endDate > startDate` | 校验 |
| **流程条件分支** | `amount > 10000 → 走总经理审批` | 流程路由 |
| **公式计算** | `salary * 12 + bonus` | 数据计算 |

---

## 8. Schema 版本管理

> 核心问题：表单从 V1 升级到 V2 后，V1 的历史数据还能正确渲染吗？

### 8.1 快照机制

**原则**：表单每次发布，当前完整 Schema 拷贝为不可变快照。

```
forms 表                          form_versions 表
┌──────────────────────┐         ┌───────────────────────────┐
│ id (UUID)            │ 1───*  │ id (UUID)                 │
│ schema (当前最新)      │        │ form_id → FK              │
│ published_version    │        │ version (自增整数)           │
│ status               │        │ schema (完整 JSON 快照)      │
└──────────────────────┘        │ change_log                 │
                                │ created_at                 │
                                └───────────────────────────┘

form_submissions 表
┌──────────────────────┐
│ form_id              │
│ form_version ← 关键！ │  ← 数据严格绑定提交时的版本号
│ data (JSON)          │
└──────────────────────┘
```

### 8.2 兼容渲染策略

| 场景 | Schema 变更 | 策略 |
|---|---|---|
| **新增字段** | V2 加了 `salary` | `defaultValue` 填充 → UI 显示默认值 + 警告标记 |
| **删除字段** | V2 删了 `age` | 数据保留在 JSON 中，渲染时 skip → 数据不丢失 |
| **修改字段类型** | `age: number` → `birthDate: date` | 尝试转换，失败保留原值 → 标记"类型不匹配" |

### 8.3 为什么不采用 Migration Script？

| 对比维度 | 快照方案（本平台） | Migration 方案 |
|---|---|---|
| **历史数据完整性** | ✅ 原封不动，可审计 | ❌ 修改后无法还原 |
| **回滚能力** | ✅ 切回旧 Schema 即可 | ❌ 需要反向脚本 |
| **性能** | ✅ 读取时按需适配 | ❌ 大批量更新可能锁表 |

---

## 9. 其他功能模块

### 9.1 仪表盘/报表

```
用户拖拽配置
    │
    ▼
┌──────────────────────┐
│ 图表类型: 柱状图/饼图/折线 │
│ 数据源: 选择表单         │
│ 聚合维度: 部门/月份      │
│ 聚合指标: COUNT/SUM/AVG │
└──────────────────────┘
    │
    ▼
后端动态生成 GROUP BY SQL → 返回聚合数据 → ECharts 渲染
```

### 9.2 应用模板市场

```
模板 = 预定义的 Schema + 流程定义 + 权限配置 的集合

内置模板：
  - 请假申请（表单 + 两级审批流程）
  - 报销申请（表单 + 条件分支：金额>5000 需总监审批）
  - CRM 客户管理（表单 + 行级权限：销售只看自己的客户）
  - 工单系统（表单 + 流程 + 状态看板）

操作：浏览模板 → 一键安装 → 自动创建表单+流程+权限 → 用户可直接使用
```

### 9.3 Webhook + 开放 API

- **Webhook**：表单提交后自动推送数据到外部系统，异步投递 + 指数退避重试 + HMAC 签名验证
- **开放 API**：RESTful API + SDK 封装，第三方可通过 API 读写表单数据

### 9.4 消息通知中心

| 类型 | 触发时机 | 渠道 |
|---|---|---|
| **待办提醒** | 有新审批任务 | 站内信 + 邮件 |
| **流程通知** | 审批通过/驳回 | 站内信 |
| **催办** | 超时未处理 | 邮件 |
| **系统公告** | 管理员发布 | 站内信 |

### 9.5 操作审计日志

- AOP 拦截器自动记录：谁、什么时间、做了什么操作、IP、User-Agent
- 可回溯：表单修改历史、数据变更记录
- 查询页：按时间/用户/操作类型筛选

---

## 10. 架构决策记录

### ADR-001: 自研表达式引擎 vs 引入第三方库

**Context**：需要运行时解析 Schema 中的条件显隐、联动规则、流程分支条件表达式。
**Decision**：自研 Lexer + Parser 递归下降解释器。
**Consequences**：
- ✅ 体积可控（~3KB gzip），语法完全自定
- ✅ 沙箱安全（无 eval/Function，无全局作用域访问）
- ❌ 需要自己维护语法扩展

### ADR-002: 流程引擎——自研状态机 vs 引入 Flowable/Camunda

**Context**：需要支持审批流程（提交→审批→分支→会签/或签→撤回/驳回）。
**Decision**：自研轻量状态机，实现 BPMN 2.0 核心子集。
**Consequences**：
- ✅ 零外部依赖，与表单引擎深度集成
- ✅ 流程定义存为 JSON，可直接嵌入表单 Schema
- ❌ 不兼容标准 BPMN XML（但我们也不需要）

### ADR-003: 五级权限——RBAC + ABAC 混合

**Context**：企业场景需要"部门经理只看本部门数据"、"HR 可编辑薪资但其他人不可见"等细粒度控制。
**Decision**：RBAC 控制菜单/按钮（粗粒度），ABAC 控制行级/字段级（细粒度）。
**Consequences**：
- ✅ 灵活度兼顾——粗粒度用角色，细粒度用属性
- ✅ SQL 拦截器统一处理行级权限，避免漏判
- ❌ 权限判定逻辑分散在两端（前端渲染 + 后端 Guard），需要一致性测试

### ADR-004: Redis 引入时机与用途

**Context**：热门表单的 Schema 读取频率远高于写入；流程状态、权限结果适合缓存。
**Decision**：Phase 3 引入 Redis，三个明确用途：
1. **Schema Hot Cache**：高频表单 Schema，命中率预期 > 90%
2. **权限结果缓存**：部门树预计算 + 权限判定结果，避免每次递归
3. **分布式锁**：防止重复提交 + 流程并发安全（SET NX + TTL）
**Consequences**：✅ 性能提升明显 ❌ 缓存失效策略需维护

### ADR-005: BullMQ 消息队列

**Decision**：Phase 3 引入 BullMQ（基于 Redis），两个用途：
1. **Webhook 异步投递**：失败指数退避重试（2^n 秒，n ≤ 5）
2. **大数据导出**：超 1 万条 Excel 导出转为后台任务
**Consequences**：✅ HTTP 响应时间稳定 ❌ 运维复杂度增加

### ADR-006: MinIO 对象存储

**Decision**：前端通过 Presigned URL 直传 MinIO（S3 兼容），NestJS 只生成签名 URL 和记录元数据。
**Consequences**：✅ 大文件不经过服务器 ❌ 需前端实现分片上传

### ADR-007: Component Bridge 设计

**Decision**：不直接在 Renderer 中 hardcode Element Plus 组件，通过适配器模式映射。
**Consequences**：✅ UI 库可替换 ✅ 第三方可注册自定义控件 ❌ 增加一层抽象

---

## 11. 开发里程碑

### Phase 1: 核心引擎定型 ✅（已完成）

- [x] RendererEngine 核心接口（ValidationPipeline + DependencyGraph + ACLFilter）
- [x] DesignerEngine 核心接口（HistoryStack + SelectionModel + DragDropManager）
- [x] 画布自由定位（绝对定位 + 碰撞检测 + 网格背景 + 4px 防抖）
- [x] Component Bridge 桥接层 + Element Plus 适配器
- [x] 表达式引擎（Lexer + Parser + 自定义函数 + 沙箱安全）
- [x] Schema 版本快照机制（版本表 + 兼容渲染 + ACL 拦截器）
- [x] 统一前端入口 apps/web（路由 + 守卫 + Layout）
- [x] 登录/注册/JWT Token + Auth Store
- [x] 工作空间选择 + 侧边栏 + 面包屑
- [x] 表单列表 + 数据列表（动态表头）+ 数据详情
- [x] 预览功能（页内全屏浮层，位置与画布一致）

### Phase 2: 流程引擎 + 五级权限（已完成）

- [x] **流程引擎核心**
  - [x] WorkflowStateMachine 状态机实现 (`workflow-engine.ts`)
  - [x] 流程定义 CRUD + JSON 存储 (`workflow.service.ts` + Prisma schema)
  - [x] 流程实例的创建、流转、完成 (`startProcess / approveTask`)
  - [x] 审批节点（单人/多人）+ 条件分支 (`ApprovalConfig + ConditionBranch`)
  - [x] 会签/或签策略 (`CountersignStrategy + CountersignEvaluator`)
  - [x] 撤回/驳回/加签操作 (`withdrawProcess / rejectTask / addSign / transferTask`)
  - [x] 流程版本管理 (实例绑定 `definition_version`)
- [x] **五级权限落地**
  - [x] L1 平台级：`super_admin` 角色 + PermissionGuard 放行
  - [x] L2 工作空间级：`WorkspaceGuard` 校验成员归属
  - [x] L3 表单级：`@RequiredPermission` 装饰器 + PermissionGuard 守卫
  - [x] L4 行级：`RowLevelInterceptor` + `buildRowLevelWhere` SQL 拦截
  - [x] L5 字段级：`FieldACLInterceptor` + RendererEngine.filterByACL
- [x] 权限矩阵 UI (`RoleManage.vue` — 矩阵表格 + 分组权限点)
- [x] 流程管理 UI (`ProcessListView / ProcessDesigner / TaskListView / MyProcessesView`)

### Phase 3: 业务闭环 + 加分功能

- [ ] 仪表盘/报表（拖拽配置图表 + 后端动态聚合）
- [ ] 应用模板市场（请假/报销/CRM/工单模板）
- [ ] Webhook 异步投递 + 指数退避重试 + HMAC 签名
- [ ] 消息通知中心（站内信 + 邮件）
- [ ] Redis Schema Cache + 权限结果缓存
- [ ] BullMQ 消息队列
- [ ] MinIO 文件直传
- [ ] 操作审计日志 AOP 拦截 + 查询页面

### Phase 4: 生产就绪

- [ ] 移动 H5 适配
- [ ] 性能压测（10 万条表单数据 → 列表查询 < 200ms）
- [ ] 单元测试覆盖（引擎层 80%+）
- [ ] 架构文档完善（GitHub README + 设计文档）

---

## 附录: 术语表

| 术语 | 定义 |
|---|---|
| **SSOT** | Single Source of Truth，单一数据源。Schema 是表单的唯一真相源。 |
| **DSL** | Domain Specific Language。表单表达式语法。 |
| **AST** | Abstract Syntax Tree。表达式引擎内部结构。 |
| **BPMN** | Business Process Model and Notation。业务流程建模标准。 |
| **RBAC** | Role-Based Access Control。基于角色的访问控制。 |
| **ABAC** | Attribute-Based Access Control。基于属性的访问控制。 |
| **FLAC** | Field-Level Access Control。字段级访问控制。 |
| **Component Bridge** | 组件桥接层，解耦 Schema 控件类型与具体 UI 框架。 |
| **ADR** | Architecture Decision Record。架构决策记录。 |
| **Dependency Graph** | 依赖图。建模字段间联动关系的有向图。 |

---

> **版本**：V3.1 | **日期**：2026-07-21
> **定位**：技术设计文档 + 开发路线图，面向面试展示与技术评审。
> **核心命题**：用纯 TypeScript 引擎驱动 UI 渲染，用 JSON Schema 统一驱动表单、流程、权限、报表。
