import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/client'

export interface Workspace {
  id: string
  name: string
  slug: string
  remark?: string
  logoUrl?: string
  plan: string
  role?: string
  /** RBAC 权限点。注意：服务端 /workspaces 列表目前不返回该字段（见 usePermission 的说明） */
  permissions?: string[]
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const current = ref<Workspace | null>(null)
  const list = ref<Workspace[]>([])

  const currentId = computed(() => current.value?.id || null)

  async function fetchList() {
    const res = await http.get('/workspaces')
    const data = (res as { data?: Workspace[] | { list?: Workspace[] } }).data || res
    list.value = Array.isArray(data) ? data : ((data as { list?: Workspace[] })?.list || []) as Workspace[]
  }

  function setCurrent(ws: Workspace) {
    current.value = ws
    localStorage.setItem('current_workspace_id', ws.id)
  }

  function getCurrentId(): string | null {
    return current.value?.id || localStorage.getItem('current_workspace_id')
  }

  return { current, list, currentId, fetchList, setCurrent, getCurrentId }
})
