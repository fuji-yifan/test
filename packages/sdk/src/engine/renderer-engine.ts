/**
 * RendererEngine — 渲染引擎核心（纯 TypeScript，零 UI 依赖）
 *
 * 职责：
 * - 管理表单运行时数据（getValue/setValue/getFormData）
 * - 校验管道（同步 + 异步 validator，Pipeline 模式顺序执行）
 * - 依赖图（有向图建模字段联动关系，循环依赖检测）
 * - 字段订阅（watch/unwatch，引擎层事件通知）
 * - 子表单（addSubFormRow/removeSubFormRow）
 */

import type { FieldSchema, FormSchema, LinkageAction, ValidationRule } from '../types/index.js'
import type { LinkageResult } from '../utils/linkage-engine.js'
import { evaluate } from '../utils/expression-eval.js'
import { findFieldByKey, flattenFieldsByKey, isLayoutField, walkFields } from '../utils/schema-utils.js'
import { resolveLinkage } from '../utils/linkage-engine.js'

// ==================== 类型定义 ====================

export type ValidationType =
  | 'required' | 'pattern' | 'min' | 'max' | 'minLength'
  | 'maxLength' | 'email' | 'url' | 'custom' | 'async'

export interface ValidationError {
  fieldKey: string
  type: ValidationType
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface FieldValidator {
  type: ValidationType
  validate(value: unknown, rule: ValidationRule, ctx: ValidationContext): ValidationError | null | Promise<ValidationError | null>
}

export interface ValidationContext {
  formData: Record<string, unknown>
  schema: FormSchema
}

export interface AffectedField {
  fieldKey: string
  rule: unknown
  action: LinkageAction
}

type WatchCallback = (newValue: unknown, oldValue: unknown) => void

// ==================== 校验管道 ====================

export class ValidationPipeline {
  private validators = new Map<string, FieldValidator>()

  constructor() {
    this.registerBuiltins()
  }

  register(name: string, validator: FieldValidator): void {
    this.validators.set(name, validator)
  }

  async execute(field: FieldSchema, value: unknown, ctx: ValidationContext): Promise<ValidationError[]> {
    if (!field.rules?.length) return []
    const errors: ValidationError[] = []

    for (const rule of field.rules) {
      const validator = this.validators.get(rule.type)
      if (!validator) continue

      try {
        const err = await validator.validate(value, rule, ctx)
        if (err) errors.push(err)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '校验失败'
        errors.push({ fieldKey: field.key, type: rule.type as ValidationType, message: msg })
      }
    }

    return errors
  }

  /** 执行整个表单的校验 */
  async executeAll(schema: FormSchema, formData: Record<string, unknown>): Promise<Map<string, ValidationError[]>> {
    const result = new Map<string, ValidationError[]>()
    const ctx: ValidationContext = { formData, schema }

    const dataFields: FieldSchema[] = []
    walkFields(schema.fields, (f) => {
      if (f.key && !isLayoutField(f.type)) dataFields.push(f)
    })

    for (const field of dataFields) {
      const errors = await this.execute(field, formData[field.key], ctx)
      if (errors.length) result.set(field.key, errors)
    }

    return result
  }

  private registerBuiltins(): void {
    this.register('required', {
      type: 'required',
      validate: (value, rule) => {
        if (value === null || value === undefined || value === '' ||
            (Array.isArray(value) && value.length === 0)) {
          return { fieldKey: '', type: 'required', message: rule.message || '此项为必填' }
        }
        return null
      },
    })

    this.register('email', {
      type: 'email',
      validate: (value, rule) => {
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          return { fieldKey: '', type: 'email', message: rule.message || '邮箱格式不正确' }
        }
        return null
      },
    })

    this.register('minLength', {
      type: 'minLength',
      validate: (value, rule) => {
        if (value && String(value).length < (Number(rule.value) || 0)) {
          return { fieldKey: '', type: 'minLength', message: rule.message || `最少${rule.value}个字符` }
        }
        return null
      },
    })

    this.register('maxLength', {
      type: 'maxLength',
      validate: (value, rule) => {
        if (value && String(value).length > (Number(rule.value) || Infinity)) {
          return { fieldKey: '', type: 'maxLength', message: rule.message || `最多${rule.value}个字符` }
        }
        return null
      },
    })

    this.register('min', {
      type: 'min',
      validate: (value, rule) => {
        if (value !== null && value !== undefined && Number(value) < Number(rule.value ?? -Infinity)) {
          return { fieldKey: '', type: 'min', message: rule.message || `最小值为${rule.value}` }
        }
        return null
      },
    })

