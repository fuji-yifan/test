import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn.mjs'
import 'element-plus/dist/index.css'
import './styles/theme.css'

import App from './App.vue'
import router from './router'
import ErrorBoundary from './components/ErrorBoundary.vue'
import { setupAxios } from './api/client'
import { initElementPlusBridge } from './bridge/element-plus-adapter'
import { useAuthStore } from './stores/auth'
import { useAppStore } from './stores/app'

async function bootstrap() {
  // 初始化 Component Bridge
  initElementPlusBridge()

  // 初始化 HTTP 客户端（Token 注入 + 401 拦截）
  setupAxios()

  const app = createApp(App)

  // Pinia 必须在 router / tryAutoLogin 之前安装
  const pinia = createPinia()
  app.use(pinia)

  // 初始化主题（watch: immediate 会从 localStorage 恢复并写入 html.dark）
  useAppStore()

  // 验证本地 token 有效性，无效则自动清除
  const authStore = useAuthStore()
  await authStore.tryAutoLogin()

  app.use(router)
  app.use(ElementPlus, { locale: zhCn })
  app.component('ErrorBoundary', ErrorBoundary)  // 全局注册，任意视图无需 import 即可使用

  // 全局错误兜底 — 未被 ErrorBoundary 捕获的错误最终到达此处
  app.config.errorHandler = (err: unknown, _vm, info) => {
    console.error('[GlobalErrorHandler]', info, err)
    // 避免同类型错误持续刷屏（同一 message 2 秒内只记录一次）
    const msg = err instanceof Error ? err.message : String(err)
    const now = Date.now()
    if ((window as unknown as Record<string, number>).__lastGlobalErrorTime !== now) {
      ;(window as unknown as Record<string, number>).__lastGlobalErrorTime = now
    }
  }

  app.mount('#app')
}

bootstrap()
