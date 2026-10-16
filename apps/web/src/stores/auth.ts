import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/client'

export interface UserInfo {
  id: string
  email: string
  nickname?: string
  avatarUrl?: string
  status?: string
  lastLoginAt?: string
  createdAt?: string
}

export interface LoginParams {
  email: string
  password: string
}

export interface RegisterParams {
  email: string
  password: string
  nickname?: string
}

interface AuthApiResponse {
  accessToken: string
  refreshToken?: string
  user: UserInfo
}

/**
 * 读 token 载荷里的 workspaceId 声明（后端 S1.1 签入，agent 端以它为准）。
 * 只做 base64 解码、不校验签名 —— 用途是让前端判断「选中的空间」和「token 绑定的空间」
 * 是否已经脱节，脱节就用 /workspaces/:wsId/token 换发，不承担任何鉴权职责。
 */
function readClaimWorkspaceId(jwt: string | null): string | null {
  if (!jwt) return null
  const part = jwt.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    return typeof payload.workspaceId === 'string' ? payload.workspaceId : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  // ---- state ----
  const user = ref<UserInfo | null>(null)
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const loading = ref(false)

  // ---- getters ----
  const isAuthenticated = computed(() => !!token.value)
  const currentUser = computed(() => user.value)
  /** token 里绑定的工作空间（agent/审计都以它为准），与 UI 选中的空间必须一致 */
  const tokenWorkspaceId = computed(() => readClaimWorkspaceId(token.value))

  // ---- actions ----

  /** 登录 */
  async function login(params: LoginParams) {
    loading.value = true
    try {
      const res = await http.post('/auth/login', params)
      const data = (res.data || res) as AuthApiResponse
      token.value = data.accessToken
      user.value = data.user
      localStorage.setItem('access_token', data.accessToken)
      if (data.refreshToken) {
        localStorage.setItem('refresh_token', data.refreshToken)
      }
      // 获取用户详情
      await fetchProfile()
      return true
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      throw new Error(err.response?.data?.message || err.message || '登录失败')
    } finally {
      loading.value = false
    }
  }

  /** 注册 */
  async function register(params: RegisterParams) {
    loading.value = true
    try {
      const res = await http.post('/auth/register', params)
      const data = (res.data || res) as AuthApiResponse
      token.value = data.accessToken
      user.value = data.user
      localStorage.setItem('access_token', data.accessToken)
      // 尝试获取详细信息，失败不影响注册结果（已经有基础用户数据）
      try { await fetchProfile() } catch { /* 忽略，已有 token */ }
      return true
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      throw new Error(err.response?.data?.message || err.message || '注册失败')
    } finally {
      loading.value = false
    }
  }

  /** 获取当前用户信息 */
  async function fetchProfile() {
    if (!token.value) return
    try {
      const res = await http.get('/auth/me')
      const data = (res.data || res) as UserInfo
      user.value = data
    } catch {
      // token 过期 → 清除
      logout(false)
    }
  }

  /**
   * 换发 token，把工作空间身份切到 workspaceId。
   *
   * 服务端会校验「空间存在、未软删、且你是成员」，不通过就抛错（调用方自便）。
   */
  async function switchWorkspace(workspaceId: string) {
    const res = await http.post(`/workspaces/${workspaceId}/token`)
    const data = (res.data || res) as { accessToken?: string }
    if (!data?.accessToken) return false
    token.value = data.accessToken
    localStorage.setItem('access_token', data.accessToken)
    return true
  }

  /** 登出 */
  function logout(redirect = true) {
    token.value = null
    user.value = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    if (redirect) {
      window.location.href = '/login'
    }
  }

  /** 应用启动时尝试恢复登录态 */
  async function tryAutoLogin() {
    const savedToken = localStorage.getItem('access_token')
    if (savedToken) {
      token.value = savedToken
      await fetchProfile()
    }
  }

  return {
    user, token, loading,
    isAuthenticated, currentUser, tokenWorkspaceId,
    login, register, fetchProfile, switchWorkspace, logout, tryAutoLogin,
  }
})
