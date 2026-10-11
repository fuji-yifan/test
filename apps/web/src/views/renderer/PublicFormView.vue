<template>
  <div class="public-form">
    <div
      v-if="!schema"
      class="loading-state"
    >
      <el-skeleton
        :rows="8"
        animated
      />
    </div>

    <div
      v-else
      class="form-wrapper"
    >
      <!-- 用户身份栏 -->
      <div class="user-bar">
        <template v-if="formUser">
          <span class="user-info">
            <el-icon><UserFilled /></el-icon>
            {{ formUser.nickname || formUser.email }}
          </span>
          <el-button
            size="small"
            @click="logout"
          >
            切换账号
          </el-button>
        </template>
        <template v-else>
          <span class="user-tip">登录后提交表单</span>
          <el-button-group size="small">
            <el-button
              type="primary"
              @click="showLogin = true"
            >
              登录
            </el-button>
            <el-button @click="showLogin = true">
              注册
            </el-button>
          </el-button-group>
        </template>
      </div>

      <!-- 表单卡片 -->
      <div
        class="form-card"
        :style="{ width: canvasWidth + 'px' }"
      >
        <div
          v-if="schema.settings.formTitle"
          class="form-title"
        >
          {{ schema.settings.formTitle }}
        </div>
        <div
          v-if="!schema.fields?.length"
          class="empty-hint"
        >
          无控件
        </div>
        <div
          v-else
          class="form-fields"
          :style="gridStyle"
        >
          <ErrorBoundary
            title="表单渲染异常"
            message="当前表单部分字段加载失败，请刷新重试"
          >
            <FormField
              v-for="field in schema.fields"
              :key="field.id"
              :field="field"
              :schema-settings="schema.settings"
              :model-value="formData[field.key]"
              :max-cols="schema.settings.canvasCols || 24"
              :required="isRequired(field)"
              @update:model-value="(v) => { if (field.key) formData[field.key] = v }"
            />
          </ErrorBoundary>
        </div>
      </div>

      <!-- 提交按钮 -->
      <div
        v-if="schema.fields?.length"
        class="form-footer"
      >
        <el-button
          type="primary"
          size="large"
          :loading="submitting"
          :disabled="!formUser"
          class="submit-btn"
          @click="handleSubmit"
        >
          {{ formUser ? (schema.settings.submitText || '提交') : '请先登录后提交' }}
        </el-button>
      </div>
    </div>

    <!-- 登录/注册弹窗 -->
    <el-dialog
      v-model="showLogin"
      width="420px"
      :close-on-click-modal="false"
      :show-close="false"
    >
      <div class="auth-dialog">
        <div class="auth-header">
          <h3>{{ loginTab === 'login' ? '登录' : '注册' }}</h3>
          <p class="auth-sub">
            登录后即可提交表单
          </p>
        </div>

        <!-- 登录 -->
        <el-form
          v-if="loginTab === 'login'"
          :model="loginForm"
          label-position="top"
          @submit.prevent="doLogin"
        >
          <el-form-item label="邮箱">
            <el-input
              v-model="loginForm.email"
              placeholder="输入邮箱地址"
              :prefix-icon="Message"
            />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="输入密码"
              show-password
              :prefix-icon="Lock"
              @keyup.enter="doLogin"
            />
          </el-form-item>
          <el-button
            type="primary"
            :loading="loginLoading"
            class="auth-btn"
            @click="doLogin"
          >
            登录
          </el-button>
          <p
            v-if="loginError"
            class="error-msg"
          >
            {{ loginError }}
          </p>
        </el-form>

        <!-- 注册 -->
        <el-form
          v-if="loginTab === 'register'"
          :model="registerForm"
          label-position="top"
          @submit.prevent="doRegister"
        >
          <el-form-item label="邮箱">
            <el-input
              v-model="registerForm.email"
              placeholder="输入邮箱地址"
              :prefix-icon="Message"
            />
          </el-form-item>
          <el-form-item label="昵称">
            <el-input
              v-model="registerForm.nickname"
              placeholder="输入昵称"
              :prefix-icon="User"
            />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="registerForm.password"
              type="password"
              placeholder="至少6位"
              show-password
              :prefix-icon="Lock"
            />
          </el-form-item>
          <el-button
            type="primary"
            :loading="regLoading"
            class="auth-btn"
            @click="doRegister"
          >
            注册
          </el-button>
          <p
            v-if="regError"
            class="error-msg"
          >
            {{ regError }}
          </p>
        </el-form>

        <div class="auth-switch">
          <template v-if="loginTab === 'login'">
            还没有账号？<a
              href="#"
              @click.prevent="loginTab = 'register'; loginError = ''; regError = ''"
            >立即注册</a>
          </template>
          <template v-else>
            已有账号？<a
              href="#"
              @click.prevent="loginTab = 'login'; loginError = ''; regError = ''"
            >立即登录</a>
          </template>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UserFilled, Message, Lock, User } from '@element-plus/icons-vue'
