/**
 * useConfirmAction — 确认 + 执行 + 反馈三合一
 *
 * 封装"弹确认框 → 调 API → 成功提示 → 可选回调"这个项目中反复出现的流程。
 *
 * 用法：
 *   const { confirm } = useConfirmAction()
 *   await confirm({
 *     action: () => http.delete(`/forms/${id}`),
 *     title: '删除表单',
 *     message: '确定删除？删除后不可恢复。',
 *     successMsg: '已删除',
 *     onSuccess: () => fetchList(),
 *   })
 */
import { ElMessage, ElMessageBox } from 'element-plus'

interface ConfirmOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  type?: 'warning' | 'info' | 'error'
  successMsg?: string
}

export function useConfirmAction() {
  const defaultMessages: ConfirmOptions = {
    confirmText: '确定',
    cancelText: '取消',
    type: 'warning',
  }

  /** 弹出确认框，确认后执行 action */
  async function confirm<T = unknown>(
    action: () => Promise<T>,
    opts: ConfirmOptions = {},
    onSuccess?: (result: T) => void,
  ): Promise<void> {
    const {
      title = '确认操作',
      message = '确定要执行此操作吗？',
      confirmText = '确定',
      cancelText = '取消',
      type = 'warning',
      successMsg,
    } = { ...defaultMessages, ...opts }

    try {
      await ElMessageBox.confirm(message, title, {
        confirmButtonText: confirmText,
        cancelButtonText: cancelText,
        type,
      })
      const result = await action()
      ElMessage.success(successMsg || '操作成功')
      if (onSuccess) onSuccess(result)
    } catch (e: unknown) {
      // 用户取消 — ElMessageBox 会 reject，不显示错误
      if (e === 'cancel' || e === 'close' || (e instanceof Error && (e as { __handled?: boolean }).__handled)) {
        return
      }
      // API 失败 — 显示后端错误
      const msg = (e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
        || (e as { message?: string }).message
        || '操作失败'
      ElMessage.error(msg)
    }
  }

  return { confirm }
}
