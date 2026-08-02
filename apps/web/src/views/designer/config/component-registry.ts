import type { ComponentMeta } from '@furmx/sdk'

/**
 * 内置控件注册表（元数据）
 * 每个控件的默认属性和分类定义
 */
export const builtinComponents: ComponentMeta[] = [
  // ======== 基础控件 ========
  { type: 'tip-text', display: '提示文本', icon: 'InfoFilled', category: 'basic', defaultProps: { text: '请输入提示文本', color: '#909399', fontSize: 14, textAlign: 'left', tipType: '' } },
  { type: 'input', display: '文本输入', icon: 'Edit', category: 'basic', defaultProps: { placeholder: '', maxLength: 100, clearable: true } },
  { type: 'textarea', display: '多行文本', icon: 'Document', category: 'basic', defaultProps: { rows: 4, maxLength: 500 } },
  { type: 'input-number', display: '数字输入', icon: 'Operation', category: 'basic', defaultProps: { min: 0, precision: 0, step: 1 } },
  { type: 'select', display: '下拉选择', icon: 'ArrowDown', category: 'basic', defaultProps: { options: [], filterable: false, multiple: false, placeholder: '请选择' } },
  { type: 'radio', display: '单选框组', icon: 'CircleCheck', category: 'basic', defaultProps: { options: [] } },
  { type: 'checkbox', display: '多选框组', icon: 'Select', category: 'basic', defaultProps: { options: [] } },
  { type: 'date-picker', display: '日期选择', icon: 'Calendar', category: 'basic', defaultProps: { format: 'YYYY-MM-DD' } },
  { type: 'switch', display: '开关', icon: 'Switch', category: 'basic', defaultProps: { activeText: '', inactiveText: '' } },
  { type: 'rate', display: '评分', icon: 'Star', category: 'basic', defaultProps: { max: 5 } },
  { type: 'slider', display: '滑块', icon: 'Histogram', category: 'basic', defaultProps: { min: 0, max: 100, step: 1 } },

  // ======== 高级控件 ========
  { type: 'upload', display: '文件上传', icon: 'Upload', category: 'advanced', defaultProps: { accept: '', maxSize: 10, maxCount: 1 } },
  { type: 'rich-text', display: '富文本', icon: 'EditPen', category: 'advanced', defaultProps: { height: 400, placeholder: '请输入内容', maxLength: 200, toolbarMode: 'full' } },
  { type: 'cascader', display: '级联选择', icon: 'Connection', category: 'advanced', defaultProps: { options: [], placeholder: '请选择', templateMode: 'manual' } },

]

export function getComponentsByCategory(category: ComponentMeta['category']): ComponentMeta[] {
  return builtinComponents.filter((c) => c.category === category)
}
