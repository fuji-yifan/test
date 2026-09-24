// ==================== 表单顶层 Schema ====================
export interface FormSchema {
  /** 协议版本 */
  version: string
  /** 表单唯一 ID */
  id: string
  /** 表单级设置 */
  settings: FormSettings
  /** 顶层字段列表（结构化栅格：控件直接放在顶层，按 col 栅格自动换行） */
  fields: FieldSchema[]
}

export interface FormSettings {
  /** 标签位置（表单级默认，字段可覆盖） */
  labelPosition: 'left' | 'top' | 'right'
  /** 尺寸（表单级默认，字段可覆盖） */
  size: 'small' | 'default' | 'large'
  /** 全局禁用 */
  disabled: boolean
  /** 提交按钮文案 */
  submitText: string
  /** 重置按钮文案 (null = 隐藏) */
  resetText: string | null
  /** 表单级校验规则 */
  rules: FormRule[]
  /** CSS 类名 */
  cssClassName: string
  /** 表单标题（画布顶部居中显示，默认跟随表单名称） */
  formTitle: string
  /** 画布栅格总列数（默认 24，最小 24，每列 ≈33px，列数越大画布越宽） */
  canvasCols: number
  /** 画布高度 px（默认 0 = 跟随内容），用户可设，不得低于内容高度 */
  canvasHeight: number
}

// ==================== 字段级 ACL ====================
export interface FieldACL {
  /** 可查看此字段的角色列表（如 ["role:hr", "role:manager"]） */
  viewable?: string[]
  /** 可编辑此字段的角色列表（如 ["role:hr"]，不在列表中的角色只能读） */
  editable?: string[]
}

// ==================== 控件 Schema ====================
export interface FieldSchema {
  /** 唯一标识 (UUID) */
  id: string
  /** 字段名（提交数据的 key，布局控件可为空字符串） */
  key: string
  /** 控件类型 */
  type: FieldType
  /** 显示标签 */
  name: string
  /** 栅格宽度 0-24（0=自动占满行，12=半行，24=整行） */
  col?: number
  /** 独立标签位置（覆盖表单级设置） */
  labelPosition?: 'left' | 'top' | 'right'
  /** 独立尺寸（覆盖表单级设置） */
  size?: 'small' | 'default' | 'large'
  /** 条件显隐 */
  hidden?: FieldVisibility
  /** 控件特定属性 */
  props: Record<string, unknown>
  /** 默认值 */
  defaultValue?: unknown
  /** 校验规则 */
  rules?: ValidationRule[]
  /** 联动规则 */
  linkage?: LinkageRule[]
  /** 嵌套子字段（布局容器使用） */
  children?: FieldSchema[]
  /** 字段级访问控制（企业特性） */
  acl?: FieldACL
}

// ==================== 控件类型枚举 ====================
export type FieldType =
  // 基础控件
  | 'tip-text'
  | 'input'
  | 'textarea'
  | 'input-number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date-picker'
  | 'switch'
  | 'rate'
  | 'slider'
  // 高级控件
  | 'upload'
  | 'rich-text'
  | 'cascader'
  | 'time-picker'
  | 'date-time-picker'
  | 'color-picker'
  | 'tree-select'
  // 布局容器
  | 'card'
  | 'collapse'
  | 'divider'

// ==================== 条件显隐 ====================
export interface FieldVisibility {
  /** DSL 表达式：满足时显示 */
  ifShow?: string
  /** DSL 表达式：满足时隐藏 */
  ifHide?: string
}

// ==================== 表单级规则 ====================
export interface FormRule {
  trigger: string
  condition: string
  message: string
}

// ==================== 联动规则 ====================
export interface LinkageRule {
  /** 触发字段 key */
  trigger: string
  /** 联动条件表达式 */
  condition?: string
  /** 目标字段 key */
  target: string
  /** 执行动作 */
  action: LinkageAction
}

export type LinkageAction =
  | { type: 'setValue'; value: unknown }
  | { type: 'setProps'; props: Record<string, any> }
  | { type: 'setOptions'; options: SelectOption[] }
  | { type: 'setRequired'; required: boolean }
  | { type: 'setDisabled'; disabled: boolean }
  | { type: 'setHidden'; hidden: boolean }

// ==================== 校验规则 ====================
export interface ValidationRule {
  type:
    | 'required'
    | 'pattern'
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'email'
    | 'url'
    | 'custom'
    | 'async'
  value?: unknown
  message: string
  /** 自定义校验函数标识（注册在全局校验器） */
  validator?: string
}

// ==================== 通用类型 ====================
export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  children?: SelectOption[]
}

// ==================== 控件元数据 ====================
export interface ComponentMeta {
  /** 控件类型标识 */
  type: FieldType | string
  /** 显示名称 */
  display: string
  /** 图标标识 */
  icon: string
  /** 分类 */
  category: 'basic' | 'advanced' | 'layout' | 'custom'
  /** 原生类型（用于 import 映射） */
  nativeType?: string
  /** 默认属性 */
  defaultProps: Record<string, any>
  /** 属性配置面板 Schema（自身就是一个小表单） */
  configSchema?: FormSchema
}

// ==================== 表单提交 ====================
export interface FormSubmission {
  id: string
  formId: string
  formVersion: number
  data: Record<string, any>
  meta: FormSubmissionMeta
  submitterId?: string
  status: 'submitted' | 'reviewed' | 'marked'
  createdAt: string
  updatedAt: string
}

export interface FormSubmissionMeta {
  ip?: string
  userAgent?: string
  duration?: number
  [key: string]: unknown
}

// ==================== API 响应 ====================
export interface ApiResponse<T = any> {
  code: number
  data: T
  message: string
  requestId: string
}

export interface PaginatedData<T> {
  list: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>