    this.register('max', {
      type: 'max',
      validate: (value, rule) => {
        if (value !== null && value !== undefined && Number(value) > Number(rule.value ?? Infinity)) {
          return { fieldKey: '', type: 'max', message: rule.message || `最大值为${rule.value}` }
        }
        return null
      },
    })

    this.register('pattern', {
      type: 'pattern',
      validate: (value, rule) => {
        if (value && rule.value && !new RegExp(String(rule.value)).test(String(value))) {
          return { fieldKey: '', type: 'pattern', message: rule.message || '格式不正确' }
        }
        return null
      },
    })
  }
}

// ==================== 依赖图（有向图） ====================

interface GraphNode {
  fieldKey: string
  edges: Map<string, Edge>        // targetFieldKey → Edge
  reverseEdges: Set<string>       // 反向边：哪些字段指向我
}

interface Edge {
  rule: unknown
  action: LinkageAction
}

export class DependencyGraph {
  private nodes = new Map<string, GraphNode>()

  /** 注册依赖关系 */
  addDependency(sourceFieldKey: string, targetFieldKey: string, rule: unknown, action: LinkageAction): void {
    this.ensureNode(sourceFieldKey)
    this.ensureNode(targetFieldKey)

    const sourceNode = this.nodes.get(sourceFieldKey)!

    // 添加边
    sourceNode.edges.set(targetFieldKey, { rule, action })

    // 添加反向边
    const targetNode = this.nodes.get(targetFieldKey)!
    targetNode.reverseEdges.add(sourceFieldKey)

    // 循环依赖检测
    const cycle = this.detectCycle()
    if (cycle) {
      // 回滚
      sourceNode.edges.delete(targetFieldKey)
      targetNode.reverseEdges.delete(sourceFieldKey)
      console.warn(`[DependencyGraph] 检测到循环依赖: ${cycle.join(' → ')}，注册失败`)
    }
  }

  /** 从 Schema 初始化依赖图 */
  static fromSchema(schema: FormSchema): DependencyGraph {
    const graph = new DependencyGraph()

    walkFields(schema.fields, (field) => {
      if (!field.linkage) return
      for (const rule of field.linkage) {
        graph.addDependency(rule.trigger, rule.target, rule, rule.action)
      }
    })

    return graph
  }

  /** 获取某个字段变化后受影响的所有字段 */
  getAffectedFields(fieldKey: string): AffectedField[] {
    const node = this.nodes.get(fieldKey)
    if (!node || node.edges.size === 0) return []

    const result: AffectedField[] = []
    node.edges.forEach((edge, targetKey) => {
      result.push({
        fieldKey: targetKey,
        rule: edge.rule,
        action: edge.action,
      })
    })

    return result
  }

  /**
   * 拓扑排序检测循环依赖
   * @returns 如果有环，返回环中的节点路径；否则返回 null
   */
  detectCycle(): string[] | null {
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const path: string[] = []
    let cycleResult: string[] | null = null
    const nodes = this.nodes

    function dfs(key: string): boolean {
      if (visited.has(key)) {
        if (inStack.has(key)) {
          cycleResult = path.slice(path.indexOf(key)).concat(key)
          return true
        }
        return false
      }

      visited.add(key)
      inStack.add(key)
      path.push(key)

      const node = nodes.get(key)
      if (node) {
        for (const [targetKey] of node.edges) {
          if (dfs(targetKey)) return true
        }
      }

      path.pop()
      inStack.delete(key)
      return false
    }

    for (const [key] of nodes) {
      if (!visited.has(key)) {
        if (dfs(key)) return cycleResult
      }
    }

    return null
  }

  /** 生成 DOT 格式描述（调试用） */
  toDot(): string {
    let dot = 'digraph DependencyGraph {\n'
    this.nodes.forEach((node, key) => {
      node.edges.forEach((edge, target) => {
        dot += `  "${key}" -> "${target}" [label="${edge.action.type}"];\n`
      })
    })
    dot += '}'
    return dot
  }

  /** 清空依赖图 */
  clear(): void {
    this.nodes.clear()
  }

  private ensureNode(fieldKey: string): void {
    if (!this.nodes.has(fieldKey)) {
      this.nodes.set(fieldKey, { fieldKey, edges: new Map(), reverseEdges: new Set() })
    }
  }
}

// ==================== RendererEngine ====================

export class RendererEngine {
  private _schema: FormSchema
  private _formData!: Record<string, unknown>
  private _previousData!: Record<string, unknown>
  private _watchers = new Map<string, Set<WatchCallback>>()

  readonly validation: ValidationPipeline
  readonly dependencyGraph: DependencyGraph

