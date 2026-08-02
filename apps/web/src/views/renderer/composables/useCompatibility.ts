/**
 * useCompatibility — Schema 版本兼容性检测
 *
 * 功能：加载历史提交数据时自动检测 Schema 版本是否变更，
 *       若变更则调用 CompatibilityAdapter 做数据适配。
 */

import { ref, type Ref } from 'vue'
import { CompatibilityAdapter } from '@furmx/sdk'
import type { FormSchema, CompatibilityWarning, AdaptedData } from '@furmx/sdk'

const adapter = new CompatibilityAdapter()

interface CompatibilityResult {
  /** 适配后的表单数据，可直接用于渲染 */
  data: Record<string, any>
  /** 兼容性警告（UI 层可展示） */
  warnings: CompatibilityWarning[]
  /** 是否需要适配 */
  needed: boolean
  /** 加载中 */
  loading: Ref<boolean>
}

/**
 * @param schema 当前表单 Schema
 * @param rawData 历史提交的原始数据
 * @param dataVersion 数据提交时的 Schema 版本号
 * @returns 适配结果
 */
export function useCompatibility(
  schema: FormSchema,
  rawData: Record<string, any>,
  dataVersion?: number,
): CompatibilityResult {
  const loading = ref(false)
  const adapted = ref<AdaptedData>({ resolved: rawData, warnings: [] })
  const needed = ref(false)

  // 同步执行适配（纯 JS，无需网络请求即可判断）
  if (dataVersion !== undefined && dataVersion < (schema as any).publishedVersion) {
    loading.value = true
    try {
      const result = adapter.adapt(rawData, schema)
      adapted.value = result
      needed.value = result.warnings.length > 0
    } catch (e) {
      console.warn('[useCompatibility] 适配失败，使用原始数据:', e)
      adapted.value = { resolved: rawData, warnings: [] }
    } finally {
      loading.value = false
    }
  }

  return {
    data: adapted.value.resolved,
    warnings: adapted.value.warnings,
    needed: needed.value,
    loading,
  }
}

/**
 * 异步版本：从 API 获取 Schema + 兼容性信息
 *
 * @param baseUrl API base URL
 * @param formId 表单 ID
 * @param rawData 历史提交的原始数据
 * @param dataVersion 数据版本号
 */
export async function fetchCompatibility(
  baseUrl: string,
  formId: string,
  rawData: Record<string, any>,
  dataVersion?: number,
): Promise<{ data: Record<string, any>; warnings: CompatibilityWarning[] }> {
  try {
    const params = dataVersion !== undefined ? `?dataVersion=${dataVersion}` : ''
    const resp = await fetch(`${baseUrl}/api/v1/public/forms/${formId}/compatibility${params}`)
    if (!resp.ok) {
      // API 不可用 → 降级到纯客户端适配
      return { data: rawData, warnings: [] }
    }

    const json = await resp.json()
    const compatInfo = json.data || json

    if (compatInfo.requiresAdaptation && compatInfo.currentSchema) {
      const result = adapter.adapt(rawData, compatInfo.currentSchema as FormSchema)
      return { data: result.resolved, warnings: result.warnings }
    }

    return { data: rawData, warnings: [] }
  } catch {
    // 网络错误 → 降级
    return { data: rawData, warnings: [] }
  }
}
