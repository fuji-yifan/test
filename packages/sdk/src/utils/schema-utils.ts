import type { FieldSchema, FormSchema } from '../types'

/**
 * 深度遍历所有字段（包括嵌套的子字段）
 */
export function walkFields(
  fields: FieldSchema[],
  callback: (field: FieldSchema, parent: FieldSchema | null, depth: number) => void,
  parent: FieldSchema | null = null,
  depth = 0,
): void {
  for (const field of fields) {
    callback(field, parent, depth)
    if (field.children && field.children.length > 0) {
      walkFields(field.children, callback, field, depth + 1)
    }
  }
}

/**
 * 根据 ID 查找字段
 */
export function findFieldById(fields: FieldSchema[], id: string): FieldSchema | null {
  for (const field of fields) {
    if (field.id === id) return field
    if (field.children) {
      const found = findFieldById(field.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * 在指定位置插入字段
 */
export function insertFieldAtIndex(
  fields: FieldSchema[],
  parentId: string | null,
  index: number,
  newField: FieldSchema,
): boolean {
  if (parentId === null) {
    fields.splice(index, 0, newField)
    return true
  }
  const parent = findFieldById(fields, parentId)
  if (parent) {
    if (!parent.children) parent.children = []
    parent.children.splice(index, 0, newField)
    return true
  }
  return false
}

/**
 * 根据 ID 移除字段
 */
export function removeFieldById(fields: FieldSchema[], id: string): FieldSchema | null {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].id === id) {
      return fields.splice(i, 1)[0]
    }
    if (fields[i].children) {
      const removed = removeFieldById(fields[i].children!, id)
      if (removed) return removed
    }
  }
  return null
}

/**
 * 判断是否为布局容器（用于跳过渲染控件本体，递归渲染 children）
 */
export function isLayoutField(type: string): boolean {
  return ['card', 'collapse', 'divider'].includes(type)
}

/**
 * 深拷贝 Schema（用于 Undo/Redo 快照）
 */
export function cloneSchema(schema: FormSchema): FormSchema {
  return JSON.parse(JSON.stringify(schema))
}

/**
 * 生成新的字段 ID（UUID v4 简化版）
 */
export function generateFieldId(): string {
  return 'field_' + Math.random().toString(36).substring(2, 10)
}
