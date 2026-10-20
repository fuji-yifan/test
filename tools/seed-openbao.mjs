#!/usr/bin/env node
/**
 * 把 apps/server/.env 的配置幂等写入 OpenBao（KV-v2: secret/data/furmx）。
 *
 * - 只打印 key 名，绝不打印值；
 * - 跳过 OpenBao 自身引导项（否则第二次启动就拿不到 token 了）；
 * - OpenBao 是 -dev 内存模式时，每次重启都需要重新播种，demo 脚本会自动处理。
 *
 * 用法：pnpm seed:openbao [--env <file>] [--addr <url>] [--path <kv path>] [--soft]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BOOTSTRAP_KEYS = new Set(['OPENBAO_ADDR', 'OPENBAO_TOKEN', 'OPENBAO_SECRET_PATH'])
/** 仅用于演示「启动时确实从 OpenBao 装载了密钥」，.env 中不存在。 */
const DEMO_MARKER = { DEMO_KEY_FROM_OPENBAO: 'demo-ok' }

export function parseEnv(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

async function waitForOpenBao(addr, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`${addr.replace(/\/+$/, '')}/v1/sys/health`, {
        signal: AbortSignal.timeout(1000),
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}

export async function seedOpenBao(options = {}) {
  const envPath = options.envPath ?? path.join(ROOT, 'apps/server/.env')
  const env = parseEnv(readFileSync(envPath, 'utf8'))

  const addr = (options.addr || env.OPENBAO_ADDR || 'http://127.0.0.1:8200').trim()
  const token = (options.token || env.OPENBAO_TOKEN || '').trim()
  const secretPath = (options.secretPath || env.OPENBAO_SECRET_PATH || 'secret/data/furmx')
    .replace(/^\/+/, '')
    .trim()

  if (!token) throw new Error(`${envPath} 中缺少 OPENBAO_TOKEN`)
  if (!(await waitForOpenBao(addr))) throw new Error(`OpenBao 不可达：${addr}`)

  const payload = {}
  for (const [key, value] of Object.entries(env)) {
    if (BOOTSTRAP_KEYS.has(key)) continue
    if (value === '') continue
    payload[key] = value
  }
  Object.assign(payload, DEMO_MARKER)

  const isV2 = secretPath.includes('/data/')
  const url = `${addr.replace(/\/+$/, '')}/v1/${secretPath}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(isV2 ? { data: payload } : payload),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`写入失败 HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }

  return { url, keys: Object.keys(payload) }
}

function parseArgs(argv) {
  const args = { soft: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--soft') args.soft = true
    else if (a === '--env') args.envPath = path.resolve(argv[++i])
    else if (a === '--addr') args.addr = argv[++i]
    else if (a === '--path') args.secretPath = argv[++i]
  }
  return args
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  try {
    const { url, keys } = await seedOpenBao(args)
    console.log(`[seed-openbao] 已写入 ${keys.length} 项 -> ${url}`)
    console.log(`[seed-openbao] keys: ${keys.join(', ')}`)
  } catch (err) {
    console.error(`[seed-openbao] ${err instanceof Error ? err.message : err}`)
    if (!args.soft) process.exit(1)
    console.warn('[seed-openbao] --soft 模式：忽略失败继续')
  }
}
