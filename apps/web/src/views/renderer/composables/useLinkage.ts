import { type Ref } from 'vue'
import type { FieldSchema } from '@furmx/sdk'
import { resolveLinkage } from '@furmx/sdk'

/**
 * 字段联动 Hook
 * 监听 formData 变更，计算联动结果
 */
export function useLinkage(
  fieldsRef: Ref<FieldSchema[]>,
  formData: Record<string, any>,
) {
  function trigger(changedKey: string) {
    const results = resolveLinkage(fieldsRef.value, changedKey, formData)
    return results
  }

  return { trigger }
}
