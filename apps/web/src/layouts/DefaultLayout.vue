<template>
  <div class="default-layout">
    <!-- 侧边栏 -->
    <aside :class="['sidebar', { collapsed: app.sidebarCollapsed }]">
      <div class="sidebar-logo">
        <span v-if="!app.sidebarCollapsed">FurmX</span>
        <span v-else>F</span>
      </div>
      <!-- 工作空间下拉选择 -->
      <div v-if="!app.sidebarCollapsed" key="ws-expanded" class="sidebar-ws-select">
        <el-select
          ref="wsSelectRef"
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
      <div v-else key="ws-collapsed" class="sidebar-ws-collapsed">
        <el-popover
          v-model:visible="wsPopoverVisible"
          placement="right-start"
          :width="208"
          :offset="10"
          trigger="click"
          popper-class="sidebar-ws-popover"
        >
          <template #reference>
            <div
              class="ws-trigger"
              :class="{ 'is-open': wsPopoverVisible }"
              :title="currentWsName"
            >
              <el-icon :size="20"><Grid /></el-icon>
            </div>
          </template>
          <div class="ws-pop-list">
            <div class="ws-pop-label">
              工作空间
            </div>
            <div
              v-for="ws in wsStore.list"
              :key="ws.id"
              class="ws-pop-item"
              :class="{ active: ws.id === sidebarWsValue }"
              @click="onCollapsedWsPick(ws.id)"
            >
              <span class="ws-pop-name">{{ ws.name }}</span>
              <el-icon v-if="ws.id === sidebarWsValue" class="ws-pop-check"><Check /></el-icon>
            </div>
            <div class="ws-pop-divider" />
            <div
              class="ws-pop-item"
              :class="{ active: sidebarWsValue === '__home__' }"
              @click="onCollapsedWsPick('__home__')"
            >
              <span class="ws-pop-name">首页</span>
              <el-icon v-if="sidebarWsValue === '__home__'" class="ws-pop-check"><Check /></el-icon>
            </div>
          </div>
        </el-popover>
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
          <!-- 平时只留 agent 图标（与悬浮窗头部同一枚），悬停展开成矩形露出品牌字 -->
          <button
            type="button"
            class="ai-btn"
            title="FlowX 智能助手"
            aria-label="打开 FlowX 智能助手"
            @click="chatVisible = true"
          >
            <el-icon :size="18">
              <ChromeFilled />
            </el-icon>
            <span class="ai-btn-text">FlowX</span>
          </button>
          <!-- 用户 -->
          <el-dropdown
            trigger="click"
            @visible-change="(v: boolean) => (userMenuOpen = v)"
          >
            <span class="user-info">
              <el-avatar
                :size="32"
                icon="UserFilled"
              />
              <span class="user-name">{{ auth.currentUser?.nickname || auth.currentUser?.email }}</span>
              <el-icon
                class="user-arrow"
                :class="{ 'is-open': userMenuOpen }"
              ><ArrowDown /></el-icon>
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
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  Monitor,
  House,
  Grid,
  Check,
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
  ChromeFilled,
} from '@element-plus/icons-vue'
import NotificationBell from '@/components/global/NotificationBell.vue'
import ChatPanel from '@/components/ChatPanel.vue'

const chatVisible = ref(false)
const wsPopoverVisible = ref(false)
/** 右上角用户下拉是否展开：用于翻转箭头 */
const userMenuOpen = ref(false)
const wsSelectRef = ref<{ blur: () => void } | null>(null)

