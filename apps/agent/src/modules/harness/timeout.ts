/**
 * 超时熔断（阶段 6 / S7.1）：给工具调用与 LLM 调用加**可配超时**，超时按可恢复失败处理，
 * 避免慢调用把整轮挂死。
 *
 * 关键：超时抛的 `TimeoutError.name === 'TimeoutError'`，与「被抢占/客户端断开」的
 * `AbortError` 明确区分 —— 后者必须原样冒泡（交上层静默收尾），前者要落进重试/降级级联。
 */

/** 超时错误：名字固定为 'TimeoutError'，供上层按名判定 */
export class TimeoutError extends Error {
  readonly name = 'TimeoutError'
  constructor(readonly label: string, readonly ms: number) {
    super(`${label} 超时（${ms}ms）`)
  }
}

/** 判定是否是超时错误（兼容跨模块 instanceof 失效的情形） */
export function isTimeoutError(err: unknown): boolean {
  return (err as { name?: string })?.name === 'TimeoutError'
}

/**
 * 给 promise 套一个超时上限。`ms <= 0` 表示不设超时（原样返回）。
 *
 * 超时后底层 promise 可能仍在跑（我们无法取消任意 promise），但调用点据此即可
 * 收口；若底层带 signal 应自行 abort（见 langgraph-llm.service.ts 的用法）。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
