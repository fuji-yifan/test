<template>
  <div class="render-layout">
    <header class="render-header">
      <div class="header-content">
        <span class="logo">FurmX</span>
      </div>
    </header>
    <main class="render-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.render-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg-page);
}
.render-header {
  height: 48px;
  background: var(--app-bg-card);
  border-bottom: 1px solid var(--app-border-color);
  display: flex;
  align-items: center;
  padding: 0 24px;
  flex-shrink: 0;
}
.logo {
  font-size: 18px;
  font-weight: 700;
  color: #409eff;
}
.render-main {
  flex: 1;
  max-width: 800px;
  width: 100%;
  margin: 24px auto;
  padding: 0 16px;
}
</style>
