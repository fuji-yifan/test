/**
 * Axios 客户端 — 统一 HTTP 请求层
 *
 * 职责：
 * - Base URL 配置 + 超时
 * - 请求拦截器：自动注入 Bearer Token
 * - 响应拦截器：统一错误处理、401 跳登录
 */

import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'

const http: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

export function setupAxios(): void {
  // -------- 请求拦截器 --------
  http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    // 如果调用方已显式设置 Authorization（如表单页的 form_access_token），不要覆盖
    if (config.headers.Authorization) return config
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  // -------- 响应拦截器 --------
  http.interceptors.response.use(
    (response: AxiosResponse) => {
      const body = response.data
      // 统一响应格式 { code, data, message }
      if (body && body.code !== undefined && body.code !== 0) {
        const err = new Error(body.message || '请求失败') as any
        err.code = body.code
        return Promise.reject(err)
      }
      return body
    },
    (error) => {
      if (error.response) {
        const { status } = error.response
        if (status === 401) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          // 不在登录页才跳转
          if (!window.location.pathname.startsWith('/login')) {
            window.location.href = '/login'
          }
        } else if (status === 403) {
          const pathname = window.location.pathname
          if (pathname.startsWith('/login') || pathname.startsWith('/register')) return Promise.reject(error)
          // 工作空间成员错误 → 跳回首页
          const msg = error.response?.data?.message || ''
          if (msg.includes('工作空间')) {
            localStorage.removeItem('current_workspace_id')
            window.location.href = '/home'
            return Promise.reject(error)
          }
          // 权限不足 → 页面中央弹窗提示（相同消息 2 秒内不重复弹）
          const now = Date.now()
          if (window.__last403Msg !== msg || now - (window.__last403Time || 0) > 2000) {
            window.__last403Msg = msg
            window.__last403Time = now
            import('element-plus').then(({ ElMessageBox }) => {
              ElMessageBox.alert(msg || '权限不足，无法执行此操作', '无权限', {
                confirmButtonText: '知道了',
                type: 'warning',
                center: true,
              })
            })
          }
          return Promise.reject(Object.assign(new Error('__handled__'), { __handled: true }))
        }
      }
      return Promise.reject(error)
    },
  )
}

export default http
