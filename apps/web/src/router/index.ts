import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'

// ---- 路由表 ----

const routes: RouteRecordRaw[] = [
  // ======== 认证 ========
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { layout: 'blank', title: '登录' },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { layout: 'blank', title: '注册' },
  },

  // ======== 工作台 ========
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'Home',
    component: () => import('@/views/home/HomeView.vue'),
    meta: { layout: 'default', title: '工作台', requiresAuth: true },
  },

  // ======== 个人信息 ========
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/auth/ProfileView.vue'),
    meta: { layout: 'default', title: '个人信息', requiresAuth: true },
  },

  // ======== 工作空间 ========
  {
    path: '/workspaces',
    name: 'Workspaces',
    component: () => import('@/views/admin/WorkspaceList.vue'),
    meta: { layout: 'default', title: '工作空间', requiresAuth: true },
  },

  // ======== 工作空间内页面 ========
  {
    path: '/workspace/:wsId',
    meta: { layout: 'default', requiresAuth: true, requiresWorkspace: true },
    children: [
      // 工作空间首页
      {
        path: 'home',
        name: 'WorkspaceHome',
        component: () => import('@/views/home/WorkspaceHomeView.vue'),
        meta: { title: '工作台' },
      },
      // 模板设计器（独立于表单，用 templateId query 传参）
      {
        path: 'template-designer',
        name: 'TemplateDesigner',
        component: () => import('@/views/designer/DesignerView.vue'),
        meta: { title: '模板视图编辑' },
      },

      // 表单管理
      {
        path: 'forms',
        meta: { title: '表单管理' },
        children: [
          {
            path: '',
            name: 'FormList',
            component: () => import('@/views/admin/FormListView.vue'),
          },
          {
            path: 'recycle',
            name: 'FormRecycle',
            component: () => import('@/views/admin/RecycleBinView.vue'),
            meta: { title: '回收站' },
          },
          {
            path: ':formId/designer',
            name: 'FormDesigner',
            component: () => import('@/views/designer/DesignerView.vue'),
            meta: { title: '表单设计器' },
          },
          {
            path: ':formId/settings',
            name: 'FormSettings',
            component: () => import('@/views/admin/FormSettingsView.vue'),
            meta: { title: '表单设置' },
          },
          {
            path: ':formId/data',
            name: 'FormData',
            component: () => import('@/views/admin/DataListView.vue'),
            meta: { title: '提交数据' },
          },
          {
            path: ':formId/data/:submissionId',
            name: 'SubmissionDetail',
            component: () => import('@/views/admin/SubmissionDetailView.vue'),
            meta: { title: '数据详情' },
          },
        ],
      },

      // 模板
      {
        path: 'templates',
        name: 'Templates',
        component: () => import('@/views/admin/TemplateView.vue'),
        meta: { title: '模板市场' },
      },

      // 分析
      {
        path: 'analytics',
        name: 'Analytics',
        component: () => import('@/views/admin/AnalyticsView.vue'),
        meta: { title: '数据分析' },
      },

      // 管理
      {
        path: 'members',
        name: 'Members',
        component: () => import('@/views/admin/MemberManage.vue'),
        meta: { title: '成员管理' },
      },
      {
        path: 'roles',
        name: 'Roles',
        component: () => import('@/views/admin/RoleManage.vue'),
        meta: { title: '角色权限' },
      },
      {
        path: 'audit-logs',
        name: 'AuditLogs',
        component: () => import('@/views/admin/AuditLog.vue'),
        meta: { title: '审计日志' },
      },

      // 流程管理
      {
        path: 'workflows',
        name: 'ProcessList',
        component: () => import('@/views/workflow/ProcessListView.vue'),
        meta: { title: '流程管理' },
      },
      {
        path: 'workflows/:wfId/designer',
        name: 'ProcessDesigner',
        component: () => import('@/views/workflow/ProcessDesigner.vue'),
        meta: { title: '流程设计器' },
      },
    ],
  },

  // ======== 通知 ========
  {
    path: '/notifications',
    name: 'Notifications',
    component: () => import('@/views/NotificationListView.vue'),
    meta: { layout: 'default', title: '消息通知', requiresAuth: true },
  },

  // ======== 我的待办 / 我的流程 ========
  {
    path: '/my-tasks',
    name: 'MyTasks',
    component: () => import('@/views/workflow/TaskListView.vue'),
    meta: { layout: 'default', title: '我的待办', requiresAuth: true, requiresWorkspace: true },
  },
  {
    path: '/my-processes',
    name: 'MyProcesses',
    component: () => import('@/views/workflow/MyProcessesView.vue'),
    meta: { layout: 'default', title: '我的流程', requiresAuth: true, requiresWorkspace: true },
  },

  // ======== 预览页（前端渲染，无需保存） ========
  {
    path: '/preview',
    name: 'Preview',
    component: () => import('@/views/renderer/PreviewOnly.vue'),
    meta: { layout: 'render', title: '预览' },
  },

  // ======== 公开填写页 ========
  {
    path: '/f/:formId',
    name: 'PublicForm',
    component: () => import('@/views/renderer/PublicFormView.vue'),
    meta: { layout: 'render', title: '表单填写' },
  },
  {
    path: '/f/:formId/success',
    name: 'SubmitSuccess',
    component: () => import('@/views/renderer/SubmitSuccess.vue'),
    meta: { layout: 'render', title: '提交成功' },
  },

  // ======== 错误页 ========
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/error/403View.vue'),
    meta: { layout: 'blank', title: '无权限' },
  },
  {
    path: '/404',
    name: 'NotFound',
    component: () => import('@/views/error/404View.vue'),
    meta: { layout: 'blank', title: '页面不存在' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404',
  },
]

