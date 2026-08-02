/**
 * @deprecated 撤销/重做已整合到 designer store 中，通过 DesignerEngine.history 管理。
 * 保留此文件作为兼容导出，实际逻辑委托给 useDesignerStore()。
 */

import { computed } from 'vue'
import { useDesignerStore } from './designer'

export const useUndoRedo = () => {
  const designer = useDesignerStore()
  return {
    canUndo: computed(() => designer.canUndo),
    canRedo: computed(() => designer.canRedo),
  }
}
