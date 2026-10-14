/**
 * 外部基建外呼的零依赖骨架（阶段 6 外部适配：S2.3 追踪 / S3.1 策略引擎 / S5.2 护栏）。
 *
 * 只用原生 `fetch`（Node 18+），**不需要任何新依赖**。纪律：
 * - 任何失败（超时 / 网络错误 / 解析失败）**一律返回 `null`，绝不抛** —— 外呼服务抖不得影响主流程；
 * - 调用方只在**基建已配置**时才调用它（未配置的 no-op 由各 service 自己短路）。
 */
export interface PostJsonResult {
  status: number
  json: unknown
}

/**
 * POST 一段 JSON，带超时；失败返回 `null`。
 *
 * @param fetcher 可注入（默认全局 fetch），便于单测替换。
 */
export async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  headers?: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<PostJsonResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => undefined)
    return { status: res.status, json }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