// ---- 路由实例 ----

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// ---- 全局前置守卫 ----

router.beforeEach(async (to, _from, next) => {
  // 设置页面标题
  document.title = (to.meta.title as string) || 'FurmX'

  // 需要登录的页面
  if (to.meta.requiresAuth) {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) {
      return next({ name: 'Login', query: { redirect: to.fullPath } })
    }

    // 需要工作空间的页面：无工作空间时退回工作台并弹窗提示
    if (to.meta.requiresWorkspace) {
      const wsStore = useWorkspaceStore()
      if (wsStore.list.length === 0) {
        await wsStore.fetchList()
      }
      if (wsStore.list.length === 0) {
        next({ name: 'Home', replace: true })
        // 动态导入避免循环依赖
        const { ElMessageBox } = await import('element-plus')
        ElMessageBox.alert('请先创建并选择一个工作空间，即可访问全部功能模块。', '无可用工作空间', {
          confirmButtonText: '知道了',
          type: 'warning',
        })
        return
      }

      // 地址栏里的 :wsId 必须是一个当前可用（未删除）的空间。否则（旧书签/历史记录
      // 指向已删除空间）页面照常渲染，聊天面板会把每轮请求绑到墓碑空间上，
      // 数据写进去用户却永远看不到。换到第一个可用空间，子路由原样保留。
      const wsId = to.params.wsId as string | undefined
      if (wsId && !wsStore.list.some((w) => w.id === wsId)) {
        // 换掉 path 里的 wsId 段，子路由原样保留（不依赖子路由有 name）
        return next({
          path: to.path.replace(`/workspace/${wsId}`, `/workspace/${wsStore.list[0].id}`),
          query: to.query,
          hash: to.hash,
          replace: true,
        })
      }
    }
  }

  // 已登录用户访问登录页 → 跳工作台
  if (to.name === 'Login') {
    const auth = useAuthStore()
    if (auth.isAuthenticated) {
      return next({ name: 'Home' })
    }
  }

  next()
})

export default router
