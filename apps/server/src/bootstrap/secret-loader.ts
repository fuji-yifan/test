import { Logger } from '@nestjs/common'

/** 默认 KV 路径（KV-v2）；Vault KV-v1 用 `secret/furmx`。 */
const DEFAULT_SECRET_PATH = 'secret/data/furmx'
const REQUEST_TIMEOUT_MS = 5000

/**
 * 启动时从 **OpenBao（Vault 兼容）** 装载密钥到 `process.env`（阶段 6 / S6.2）。
 *
 * **env-gated、不配即 no-op**：`OPENBAO_ADDR` + `OPENBAO_TOKEN` **都设了**才启用；否则直接返回，
 * 行为与「没用密钥托管」逐字节一致。
 *
 * 命中后：`GET ${ADDR}/v1/${OPENBAO_SECRET_PATH}`（`X-Vault-Token` 鉴权），兼容
 * **KV-v2**（`data.data`）与 **KV-v1**（`data`）。**只在 `process.env[k] === undefined` 时写入**
 * —— 真实环境变量优先，绝不覆盖已显式配置的值。
 *
 * 失败语义：开发环境仅 `warn` 继续启动；**生产（`NODE_ENV=production`）抛错终止**，避免带空密钥上线。
 *
 * 注：SOPS 为文件/二进制方案，引入需新依赖 —— 本轮只做 OpenBao（HTTP，零新依赖）。
 */
export async function loadOpenBaoSecrets(logger: Logger): Promise<void> {
  const addr = (process.env.OPENBAO_ADDR || '').trim()
  const token = (process.env.OPENBAO_TOKEN || '').trim()
  if (!addr || !token) return

  const isProd = process.env.NODE_ENV === 'production'
  const path = (process.env.OPENBAO_SECRET_PATH || DEFAULT_SECRET_PATH).replace(/^\/+/, '')
  const url = `${addr.replace(/\/+$/, '')}/v1/${path}`

  let data: Record<string, unknown> | undefined
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'X-Vault-Token': token },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { data?: { data?: unknown } | unknown }
    const payload =
      (json?.data as { data?: unknown })?.data ?? (json?.data as unknown)
    if (!payload || typeof payload !== 'object') throw new Error('响应无 data 字段')
    data = payload as Record<string, unknown>
  } catch (err) {
    const msg = `OpenBao 密钥装载失败：${(err as Error)?.message ?? err}`
    if (isProd) throw new Error(msg)
    logger.warn(`${msg}（开发环境，忽略继续）`)
    return
  }

  let loaded = 0
  for (const [key, value] of Object.entries(data)) {
    if (process.env[key] === undefined && value != null) {
      process.env[key] = typeof value === 'string' ? value : JSON.stringify(value)
      loaded++
    }
  }
  logger.log(`OpenBao 已装载 ${loaded} 项密钥（来源 ${url}）`)
}
