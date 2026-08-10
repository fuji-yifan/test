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
 * 根据 key 查找字段
 */
export function findFieldByKey(fields: FieldSchema[], key: string): FieldSchema | null {
  for (const field of fields) {
    if (field.key === key) return field
    if (field.children) {
      const found = findFieldByKey(field.children, key)
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
 * 将嵌套字段平铺为一维 Map
 */
export function flattenFields(fields: FieldSchema[]): Map<string, FieldSchema> {
  const map = new Map<string, FieldSchema>()
  walkFields(fields, (field) => {
    map.set(field.id, field)
  })
  return map
}

/**
 * 根据 key 平铺字段 Map（用于数据收集时快速查找）
 */
export function flattenFieldsByKey(fields: FieldSchema[]): Map<string, FieldSchema> {
  const map = new Map<string, FieldSchema>()
  walkFields(fields, (field) => {
    if (field.key && !isLayoutField(field.type)) {
      map.set(field.key, field)
    }
  })
  return map
}

/**
 * 判断是否为布局容器（用于跳过渲染控件本体，递归渲染 children）
 */
export function isLayoutField(type: string): boolean {
  return ['card', 'collapse', 'divider'].includes(type)
}

/**
 * 判断是否为叶子容器（不可再嵌套子布局，只能放基础控件）
 */
export function isLeafContainer(type: string): boolean {
  return false // 当前无叶子容器限制
}

/**
 * 计算一行内已使用的列数
 */
export function getRowUsedColumns(fields: FieldSchema[]): number {
  return fields.reduce((sum, f) => sum + (f.col || 12), 0)
}

/**
 * 判断新控件能否放入当前行
 * @param currentRowCols 当前行已占用列数
 * @param newFieldCol 新控件的栅格宽度
 * @param maxCols 总列数（默认 24）
 */
export function canFitInRow(currentRowCols: number, newFieldCol: number, maxCols = 24): boolean {
  return (currentRowCols + newFieldCol) <= maxCols
}

/**
 * 将顶层字段按 24 列栅格自动分行
 * 返回二维数组，每个子数组代表一行
 */
export function layoutGridRows(fields: FieldSchema[], maxCols = 24): FieldSchema[][] {
  const rows: FieldSchema[][] = []
  let currentRow: FieldSchema[] = []
  let usedCols = 0

  for (const field of fields) {
    const col = field.col || 12

    // 24 列控件独占一行
    if (col >= maxCols) {
      if (currentRow.length > 0) {
        rows.push(currentRow)
        currentRow = []
        usedCols = 0
      }
      rows.push([field])
      continue
    }

    // 当前行放不下，换行
    if (!canFitInRow(usedCols, col, maxCols)) {
      rows.push(currentRow)
      currentRow = []
      usedCols = 0
    }

    currentRow.push(field)
    usedCols += col
  }

  // 最后一行
  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  return rows
}

/**
 * 提取表单 Schema 中所有字段 key 的列表
 */
export function extractFieldKeys(fields: FieldSchema[]): string[] {
  const keys: string[] = []
  walkFields(fields, (field) => {
    if (field.key && !isLayoutField(field.type)) {
      keys.push(field.key)
    }
  })
  return keys
}

/**
 * 根据字段 key 生成表单数据的默认值对象
 */
export function generateDefaultValues(fields: FieldSchema[]): Record<string, any> {
  const data: Record<string, any> = {}
  walkFields(fields, (field) => {
    if (field.key && !isLayoutField(field.type)) {
      data[field.key] = field.defaultValue ?? null
    }
  })
  return data
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
