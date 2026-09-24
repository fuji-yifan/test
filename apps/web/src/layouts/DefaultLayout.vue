<template>
  <div class="default-layout">
    <!-- 侧边栏 -->
    <aside :class="['sidebar', { collapsed: app.sidebarCollapsed }]">
      <div class="sidebar-logo">
        <span v-if="!app.sidebarCollapsed">FurmX</span>
        <span v-else>F</span>
      </div>
      <!-- 工作空间下拉选择 -->
      <div v-if="!app.sidebarCollapsed" class="sidebar-ws-select">
        <el-select
          :model-value="sidebarWsValue"
          placeholder="选择工作空间"
          popper-class="sidebar-ws-popper"
          @change="onSidebarWsChange"
        >
          <el-option label="首页" value="__home__" />
          <el-option
            v-for="ws in wsStore.list"
            :key="ws.id"
            :label="ws.name"
            :value="ws.id"
          />
        </el-select>
      </div>
      <div v-else class="sidebar-ws-collapsed">
        <el-icon :size="20" @click="goHome"><House /></el-icon>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="app.sidebarCollapsed"
        :router="true"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <el-menu-item :index="`/home`">
          <el-icon><House /></el-icon>
          <span>首页</span>
        </el-menu-item>
        <el-menu-item :index="`/workspace/${defaultWsId}/home`">
          <el-icon><Monitor /></el-icon>
          <span>工作台</span>
        </el-menu-item>
        <el-menu-item :index="`/workspace/${defaultWsId}/forms`">
          <el-icon><DocumentCopy /></el-icon>
          <span>表单管理</span>
        </el-menu-item>
        <el-menu-item :index="`/workspace/${defaultWsId}/templates`">
          <el-icon><ScaleToOriginal /></el-icon>
          <span>模板市场</span>
        </el-menu-item>
        <el-menu-item :index="`/workspace/${defaultWsId}/workflows`">
          <el-icon><Files /></el-icon>
          <span>流程管理</span>
        </el-menu-item>
        <el-menu-item :index="`/my-processes`">
          <el-icon><PieChart /></el-icon>
          <span>我的流程</span>
        </el-menu-item>
        <el-menu-item :index="`/my-tasks`">
          <el-icon><Message /></el-icon>
          <span>我的待办</span>
        </el-menu-item>
        <el-menu-item :index="`/workspace/${defaultWsId}/analytics`">
          <el-icon><Stopwatch /></el-icon>
          <span>数据分析</span>
        </el-menu-item>
        <el-sub-menu index="admin">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>管理</span>
          </template>
          <el-menu-item :index="`/workspace/${defaultWsId}/members`">
            成员管理
          </el-menu-item>
          <el-menu-item :index="`/workspace/${defaultWsId}/roles`">
            角色权限
          </el-menu-item>
          <el-menu-item :index="`/workspace/${defaultWsId}/audit-logs`">
            审计日志
          </el-menu-item>
        </el-sub-menu>
      </el-menu>

      <!-- 主题切换 -->
      <div class="sidebar-footer">
        <el-tooltip
          :content="app.isDark ? '深色模式' : '浅色模式'"
          placement="right"
          :disabled="!app.sidebarCollapsed"
        >
          <button
            class="theme-toggle"
            @click="app.toggleDark()"
          >
            <el-icon :size="18">
              <Moon v-if="app.isDark" /><Sunny v-else />
            </el-icon>
          </button>
        </el-tooltip>
        <span
          v-if="!app.sidebarCollapsed"
          class="theme-label"
        >{{ app.isDark ? '深色模式' : '浅色模式' }}</span>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="main-area">
      <!-- 顶部栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <el-button
            text
            @click="app.toggleSidebar()"
          >
            <el-icon :size="18">
              <DArrowLeft v-if="!app.sidebarCollapsed" /><DArrowRight v-else />
            </el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item
              v-for="(item, i) in breadcrumbs"
              :key="i"
              :to="item.to"
            >
              {{ item.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="topbar-right">
          <NotificationBell />
          <el-button
            class="ai-btn"
            @click="chatVisible = true"
          >
            <el-icon class="ai-btn-icon"><ChatDotRound /></el-icon>
            Agent - X
          </el-button>
          <!-- 用户 -->
          <el-dropdown trigger="click">
            <span class="user-info">
              <el-avatar
                :size="32"
                icon="UserFilled"
              />
              <span class="user-name">{{ auth.currentUser?.nickname || auth.currentUser?.email }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="goProfile">
                  个人信息
                </el-dropdown-item>
                <el-dropdown-item
                  divided
                  @click="handleLogout"
                >
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- 内容区 -->
      <main class="content">
        <router-view />
      </main>
    </div>

    <ChatPanel
      v-model:visible="chatVisible"
      :scenario="agentScenario"
      :workspace-id="wsId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  Monitor,
  House,
  DocumentCopy,
  ScaleToOriginal,
  Files,
  Message,
  PieChart,
  Stopwatch,
  Setting,
  DArrowLeft,
  DArrowRight,
  ArrowDown,
  Sunny,
  Moon,
  ChatDotRound,
} from '@element-plus/icons-vue'
import NotificationBell from '@/components/global/NotificationBell.vue'
import ChatPanel from '@/components/ChatPanel.vue'

const chatVisible = ref(false)

// 根据当前路由自动推断 Agent 场景
const agentScenario = computed(() => {
  const path = route.path
  console.log('[agentScenario] path:', path)
  if (path.includes('/templates')) return 'template-creator'
  if (path.includes('/workflows') || path.includes('/my-processes')) return 'workflow-node'
  // 任务页是流程流转出来的待办，默认身份给流程助手（原 approval-assist 已下线）
  if (path.includes('/tasks') || path.includes('/my-tasks')) return 'workflow-node'
  if (path.includes('/analytics')) return 'data-analysis'
  if (path.includes('/designer') || path.includes('/forms')) return 'form-builder'
  return 'general'
})

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const app = useAppStore()
const wsStore = useWorkspaceStore()

const wsId = computed(() => {
  const fromRoute = route.params.wsId
  if (typeof fromRoute === 'string' && fromRoute) return fromRoute
  return typeof wsStore.currentId === 'string' ? wsStore.currentId : ''
})

/** 始终返回一个有效的 workspace ID，侧边栏所有菜单依赖此值 */
const defaultWsId = computed(() => {
  const id = wsId.value
  if (id) return id
  if (wsStore.list.length > 0) return wsStore.list[0].id
  return ':wsId'
})

const activeMenu = computed(() => {
  const path = route.path
  if (path === '/home') return '/home'
  // workspace home
  if (path.match(/^\/workspace\/[^/]+\/home$/)) return `/workspace/${route.params.wsId}/home`
  return path
})

/** 侧边栏下拉框的值：首页 or 工作空间 ID */
const sidebarWsValue = computed(() => {
  if (route.path === '/home') return '__home__'
  const id = route.params.wsId
  if (typeof id === 'string' && id) return id
  if (wsStore.currentId) return wsStore.currentId
  return '__home__'
})

function onSidebarWsChange(val: string) {
  if (val === '__home__') {
    router.push('/home')
    return
  }
  switchWorkspace(val)
}

function goHome() {
  router.push('/home')
}

const breadcrumbs = computed(() => {
  const items: { title: string; to?: string }[] = [{ title: '首页', to: '/home' }]
  const wsIdVal = route.params.wsId as string

  // 按 route.name 精确构建面包屑
  const routeName = route.name as string
  const map: Record<string, { title: string; to?: string }[]> = {
    Home: [],
    WorkspaceHome: [{ title: '工作台' }],
    FormList: [{ title: '表单管理' }],
    FormDesigner: [
      { title: '表单管理', to: `/workspace/${wsIdVal}/forms` },
      { title: '表单设计器' },
    ],
    FormSettings: [
      { title: '表单管理', to: `/workspace/${wsIdVal}/forms` },
      { title: '表单设置' },
    ],
    FormData: [
      { title: '表单管理', to: `/workspace/${wsIdVal}/forms` },
      { title: '提交数据' },
    ],
    SubmissionDetail: [
      { title: '表单管理', to: `/workspace/${wsIdVal}/forms` },
      { title: '提交数据', to: `/workspace/${wsIdVal}/forms/${route.params.formId}/data` },
      { title: '数据详情' },
    ],
    Templates: [{ title: '模板市场' }],
    TemplateDesigner: [
      { title: '模板市场', to: `/workspace/${wsIdVal}/templates` },
      { title: '编辑模板' },
    ],
    Analytics: [{ title: '数据分析' }],
    Members: [{ title: '成员管理' }],
    Roles: [{ title: '角色权限' }],
    AuditLogs: [{ title: '审计日志' }],
    ProcessList: [{ title: '流程管理' }],
    ProcessDesigner: [
      { title: '流程管理', to: `/workspace/${wsIdVal}/workflows` },
      { title: '流程设计器' },
    ],
    Profile: [{ title: '个人信息' }],
    MyTasks: [{ title: '我的待办' }],
    MyProcesses: [{ title: '我的流程' }],
    Notifications: [{ title: '消息通知' }],
    InstanceViewer: [{ title: '流程进度' }],
  }

  const extra = map[routeName] || []
  items.push(...extra)
  return items
})

onMounted(async () => {
  await wsStore.fetchList()
  // 恢复上次选中的工作空间，或自动选第一个
  const savedId = localStorage.getItem('current_workspace_id')
  if (savedId) {
    const found = wsStore.list.find(w => w.id === savedId)
    if (found) {
      wsStore.setCurrent(found)
    }
  }
  if (!wsStore.currentId && wsStore.list.length > 0) {
    wsStore.setCurrent(wsStore.list[0])
  }
  // 如果用户没有任何工作空间，清除可能残留的缓存
  if (wsStore.list.length === 0) {
    localStorage.removeItem('current_workspace_id')
  }
})

function switchWorkspace(id: string) {
  const ws = wsStore.list.find((w) => w.id === id)
  if (ws) {
    wsStore.setCurrent(ws)
    router.push(`/workspace/${id}/home`)
  }
}

function goProfile() {
  router.push('/profile')
}

function handleLogout() {
  auth.logout()
}
</script>

<style scoped>
.default-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: #304156;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.3s;
}
.sidebar.collapsed {
  width: 64px;
}
.sidebar-logo {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.sidebar .el-menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ai-btn {
  font-weight: 700;
  font-size: 15px;
  padding: 6px 18px;
  border-radius: 8px;
  background: #e8f2fc;
  border-color: #d0e3f7;
  color: #2c3e50;
}
.ai-btn:hover {
  background: #d4e8fa;
  border-color: #b3d8ff;
}
.ai-btn:active {
  background: #c0dcf7;
}
.ai-btn-icon {
  font-size: 20px;
  margin-right: 4px;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.ws-selector {
  width: 160px;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}
.user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--app-border-light);
}
.theme-toggle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--app-border-color);
  background: var(--app-bg-card);
  color: var(--app-text-regular);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
}
.theme-toggle:hover {
  background: #f0f4ff;
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.theme-label {
  font-size: 13px;
  color: var(--app-text-regular);
  white-space: nowrap;
}

.sidebar-ws-select {
  padding: 10px 12px 6px;
}
.sidebar-ws-select :deep(.el-select) {
  width: 100%;
}
.sidebar-ws-select :deep(.el-input__wrapper) {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.15);
  box-shadow: none;
}
.sidebar-ws-select :deep(.el-input__inner) {
  color: #bfcbd9;
}
.sidebar-ws-select :deep(.el-input__inner::placeholder) {
  color: rgba(255,255,255,0.4);
}
.sidebar-ws-collapsed {
  display: flex;
  justify-content: center;
  padding: 12px 0;
  color: #bfcbd9;
  cursor: pointer;
}
.sidebar-ws-collapsed:hover {
  color: #409eff;
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--app-bg-page);
  padding: 20px;
}
</style>
