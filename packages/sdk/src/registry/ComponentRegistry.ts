import type { FieldType, ComponentMeta } from '../types/index.js'

type ComponentConstructor = any // Vue component type (defineComponent return)

interface RegistryEntry {
  meta: ComponentMeta
  component: ComponentConstructor
}

/**
 * 全局组件注册表 — 单例模式
 * 负责管理所有可用的表单控件，支持动态注册第三方控件
 */
export class ComponentRegistry {
  private static instance: ComponentRegistry
  private registry = new Map<string, RegistryEntry>()
  private customRegistries = new Map<string, Map<string, RegistryEntry>>()

  private constructor() {}

  static getInstance(): ComponentRegistry {
    if (!ComponentRegistry.instance) {
      ComponentRegistry.instance = new ComponentRegistry()
    }
    return ComponentRegistry.instance
  }

  /**
   * 注册一个控件
   */
  register(meta: ComponentMeta, component: ComponentConstructor): void {
    if (this.registry.has(meta.type)) {
      console.warn(`[ComponentRegistry] 控件类型 "${meta.type}" 已存在，将被覆盖`)
    }
    this.registry.set(meta.type, { meta, component })
  }

  /**
   * 批量注册
   */
  registerBatch(entries: Array<{ meta: ComponentMeta; component: ComponentConstructor }>): void {
    entries.forEach(({ meta, component }) => this.register(meta, component))
  }

  /**
   * 注册自定义组件（作用域：workspaceId 或 'global'）
   */
  registerCustom(
    scope: string,
    meta: ComponentMeta,
    component: ComponentConstructor,
  ): void {
    if (!this.customRegistries.has(scope)) {
      this.customRegistries.set(scope, new Map())
    }
    this.customRegistries.get(scope)!.set(meta.type, { meta, component })
  }

  /**
   * 获取控件组件
   */
  get(type: FieldType | string, scope?: string): RegistryEntry | undefined {
    // 优先从自定义注册表查找
    if (scope && this.customRegistries.has(scope)) {
      const entry = this.customRegistries.get(scope)!.get(type)
      if (entry) return entry
    }
    // 尝试全局自定义注册表
    if (this.customRegistries.has('global')) {
      const entry = this.customRegistries.get('global')!.get(type)
      if (entry) return entry
    }
    // 查找内置注册表
    return this.registry.get(type)
  }

  /**
   * 获取所有控件元数据（用于组件面板展示）
   */
  getAllMeta(scope?: string): ComponentMeta[] {
    const metaList: ComponentMeta[] = []
    this.registry.forEach((entry) => metaList.push(entry.meta))
    if (scope && this.customRegistries.has(scope)) {
      this.customRegistries.get(scope)!.forEach((entry) => metaList.push(entry.meta))
    }
    return metaList
  }

  /**
   * 按分类获取控件元数据
   */
  getMetaByCategory(category: ComponentMeta['category'], scope?: string): ComponentMeta[] {
    return this.getAllMeta(scope).filter((m) => m.category === category)
  }

  /**
   * 检查控件是否已注册
   */
  has(type: FieldType | string, scope?: string): boolean {
    if (scope && this.customRegistries.has(scope)) {
      if (this.customRegistries.get(scope)!.has(type)) return true
    }
    return this.registry.has(type)
  }

  /**
   * 注销控件
   */
  unregister(type: FieldType | string, scope?: string): void {
    if (scope && this.customRegistries.has(scope)) {
      this.customRegistries.get(scope)!.delete(type)
    } else {
      this.registry.delete(type)
    }
  }

  /**
   * 清空所有（仅测试用）
   */
  clear(): void {
    this.registry.clear()
    this.customRegistries.clear()
  }
}

/** 便捷单例导出 */
export const componentRegistry = ComponentRegistry.getInstance()
