import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 轻量加载 .env（避免为此引入 dotenv 依赖），让一致性套件能拿到 AGENT_DATABASE_URL
try {
  const raw = readFileSync(resolve(__dirname, '.env'), 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {
  // 没有 .env 时依赖外部环境变量
}

export default defineConfig({
  test: {
    globals: true, // 官方一致性套件使用全局 beforeAll/describe/test
    testTimeout: 30000,
    hookTimeout: 120000,
    include: ['test/**/*.spec.ts'],
  },
})
