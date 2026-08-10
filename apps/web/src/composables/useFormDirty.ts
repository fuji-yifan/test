/**
 * useFormDirty — 表单脏状态追踪
 *
 * 追踪表单是否有未保存的更改，并可注册浏览器关闭/路由离开拦截。
 *
 * 用法：
 *   const { isDirty, markClean, watchSource } = useFormDirty()
 *   watchSource(schema)  // 监控 schema 变更
 *   <el-button @click="save" :disabled="!isDirty">保存</el-button>
 */
import { ref, watch, onBeforeUnmount, type Ref, type WatchSource } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

export function useFormDirty(initialState = false) {
  const isDirty = ref(initialState)
  const _sources: WatchSource[] = []

  /** 注册一个待追踪的数据源（如 schema、form data） */
  function track(source: WatchSource): void {
    _sources.push(source)
    watch(source, () => {
      isDirty.value = true
    }, { deep: true })
  }

  /** 监听一个 ref 的变化 */
  function watchSource<T>(source: Ref<T> | (() => T)): void {
    const s: WatchSource = typeof source === 'function' ? source : () => source.value
    track(s)
  }

  /** 标记为未修改（保存后调用） */
  function markClean(): void {
    isDirty.value = false
  }

  /** 标记为已修改（手动触发） */
  function markDirty(): void {
    isDirty.value = true
  }

  /**
   * 注册浏览器关闭拦截
   * 若 isDirty 为 true，关闭/刷新时弹出浏览器原生确认框
   */
  function enableUnloadGuard() {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty.value) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    onBeforeUnmount(() => window.removeEventListener('beforeunload', handler))
  }

  /**
   * 注册路由离开拦截（Vue Router）
   * 若 isDirty 为 true，路由跳转前弹出确认
   */
  function enableRouteGuard(message = '你有未保存的更改，确定要离开吗？') {
    onBeforeRouteLeave((_to, _from, next) => {
      if (!isDirty.value) {
        next()
        return
      }
      const answer = window.confirm(message)
      next(answer)
    })
  }

  return { isDirty, markClean, markDirty, watchSource, enableUnloadGuard, enableRouteGuard }
}
