<template>
  <div class="success-page">
    <div class="success-card">
      <div class="success-icon">
        <el-icon :size="64" color="#22c55e"><CircleCheckFilled /></el-icon>
      </div>
      <h2>提交成功</h2>
      <p class="sub">您的信息已成功提交</p>
      <el-button type="primary" size="large" @click="$router.push(`/f/${formId}`)" class="action-btn">继续填写</el-button>
      <div class="back-link">
        <el-button text size="small" @click="$router.push('/home')">返回首页</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { CircleCheckFilled } from '@element-plus/icons-vue'
const route = useRoute()
const formId = route.params.formId as string
</script>

<style scoped>
.success-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 40px 16px;
  background: var(--app-bg-page);
}
.success-card {
  text-align: center;
  max-width: 400px;
  width: 100%;
  background: var(--app-bg-card);
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--app-border-color);
  padding: 56px 40px 48px;
  box-shadow: var(--app-shadow-md);
}
.success-icon { margin-bottom: 20px; }
.success-card h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; color: var(--app-text-primary); }
.sub { margin: 0 0 32px; font-size: 14px; color: var(--app-text-secondary); }
.action-btn { min-width: 160px; height: 44px; font-size: 15px; border-radius: var(--el-border-radius-base); }
.back-link { margin-top: 16px; }
</style>
