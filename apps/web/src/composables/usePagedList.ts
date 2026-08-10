/**
 * usePagedList<T> — 分页列表通用三态管理
 *
 * 封装 loading / error / data 三态 + 翻页 / 刷新 / 搜索，
 * 消除 8+ 个列表页面中的重复模板代码。
 *
 * 用法：
 *   const { list, total, page, loading, fetch } = usePagedList<Form>(
 *     (params) => http.get(`/workspaces/${wsId}/forms`, { params }),
 *   )
 */
import { ref } from 'vue'

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface PagedResult<T> {
  list: T[]
  pagination: Pagination
}

type Fetcher<T> = (params: Record<string, string | number>) => Promise<PagedResult<T> | { data: PagedResult<T> } | { list: T[]; total: number } | T[]>

export function usePagedList<T>(fetcher: Fetcher<T>, defaultPageSize = 20) {
  const list = ref<T[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(defaultPageSize)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(extraParams: Record<string, string | number> = {}) {
    loading.value = true
    error.value = null
    try {
      const params: Record<string, string | number> = {
        page: page.value,
        pageSize: pageSize.value,
        ...extraParams,
      }
      const res = await fetcher(params)

      // 兼容多种后端响应格式
      let actual: { list?: T[]; pagination?: Pagination; total?: number } | T[]

      if (Array.isArray(res)) {
        actual = res
      } else if ('data' in res && res.data && typeof res.data === 'object') {
        actual = res.data as Record<string, unknown>
      } else {
        actual = res as Record<string, unknown>
      }

      if (Array.isArray(actual)) {
        list.value = actual
        total.value = actual.length
      } else {
        list.value = (actual as { list?: T[] }).list || []
        total.value = (actual as { pagination?: Pagination }).pagination?.total
          || (actual as { total?: number }).total
          || 0
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
        || (e as { message?: string }).message
        || '加载失败'
      error.value = msg
    } finally {
      loading.value = false
    }
  }

  /** 翻到指定页 */
  function goPage(p: number) {
    page.value = p
    return fetch()
  }

  /** 重置到第一页并刷新 */
  function refresh() {
    page.value = 1
    return fetch()
  }

  return { list, total, page, pageSize, loading, error, fetch, goPage, refresh }
}
