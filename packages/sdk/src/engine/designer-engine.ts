/**
 * DesignerEngine — 搭建引擎核心（纯 TypeScript，零 UI 依赖）
 *
 * 职责：
 * - 管理设计态 Schema（增删改字段、移动排序）
 * - 选区模型（单选 / 范围多选 / 取消选中）
 * - 历史栈（撤销/重做，最大 50 步，不可变快照）
 * - 拖拽管理器（组件面板拖入 / 画布内排序 / 跨容器移动）
 * - 流式栅格布局：控件按 col 自动排列，不放满自动换行
 */

import type { FieldSchema, FormSchema } from '../types/index.js'
import {
  cloneSchema, findFieldById, generateFieldId,
  insertFieldAtIndex, removeFieldById, walkFields, isLayoutField,
} from '../utils/schema-utils.js'

// ==================== 类型定义 ====================

type EngineEvent = 'field:added' | 'field:removed' | 'field:moved' | 'schema:changed' | 'selection:changed'
type EventHandler = (...args: any[]) => void

interface DragSource {
  type: 'palette' | 'canvas'
  componentType?: string
  fieldId?: string
  parentId: string | null
  index: number
}

export type { DragSource }

// ==================== 选区模型 ====================

export class SelectionModel {
  private _selectedId: string | null = null
  private _selectedIds: string[] = []

  get selectedId(): string | null { return this._selectedId }
  get selectedIds(): readonly string[] { return this._selectedIds }

  /** 单选 */
  select(id: string | null): void {
    this._selectedId = id
    this._selectedIds = id ? [id] : []
  }

  /** 范围多选 */
  selectRange(ids: string[]): void {
    this._selectedIds = ids
    this._selectedId = ids.length > 0 ? ids[0] : null
  }

  clear(): void {
    this._selectedId = null
    this._selectedIds = []
  }

  isSelected(id: string): boolean {
    return this._selectedIds.includes(id)
  }
}

// ==================== 历史栈 ====================

const MAX_HISTORY = 50

interface Snapshot {
  schema: FormSchema
  timestamp: number
}

export class HistoryStack {
  private stack: Snapshot[] = []
  private index = -1

  get canUndo(): boolean { return this.index > 0 }
  get canRedo(): boolean { return this.index < this.stack.length - 1 }
  get depth(): number { return this.stack.length }

  push(schema: FormSchema): void {
    // 丢弃当前指针之后的记录
    this.stack = this.stack.slice(0, this.index + 1)
    // 推入新快照
    this.stack.push({ schema: cloneSchema(schema), timestamp: Date.now() })
    // 限制最大深度
    if (this.stack.length > MAX_HISTORY) {
      this.stack.shift()
    }
    this.index = this.stack.length - 1
  }

  undo(): FormSchema | null {
    if (!this.canUndo) return null
    this.index--
    return cloneSchema(this.stack[this.index].schema)
  }

  redo(): FormSchema | null {
    if (!this.canRedo) return null
    this.index++
    return cloneSchema(this.stack[this.index].schema)
  }

  clear(): void {
    this.stack = []
    this.index = -1
  }
}

// ==================== 拖拽管理器 ====================

/** 插入位置指示 */
export interface DropPosition {
  /** 目标父容器 ID（null = 顶层） */
  parentId: string | null
  /** 插入索引 */
  index: number
  /** 插入方式：before/after/inside */
  mode: 'before' | 'after' | 'inside'
}

export class DragDropManager {
  private _isDragging = false
  private _dragSource: DragSource | null = null
  private _dropTarget: DropPosition | null = null
  private _onStateChange: (() => void) | null = null

  get isDragging(): boolean { return this._isDragging }
  get dragSource(): DragSource | null { return this._dragSource }
  get dropTarget(): DropPosition | null { return this._dropTarget }

  /** 注册状态变更回调 */
  onChange(cb: () => void): void {
    this._onStateChange = cb
  }

  /** 从组件面板开始拖拽新控件 */
  startDrag(source: DragSource): void {
    this._isDragging = true
    this._dragSource = source
    this._dropTarget = null
    this._notify()
  }

  /** 更新拖拽悬停位置 */
  updateDropTarget(target: DropPosition | null): void {
    this._dropTarget = target
    this._notify()
  }

  /**
   * 校验是否可以将源拖拽到目标位置
   * - palette → 任意位置 ✅
   * - canvas → canvas（排序）✅
   * - canvas → 自身子元素 ❌（防止自嵌套）
   * - 嵌套深度检查（最多 10 层）
   */
  canDrop(source: DragSource, target: DropPosition, currentDepth?: number): boolean {
    // 禁止将字段拖入自身
    if (source.fieldId && target.parentId === source.fieldId) return false
    // 深度限制
    if (currentDepth !== undefined && target.mode === 'inside' && currentDepth >= 10) return false
    // palette 拖出
    if (source.type === 'palette') return true
    // canvas 内排序
    if (source.type === 'canvas' && source.fieldId) {
      return target.parentId !== source.fieldId
    }
    return true
  }

