/**
 * useRendererEngine — Vue 响应式适配层
 *
 * 将 RendererEngine（纯 TS）桥接到 Vue 的响应式系统。
 * reactiveData 是 Vue 响应的，engine._formData 是引擎内部的。
 * updateField 同时更新两端，保证引擎状态和 Vue 模板一致。
 */

import { reactive, computed, shallowRef } from 'vue'
import { RendererEngine } from '@furmx/sdk'
import type { FormSchema, FieldSchema, ValidationResult } from '@furmx/sdk'

export function useRendererEngine(schema: FormSchema, initialData?: Record<string, any>) {
  // 创建引擎实例
  const engine = new RendererEngine(schema, initialData)

  // 从引擎 copy 数据到 Vue reactive 对象
  const reactiveData = reactive<Record<string, any>>({ ...engine['_formData'] })

  const engineRef = shallowRef(engine)

  // 可见字段
  const visibleFields = computed<FieldSchema[]>(() => {
    // 浅读触发依赖追踪
    const _ = { ...reactiveData }
    return engine.getVisibleFields()
  })

  // 校验
  async function validate(fieldKey?: string): Promise<ValidationResult> {
    return engine.validate(fieldKey)
  }

  // 字段值变更 — 同时更新 Vue reactive 和引擎
  function updateField(key: string, value: any) {
    reactiveData[key] = value          // Vue 响应式更新 → 模板刷新
    engine.setValue(key, value)        // 引擎内部同步
    engine.triggerLinkage(key)
  }

  // 提交
  async function submitForm(): Promise<{ valid: boolean; data: Record<string, any> }> {
    const result = await engine.validate()
    if (!result.valid) return { valid: false, data: {} }
    return { valid: true, data: engine.getFormData() }
  }

  // 重置/加载数据 → 两边同步
  function resetForm(data?: Record<string, any>) {
    engine.resetForm(data)
    syncFromEngine()
  }

  function loadData(data: Record<string, any>) {
    engine.loadData(data)
    syncFromEngine()
  }

  function updateSchema(newSchema: FormSchema) {
    engine.updateSchema(newSchema)
    syncFromEngine()
    engineRef.value = engine
  }

  function syncFromEngine() {
    // 清除旧 key，写入新值（不替换 reactive 对象引用）
    for (const key of Object.keys(reactiveData)) {
      delete reactiveData[key]
    }
    Object.assign(reactiveData, engine['_formData'])
  }

  return {
    engine,
    engineRef,
    formData: reactiveData,
    visibleFields,
    validate,
    updateField,
    submitForm,
    loadData,
    updateSchema,
    resetForm,
    getFormData: () => engine.getFormData(),
  }
}
