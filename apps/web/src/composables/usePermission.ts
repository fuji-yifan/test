/**
 * usePermission — 统一权限判断
 *
 * 替代散落在各视图中的权限字符串判断和角色比对。
 *
 * 用法：
 *   const { can, isOwner, isEditor } = usePermission()
 *   <el-button v-if="can('form:create')">新建</el-button>
 *   <el-button v-if="isOwner" @click="deleteAll">销毁</el-button>
 */
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 全部已知权限键（与后端 RBAC 模块保持同步）
 * 前端用 Set 做 O(1) 的有效性校验
 */
const KNOWN_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  'form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'form:delete',
  'submission:view', 'submission:edit', 'submission:delete', 'submission:export',
  'analytics:view',
  'template:create', 'template:edit', 'template:delete',
  'workflow:manage', 'workflow:edit', 'workflow:delete', 'workflow:start', 'workflow:withdraw', 'workflow:remove',
  'task:approve', 'task:reject', 'task:transfer',
  'member:invite', 'member:role', 'member:remove',
  'role:create', 'role:edit', 'role:delete',
  'audit:view', 'audit:export', 'audit:cleanup',
  'webhook:manage', 'upload:manage',
])

export function usePermission() {
  const wsStore = useWorkspaceStore()

  const currentRole = computed(() => wsStore.current?.role)
  const isOwner = computed(() => currentRole.value === 'owner')
  const isEditor = computed(() => currentRole.value === 'editor' || currentRole.value === 'owner')
  const isViewer = computed(() => currentRole.value === 'viewer')

  /** 检查当前用户是否有指定权限 */
  function can(permission: string): boolean {
    if (isOwner.value) return true
    return wsStore.current?.permissions?.includes(permission) ?? false
  }

  /** 检查是否拥有任意一项权限 */
  function canAny(...permissions: string[]): boolean {
    if (isOwner.value) return true
    return permissions.some((p) => wsStore.current?.permissions?.includes(p))
  }

  /** 权限 label 映射（按钮文案、提示语等场景） */
  function permLabel(key: string): string {
    const map: Record<string, string> = {
      'form:create': '新建表单', 'form:edit': '修改表单', 'form:publish': '发布表单',
      'form:archive': '归档表单', 'form:copy': '复制表单', 'form:delete': '删除表单',
      'submission:view': '查看数据', 'submission:edit': '编辑数据',
      'submission:delete': '删除数据', 'submission:export': '导出数据',
      'analytics:view': '查看分析',
      'template:create': '创建模板', 'template:edit': '修改模板', 'template:delete': '删除模板',
      'workflow:manage': '管理流程', 'workflow:edit': '修改流程', 'workflow:delete': '删除流程',
      'workflow:start': '启动流程', 'workflow:withdraw': '撤回流程', 'workflow:remove': '删除实例',
      'task:approve': '审批', 'task:reject': '驳回', 'task:transfer': '转交',
      'member:invite': '邀请成员', 'member:role': '修改角色', 'member:remove': '移除成员',
      'role:create': '新建角色', 'role:edit': '编辑角色', 'role:delete': '删除角色',
      'audit:view': '查看日志', 'audit:export': '导出日志', 'audit:cleanup': '清理日志',
      'webhook:manage': '管理 Webhook', 'upload:manage': '管理文件',
    }
    return map[key] || key
  }

  /** 校验权限 key 是否在已知矩阵中 */
  function isValidKey(key: string): boolean {
    return key === '*' || KNOWN_PERMISSION_KEYS.has(key)
  }

  return { isOwner, isEditor, isViewer, can, canAny, permLabel, isValidKey }
}
