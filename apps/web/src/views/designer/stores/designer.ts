/**
 * Designer Store — Vue 响应式适配层，包装 DesignerEngine（纯 TS）
 *
 * Pinia store 不再自管理 Schema 操作和历史栈，
 * 全部委托给 SDK 的 DesignerEngine，store 只做 Vue 响应式桥接。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { DesignerEngine, findFieldById } from '@furmx/sdk'
import type { FormSchema, FieldSchema } from '@furmx/sdk'
import { builtinComponents } from '../config/component-registry'

export const useDesignerStore = defineStore('designer', () => {
  // ========== 引擎实例 ==========
  const engine = new DesignerEngine()

  // ========== Vue 响应式代理 ==========
  const schema = ref<FormSchema>(engine.schema)

  const selectedFieldId = ref<string | null>(null)
  const isDirty = ref(false)
  const formId = ref<string | null>(null)
  const showGrid = ref(false)
  const dragComponentType = ref<string | null>(null)
  const dragSourceFieldId = ref<string | null>(null)
  const canvasContentHeight = ref(0)

  // 同步引擎状态到 Vue
  function _syncFromEngine() {
    schema.value = engine.getSchema()
    selectedFieldId.value = engine.selectedFieldId
    isDirty.value = engine.isDirty
    canUndo.value = engine.history.canUndo
    canRedo.value = engine.history.canRedo
  }

  // 监听引擎事件自动同步
  engine.on('schema:changed', () => {
    selectedFieldId.value = engine.selectedFieldId
    isDirty.value = engine.isDirty
    canUndo.value = engine.history.canUndo
    canRedo.value = engine.history.canRedo
    schema.value = engine.getSchema()
  })

  engine.on('field:added', () => _syncFromEngine())
  engine.on('field:removed', () => _syncFromEngine())
  engine.on('field:moved', () => _syncFromEngine())

  // ========== 计算属性 ==========
  const selectedField = computed(() => {
    if (!selectedFieldId.value) return null
    return findFieldById(schema.value.fields, selectedFieldId.value)
  })

  const flatFieldMap = computed(() => {
    return engine.getFlatFieldMap()
  })

  // ========== 操作 ==========
  function addField(parentId: string | null, index: number, fieldType: string) {
    engine.addField(parentId, index, fieldType)
    // 添加后立即设置中文显示名
    const displayName = builtinComponents.find((c) => c.type === fieldType)?.display
    if (displayName && engine.selectedFieldId) {
      engine.updateFieldMeta(engine.selectedFieldId, { name: displayName })
    }
    _syncFromEngine()
  }

  function removeField(fieldId: string) {
    engine.removeField(fieldId)
    _syncFromEngine()
  }

  function selectField(id: string | null) {
    engine.selection.select(id)
    selectedFieldId.value = id
  }

  function updateFieldProps(fieldId: string, props: Record<string, any>) {
    engine.updateFieldProps(fieldId, props)
    _syncFromEngine()
  }

  function updateFieldMeta(
    fieldId: string,
    meta: Partial<Pick<FieldSchema, 'key' | 'name' | 'col' | 'labelPosition' | 'size' | 'hidden' | 'rules' | 'linkage'>>,
  ) {
    engine.updateFieldMeta(fieldId, meta)
    _syncFromEngine()
  }

  function updateSettings(s: Partial<FormSchema['settings']>) {
    engine.updateSettings(s)
    _syncFromEngine()
  }

  // ========== 撤销/重做 ==========
  const canUndo = ref(false)
  const canRedo = ref(false)

  function undo() {
    const ok = engine.undo()
    if (ok) _syncFromEngine()
  }

  function redo() {
    const ok = engine.redo()
    if (ok) _syncFromEngine()
  }

  // ========== Schema 读写 ==========
  function getSchema(): FormSchema {
    return engine.getSchema()
  }

  function loadSchema(data: FormSchema) {
    engine.loadSchema(data)
    _syncFromEngine()
  }

  return {
    // state
    schema, selectedFieldId, selectedField, isDirty, formId, flatFieldMap,
    canUndo, canRedo, showGrid, dragComponentType, dragSourceFieldId, canvasContentHeight,
    // actions
    addField, removeField, selectField, updateFieldProps, updateFieldMeta, updateSettings,
    undo, redo, getSchema, loadSchema,
    // engine ref
    engine,
  }
})