import http from '@/api/client'
import type { FormSchema, FieldSchema } from '@furmx/sdk'
import { isLayoutField } from '@furmx/sdk'
import ErrorBoundary from '@/components/ErrorBoundary.vue'
import FormField from './components/FormField.vue'

const FORM_TOKEN_KEY = 'form_access_token'
const FORM_USER_KEY = 'form_user'

const route = useRoute()
const router = useRouter()
const formId = route.params.formId as string

const schema = ref<FormSchema | null>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)

// ---- 表单页独立的登录态 ----
const formToken = ref(localStorage.getItem(FORM_TOKEN_KEY) || '')
const formUser = ref<any>(JSON.parse(localStorage.getItem(FORM_USER_KEY) || 'null'))

const showLogin = ref(false)
const loginTab = ref('login')
const loginForm = reactive({ email: '', password: '' })
const registerForm = reactive({ email: '', nickname: '', password: '' })
const loginLoading = ref(false)
const regLoading = ref(false)
const loginError = ref('')
const regError = ref('')

function saveFormAuth(token: string, user: any) {
  formToken.value = token
  formUser.value = user
  localStorage.setItem(FORM_TOKEN_KEY, token)
  localStorage.setItem(FORM_USER_KEY, JSON.stringify(user))
}

function logout() {
  formToken.value = ''
  formUser.value = null
  localStorage.removeItem(FORM_TOKEN_KEY)
  localStorage.removeItem(FORM_USER_KEY)
}

onMounted(async () => {
  try {
    const headers: any = {}
    if (formToken.value) headers.Authorization = `Bearer ${formToken.value}`
    const res = await http.get(`/public/forms/${formId}`, { headers }) as any
    const form = res.data || res
    schema.value = form.schema as FormSchema
    if (schema.value?.fields) {
      const walk = (fields: FieldSchema[]) => {
        for (const f of fields) {
          if (f.key && !isLayoutField(f.type)) formData[f.key] = f.defaultValue ?? (['checkbox', 'date-range-picker'].includes(f.type) ? [] : '')
          if (f.children) walk(f.children)
        }
      }
      walk(schema.value.fields)
    }
  } catch {
    ElMessage.error('加载表单失败')
  }
})

const COL_PX = 800 / 24
const canvasCols = computed(() => schema.value?.settings?.canvasCols || 24)

