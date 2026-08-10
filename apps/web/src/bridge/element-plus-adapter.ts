/**
 * Element Plus Component Bridge — 将 Schema type 映射到 Element Plus 组件
 *
 * 这是 Component Bridge 在 Element Plus 框架下的具体实现。
 * 如果要切换到 Ant Design Vue / Naive UI：
 *   1. 替换此文件中的 componentMap
 *   2. 替换 FieldRenderer.vue 模板中的 el-* 组件引用
 *   3. SDK 核心和 RendererEngine 逻辑层不受影响
 */

import { componentBridge } from '@furmx/sdk'
import type { ComponentAdapter } from '@furmx/sdk'

// ---- Schema type → Element Plus 组件名映射 ----
export const elComponentMap: Record<string, string> = {
  input: 'el-input',
  textarea: 'el-input',             // type="textarea"
  'input-number': 'el-input-number',
  select: 'el-select',
  radio: 'el-radio-group',
  checkbox: 'el-checkbox-group',
  'date-picker': 'el-date-picker',
  'time-picker': 'el-time-picker',
  'date-time-picker': 'el-date-time-picker',
  switch: 'el-switch',
  rate: 'el-rate',
  slider: 'el-slider',
  'color-picker': 'el-color-picker',
  cascader: 'el-cascader',
  'tree-select': 'el-tree-select',
  upload: 'el-upload',
}

// ---- Layout 控件映射 ----
export const elLayoutComponentMap: Record<string, string> = {
  card: 'el-card',
  collapse: 'el-collapse',
  divider: 'el-divider',
  // grid / flex / group / tab 用自定义 div 布局
}

// ---- 内置控件适配器 ----
const elementPlusAdapters: ComponentAdapter[] = [
  {
    type: 'tip-text', display: '提示文本', icon: 'InfoFilled', category: 'basic',
    defaultProps: { text: '请输入提示文本', color: '#909399', fontSize: 14, textAlign: 'left', tipType: '' },
  },
  {
    type: 'input', display: '文本输入', icon: 'Edit', category: 'basic',
    defaultProps: { placeholder: '', maxLength: 100, clearable: true },
  },
  {
    type: 'textarea', display: '多行文本', icon: 'Document', category: 'basic',
    defaultProps: { rows: 4, maxLength: 500 },
  },
  {
    type: 'input-number', display: '数字输入', icon: 'Operation', category: 'basic',
    defaultProps: { min: 0, precision: 0, step: 1 },
  },
  {
    type: 'select', display: '下拉选择', icon: 'ArrowDown', category: 'basic',
    defaultProps: { options: [], filterable: false, multiple: false },
    mapProps: (props) => { const { options: _, ...rest } = props; return rest },
  },
  {
    type: 'radio', display: '单选框组', icon: 'CircleCheck', category: 'basic',
    defaultProps: { options: [] },
    mapProps: (props) => { const { options: _, ...rest } = props; return rest },
  },
  {
    type: 'checkbox', display: '多选框组', icon: 'Select', category: 'basic',
    defaultProps: { options: [] },
    mapProps: (props) => { const { options: _, ...rest } = props; return rest },
  },
  {
    type: 'date-picker', display: '日期选择', icon: 'Calendar', category: 'basic',
    defaultProps: { format: 'YYYY-MM-DD' },
  },
  {
    type: 'switch', display: '开关', icon: 'Switch', category: 'basic',
    defaultProps: { activeText: '', inactiveText: '' },
  },
  {
    type: 'rate', display: '评分', icon: 'Star', category: 'basic',
    defaultProps: { max: 5 },
  },
  {
    type: 'slider', display: '滑块', icon: 'Histogram', category: 'basic',
    defaultProps: { min: 0, max: 100, step: 1 },
  },

  // 高级控件
  {
    type: 'upload', display: '文件上传', icon: 'Upload', category: 'advanced',
    defaultProps: { accept: '', maxSize: 10, maxCount: 1 },
  },
  {
    type: 'rich-text', display: '富文本', icon: 'EditPen', category: 'advanced',
    defaultProps: { height: 400, placeholder: '请输入内容', maxLength: 200, toolbarMode: 'full' },
  },
  {
    type: 'cascader', display: '级联选择', icon: 'Connection', category: 'advanced',
    defaultProps: { options: [], placeholder: '请选择', templateMode: 'manual' },
  },

  // 布局控件
  { type: 'grid', display: '栅格容器', icon: 'Grid', category: 'layout', isLayout: true, defaultProps: { columns: 2, gutter: 16 } },
  { type: 'card', display: '卡片容器', icon: 'Postcard', category: 'layout', isLayout: true, defaultProps: { header: '', shadow: 'always' } },
  { type: 'collapse', display: '折叠面板', icon: 'Fold', category: 'layout', isLayout: true, defaultProps: { accordion: false } },
  { type: 'group', display: '分组标题', icon: 'Tickets', category: 'layout', isLayout: true, defaultProps: { title: '' } },
  { type: 'divider', display: '分隔线', icon: 'Minus', category: 'layout', isLayout: true, defaultProps: { direction: 'horizontal' } },
  { type: 'flex', display: '弹性容器', icon: 'Rank', category: 'layout', isLayout: true, defaultProps: { direction: 'row', gap: 12 } },
  { type: 'tab', display: '标签页', icon: 'Collection', category: 'layout', isLayout: true, defaultProps: { tabs: [] } },
]

/** 初始化：将所有适配器注册到全局 ComponentBridge */
export function initElementPlusBridge(): void {
  componentBridge.registerBatch(elementPlusAdapters)
}

/** 获取控件的 Element Plus 组件名 */
export function resolveElComponent(type: string): string {
  return elComponentMap[type] || 'el-input'
}

/** 获取布局控件的 Element Plus 组件名 */
export function resolveElLayoutComponent(type: string): string | null {
  return elLayoutComponentMap[type] || null
}