  /**
   * 解析 DropPosition 为实际的 parentId 和 index
   */
  resolveInsertion(dropPos: DropPosition, sourceIndex: number): { parentId: string | null; index: number } {
    switch (dropPos.mode) {
      case 'before':
        return {
          parentId: dropPos.parentId,
          index: sourceIndex > dropPos.index ? dropPos.index : dropPos.index - 1,
        }
      case 'after':
        return {
          parentId: dropPos.parentId,
          index: sourceIndex < dropPos.index ? dropPos.index : dropPos.index + 1,
        }
      case 'inside':
        return { parentId: dropPos.parentId, index: 0 }
      default:
        return { parentId: dropPos.parentId, index: dropPos.index }
    }
  }

  /** 结束拖拽，清除状态 */
  endDrag(): void {
    this._isDragging = false
    this._dragSource = null
    this._dropTarget = null
    this._notify()
  }

  private _notify(): void {
    if (this._onStateChange) {
      this._onStateChange()
    }
  }
}

// ==================== DesignerEngine ====================

interface FieldTypeConfig {
  defaultProps: Record<string, any>
  /** 默认栅格列宽 (1-24) */
  defaultCol: number
  /** 最小栅格列宽，防止内容溢出 */
  minCol: number
}

/** 控件类型统一配置 —— 单一数据源，defaultProps/defaultCol/minCol 均由此派生 */
const fieldConfigs: Record<string, FieldTypeConfig> = {
  input:          { defaultProps: { placeholder: '', maxLength: 100, clearable: true }, defaultCol: 12, minCol: 5 },
  'tip-text':     { defaultProps: { text: '请输入提示文本', color: '#909399', fontSize: 14, textAlign: 'left', tipType: '' }, defaultCol: 24, minCol: 4 },
  textarea:       { defaultProps: { rows: 4, maxLength: 500 },                     defaultCol: 24, minCol: 8 },
  'input-number': { defaultProps: { min: 0, precision: 0, step: 1, placeholder: '', numberStyle: 'stepper' }, defaultCol: 12, minCol: 6 },
  select:         { defaultProps: { options: [], filterable: false, multiple: false, placeholder: '请选择' }, defaultCol: 12, minCol: 5 },
  radio:          { defaultProps: { options: [] },                                  defaultCol: 12, minCol: 4 },
  checkbox:       { defaultProps: { options: [] },                                  defaultCol: 12, minCol: 4 },
  'date-picker':  { defaultProps: { format: 'YYYY-MM-DD', valueFormat: 'YYYY-MM-DD' }, defaultCol: 12, minCol: 6 },
  switch:         { defaultProps: { activeText: '', inactiveText: '' },             defaultCol: 8,  minCol: 3 },
  rate:           { defaultProps: { max: 5 },                                       defaultCol: 8,  minCol: 4 },
  slider:         { defaultProps: { min: 0, max: 100, step: 1 },                    defaultCol: 12, minCol: 6 },
  upload:         { defaultProps: { accept: '', maxSize: 10, maxCount: 1 },         defaultCol: 24, minCol: 8 },
  'rich-text':    { defaultProps: { height: 400, placeholder: '请输入内容', maxLength: 200, toolbarMode: 'full' }, defaultCol: 24, minCol: 12 },
  cascader:       { defaultProps: { options: [], placeholder: '请选择', templateMode: 'manual' }, defaultCol: 12, minCol: 6 },
  // 布局容器
  card:           { defaultProps: { header: '', shadow: 'always' },                 defaultCol: 24, minCol: 24 },
  collapse:       { defaultProps: { accordion: false },                             defaultCol: 24, minCol: 24 },
  tabs:           { defaultProps: { tabList: ['标签1', '标签2'], defaultActive: '0' }, defaultCol: 24, minCol: 24 },
  divider:        { defaultProps: { direction: 'horizontal' },                      defaultCol: 24, minCol: 24 },
}

function getFieldConfig(type: string): FieldTypeConfig {
  return fieldConfigs[type] ?? { defaultProps: {}, defaultCol: 12, minCol: 4 }
}

/** 获取控件最小栅格列宽 */
export function getMinCol(type: string): number {
  return getFieldConfig(type).minCol
}

/** 获取控件默认栅格列宽 */
export function getDefaultCol(type: string): number {
  return getFieldConfig(type).defaultCol
}

export class DesignerEngine {
  private _schema: FormSchema
  readonly selection: SelectionModel
  readonly history: HistoryStack
  readonly dragDrop: DragDropManager
  private _eventHandlers = new Map<EngineEvent, Set<EventHandler>>()
  private _isDirty = false

  constructor(initialSchema?: FormSchema) {
    this._schema = initialSchema ? cloneSchema(initialSchema) : this._createEmptySchema()
    this.selection = new SelectionModel()
    this.history = new HistoryStack()
    this.dragDrop = new DragDropManager()
    this.history.push(this._schema)
  }

  // ---- 状态查询 ----

  get schema(): FormSchema { return this._schema }
  get selectedFieldId(): string | null { return this.selection.selectedId }
  get isDirty(): boolean { return this._isDirty }

  getSelectedField(): FieldSchema | null {
    if (!this.selection.selectedId) return null
    return findFieldById(this._schema.fields, this.selection.selectedId)
  }

