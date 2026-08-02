<template>
  <div class="error-page">
    <div class="error-code">
      404
    </div>
    <h2>页面不存在</h2>
    <p>请检查链接是否正确，或返回首页</p>
    <el-button
      size="large"
      @click="$router.push('/home')"
    >
      返回首页
    </el-button>
  </div>
</template>

<style scoped>
.error-page { text-align: center; padding: 80px 0; }
.error-code { font-size: 96px; font-weight: 800; color: var(--app-text-secondary); line-height: 1; margin-bottom: 8px; letter-spacing: -2px; }
.error-page h2 { margin: 0 0 8px; font-size: 20px; color: var(--app-text-primary); }
.error-page p { font-size: 14px; color: var(--app-text-secondary); margin: 0 0 32px; }
</style>
