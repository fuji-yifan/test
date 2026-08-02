import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
    meta: { layout: 'default', requiresAuth: true },
    children: [
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

  // ======== 流程实例进度查看 ========
  {
    path: '/instance/:id',
    name: 'InstanceViewer',
    component: () => import('@/views/workflow/InstanceViewer.vue'),
    meta: { layout: 'default', title: '流程进度', requiresAuth: true },
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
    meta: { layout: 'default', title: '我的待办', requiresAuth: true },
  },
  {
    path: '/my-processes',
    name: 'MyProcesses',
    component: () => import('@/views/workflow/MyProcessesView.vue'),
    meta: { layout: 'default', title: '我的流程', requiresAuth: true },
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

router.beforeEach((to, _from, next) => {
  // 设置页面标题
  document.title = (to.meta.title as string) || 'FurmX'

  // 需要登录的页面
  if (to.meta.requiresAuth) {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) {
      return next({ name: 'Login', query: { redirect: to.fullPath } })
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