const canvasWidth = computed(() => Math.round(canvasCols.value * COL_PX))

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${canvasCols.value}, 1fr)`,
  gap: '12px 16px',
  alignItems: 'start' as const,
}))

function isRequired(field: FieldSchema) {
  return (field.rules || []).some((r) => r.type === 'required')
}

async function doLogin() {
  loginError.value = ''
  loginLoading.value = true
  try {
    const res = await http.post('/auth/login', { email: loginForm.email, password: loginForm.password }) as any
    const data = res.data || res
    saveFormAuth(data.accessToken, data.user)
    loginForm.email = ''; loginForm.password = ''
    showLogin.value = false
  } catch (e: any) {
    loginError.value = e.response?.data?.message || '登录失败'
  } finally {
    loginLoading.value = false
  }
}

async function doRegister() {
  regError.value = ''
  if (!registerForm.email || !registerForm.password) { regError.value = '请填写邮箱和密码'; return }
  if (!registerForm.nickname) { regError.value = '请输入昵称'; return }
  if (registerForm.password.length < 6) { regError.value = '密码至少6位'; return }
  regLoading.value = true
  try {
    const res = await http.post('/auth/register', { email: registerForm.email, password: registerForm.password, nickname: registerForm.nickname }) as any
    const data = res.data || res
    saveFormAuth(data.accessToken, data.user)
    registerForm.email = ''; registerForm.nickname = ''; registerForm.password = ''
    showLogin.value = false
  } catch (e: any) {
    regError.value = e.response?.data?.message || '注册失败'
  } finally {
    regLoading.value = false
  }
}

async function handleSubmit() {
  if (!formUser.value) {
    showLogin.value = true
    return
  }
  if (schema.value?.fields) {
    const check = (fields: FieldSchema[]): boolean => {
      for (const f of fields) {
        if (isRequired(f) && (!formData[f.key] || formData[f.key] === '')) {
          ElMessage.warning(`请填写「${f.name}」`)
          return false
        }
        // field.props 为运行时 JSON 属性包（SDK 类型 Record<string, unknown>），按 any 读取
        const fp: Record<string, any> = f.props
        const maxLen = fp.maxLength || fp.maxlength
        if (maxLen && formData[f.key] && String(formData[f.key]).length > maxLen) {
          ElMessage.warning(`「${f.name}」输入内容超过最大长度 ${maxLen}`)
          return false
        }
        if (f.children && !check(f.children)) return false
      }
      return true
    }
    if (!check(schema.value.fields)) return
  }

  submitting.value = true
  try {
    const headers: any = {}
    if (formToken.value) headers.Authorization = `Bearer ${formToken.value}`
    await http.post(`/public/forms/${formId}/submit`, { data: { ...formData } }, { headers })
    router.push(`/f/${formId}/success`)
  } catch {
    ElMessage.error('提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.public-form { min-height: 100vh; padding: 32px 16px 80px; background: var(--app-bg-page); }
.loading-state { max-width: 800px; margin: 0 auto; }
.form-wrapper { display: flex; flex-direction: column; align-items: center; }

.user-bar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-bottom: 20px; font-size: 13px; }
.user-info { display: flex; align-items: center; gap: 6px; color: var(--app-text-primary); font-weight: 500; }
.user-tip { color: var(--app-text-secondary); }

.form-card { background: #fff; border-radius: 4px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
.form-title { text-align: center; font-size: 20px; font-weight: 600; color: #303133; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #ebeef5; }
.form-fields { display: grid; gap: 12px 16px; align-items: start; }
.empty-hint { text-align: center; padding: 80px 0; color: #909399; }

.form-footer { text-align: center; margin-top: 32px; }
.submit-btn { min-width: 200px; height: 44px; font-size: 15px; font-weight: 500; }

.dialog-submit-btn { width: 100%; }

/* ---- 登录弹窗 ---- */
.auth-dialog { padding: 8px 0; }
.auth-header { text-align: center; margin-bottom: 28px; }
.auth-header h3 { margin: 0 0 6px; font-size: 22px; font-weight: 700; color: var(--app-text-primary); }
.auth-sub { margin: 0; font-size: 14px; color: var(--app-text-secondary); }
.auth-btn { width: 100%; height: 42px; font-size: 15px; border-radius: var(--el-border-radius-base); }
.auth-switch { text-align: center; margin-top: 20px; font-size: 14px; color: var(--app-text-secondary); }
.auth-switch a { color: var(--app-text-primary); font-weight: 500; text-decoration: none; }
.auth-switch a:hover { color: var(--el-color-primary); }
.error-msg { color: #f56c6c; text-align: center; margin-top: 12px; font-size: 13px; background: #fef2f2; padding: 8px 12px; border-radius: 6px; }

html.dark .form-card { background: #1e293b; }
html.dark .form-title { color: #e2e8f0; border-bottom-color: #334155; }
html.dark .empty-hint { color: #64748b; }
</style>
