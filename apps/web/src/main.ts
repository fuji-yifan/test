import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import 'element-plus/dist/index.css'
import './styles/theme.css'

import App from './App.vue'
import router from './router'
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
  app.mount('#app')
}

bootstrap()
