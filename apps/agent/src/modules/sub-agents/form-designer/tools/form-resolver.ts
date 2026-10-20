import { ContextService } from '../../../context/context.service'

/**
 * 把「编排层注入的 formId / 模型给的 target」解析成一张**真实存在**的表单。
 *
 * 为什么工具里还要查一次：
 * - 删除 / 回滚 / 删版本是破坏性操作，不能拿模型编造的 id 直接打 server；
 * - 用户点名的表常常**不在本会话**（以前保存的），而编排层只按会话工作台注入 id，
 *   于是 target 只能是表名 —— 这里按名称在当前工作空间里解析真实 id。
 *
 * 目标顺序：formId（或看起来像 uuid 的 target）先向 server 校验；不存在且有表名时
 * 再按名称查一次。只在找到**唯一精确匹配**时返回，绝不猜、绝不误伤重名表。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 会话工作台里的短 key（f1/f2…）：没保存过的表拿不到 formId，也没法按名字查到 */
const WORKSHEET_KEY_RE = /^f\d+$/

export interface ResolvedForm {
  formId?: string
  formName?: string
  failure?: {
    ok: false
    error: string
    summary: string
    /** form_ambiguous 时的候选真实表单（供编排层弹消歧卡） */
    candidates?: Array<{ formId: string; formName: string }>
  }
}

export interface ResolveFormOptions {
  /** 失败文案里的动作词，如「删除」「回滚」 */
  action?: string
  /** 省略时用该默认文案（如回滚工具原有的「没有可回滚的版本」） */
  noTargetSummary?: string
}

export async function resolveExistingForm(
  ctx: ContextService,
  token: string,
  workspaceId: string | undefined,
  formIdRaw: string | undefined,
  targetRaw: string | undefined,
  opts: ResolveFormOptions = {},
): Promise<ResolvedForm> {
  const action = opts.action || '操作'
  const formId = (formIdRaw || '').trim()
  const target = (targetRaw || '').trim()
  const candidateId = formId || (UUID_RE.test(target) ? target : '')

  if (candidateId) {
    try {
      const form = await ctx.getForm(token, candidateId)
      if (form?.workspaceId && workspaceId && form.workspaceId !== workspaceId) {
        return {
          failure: { ok: false, error: 'form_workspace_mismatch', summary: '该表单不属于当前工作空间，无法操作。' },
        }
      }
      return { formId: form?.id || candidateId, formName: form?.name || (target || undefined) }
    } catch (e: any) {
      if (e?.status !== 404) {
        return {
          failure: { ok: false, error: 'form_lookup_failed', summary: `读取表单失败：${e?.message || '未知错误'}` },
        }
      }
      if (!target) {
        return {
          failure: {
            ok: false,
            error: 'form_not_found',
            summary: `当前空间里没有 id 为「${candidateId}」的表单，可能已被删除。`,
          },
        }
      }
      if (WORKSHEET_KEY_RE.test(target)) {
        return {
          failure: {
            ok: false,
            error: 'form_not_found',
            summary: '这张表可能已被删除，或还没保存过，无法执行该操作。',
          },
        }
      }
      // 404 但有表名：继续按名称解析（模型可能把旧 id 和正确表名一起给了）
    }
  }

  if (!target) {
    return {
      failure: {
        ok: false,
        error: 'no_form_id',
        summary: opts.noTargetSummary || `没有确定要${action}的表单。请先说明是哪张已保存的表。`,
      },
    }
  }
  // 会话里刚拼好、还没保存的表：没有 formId，工作空间里也查不到
  if (WORKSHEET_KEY_RE.test(target)) {
    return {
      failure: {
        ok: false,
        error: 'form_not_saved',
        summary: '这张表还没有保存过，无法执行该操作。请先保存后再试。',
      },
    }
  }
  if (!workspaceId) {
    return {
      failure: { ok: false, error: 'no_workspace', summary: '无法确定当前工作空间，暂时不能按名称查找表单。' },
    }
  }

  let list: any[] = []
  try {
    const res = await ctx.listForms(token, workspaceId, { pageSize: 200, keyword: target })
    list = Array.isArray(res) ? res : Array.isArray(res?.list) ? res.list : []
  } catch (e: any) {
    return {
      failure: { ok: false, error: 'form_lookup_failed', summary: `查找表单失败：${e?.message || '未知错误'}` },
    }
  }

  const normalized = normalizeName(target)
  const matches = list.filter((f) => f && !f.deletedAt && normalizeName(f.name) === normalized)
  if (matches.length === 0) {
    return {
      failure: {
        ok: false,
        error: 'form_not_found',
        summary: `当前空间里没有名为「${target}」的表单，请核对名称。`,
      },
    }
  }
  if (matches.length > 1) {
    const options = matches.map((f) => `${f.name}（${f.id}）`).join('、')
    return {
      failure: {
        ok: false,
        error: 'form_ambiguous',
        summary: `当前空间里有多张名为「${target}」的表单：${options}。请指明要${action}哪一张。`,
        candidates: matches.map((f) => ({ formId: f.id, formName: f.name || target })),
      },
    }
  }
  return { formId: matches[0].id, formName: matches[0].name || target }
}

/** 名称比对前去掉空白与常见书名号/引号 */
function normalizeName(name: string): string {
  return (name || '').replace(/[\s「」『』"'“”]/g, '')
}
