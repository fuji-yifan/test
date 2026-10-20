import { Prisma } from '@prisma/client'
import { getRequestContext } from './request-context'

/** 需要审计的模型 */
const AUDITED_MODELS = new Set([
  'Form',
  'FormSubmission',
  'ProcessDefinition',
  'ProcessInstance',
  'TaskInstance',
  'WorkspaceMember',
  'WorkspaceInvitation',
  'Role',
  'Template',
])

/** 操作中文映射（仅单条操作，Many 操作直接跳过） */
const actionMap: Record<string, string> = {
  create: '创建',
  update: '修改',
  upsert: '创建/更新',
  delete: '删除',
}

function modelLabel(model: string): string {
  const map: Record<string, string> = {
    Form: '表单',
    FormSubmission: '数据',
    ProcessDefinition: '流程',
    ProcessInstance: '流程',
    TaskInstance: '任务',
    WorkspaceMember: '成员',
  WorkspaceInvitation: '邀请',
    Role: '角色',
    Template: '模板',
  }
  return map[model] || model
}

/** 特定模型的动作覆盖：不再拼接，直接用固定文案 */
const modelActionOverride: Record<string, Partial<Record<string, string>>> = {
  Form: {
    create: '新建表单',
    delete: '删除表单',
  },
  // Form.update 通过 data 字段细分（见下方 detectFormAction）
  ProcessDefinition: {
    create: '新建固有流程',
    update: '修改固有流程',
    delete: '删除固有流程',
  },
  ProcessInstance: {
    create: '发起我的流程',
    update: '撤回我的流程',
    delete: '删除我的流程',
  },
  // TaskInstance.update 根据 data.status 细分（见 buildAction）
  FormSubmission: {
    create: '提交表单数据',
    delete: '删除表单数据',
  },
  WorkspaceMember: {
    create: '邀请成员',
    update: '修改成员角色',
    delete: '移除成员',
  },
  Role: {
    create: '新建角色',
    update: '编辑角色权限',
    delete: '删除角色',
  },
}

function buildAction(prismaAction: string, model: string, args?: any): string {
  // Form.create: 检测 fork（settings.forkedFrom 存在）
  if (model === 'Form' && prismaAction === 'create') {
    if (args?.data?.settings?.forkedFrom) return '复制表单'
  }
  // Form.update: 根据 data 细分
  if (model === 'Form' && prismaAction === 'update') {
    const data = args?.data || {}
    if (data.deletedAt) return '删除表单'
    if (data.publishedAt || (data.publishedVersion && data.status === 'published')) return '发布表单'
    if (data.status === 'archived') return '归档表单'
    return '修改表单'
  }
  // ProcessDefinition.update: 发布/撤回发布（都是改 status）与普通修改区分开
  if (model === 'ProcessDefinition' && prismaAction === 'update') {
    const data = (args as any)?.data || {}
    if (data.status === 'published' && data.publishedAt) return '发布固有流程'
    if (data.status === 'draft' && data.publishedAt === null) return '撤回固有流程'
  }
  // TaskInstance: 根据 data.status 细分
  if (model === 'TaskInstance' && prismaAction === 'update') {
    const data = (args as any)?.data || {}
    if (data.status === 'approved') return '通过审批'
    if (data.status === 'rejected') return '驳回审批'
    if (data.status === 'transferred') {
      return data.transferredFrom ? '超时升级' : '转交审批'
    }
  }
  const override = modelActionOverride[model]?.[prismaAction]
  if (override) return override
  return (actionMap[prismaAction] || prismaAction) + modelLabel(model)
}

/**
 * Prisma 审计中间件工厂
 * 需要注入 PrismaClient 以异步写入审计日志
 */
export function createAuditMiddleware(prisma: any): Prisma.Middleware {
  return async (params, next) => {
    const result = await next(params)

    const model = params.model
    if (!model || !AUDITED_MODELS.has(model)) return result
    if (model === 'AuditLog') return result

    // TaskInstance: 只审计 approve/reject/transfer
    if (model === 'TaskInstance') {
      if (params.action !== 'update') return result
      const st = (params.args as any)?.data?.status
      if (st !== 'approved' && st !== 'rejected' && st !== 'transferred') return result
    }
    // 其他模型：只审计单条操作
    if (model !== 'TaskInstance') {
      const action = actionMap[params.action]
      if (!action) return result
    }

    // 提交数据只读，跳过 update
    if (model === 'FormSubmission' && params.action === 'update') return result
    // ProcessInstance: 只审计 create/delete/撤回
    if (model === 'ProcessInstance' && params.action !== 'create' && params.action !== 'delete' && params.action !== 'update') return result
    if (model === 'ProcessInstance' && params.action === 'update') {
      const data = (params.args as any)?.data || {}
      if (data.currentState !== 'withdrawn') return result
    }

    const ctx = getRequestContext()
    if (!ctx) return result
    // 优先从请求上下文取 workspaceId，其次从 Prisma 操作参数/结果中提取
    let wsId = ctx.workspaceId
      || (params.args as any)?.data?.workspaceId
      || (result as any)?.workspaceId
      || (params.args as any)?.where?.workspaceId
    // 无直接 workspaceId 的模型 — 通过关联链查库
    if (!wsId) {
      try {
        if (model === 'Form') {
          // delete/update 的 result 中包含 workspaceId
          wsId = (result as any)?.workspaceId
            || (params.args as any)?.data?.workspaceId
        } else if (model === 'FormSubmission') {
          const fid = (params.args as any)?.data?.formId || (result as any)?.formId
          if (fid) wsId = (await prisma.form.findUnique({ where: { id: fid }, select: { workspaceId: true } }))?.workspaceId
        } else if (model === 'ProcessInstance') {
          const defId = (params.args as any)?.data?.definitionId || (result as any)?.definitionId
          if (defId) {
            const def = await prisma.processDefinition.findUnique({ where: { id: defId }, select: { workspaceId: true } })
            wsId = def?.workspaceId
          }
        } else if (model === 'TaskInstance') {
          const iid = (params.args as any)?.data?.instanceId
            || (params.args as any)?.where?.instanceId
            || (result as any)?.instanceId
          if (iid) {
            const inst = await prisma.processInstance.findUnique({ where: { id: iid }, select: { definition: { select: { workspaceId: true } } } })
            wsId = inst?.definition?.workspaceId
          }
        }
      } catch { /* ignore */ }
    }
    if (!wsId) return result

    const resourceId = (params.args as any)?.where?.id
      || (result as any)?.id
      || undefined

    const detail = result && typeof result === 'object' && !Array.isArray(result)
      ? { id: (result as any).id }
      : undefined

    prisma.auditLog.create({
      data: {
        workspaceId: wsId,
        userId: ctx.userId || null,
        action: buildAction(params.action, model, params.args),
        resourceType: model,
        resourceId: resourceId ? String(resourceId) : null,
        details: detail || {},
        ip: ctx.ip || null,
      },
    }).catch(() => { /* 审计失败不影响业务 */ })

    return result
  }
}

/** 清理敏感字段（passwordHash 等） */
function sanitizeArgs(args: any): any {
  if (!args || typeof args !== 'object') return args
  const clone = JSON.parse(JSON.stringify(args))
  if (clone.data?.passwordHash) clone.data.passwordHash = '***'
  // JSON 字段可能很大，截断
  if (clone.data?.schema && typeof clone.data.schema === 'object') {
    clone.data.schema = { __truncated: true }
  }
  if (clone.data?.data && typeof clone.data.data === 'object') {
    clone.data.data = { __truncated: true }
  }
  return clone
}
