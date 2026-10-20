#!/usr/bin/env node
/**
 * 一键可演示环境：
 *   1. 检查 MySQL / Redis；
 *   2. 复用或拉起 OPA / OpenBao / Guardrails；
 *   3. 把 apps/server/.env 播种进 OpenBao（-dev 模式重启后自动补种）；
 *   4. 复用或拉起缺失的 server / agent / web；
 *   5. 打印各服务状态与入口地址。
 *
 * 用法：pnpm demo            完整启动（Ctrl+C 会连同本脚本拉起的子进程一起退出）
 *       pnpm demo:check      只检查状态，不启动、不写入
 *       pnpm demo --no-db-seed / --no-seed   跳过演示数据 / 跳过 OpenBao 播种
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedOpenBao } from './seed-openbao.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const CHECK_ONLY = process.argv.includes('--check')
const NO_SEED = process.argv.includes('--no-seed')
const NO_DB_SEED = process.argv.includes('--no-db-seed')

const children = []
let keepAlive = null

function log(msg) {
  console.log(`[demo] ${msg}`)
}

function startChild(name, command) {
  log(`启动 ${name}: ${command}`)
  const child = spawn(command, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code, signal) => log(`${name} 退出（code=${code ?? '-'} signal=${signal ?? '-'}）`))
  children.push({ name, child })
  return child
}

function stopChildren() {
  for (const { name, child } of children) {
    if (!child.pid || child.killed) continue
    try {
      if (IS_WIN) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
    log(`已停止 ${name}`)
  }
  children.length = 0
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    log(`收到 ${sig}，清理子进程`)
    stopChildren()
    process.exit(0)
  })
}

function connectOnce(port, host, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Vite 默认只监听 ::1，因此 IPv4/IPv6 都要探。 */
async function portOpen(port, timeoutMs = 800) {
  if (await connectOnce(port, '127.0.0.1', timeoutMs)) return true
  return connectOnce(port, '::1', timeoutMs)
}

async function httpOk(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function waitUntil(probe, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function ensureService({ name, probe, start, timeoutMs }) {
  if (await probe()) {
    log(`${name} 已在运行，复用`)
    return true
  }
  if (CHECK_ONLY) return false
  startChild(name, start)
  const ok = await waitUntil(probe, timeoutMs)
  if (!ok) log(`⚠️ ${name} 在 ${timeoutMs / 1000}s 内未就绪`)
  return ok
}

async function main() {
  log(`项目目录：${ROOT}`)

  const mysql = await portOpen(3306)
  const redis = await portOpen(6379)
  if (!mysql && !CHECK_ONLY) {
    log('❌ MySQL(3306) 未启动：请先启动本机 MySQL（库 formpu）')
    process.exit(1)
  }

  // 演示数据（幂等 upsert，不删除任何已有数据）
  if (mysql && !CHECK_ONLY && !NO_DB_SEED) {
    log('播种演示数据（admin@furm.com / 123456、示例表单、示例流程）…')
    const r = spawnSync('pnpm db:seed', { cwd: ROOT, shell: true, stdio: 'inherit' })
    if (r.status !== 0) log('⚠️ 演示数据播种失败（可忽略，不影响已有数据）')
  }

  // 基建（本地三个进程）
  await ensureService({
    name: 'OpenBao',
    probe: () => httpOk('http://127.0.0.1:8200/v1/sys/health'),
    start: 'pnpm dev:openbao',
    timeoutMs: 30000,
  })
  await ensureService({
    name: 'OPA',
    probe: () => httpOk('http://127.0.0.1:8181/health'),
    start: 'pnpm dev:opa',
    timeoutMs: 30000,
  })
  await ensureService({
    name: 'Guardrails',
    probe: () =>
      httpOk('http://127.0.0.1:8190/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'input', text: 'ping' }),
      }),
    start: 'pnpm dev:guardrails',
    timeoutMs: 60000,
  })

  // 播种 OpenBao（-dev 为内存存储，每次 demo 启动都补种）
  if (!CHECK_ONLY && !NO_SEED) {
    try {
      const { url, keys } = await seedOpenBao()
      log(`OpenBao 已写入 ${keys.length} 项 → ${url}`)
      log(`keys: ${keys.join(', ')}`)
    } catch (err) {
      log(`⚠️ OpenBao 播种失败（不影响 .env 启动）：${err instanceof Error ? err.message : err}`)
    }
  }

  // 三端：只拉起缺失的，已在运行的复用
  const apps = [
    { name: 'server', port: 3000, filter: '@furmx/server' },
    { name: 'agent', port: 3002, filter: '@furmx/agent' },
    { name: 'web', port: 5173, filter: '@furmx/web' },
  ]
  const missing = []
  for (const app of apps) {
    if (await portOpen(app.port)) log(`${app.name} 已在运行，复用 (:${app.port})`)
    else missing.push(app)
  }
  if (missing.length && !CHECK_ONLY) {
    const filters = missing.map((a) => `--filter=${a.filter}`).join(' ')
    startChild('apps', `pnpm exec turbo run dev ${filters}`)
  }

  // 启动后等待缺失端口就绪（最多 90s），然后输出状态
  if (missing.length && !CHECK_ONLY) {
    await waitUntil(async () => {
      for (const app of missing) if (!(await portOpen(app.port))) return false
      return true
    }, 90000)
  }

  const rows = [
    ['MySQL', mysql, '127.0.0.1:3306'],
    ['Redis', redis, '127.0.0.1:6379（可选，缓存/限流回退内存）'],
    [
      'OpenBao',
      await httpOk('http://127.0.0.1:8200/v1/sys/health'),
      'http://127.0.0.1:8200',
    ],
    ['OPA', await httpOk('http://127.0.0.1:8181/health'), 'http://127.0.0.1:8181'],
    [
      'Guardrails',
      await httpOk('http://127.0.0.1:8190/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'input', text: 'ping' }),
      }),
      'http://127.0.0.1:8190/check',
    ],
    ['server', await portOpen(3000), 'http://localhost:3000'],
    ['agent', await portOpen(3002), 'http://localhost:3002'],
    ['web', await portOpen(5173), 'http://localhost:5173'],
  ]
  log('服务状态：')
  for (const [name, ok, where] of rows) {
    console.log(`  ${String(name).padEnd(11)} ${ok ? 'OK  ' : 'DOWN'} ${where}`)
  }
  console.log('')
  console.log('  前端入口：http://localhost:5173')
  console.log('  Langfuse：https://cloud.langfuse.com（env 已配置，直接看 Traces）')
  console.log('')

  if (CHECK_ONLY || !children.length) return
  keepAlive = setInterval(() => {}, 1 << 30)
}

await main()
