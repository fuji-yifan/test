import type { FieldSchema, LinkageAction, LinkageRule } from '../types'
import { evaluate } from './expression-eval.js'
import { findFieldByKey } from './schema-utils.js'

export interface LinkageResult {
  fieldId: string
  action: LinkageAction
}

/**
 * 联动规则引擎
 * 根据表单数据变更，计算受影响的联动动作
 *
 * @param fields 表单所有字段（顶层）
 * @param changedKey 发生变化的字段 key
 * @param formData 当前表单数据
 * @returns 需要执行的联动动作列表
 */
export function resolveLinkage(
  fields: FieldSchema[],
  changedKey: string,
  formData: Record<string, any>,
): LinkageResult[] {
  const results: LinkageResult[] = []

  walkLinkages(fields, (field, rule) => {
    // 触发器匹配
    if (rule.trigger !== changedKey) return

    // 条件判断
    if (rule.condition) {
      try {
        const satisfied = evaluate(rule.condition, formData)
        if (!satisfied) return
      } catch (e) {
        console.warn(`[LinkageEngine] 联动条件表达式错误: ${rule.condition}`, e)
        return
      }
    }

    // 查找目标字段
    const targetField = findFieldByKey(fields, rule.target)
    if (!targetField) {
      console.warn(`[LinkageEngine] 联动目标字段 "${rule.target}" 不存在`)
      return
    }

    results.push({
      fieldId: targetField.id,
      action: rule.action,
    })
  })

  return results
}

/**
 * 遍历所有联动规则
 */
function walkLinkages(
  fields: FieldSchema[],
  callback: (field: FieldSchema, rule: LinkageRule) => void,
): void {
  for (const field of fields) {
    if (field.linkage) {
      for (const rule of field.linkage) {
        callback(field, rule)
      }
    }
    if (field.children) {
      walkLinkages(field.children, callback)
    }
  }
}

/**
 * 应用联动动作到表单数据 / 字段 Schema
 * 注意: 这是纯函数，返回新的数据/字段，不修改原对象
 */
export function applyLinkageAction(
  formData: Record<string, any>,
  action: LinkageAction,
  targetKey: string,
): Record<string, any> {
  const newData = { ...formData }

  switch (action.type) {
    case 'setValue':
      newData[targetKey] = action.value
      break
    // setProps / setOptions / setRequired / setDisabled / setHidden
    // 这些需要在实际组件中响应，此处先占位
  }

  return newData
}