// 根据当前路由自动推断 Agent 场景
const agentScenario = computed(() => {
  const path = route.path
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

/**
 * 让 token 里的 workspaceId 始终跟着界面选中的空间走。
 *
 * 登录时后端把「最早的工作空间」签进了 JWT，之后切空间只改路由、不换 token；而 agent
 * 端取 id 的写法是 `user.workspaceId || context.workspaceId`，JWT 优先 —— 不换发 token
 * 的话，切了空间 agent 照样往旧空间里写（数据落库了，用户却永远看不到）。
 * 挂在 wsId 上可覆盖全部入口：侧边栏切换、首页卡片进入、直接改地址栏。
 */
watch(wsId, (id) => {
  if (!id || !auth.isAuthenticated || auth.tokenWorkspaceId === id) return
  auth.switchWorkspace(id).catch(() => {
    // 换发失败不阻断导航；下一轮 wsId 变化时会再试
  })
}, { immediate: true })

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

/** 收拢态弹层里当前工作空间的名字，用于 hover 提示 */
const currentWsName = computed(() => {
  const ws = wsStore.list.find((w) => w.id === sidebarWsValue.value)
  return ws ? ws.name : '选择工作空间'
})

/** 收拢态弹层选择：首页或某个工作空间 */
function onCollapsedWsPick(val: string) {
  wsPopoverVisible.value = false
  if (val === '__home__') {
    router.push('/home')
    return
  }
  switchWorkspace(val)
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
    FormRecycle: [
      { title: '表单管理', to: `/workspace/${wsIdVal}/forms` },
      { title: '回收站' },
    ],
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

// 侧边栏展开/收起时，先关掉可能还开着的下拉与弹层：
// 否则残留的浮层会跟着切换形态，位置错乱
watch(() => app.sidebarCollapsed, () => {
  wsSelectRef.value?.blur()
  wsPopoverVisible.value = false
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
/*
 * FlowX 入口：收起时是个只含 agent 图标的方形，悬停横向展开成矩形并露出品牌字。
 *
 * 这里不能用 el-button：它的内部结构是 <button><span>…</span></button>，宽度被内层
 * span 撑住，`width` 过渡会被内容顶回去，展开是硬跳而非"延长"。
 * 元素仍是原生 <button>，字体依旧走 UA 样式表的 Arial —— 与悬浮窗标题的 brand-flowx 一致。
 */
.ai-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #d0e3f7;
  border-radius: 8px;
  background: #e8f2fc;
  color: #2c3e50;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  overflow: hidden;
  transition: width 0.22s ease, background-color 0.2s ease, border-color 0.2s ease;
}
/* 收起态用 max-width 把品牌字压成 0 宽，展开时再把位置让出来并淡入 */
.ai-btn-text {
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  white-space: nowrap;
  overflow: hidden;
  transition: max-width 0.22s ease, margin-left 0.22s ease, opacity 0.18s ease;
}
.ai-btn:hover,
.ai-btn:focus-visible {
  width: 104px;
  background: #d4e8fa;
  border-color: #b3d8ff;
}
.ai-btn:hover .ai-btn-text,
.ai-btn:focus-visible .ai-btn-text {
  max-width: 64px;
  margin-left: 6px;
  opacity: 1;
}
.ai-btn:active {
  background: #c0dcf7;
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
/* 用户下拉展开时箭头翻转 */
.user-arrow { transition: transform 0.2s; }
.user-arrow.is-open { transform: rotate(180deg); }

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
  padding: 6px 0;
}
/* 与收拢态菜单项同尺寸(48×44 / 8px 圆角)，视觉上对齐成一列 */
.ws-trigger {
  width: 48px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--app-text-regular);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.ws-trigger:hover,
.ws-trigger.is-open {
  background: #f0f4ff;
  color: var(--el-color-primary);
}

/* 收拢态空间弹层 */
.ws-pop-list {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}
.ws-pop-label {
  padding: 0 8px 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--app-text-secondary);
}
.ws-pop-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 14px;
  color: var(--app-text-primary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ws-pop-item:hover {
  background: rgba(128,128,128,0.08);
}
.ws-pop-item.active {
  color: var(--el-color-primary);
  font-weight: 600;
}
.ws-pop-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ws-pop-check {
  flex-shrink: 0;
  font-size: 14px;
}
.ws-pop-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--app-border-light);
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--app-bg-page);
  padding: 20px;
}
</style>
