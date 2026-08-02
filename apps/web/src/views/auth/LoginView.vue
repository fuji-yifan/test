<template>
  <div class="login-page">
    <!-- 左侧品牌区 -->
    <div class="login-brand">
      <div class="brand-content">
        <div class="brand-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill="#1a1a2e"/>
            <path d="M12 14h16v4H12zM12 22h12v4H12z" fill="#fff" opacity="0.9"/>
          </svg>
        </div>
        <h1 class="brand-name">FurmX</h1>
        <p class="brand-desc">轻量化低代码表单平台</p>
        <div class="brand-features">
          <div class="feature-item">
            <span class="feature-dot"></span>
            可视化拖拽搭建
          </div>
          <div class="feature-item">
            <span class="feature-dot"></span>
            灵活的流程审批
          </div>
          <div class="feature-item">
            <span class="feature-dot"></span>
            数据统计与分析
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧表单区 -->
    <div class="login-form-area">
      <div class="form-wrapper">
        <h2 class="form-title">欢迎回来</h2>
        <p class="form-subtitle">登录你的账号以继续</p>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          size="large"
          class="login-form"
          @submit.prevent="handleLogin"
        >
          <el-form-item prop="email">
            <el-input
              v-model="form.email"
              placeholder="输入邮箱地址"
              :prefix-icon="Message"
              clearable
            />
          </el-form-item>

          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="输入密码"
              :prefix-icon="Lock"
              show-password
              @keyup.enter="handleLogin"
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              native-type="submit"
              :loading="auth.loading"
              class="submit-btn"
            >
              登录
            </el-button>
          </el-form-item>
        </el-form>

        <p class="register-link">
          还没有账号？<router-link to="/register">创建账号</router-link>
        </p>

        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Message, Lock } from '@element-plus/icons-vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const formRef = ref()
const errorMsg = ref('')
const form = reactive({ email: '', password: '' })
const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' },
  ],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  errorMsg.value = ''
  try {
    await auth.login({ email: form.email, password: form.password })
    const redirect = (route.query.redirect as string) || '/home'
    router.push(redirect)
  } catch (e: any) {
    errorMsg.value = e.message
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  width: 100vw;
  height: 100vh;
  min-height: 600px;
}

/* ========== 左侧品牌区 ========== */
.login-brand {
  flex: 0 0 44%;
  background: #f7f8fa;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

/* 背景装饰圆 */
.login-brand::before {
  content: '';
  position: absolute;
  top: -120px;
  right: -80px;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  background: #eceef2;
  z-index: 0;
}

.login-brand::after {
  content: '';
  position: absolute;
  bottom: -60px;
  left: -40px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: #eceef2;
  z-index: 0;
}

.brand-content {
  position: relative;
  z-index: 1;
  max-width: 360px;
}

.brand-logo {
  margin-bottom: 24px;
}

.brand-name {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 8px;
  letter-spacing: -0.5px;
}

.brand-desc {
  font-size: 15px;
  color: #6b7280;
  margin: 0 0 40px;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #4b5563;
}

.feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}

/* ========== 右侧表单区 ========== */
.login-form-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.form-wrapper {
  width: 380px;
}

.form-title {
  font-size: 26px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 6px;
  letter-spacing: -0.3px;
}

.form-subtitle {
  font-size: 14px;
  color: #9ca3af;
  margin: 0 0 36px;
}

.login-form {
  margin-bottom: 20px;
}

.submit-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 500;
  border-radius: 8px;
}

.register-link {
  text-align: center;
  font-size: 14px;
  color: #9ca3af;
}

.register-link a {
  color: #111827;
  font-weight: 500;
  text-decoration: none;
}

.register-link a:hover {
  color: #409eff;
}

.error-msg {
  color: #f56c6c;
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  background: #fef2f2;
  padding: 10px 14px;
  border-radius: 6px;
}
</style>