  /** 获取平铺字段 Map */
  getFlatFieldMap(): Map<string, FieldSchema> {
    const map = new Map<string, FieldSchema>()
    walkFields(this._schema.fields, (f) => map.set(f.id, f))
    return map
  }

  // ---- 字段操作 ----

  addField(parentId: string | null, index: number, fieldType: string): FieldSchema {
    const newField = this._createField(fieldType)
    insertFieldAtIndex(this._schema.fields, parentId, index, newField)
    this.selection.select(newField.id)
    this._isDirty = true
    this.history.push(this._schema)
    this._emit('field:added', newField, parentId, index)
    this._emit('schema:changed', this._schema)
    return newField
  }

  removeField(fieldId: string): void {
    const removed = removeFieldById(this._schema.fields, fieldId)
    if (!removed) return
    if (this.selection.selectedId === fieldId) {
      this.selection.clear()
    }
    this._isDirty = true
    this.history.push(this._schema)
    this._emit('field:removed', removed)
    this._emit('schema:changed', this._schema)
  }

  moveField(fieldId: string, targetParentId: string | null, targetIndex: number): void {
    const field = removeFieldById(this._schema.fields, fieldId)
    if (!field) return

    insertFieldAtIndex(this._schema.fields, targetParentId, targetIndex, field)
    this._isDirty = true
    this.history.push(this._schema)
    this._emit('field:moved', field, targetParentId, targetIndex)
    this._emit('schema:changed', this._schema)
  }

  updateFieldProps(fieldId: string, props: Record<string, any>): void {
    const field = findFieldById(this._schema.fields, fieldId)
    if (field) {
      Object.assign(field.props, props)
      this._isDirty = true
      this.history.push(this._schema)
      this._emit('schema:changed', this._schema)
    }
  }

  updateFieldMeta(
    fieldId: string,
    meta: Partial<Pick<FieldSchema, 'key' | 'name' | 'col' | 'labelPosition' | 'size' | 'hidden' | 'rules' | 'linkage'>>,
  ): void {
    const field = findFieldById(this._schema.fields, fieldId)
    if (field) {
      Object.assign(field, meta)
      this._isDirty = true
      this.history.push(this._schema)
      this._emit('schema:changed', this._schema)
    }
  }

  updateSettings(settings: Partial<FormSchema['settings']>): void {
    Object.assign(this._schema.settings, settings)
    this._isDirty = true
    this.history.push(this._schema)
    this._emit('schema:changed', this._schema)
  }

  // ---- Schema 读写 ----

  loadSchema(schema: FormSchema): void {
    const s = cloneSchema(schema)
    // 防御：确保核心字段不为 undefined
    if (!s.settings) {
      s.settings = {
        labelPosition: 'left', size: 'default', disabled: false,
        submitText: '提交', resetText: null, rules: [],
        cssClassName: '', formTitle: '', canvasCols: 24, canvasHeight: 0,
      }
    }
    if (!s.fields) s.fields = []
    this._schema = s
    this.selection.clear()
    this._isDirty = false
    this._emit('schema:changed', this._schema)
  }

  getSchema(): FormSchema {
    return cloneSchema(this._schema)
  }

  // ---- 撤销/重做 ----

  undo(): boolean {
    const prev = this.history.undo()
    if (!prev) return false
    this._schema = prev
    this._emit('schema:changed', this._schema)
    return true
  }

  redo(): boolean {
    const next = this.history.redo()
    if (!next) return false
    this._schema = next
    this._emit('schema:changed', this._schema)
    return true
  }

  // ---- 事件 ----

  on(event: EngineEvent, handler: EventHandler): () => void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set())
    }
    this._eventHandlers.get(event)!.add(handler)
    return () => {
      this._eventHandlers.get(event)?.delete(handler)
    }
  }

  // ---- 私有方法 ----

  private _createEmptySchema(): FormSchema {
    return {
      version: '2.0',
      id: '',
      settings: {
        labelPosition: 'right',
        size: 'default',
        disabled: false,
        submitText: '提交',
        resetText: null,
        rules: [],
        cssClassName: '',
        formTitle: '',
        canvasCols: 24,
        canvasHeight: 0,
      },
      fields: [],
    }
  }

  private _createField(type: string): FieldSchema {
    const cfg = getFieldConfig(type)
    return {
      id: generateFieldId(),
      key: `field_${Math.random().toString(36).substring(2, 10)}`,
      type: type as any,
      name: type,
      col: Math.max(cfg.minCol, cfg.defaultCol),
      props: { ...cfg.defaultProps },
    }
  }

  private _emit(event: EngineEvent, ...args: any[]): void {
    const handlers = this._eventHandlers.get(event)
    if (handlers) {
      handlers.forEach((h) => { try { h(...args) } catch (e) { console.warn(`[DesignerEngine] handler error:`, e) } })
    }
  }

  /** 生成新 Schema ID（新建表单时） */
  initNewForm(): void {
    this._schema.id = crypto.randomUUID?.() ?? `form_${Date.now()}`
    this.history.clear()
    this.history.push(this._schema)
  }
}
