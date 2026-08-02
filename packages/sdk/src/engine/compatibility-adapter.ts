/**
 * CompatibilityAdapter — Schema 版本兼容适配器
 *
 * 核心职责：当表单改版（V1 → V2），用新 Schema 渲染旧数据时的兼容策略。
 *
 * 三条兼容规则：
 * 1. 新增字段 → defaultValue 填充 + 警告
 * 2. 删除字段 → 数据保留在 JSON 中，渲染时跳过（不丢数据）
 * 3. 类型变更 → 尝试转换，失败保留原值 + 类型不匹配警告
 */

import type { FieldSchema, FormSchema } from '../types/index.js'
import { walkFields, isLayoutField, flattenFieldsByKey } from '../utils/schema-utils.js'

// ==================== 类型定义 ====================

export interface CompatibilityWarning {
  type: 'FIELD_NOT_FOUND' | 'DEFAULT_VALUE_USED' | 'TYPE_MISMATCH'
  key: string
  message: string
  detail?: string
}

export interface AdaptedData {
  /** 适配后可直接用于渲染的数据 */
  resolved: Record<string, any>
  /** 兼容性警告列表（UI 可据此向用户展示提示） */
  warnings: CompatibilityWarning[]
}

// ==================== CompatibilityAdapter ====================

export class CompatibilityAdapter {
  /**
   * 将旧版本数据适配到目标 Schema
   *
   * @param data 旧版本提交的原始数据
   * @param dataVersion 数据提交时的 Schema 版本号
   * @param currentSchema 当前 Schema（可能已改版）
   * @returns 适配后的数据 + 警告
   */
  adapt(data: Record<string, any>, currentSchema: FormSchema): AdaptedData {
    const warnings: CompatibilityWarning[] = []
    const resolved: Record<string, any> = {}
    const dataKeys = new Set(Object.keys(data))

    // 构建当前 Schema 的字段 map
    const currentFields = flattenFieldsByKey(currentSchema.fields)

    // 遍历当前 Schema 的所有字段
    walkFields(currentSchema.fields, (field) => {
      if (!field.key || isLayoutField(field.type)) return

      if (dataKeys.has(field.key)) {
        // 字段存在于旧数据中
        const oldValue = data[field.key]
        // 类型兼容检查
        const adapted = this._coerceType(oldValue, field)
        resolved[field.key] = adapted.value
        dataKeys.delete(field.key)

        if (adapted.warning) {
          warnings.push(adapted.warning)
        }
      } else {
        // 字段在旧数据中不存在（新增字段）
        resolved[field.key] = field.defaultValue ?? null
        warnings.push({
          type: 'DEFAULT_VALUE_USED',
          key: field.key,
          message: `字段 "${field.name || field.key}" 使用了默认值（旧数据中不存在此字段）`,
        })
      }
    })

    // 旧数据中存在但新 Schema 中已删除的字段 → 保留在 resolved 中但不渲染
    for (const leftoverKey of dataKeys) {
      resolved[leftoverKey] = data[leftoverKey]
      warnings.push({
        type: 'FIELD_NOT_FOUND',
        key: leftoverKey,
        message: `字段 "${leftoverKey}" 在当前 Schema 中不存在，数据已保留但不显示`,
      })
    }

    return { resolved, warnings }
  }

  /**
   * 检查两个版本是否存在破坏性变更
   */
  checkBreakingChanges(oldSchema: FormSchema, newSchema: FormSchema): CompatibilityWarning[] {
    const warnings: CompatibilityWarning[] = []
    const oldFields = flattenFieldsByKey(oldSchema.fields)
    const newFields = flattenFieldsByKey(newSchema.fields)

    // 检查被删除的必填字段
    oldFields.forEach((oldField, key) => {
      if (!oldField.key || isLayoutField(oldField.type)) return
      if (!newFields.has(key)) {
        warnings.push({
          type: 'FIELD_NOT_FOUND',
          key,
          message: `字段 "${oldField.name || key}" 在 V${oldSchema.version} 中存在但新版中已删除`,
        })
      }
    })

    // 检查新增的字段
    newFields.forEach((newField, key) => {
      if (!newField.key || isLayoutField(newField.type)) return
      if (!oldFields.has(key)) {
        warnings.push({
          type: 'DEFAULT_VALUE_USED',
          key,
          message: `新增字段 "${newField.name || key}"，旧数据将使用默认值`,
        })
      }
    })

    return warnings
  }

  // ---- 私有方法 ----

  private _coerceType(oldValue: any, field: FieldSchema): { value: any; warning?: CompatibilityWarning } {
    const expectedType = this._getExpectedType(field)

    // null/undefined → 保持
    if (oldValue === null || oldValue === undefined) {
      return { value: oldValue }
    }

    const actualType = typeof oldValue

    // 类型匹配 → 直接返回
    if (actualType === expectedType) {
      return { value: oldValue }
    }

    // 尝试转换
    if (expectedType === 'string') {
      return {
        value: String(oldValue),
        warning: {
          type: 'TYPE_MISMATCH',
          key: field.key,
          message: `字段 "${field.name}" 期望 string，实际为 ${actualType}，已自动转换`,
          detail: `原始值: ${JSON.stringify(oldValue)}`,
        },
      }
    }

    if (expectedType === 'number') {
      const num = Number(oldValue)
      return {
        value: isNaN(num) ? oldValue : num,
        warning: isNaN(num) ? {
          type: 'TYPE_MISMATCH',
          key: field.key,
          message: `字段 "${field.name}" 期望 number，无法转换，保留原值`,
        } : undefined,
      }
    }

    // 无法转换 → 保留原值
    return { value: oldValue }
  }

  private _getExpectedType(field: FieldSchema): string {
    switch (field.type) {
      case 'input':
      case 'textarea':
      case 'rich-text':
      case 'color-picker':
        return 'string'
      case 'input-number':
      case 'rate':
      case 'slider':
        return 'number'
      case 'switch':
        return 'boolean'
      case 'checkbox':
        return 'object' // array
      default:
        return 'string'
    }
  }
}