  constructor(schema: FormSchema, initialData?: Record<string, unknown>) {
    this._schema = schema
    this._formData = {}  // 先初始化对象
    this.validation = new ValidationPipeline()
    this.dependencyGraph = DependencyGraph.fromSchema(schema)
    this.resetForm(initialData)
  }

  // ---- 数据管理 ----

  getValue(fieldKey: string): unknown {
    return this._formData[fieldKey]
  }

  setValue(fieldKey: string, value: unknown): void {
    const oldValue = this._formData[fieldKey]
    this._previousData[fieldKey] = oldValue
    this._formData[fieldKey] = value

    // 通知订阅者
    this._notifyWatchers(fieldKey, value, oldValue)
  }

  getFormData(): Record<string, unknown> {
    return { ...this._formData }
  }

  resetForm(data?: Record<string, unknown>): void {
    // 不清空对象引用，Vue reactive 才能持续追踪
    const newData = data ? { ...data } : this._collectDefaults()
    // 清除旧 key，写入新值
    for (const key of Object.keys(this._formData)) {
      delete this._formData[key]
    }
    Object.assign(this._formData, newData)
    this._previousData = { ...this._formData }
  }

  /** 批量设置数据（从 API 加载历史提交数据时使用） */
  loadData(data: Record<string, unknown>): void {
    const newData = { ...this._collectDefaults(), ...data }
    for (const key of Object.keys(this._formData)) {
      delete this._formData[key]
    }
    Object.assign(this._formData, newData)
    this._previousData = { ...this._formData }
  }

  // ---- 校验 ----

  async validate(fieldKey?: string): Promise<ValidationResult> {
    if (fieldKey) {
      const field = findFieldByKey(this._schema.fields, fieldKey)
      if (!field) return { valid: true, errors: [] }

      const errors = await this.validation.execute(field, this._formData[fieldKey], {
        formData: this._formData,
        schema: this._schema,
      })

      return { valid: errors.length === 0, errors }
    }

    // 校验全部
    const allErrors = await this.validation.executeAll(this._schema, this._formData)
    const flat: ValidationError[] = []
    allErrors.forEach((errs) => flat.push(...errs))
    return { valid: flat.length === 0, errors: flat }
  }

  async validateAll(): Promise<ValidationResult[]> {
    const allErrors = await this.validation.executeAll(this._schema, this._formData)
    const results: ValidationResult[] = []
    allErrors.forEach((errors) => results.push({ valid: errors.length === 0, errors }))
    return results
  }

  // ---- 字段订阅 ----

  watch(fieldKey: string, callback: WatchCallback): () => void {
    if (!this._watchers.has(fieldKey)) {
      this._watchers.set(fieldKey, new Set())
    }
    this._watchers.get(fieldKey)!.add(callback)

    // 返回取消订阅函数
    return () => {
      this._watchers.get(fieldKey)?.delete(callback)
    }
  }

  unwatch(fieldKey: string): void {
    this._watchers.delete(fieldKey)
  }

  // ---- 显隐计算 ----

  getVisibleFields(): FieldSchema[] {
    return this._filterVisible(this._schema.fields)
  }

  // ---- 联动执行 ----

  triggerLinkage(changedFieldKey: string): LinkageResult[] {
    const results = resolveLinkage(this._schema.fields, changedFieldKey, this._formData)

    // 执行联动动作
    for (const result of results) {
      this._applyAction(result.fieldId, result.action)
    }

    return results
  }

  // ---- 字段级 ACL ----

  /**
   * 按用户角色过滤字段
   * @param userRoles 用户角色列表，如 ["role:hr", "role:manager"]
   * @returns 过滤后的字段列表（不可见字段已移除，不可编辑字段已设置 disabled）
   */
  filterByACL(userRoles: string[]): FieldSchema[] {
    if (!userRoles.length) return this._schema.fields // 无角色限制
    return this._applyACL(this._schema.fields, userRoles)
  }

  /**
   * 检查字段是否可编辑
   */
  canEdit(field: FieldSchema, userRoles: string[]): boolean {
    if (!field.acl) return true
    if (!userRoles.length) return true
    if (!field.acl.editable?.length) return true
    return field.acl.editable.some((role) => userRoles.includes(role))
  }

  /**
   * 检查字段是否可见
   */
  canView(field: FieldSchema, userRoles: string[]): boolean {
    if (!field.acl) return true
    if (!userRoles.length) return true
    if (!field.acl.viewable?.length) return true
    return field.acl.viewable.some((role) => userRoles.includes(role))
  }

