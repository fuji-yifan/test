/**
 * ComponentBridge — 组件桥接层（纯 TypeScript，不依赖具体 UI 框架）
 *
 * 职责：
 * - 将 Schema 中的控件 type 映射到具体的 UI 组件
 * - 属性转换（Schema props → UI 组件 props）
 * - 事件映射（UI 事件 → Engine setValue 调用）
 *
 * 设计意图：
 * - 底层 UI 库（Element Plus / Ant Design / Naive UI）可替换
 * - 只需更换 Adapter 对象，Renderer 核心和引擎逻辑不受影响
 * - 第三方控件通过实现 ComponentAdapter 接口即可注册
 */

export interface ComponentAdapter {
  /** 控件类型标识（对应 Schema 中的 FieldType） */
  type: string

  /** 显示名称 */
  display: string

  /** 图标标识 */
  icon: string

  /** 分类 */
  category: 'basic' | 'advanced' | 'layout' | 'custom'

  /** 默认 Props */
  defaultProps: Record<string, any>

  /**
   * 属性映射函数
   * 输入：FieldSchema.props + defaultProps
   * 输出：直接传给 UI 组件的 props 对象
   */
  mapProps?: (fieldProps: Record<string, any>) => Record<string, any>

  /**
   * 事件映射函数
   * 输入：引擎的 setValue 方法
   * 输出：UI 组件的事件绑定对象
   */
  mapEvents?: (emit: (value: any) => void) => Record<string, Function>

  /** 是否为布局控件 */
  isLayout?: boolean

  /** 属性面板定义 Schema（自身就是一份小表单） */
  configSchema?: any
}

/**
 * 全局 Component Bridge — 管理所有控件适配器
 */
export class ComponentBridge {
  private adapters = new Map<string, ComponentAdapter>()

  /** 注册一个控件适配器 */
  register(adapter: ComponentAdapter): void {
    if (this.adapters.has(adapter.type)) {
      console.warn(`[ComponentBridge] "${adapter.type}" 已注册，将被覆盖`)
    }
    this.adapters.set(adapter.type, adapter)
  }

  /** 批量注册 */
  registerBatch(adapters: ComponentAdapter[]): void {
    adapters.forEach((a) => this.register(a))
  }

  /** 获取适配器 */
  get(type: string): ComponentAdapter | undefined {
    return this.adapters.get(type)
  }

  /** 获取所有适配器元数据（组件面板展示用） */
  getAllMeta(): ComponentAdapter[] {
    return Array.from(this.adapters.values())
  }

  /** 按分类获取 */
  getByCategory(category: ComponentAdapter['category']): ComponentAdapter[] {
    return this.getAllMeta().filter((a) => a.category === category)
  }

  /** 注销 */
  unregister(type: string): void {
    this.adapters.delete(type)
  }

  /** 清空 */
  clear(): void {
    this.adapters.clear()
  }
}

/** 单例 */
export const componentBridge = new ComponentBridge()
