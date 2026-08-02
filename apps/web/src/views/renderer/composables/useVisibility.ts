import { computed, type Ref } from 'vue'
import type { FieldSchema } from '@furmx/sdk'
import { evaluate } from '@furmx/sdk'

/**
 * 条件显隐 Hook
 * 根据字段的 hidden.ifShow / hidden.ifHide 计算哪些字段可见
 */
export function useVisibility(
  fieldsRef: Ref<FieldSchema[]>,
  formData: Record<string, any>,
) {
  const visibleFields = computed(() => {
    return filterVisible(fieldsRef.value, formData)
  })

  return { visibleFields }
}

function filterVisible(
  fields: FieldSchema[],
  formData: Record<string, any>,
): FieldSchema[] {
  return fields.filter((field) => {
    if (field.hidden) {
      if (field.hidden.ifShow) {
        try {
          if (!evaluate(field.hidden.ifShow, formData)) return false
        } catch {
          return false
        }
      }
      if (field.hidden.ifHide) {
        try {
          if (evaluate(field.hidden.ifHide, formData)) return false
        } catch { /* pass through */ }
      }
    }
    // 布局控件：递归过滤子字段
    if (field.children) {
      return filterVisible(field.children, formData).length > 0
    }
    return true
  })
}