  /**
   * 从提交数据中过滤掉用户无权编辑的字段（服务端双重保障用）
   */
  filterSubmissionData(data: Record<string, unknown>, userRoles: string[]): Record<string, unknown> {
    if (!userRoles.length) return data

    const allowedKeys = new Set<string>()
    walkFields(this._schema.fields, (field) => {
      if (field.key && !isLayoutField(field.type) && this.canEdit(field, userRoles)) {
        allowedKeys.add(field.key)
      }
    })

    const filtered: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (allowedKeys.has(key)) {
        filtered[key] = data[key]
      }
    }
    return filtered
  }

  // ---- 子表单 ----

  addSubFormRow(fieldKey: string, data?: Record<string, unknown>): number {
    const current = this._formData[fieldKey]
    if (!Array.isArray(current)) {
      this._formData[fieldKey] = []
    }
    const rows = this._formData[fieldKey] as unknown[]
    const rowData = data || this._getSubFormDefaults(fieldKey)
    rows.push(rowData)
    return rows.length - 1
  }

  removeSubFormRow(fieldKey: string, rowIndex: number): void {
    const current = this._formData[fieldKey]
    if (Array.isArray(current)) {
      current.splice(rowIndex, 1)
    }
  }

  // ---- Schema 更新（动态切换表单 Schema） ----

  updateSchema(schema: FormSchema): void {
    this._schema = schema
    // 重建依赖图
    this.dependencyGraph.clear()
    const newGraph = DependencyGraph.fromSchema(schema)
    newGraph['nodes'].forEach((node, key) => {
      ;(this.dependencyGraph as unknown as { _nodes?: Map<string, unknown> })._nodes?.set(key, node)
    })
    // 可以用新 Schema 的默认值补全缺失数据
    this._mergeDefaults()
  }

  get schema(): FormSchema {
    return this._schema
  }

  // ---- 私有方法 ----

  private _collectDefaults(): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    walkFields(this._schema.fields, (field) => {
      if (field.key && !isLayoutField(field.type)) {
        data[field.key] = field.defaultValue ?? null
      }
    })
    return data
  }

  private _filterVisible(fields: FieldSchema[]): FieldSchema[] {
    return fields.filter((field) => {
      if (field.hidden) {
        try {
          if (field.hidden.ifShow && !evaluate(field.hidden.ifShow, this._formData)) return false
          if (field.hidden.ifHide && evaluate(field.hidden.ifHide, this._formData)) return false
        } catch { /* 表达式错误 → 默认显示 */ }
      }
      if (field.children) {
        return this._filterVisible(field.children).length > 0
      }
      return true
    })
  }

  private _applyAction(fieldId: string, action: LinkageAction): void {
    const fieldMap = flattenFieldsByKey(this._schema.fields)
    // 根据 action type 修改 formData
    switch (action.type) {
      case 'setValue': {
        const targetField = Array.from(fieldMap.values()).find(f => f.id === fieldId)
        if (targetField) {
          this.setValue(targetField.key, action.value)
        }
        break
      }
      // setProps / setOptions / setRequired / setDisabled / setHidden
      // 这些修改的是 FieldSchema 的运行时属性，需要 UI 层配合
      // 引擎层发出 Signal → Vue 组件响应
      default:
        break
    }
  }

  private _getSubFormDefaults(fieldKey: string): Record<string, unknown> {
    const field = findFieldByKey(this._schema.fields, fieldKey)
    if (!field?.children) return {}

    const defaults: Record<string, unknown> = {}
    walkFields(field.children, (child) => {
      if (child.key && !isLayoutField(child.type)) {
        defaults[child.key] = child.defaultValue ?? null
      }
    })
    return defaults
  }

  private _mergeDefaults(): void {
    const defaults = this._collectDefaults()
    for (const [key, val] of Object.entries(defaults)) {
      if (!(key in this._formData)) {
        this._formData[key] = val
      }
    }
  }

  private _applyACL(fields: FieldSchema[], userRoles: string[]): FieldSchema[] {
    return fields
      .filter((field) => this.canView(field, userRoles))
      .map((field) => ({
        ...field,
        // 不可编辑 → 设置 disabled
        ...(field.acl && field.acl.editable?.length && !this.canEdit(field, userRoles)
          ? { props: { ...field.props, disabled: true } }
          : {}),
        // 递归处理子字段
        children: field.children ? this._applyACL(field.children, userRoles) : undefined,
      })) as FieldSchema[]
  }

  private _notifyWatchers(fieldKey: string, newVal: unknown, oldVal: unknown): void {
    const callbacks = this._watchers.get(fieldKey)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(newVal, oldVal) } catch (e) { console.warn('[RendererEngine] watcher error:', e) }
      })
    }
  }
}
