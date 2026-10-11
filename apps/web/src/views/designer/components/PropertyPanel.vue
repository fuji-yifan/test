<template>
  <div class="property-panel">
    <!-- ====== 导航切换 ====== -->
    <div class="panel-nav">
      <span
        :class="['nav-item', { active: panelMode === 'form' }]"
        @click="switchToForm"
      >界面设置</span>
      <span
        :class="['nav-item', { active: panelMode === 'field' }]"
        @click="switchToField"
      >控件属性</span>
    </div>

    <!-- ====== 控件属性 ====== -->
    <template v-if="panelMode === 'field' && selectedField">
      <h4 class="panel-title">
        {{ displayName }}
      </h4>

      <el-form
        label-position="top"
        size="small"
        class="prop-form"
      >
        <!-- 基础必选项 -->
        <el-form-item
          v-if="selectedField?.type !== 'tip-text'"
          label="标签名称"
        >
          <el-input
            :model-value="labelNameText"
            @input="onLabelNameInput"
          >
            <template #suffix>
              <span
                v-if="labelNameText.length > 6"
                class="name-overflow"
              >-{{ labelNameText.length - 6 }}</span>
            </template>
          </el-input>
          <div
            v-if="!labelNameText.trim()"
            class="placeholder-warning"
          >
            标签名称不可为空
          </div>
          <div
            v-else-if="showLabelNameWarning"
            class="placeholder-warning"
          >
            名称过长可能会造成部分文字缺失
            <span
              class="placeholder-warning-close"
              @click="dismissLabelNameWarning"
            >×</span>
          </div>
        </el-form-item>

        <el-form-item
          v-if="hasPlaceholder"
          label="占位文本"
        >
          <el-input
            :model-value="placeholderText"
            @input="onPlaceholderInput"
          />
          <div
            v-if="showPlaceholderWarning"
            class="placeholder-warning"
          >
            文本过长可能会造成部分文字缺失
            <span
              class="placeholder-warning-close"
              @click="dismissPlaceholderWarning"
            >×</span>
          </div>
        </el-form-item>

        <!-- 栅格宽度 -->
        <el-form-item
          v-if="selectedField?.type !== 'rate' && selectedField?.type !== 'switch'"
          label="栅格列宽"
        >
          <el-slider
            v-model="fieldMeta.col"
            :min="minCol"
            :max="maxCol"
            :step="1"
            @update:model-value="updateMeta"
          />
        </el-form-item>

        <!-- 尺寸 -->
        <el-form-item label="尺寸">
          <el-select
            :model-value="fieldMeta.size"
            clearable
            placeholder="继承表单设置"
            @update:model-value="(v: string) => { fieldMeta.size = v; updateMeta() }"
          >
            <el-option
              label="继承表单"
              value=""
            />
            <el-option
              label="小"
              value="small"
            />
            <el-option
              label="默认"
              value="default"
            />
            <el-option
              label="大"
              value="large"
            />
          </el-select>
        </el-form-item>

        <!-- 类型特定属性 -->
        <el-divider />

        <!-- input-number: 显示样式 + 数值参数 -->
        <template v-if="selectedField.type === 'input-number'">
          <el-form-item label="显示样式">
            <el-select
              :model-value="selectedField.props?.numberStyle || 'default'"
              @update:model-value="(v: string) => updateProp('numberStyle', v)"
            >
              <el-option
                label="计数器"
                value="default"
              />
              <el-option
                label="步进器"
                value="stepper"
              />
              <el-option
                label="输入框"
                value="input"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="最小值">
            <el-input-number
              v-model="propsProxy.min"
              :min="0"
              @change="(v: any) => updateProp('min', v)"
            />
          </el-form-item>
          <el-form-item label="最大值">
            <el-input-number
              :model-value="propsProxy.max ?? 100"
              @update:model-value="(v: any) => updateProp('max', v)"
            />
          </el-form-item>
          <el-form-item
            v-if="selectedField.props?.numberStyle !== 'input'"
            label="步长"
          >
            <el-input-number
              v-model="propsProxy.step"
              :min="0"
              @change="(v: any) => updateProp('step', v)"
            />
          </el-form-item>
          <el-form-item label="小数位">
            <el-input-number
              v-model="propsProxy.precision"
              :min="0"
              :max="10"
              @change="(v: any) => updateProp('precision', v)"
            />
          </el-form-item>
        </template>

        <!-- select: 可搜索 / 多选 / 选项 -->
        <template v-if="selectedField.type === 'select'">
          <el-form-item label="可搜索">
            <el-switch
              :model-value="selectedField.props?.filterable"
              @update:model-value="(v: boolean) => updateProp('filterable', v)"
            />
          </el-form-item>
          <el-form-item label="多选">
            <el-switch
              :model-value="selectedField.props?.multiple"
              @update:model-value="(v: boolean) => updateProp('multiple', v)"
            />
          </el-form-item>
          <el-form-item label="选项列表">
            <div
              v-for="(opt, i) in selectOptions"
              :key="i"
              class="option-row"
            >
              <el-input
                v-model="opt.label"
                size="small"
                placeholder="选项文本"
                @input="(v: string) => { opt.value = v; markOptionsDirty() }"
              />
              <el-button
                size="small"
                text
                type="danger"
                @click="removeOption(i)"
              >
                ×
              </el-button>
            </div>
            <el-button
              size="small"
              style="margin-top:4px"
              @click="addOption"
            >
              + 添加选项
            </el-button>
          </el-form-item>
        </template>

        <!-- radio / checkbox: 选项 -->
        <template v-if="selectedField.type === 'radio' || selectedField.type === 'checkbox'">
          <el-form-item label="选项列表">
            <div
              v-for="(opt, i) in selectOptions"
              :key="i"
              class="option-row"
            >
              <el-input
                v-model="opt.label"
                size="small"
                placeholder="选项文本"
                @input="(v: string) => { opt.value = v; markOptionsDirty() }"
              />
              <el-button
                size="small"
                text
                type="danger"
                @click="removeOption(i)"
              >
                ×
              </el-button>
            </div>
            <el-button
              size="small"
              style="margin-top:4px"
              @click="addOption"
            >
              + 添加选项
            </el-button>
          </el-form-item>
        </template>

        <!-- textarea: 行数 -->
        <template v-if="selectedField.type === 'textarea'">
          <el-form-item label="行数">
            <el-input-number
              v-model="propsProxy.rows"
              :min="1"
              :max="20"
              @change="(v: any) => updateProp('rows', v)"
            />
          </el-form-item>
        </template>

        <!-- input: 可清除 -->
        <template v-if="selectedField.type === 'input'">
          <el-form-item label="可清除">
            <el-switch
              :model-value="selectedField.props?.clearable !== false"
              @update:model-value="(v: boolean) => updateProp('clearable', v)"
            />
          </el-form-item>
        </template>

        <!-- date-picker / date-range-picker: 格式 -->
        <template v-if="selectedField.type === 'date-picker' || selectedField.type === 'date-range-picker'">
          <el-form-item label="日期格式">
            <el-select
              :model-value="selectedField.props?.format || 'YYYY-MM-DD'"
              @update:model-value="(v: string) => updateProp('format', v)"
            >
              <el-option
                label="YYYY-MM-DD"
                value="YYYY-MM-DD"
              />
              <el-option
                label="YYYY/MM/DD"
                value="YYYY/MM/DD"
              />
              <el-option
                label="MM-DD-YYYY"
                value="MM-DD-YYYY"
              />
              <el-option
                label="MM/DD/YYYY"
                value="MM/DD/YYYY"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- switch: 文案 -->
        <template v-if="selectedField.type === 'switch'">
          <el-form-item label="启用文案">
            <el-input
              :model-value="activeText"
              @input="onActiveTextInput"
            >
              <template #suffix>
                <span
                  v-if="activeText.length > 6"
                  class="name-overflow"
                >-{{ activeText.length - 6 }}</span>
              </template>
            </el-input>
            <div
              v-if="showActiveTextWarning"
              class="placeholder-warning"
            >
              文案过长可能会造成部分文字缺失
              <span
                class="placeholder-warning-close"
                @click="dismissActiveTextWarning"
              >×</span>
            </div>
          </el-form-item>
          <el-form-item label="关闭文案">
            <el-input
              :model-value="inactiveText"
              @input="onInactiveTextInput"
            >
              <template #suffix>
                <span
                  v-if="inactiveText.length > 6"
                  class="name-overflow"
                >-{{ inactiveText.length - 6 }}</span>
              </template>
            </el-input>
            <div
              v-if="showInactiveTextWarning"
              class="placeholder-warning"
            >
              文案过长可能会造成部分文字缺失
              <span
                class="placeholder-warning-close"
                @click="dismissInactiveTextWarning"
              >×</span>
            </div>
          </el-form-item>
        </template>

        <!-- rate: 最大星数 -->
        <template v-if="selectedField.type === 'rate'">
          <el-form-item label="最大星数">
            <el-input-number
              v-model="propsProxy.max"
              :min="1"
              :max="10"
              @change="(v: any) => updateProp('max', v)"
            />
          </el-form-item>
        </template>

        <!-- slider: 范围 / 步长 -->
        <template v-if="selectedField.type === 'slider'">
          <el-form-item label="最小值">
            <el-input-number
              v-model="propsProxy.min"
              @change="(v: any) => updateProp('min', v)"
            />
          </el-form-item>
          <el-form-item label="最大值">
            <el-input-number
              v-model="propsProxy.max"
              @change="(v: any) => updateProp('max', v)"
            />
          </el-form-item>
          <el-form-item label="步长">
            <el-input-number
              v-model="propsProxy.step"
              :min="0"
              @change="(v: any) => updateProp('step', v)"
            />
          </el-form-item>
        </template>

        <!-- card: 标题 / 阴影 -->
        <template v-if="selectedField.type === 'card'">
          <el-form-item label="标题">
            <el-input
              :model-value="selectedField.props?.header || ''"
              @input="(v: string) => updateProp('header', v)"
            />
          </el-form-item>
          <el-form-item label="阴影">
            <el-select
              :model-value="selectedField.props?.shadow || 'always'"
              @update:model-value="(v: string) => updateProp('shadow', v)"
            >
              <el-option
                label="始终"
                value="always"
              />
              <el-option
                label="悬停"
                value="hover"
              />
              <el-option
                label="从不"
                value="never"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- tabs: 标签列表 -->
        <template v-if="(selectedField.type as string) === 'tabs'">
          <el-form-item label="标签页列表">
            <div
              v-for="(tab, i) in tabList"
              :key="i"
              class="option-row"
            >
              <el-input
                v-model="tabList[i]"
                size="small"
                :placeholder="'标签 ' + (i + 1)"
                @input="markTabDirty"
              />
              <el-button
                size="small"
                text
                type="danger"
                @click="removeTab(i)"
              >
                ×
              </el-button>
            </div>
            <el-button
              size="small"
              style="margin-top:4px"
              @click="addTab"
            >
              + 添加标签
            </el-button>
          </el-form-item>
        </template>

        <!-- upload: 文件配置 -->
        <template v-if="selectedField.type === 'upload'">
          <el-form-item label="最大数量">
            <el-input-number
              v-model="propsProxy.maxCount"
              :min="1"
              @change="(v: any) => updateProp('maxCount', v)"
            />
          </el-form-item>
          <el-form-item label="单个文件容量上限(MB)">
            <el-input-number
              v-model="propsProxy.maxSize"
              :min="1"
              @change="(v: any) => updateProp('maxSize', v)"
            />
          </el-form-item>
          <el-form-item label="文件类型">
            <el-select
              :model-value="acceptList"
              multiple
              filterable
              clearable
              placeholder="不限"
              @update:model-value="onAcceptChange"
            >
              <el-option
                v-for="opt in acceptOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- rich-text: 富文本配置 -->
        <template v-if="selectedField.type === 'rich-text'">
          <el-form-item label="编辑器高度(px)">
            <el-input-number
              v-model="propsProxy.height"
              :min="richTextMinHeight"
              :max="2000"
              :step="50"
              @change="(v: any) => updateProp('height', v)"
            />
          </el-form-item>
          <el-form-item label="最大字数限制">
            <el-input-number
              v-model="propsProxy.maxLength"
              :min="100"
              :max="50000"
              :step="100"
              @change="(v: any) => updateProp('maxLength', v)"
            />
          </el-form-item>
          <el-form-item label="工具栏模式">
            <el-select
              :model-value="selectedField.props?.toolbarMode || 'full'"
              @update:model-value="(v: string) => updateProp('toolbarMode', v)"
            >
              <el-option
                label="完整模式"
                value="full"
              />
              <el-option
                label="简洁模式"
                value="simple"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- cascader: 级联选择配置 -->
        <template v-if="selectedField.type === 'cascader'">
          <el-form-item label="可清除">
            <el-switch
              :model-value="selectedField.props?.clearable !== false"
              @update:model-value="(v: boolean) => updateProp('clearable', v)"
            />
          </el-form-item>
          <el-form-item label="可搜索">
            <el-switch
              :model-value="selectedField.props?.filterable === true"
              @update:model-value="(v: boolean) => updateProp('filterable', v)"
            />
          </el-form-item>
          <el-form-item label="显示完整路径">
            <el-switch
              :model-value="selectedField.props?.showAllLevels !== false"
              @update:model-value="(v: boolean) => updateProp('showAllLevels', v)"
            />
          </el-form-item>
          <el-form-item label="路径分隔符">
            <el-input
              :model-value="cascaderSeparator"
              @update:model-value="(v: string) => { cascaderSeparator = v; updateProp('separator', v) }"
            />
          </el-form-item>
          <el-form-item label="选项来源">
            <el-radio-group
              :model-value="selectedField.props?.templateMode || 'manual'"
              @change="onCascaderModeChange"
            >
              <el-radio value="manual">
                自主编辑
              </el-radio>
              <el-radio value="region">
                省市区模板
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <template v-if="(selectedField.props?.templateMode || 'manual') === 'manual'">
            <el-form-item label="选项数据">
              <div class="cascader-opts-header">
                <el-button
                  size="small"
                  @click="addCascaderRoot"
                >
                  + 添加根节点
                </el-button>
              </div>
              <div class="cascader-tree">
                <CascaderNode
                  v-for="(node, i) in cascaderNodes"
                  :key="i"
                  :node="node"
                  :index="i"
                  :depth="0"
                  :path="[i]"
                  @update="onCascaderNodeUpdate"
                  @add-child="onCascaderAddChild"
                  @remove="onCascaderRemove"
                />
              </div>
            </el-form-item>
          </template>
          <template v-else>
            <div class="cascader-template-info">
              当前使用「省份 → 城市 → 区县」行政区划模板
            </div>
          </template>
        </template>

        <!-- tip-text: 提示文本配置 -->
        <template v-if="selectedField.type === 'tip-text'">
          <el-form-item label="提示内容">
            <el-input
              :model-value="selectedField.props?.text || ''"
              type="textarea"
              :rows="3"
              @input="(v: string) => updateProp('text', v)"
            />
            <div
              v-if="!tipText.trim()"
              class="placeholder-warning"
            >
              提示内容不能为空
            </div>
          </el-form-item>
          <el-form-item label="提示类型">
            <el-select
              :model-value="selectedField.props?.tipType || ''"
              @change="onTipTypeChange"
            >
              <el-option
                label="无"
                value=""
              />
              <el-option
                label="成功"
                value="success"
              />
              <el-option
                label="失败"
                value="danger"
              />
              <el-option
                label="警告"
                value="warning"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="字体颜色">
            <el-color-picker
              :model-value="selectedField.props?.color || '#909399'"
              @focus="tipTextPrevColor = tipColor"
              @change="(v: string | null) => updateProp('color', v ?? '#909399')"
            />
            <el-button
              v-if="tipTextPrevColor && tipTextPrevColor !== (selectedField.props?.color || '#909399')"
              size="small"
              text
              type="warning"
              @click="updateProp('color', tipTextPrevColor)"
            >
              撤销
            </el-button>
          </el-form-item>
          <el-form-item label="字号">
            <el-input-number
              v-model="propsProxy.fontSize"
              :min="12"
              :max="48"
              @change="(v: any) => updateProp('fontSize', v)"
            />
          </el-form-item>
          <el-form-item label="对齐方式">
            <el-select
              :model-value="selectedField.props?.textAlign || 'left'"
              @update:model-value="(v: string) => updateProp('textAlign', v)"
            >
              <el-option
                label="左对齐"
                value="left"
              />
              <el-option
                label="居中"
                value="center"
              />
              <el-option
                label="右对齐"
                value="right"
              />
            </el-select>
          </el-form-item>
        </template>

        <!-- 校验 -->
        <template v-if="showValidation">
          <el-divider />
          <h5>校验</h5>
          <el-form-item label="是否必填">
            <el-switch
              :model-value="hasRequiredRule"
              @update:model-value="toggleRequired"
            />
          </el-form-item>
          <el-form-item
            v-if="hasMaxLength"
            label="最大长度"
          >
            <el-input-number
              v-model="propsProxy.maxLength"
              :min="0"
              @change="(v: any) => updateProp('maxLength', v)"
            />
          </el-form-item>
          <el-form-item
            v-if="showFieldType"
            label="字段类型"
          >
            <el-select
              :model-value="fieldType"
              @update:model-value="(v: string) => updateFieldType(v)"
            >
              <el-option
                label="不限"
                value=""
              />
              <el-option
                label="数字"
                value="number"
              />
              <el-option
                label="字符串"
                value="string"
              />
              <el-option
                label="邮箱"
                value="email"
              />
              <el-option
                label="手机号"
                value="phone"
              />
              <el-option
                label="网址"
                value="url"
              />
            </el-select>
          </el-form-item>
        </template>
      </el-form>

      <el-button
        type="danger"
        size="small"
        plain
        class="delete-btn"
        @click="deleteField"
      >
        删除控件
      </el-button>
    </template>

    <div
      v-if="panelMode === 'field' && !selectedField"
      class="empty-hint"
    >
      请选中控件后再查看属性列表
    </div>

    <!-- ====== 界面设置 ====== -->
    <FormSettingsPanel v-if="panelMode === 'form'" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch, ref } from 'vue'
import { useDesignerStore } from '../stores/designer'
import { builtinComponents } from '../config/component-registry'
import { getMinCol } from '@furmx/sdk'
import type { FieldSchema, SelectOption } from '@furmx/sdk'
import CascaderNode from './CascaderNode.vue'
import FormSettingsPanel from './FormSettingsPanel.vue'
// regionData 由子组件 CascaderNode 按需导入

const store = useDesignerStore()

const selectedField = computed(() => store.selectedField)

// props 为 Record<string, unknown>，这里对已知属性做窄化，供模板/逻辑安全使用
const selectOptions = computed<SelectOption[]>(() => {
  const opts = selectedField.value?.props?.options
  return Array.isArray(opts) ? opts : []
})

const tabList = computed<string[]>(() => {
  const list = selectedField.value?.props?.tabList
  return Array.isArray(list) ? list : []
})

const tipText = computed(() => {
  const t = selectedField.value?.props?.text
  return typeof t === 'string' ? t : ''
})

const tipColor = computed(() => {
  const c = selectedField.value?.props?.color
  return typeof c === 'string' ? c : ''
})

// 面板模式：'form' = 表单设置，'field' = 控件属性
const panelMode = ref<'form' | 'field'>('form')

watch(() => store.selectedFieldId, (id) => {
  if (id) panelMode.value = 'field'
})

function switchToForm() { panelMode.value = 'form' }
function switchToField() {
  panelMode.value = 'field'
}

const displayName = computed(() => {
  if (!selectedField.value) return ''
  const comp = builtinComponents.find((c) => c.type === selectedField.value!.type)
  return comp?.display || selectedField.value.type
})

/** 当前控件栅格列宽范围（评分按最大星数动态调整） */
const minCol = computed(() => {
  if (!selectedField.value) return 0
  let min = getMinCol(selectedField.value.type)
  if (selectedField.value.type === 'rate') {
    const labelLen = (selectedField.value.name || '').length
    const stars = Number(selectedField.value.props?.max) || 5
    min = Math.max(3, Math.ceil(labelLen * 0.4 + stars * 0.75 + 0.8))
  }
  return min
})
const maxCol = computed(() => store.schema.settings.canvasCols || 24)

/** 画布高度显示值：取 max(设定值, 内容实际高度) */
const fieldMeta = reactive({
  key: '', name: '', col: 12,
  size: '' as string,
})

// 可编辑的 props 代理
const propsProxy = reactive<Record<string, any>>({})

const hasPlaceholder = computed(() => {
  if (!selectedField.value) return false
  return ['input', 'textarea', 'select', 'input-number', 'rich-text', 'cascader'].includes(selectedField.value.type)
})

// ---- 标签名称过长检测 ----
const labelNameText = ref('')
const labelNameDismissed = ref(false)
let labelNameTimer: ReturnType<typeof setTimeout> | null = null

const showLabelNameWarning = computed(() =>
  labelNameText.value.length > 10 && !labelNameDismissed.value
)

watch(() => selectedField.value?.name, (v) => {
  if (!labelNameTimer) labelNameText.value = v || ''
})
watch(() => selectedField.value?.id, () => {
  labelNameText.value = selectedField.value?.name || ''
  labelNameDismissed.value = false
  if (labelNameTimer) { clearTimeout(labelNameTimer); labelNameTimer = null }
})

function onLabelNameInput(v: string) {
  labelNameText.value = v
  fieldMeta.name = v
  if (v.length > 10) labelNameDismissed.value = false
  if (labelNameTimer) clearTimeout(labelNameTimer)
  labelNameTimer = setTimeout(() => {
    onNameChange()
    labelNameTimer = null
  }, 400)
}

function dismissLabelNameWarning() {
  labelNameDismissed.value = true
}

// ---- 占位文本过长检测 ----
const placeholderText = ref('')
const placeholderDismissed = ref(false)
let placeholderTimer: ReturnType<typeof setTimeout> | null = null

const showPlaceholderWarning = computed(() =>
  placeholderText.value.length > 8 && !placeholderDismissed.value
)

function getPlaceholderDefault(field: typeof selectedField.value): string {
  if (!field) return ''
  const comp = builtinComponents.find(c => c.type === field.type)
  return field.props?.placeholder ?? comp?.defaultProps?.placeholder ?? ''
}

watch(() => selectedField.value?.props?.placeholder, (v) => {
  if (!placeholderTimer) placeholderText.value = String(v ?? getPlaceholderDefault(selectedField.value))
})
watch(() => selectedField.value?.id, () => {
  placeholderText.value = getPlaceholderDefault(selectedField.value)
  placeholderDismissed.value = false
  if (placeholderTimer) { clearTimeout(placeholderTimer); placeholderTimer = null }
})

// ---- 富文本编辑器高度：栅格列宽决定最小高度 ----
function calcRichMinHeight(col: number): number {
  return Math.max(200, Math.round(7200 / col - 100))
}

const richTextMinHeight = computed(() => {
  if (selectedField.value?.type !== 'rich-text') return 200
  return calcRichMinHeight(fieldMeta.col)
})

// 栅格列宽变化时，若当前高度低于新最小值，自动抬高
watch(
  () => fieldMeta.col,
  (newCol) => {
    if (selectedField.value?.type !== 'rich-text') return
    const minH = calcRichMinHeight(newCol)
    if ((propsProxy.height || 0) < minH) {
      propsProxy.height = minH
      updateProp('height', minH)
    }
  },
)

function onPlaceholderInput(v: string) {
  placeholderText.value = v
  if (v.length > 8) placeholderDismissed.value = false
  if (placeholderTimer) clearTimeout(placeholderTimer)
  placeholderTimer = setTimeout(() => {
    updateProp('placeholder', v)
    placeholderTimer = null
  }, 400)
}

function dismissPlaceholderWarning() {
  placeholderDismissed.value = true
}

// ---- 开关启用/关闭文案过长检测 ----
const activeText = ref('')
const activeTextDismissed = ref(false)
let activeTextTimer: ReturnType<typeof setTimeout> | null = null
const inactiveText = ref('')
const inactiveTextDismissed = ref(false)
let inactiveTextTimer: ReturnType<typeof setTimeout> | null = null

const showActiveTextWarning = computed(() => activeText.value.length > 6 && !activeTextDismissed.value)
const showInactiveTextWarning = computed(() => inactiveText.value.length > 6 && !inactiveTextDismissed.value)

watch(() => selectedField.value?.props?.activeText, (v) => { if (!activeTextTimer) activeText.value = String(v ?? '') })
watch(() => selectedField.value?.props?.inactiveText, (v) => { if (!inactiveTextTimer) inactiveText.value = String(v ?? '') })
watch(() => selectedField.value?.id, () => {
  activeText.value = String(selectedField.value?.props?.activeText ?? '')
  inactiveText.value = String(selectedField.value?.props?.inactiveText ?? '')
  activeTextDismissed.value = false
  inactiveTextDismissed.value = false
  if (activeTextTimer) { clearTimeout(activeTextTimer); activeTextTimer = null }
  if (inactiveTextTimer) { clearTimeout(inactiveTextTimer); inactiveTextTimer = null }
})

function onActiveTextInput(v: string) {
  activeText.value = v
  if (v.length > 6) activeTextDismissed.value = false
  if (activeTextTimer) clearTimeout(activeTextTimer)
  activeTextTimer = setTimeout(() => { updateProp('activeText', v); activeTextTimer = null }, 400)
}
function onInactiveTextInput(v: string) {
  inactiveText.value = v
  if (v.length > 6) inactiveTextDismissed.value = false
  if (inactiveTextTimer) clearTimeout(inactiveTextTimer)
  inactiveTextTimer = setTimeout(() => { updateProp('inactiveText', v); inactiveTextTimer = null }, 400)
}
function dismissActiveTextWarning() { activeTextDismissed.value = true }
function dismissInactiveTextWarning() { inactiveTextDismissed.value = true }

const hasRequiredRule = computed(() => {
  return selectedField.value?.rules?.some((r) => r.type === 'required') ?? false
})

const showValidation = computed(() => {
  const t = selectedField.value?.type
  return t && !['card', 'collapse', 'tabs', 'divider', 'tip-text'].includes(t)
})

const hasMaxLength = computed(() => {
  const t = selectedField.value?.type
  return t === 'input' || t === 'textarea'
})

const showFieldType = computed(() => {
  const t = selectedField.value?.type
  return t === 'input' || t === 'textarea'
})

const fieldType = computed(() => {
  const rules = selectedField.value?.rules || []
  const typeRule = rules.find((r) => ['email', 'url', 'number', 'string', 'phone'].includes(r.type))
  return typeRule?.type || ''
})

// 同步选中控件到 fieldMeta
watch(
  () => {
    const f = selectedField.value
    return f ? { id: f.id, col: f.col, name: f.name, key: f.key, size: f.size, props: f.props } : null
  },
  (info) => {
    if (!info) return
    fieldMeta.key = info.key
    fieldMeta.name = info.name
    if (selectedField.value?.type === 'rate') {
      const labelLen = (info.name || '').length
      const stars = Number(info.props?.max) || 5
      fieldMeta.col = Math.max(3, Math.ceil(labelLen * 0.4 + stars * 0.75 + 0.8))
    } else if (selectedField.value?.type === 'switch') {
      const labelLen = Math.min((info.name || '').length, 6)
      const activeLen = Math.min(String(info.props?.activeText ?? '').length, 6)
      const inactiveLen = Math.min(String(info.props?.inactiveText ?? '').length, 6)
      const textLen = labelLen + activeLen + inactiveLen
      fieldMeta.col = Math.max(4, Math.ceil(textLen * 0.5 + 3))
    } else {
      fieldMeta.col = Math.max(getMinCol(selectedField.value?.type || ''), info.col ?? 12)
    }
    fieldMeta.size = info.size || ''
    Object.keys(propsProxy).forEach((k) => delete propsProxy[k])
    if (info.props) Object.assign(propsProxy, info.props)
    // 默认值兜底：旧字段可能缺失这些属性
    if (selectedField.value?.type === 'rich-text') {
      const defs = builtinComponents.find(c => c.type === 'rich-text')?.defaultProps || {}
      if (propsProxy.maxLength === undefined) propsProxy.maxLength = defs.maxLength ?? 200
      if (propsProxy.height === undefined) propsProxy.height = defs.height ?? 400
    }
    if (selectedField.value?.type === 'tip-text') {
      const defs = builtinComponents.find(c => c.type === 'tip-text')?.defaultProps || {}
      if (propsProxy.fontSize === undefined) propsProxy.fontSize = defs.fontSize ?? 14
    }
  },
  { immediate: true },
)

function slugify(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/g, '').trim()
  if (/[\u4e00-\u9fa5]/.test(cleaned)) return 'field_' + Date.now().toString(36)
  return cleaned
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
}

function onNameChange() {
  if (!store.selectedFieldId) return
  if (fieldMeta.key.startsWith('field_') || !fieldMeta.key) fieldMeta.key = slugify(fieldMeta.name)
  updateMeta()
}

function updateMeta() {
  if (!store.selectedFieldId) return
  store.updateFieldMeta(store.selectedFieldId, {
    key: fieldMeta.key,
    name: fieldMeta.name,
    col: fieldMeta.col,
    size: (fieldMeta.size || undefined) as FieldSchema['size'],
  })
}

function updateProp(key: string, value: any) {
  if (!store.selectedFieldId) return
  store.updateFieldProps(store.selectedFieldId, { [key]: value })
}

function markOptionsDirty() {
  if (!store.selectedFieldId || !selectedField.value) return
  const opts = [...selectOptions.value]
  store.updateFieldProps(store.selectedFieldId, { options: opts })
}

function addOption() {
  if (!store.selectedFieldId || !selectedField.value) return
  const label = '选项 ' + ((selectOptions.value.length) + 1)
  const opts = [...selectOptions.value, { label, value: label }]
  store.updateFieldProps(store.selectedFieldId, { options: opts })
}

function removeOption(i: number) {
  if (!store.selectedFieldId || !selectedField.value) return
  const opts = [...selectOptions.value]
  opts.splice(i, 1)
  store.updateFieldProps(store.selectedFieldId, { options: opts })
}

// tabs 操作
function addTab() {
  if (!store.selectedFieldId || !selectedField.value) return
  const raw = selectedField.value.props?.tabList
  const list = Array.isArray(raw) ? [...raw] : ['标签1', '标签2']
  list.push('标签' + (list.length + 1))
  store.updateFieldProps(store.selectedFieldId, { tabList: list })
}
function removeTab(i: number) {
  if (!store.selectedFieldId || !selectedField.value) return
  const list = [...tabList.value]
  list.splice(i, 1)
  store.updateFieldProps(store.selectedFieldId, { tabList: list })
}
function markTabDirty() {
  // tabList 已经通过 v-model 直接修改，此处触发保存
  if (!store.selectedFieldId || !selectedField.value) return
  store.updateFieldProps(store.selectedFieldId, { tabList: [...tabList.value] })
}

// ---- 文件类型选项 ----
const acceptOptions = [
  { label: '.pdf', value: '.pdf' },
  { label: '.doc', value: '.doc' },
  { label: '.docx', value: '.docx' },
  { label: '.xls', value: '.xls' },
  { label: '.xlsx', value: '.xlsx' },
  { label: '.ppt', value: '.ppt' },
  { label: '.pptx', value: '.pptx' },
  { label: '.jpg', value: '.jpg' },
  { label: '.jpeg', value: '.jpeg' },
  { label: '.png', value: '.png' },
  { label: '.gif', value: '.gif' },
  { label: '.zip', value: '.zip' },
  { label: '.rar', value: '.rar' },
  { label: '.7z', value: '.7z' },
  { label: '.txt', value: '.txt' },
  { label: '.csv', value: '.csv' },
  { label: '.mp4', value: '.mp4' },
  { label: '.avi', value: '.avi' },
  { label: '.mov', value: '.mov' },
  { label: '.mp3', value: '.mp3' },
  { label: '.wav', value: '.wav' },
]

const acceptList = computed(() => {
  const raw = selectedField.value?.props?.accept
  if (typeof raw !== 'string' || !raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
})

function onAcceptChange(vals: string[]) {
  updateProp('accept', [...new Set(vals)].join(','))
}

function toggleRequired(required: boolean) {
  if (!store.selectedFieldId || !selectedField.value) return
  const field = selectedField.value
  if (required) {
    store.updateFieldMeta(store.selectedFieldId, {
      rules: [...(field.rules || []), { type: 'required', message: `${field.name}不能为空` }],
    })
  } else {
    store.updateFieldMeta(store.selectedFieldId, {
      rules: (field.rules || []).filter((r) => r.type !== 'required'),
    })
  }
}

const TYPE_MSGS: Record<string, string> = {
  email: '请输入正确的邮箱', url: '请输入正确的网址',
  number: '请输入数字', string: '请输入字符串', phone: '请输入正确的手机号',
}

function updateFieldType(v: string) {
  if (!store.selectedFieldId || !selectedField.value) return
  const field = selectedField.value
  const filtered = (field.rules || []).filter((r) => !['email', 'url', 'number', 'string', 'phone'].includes(r.type))
  if (v) {
    filtered.push({ type: v as any, message: TYPE_MSGS[v] || '格式不正确' })
  }
  store.updateFieldMeta(store.selectedFieldId, { rules: filtered })
}

// ---- 级联选择：选项树编辑 ----
const cascaderNodes = reactive<any[]>([])
const tipTextPrevColor = ref<string | null>(null)
const cascaderSeparator = ref('/')
let _cascaderSyncing = false

watch(
  () => selectedField.value?.props?.separator,
  (v) => { cascaderSeparator.value = String(v ?? '/') },
  { immediate: true },
)

watch(
  () => selectedField.value?.props?.options,
  (opts) => {
    if (_cascaderSyncing) return
    cascaderNodes.length = 0
    if (Array.isArray(opts)) {
      cascaderNodes.push(...opts.map((n: any) => ({ label: n.label, value: n.value || n.label, children: n.children ? [...n.children] : undefined })))
    }
  },
  { immediate: true },
)

function getNodeByPath(path: number[]): any {
  // path[0] 定位 cascaderNodes 中的根节点，后续索引走 children
  let target: any = cascaderNodes[path[0]]
  for (let i = 1; i < path.length; i++) {
    target = target.children[path[i]]
  }
  return target
}

function syncCascaderToField() {
  if (!store.selectedFieldId || selectedField.value?.type !== 'cascader') return
  _cascaderSyncing = true
  store.updateFieldProps(store.selectedFieldId, { options: JSON.parse(JSON.stringify([...cascaderNodes])) })
  setTimeout(() => { _cascaderSyncing = false }, 0)
}

const tipTypeColors: Record<string, string> = {
  success: '#67c23a',
  danger: '#f56c6c',
  warning: '#e6a23c',
}

function onTipTypeChange(tipType: string) {
  updateProp('tipType', tipType)
  if (tipType && tipTypeColors[tipType]) {
    updateProp('color', tipTypeColors[tipType])
  }
}

function onCascaderModeChange(mode: string) {
  updateProp('templateMode', mode)
  if (mode === 'region') {
    cascaderNodes.length = 0
    // 不存 options 到 schema，渲染器直接读 regionData
  } else {
    cascaderNodes.length = 0
    updateProp('options', [])
  }
}

function addCascaderRoot() {
  cascaderNodes.push({ label: '新选项', value: '新选项' })
  syncCascaderToField()
}

function onCascaderAddChild(parentPath: number[]) {
  const parent = getNodeByPath(parentPath)
  if (!parent.children) parent.children = []
  parent.children.push({ label: '新选项', value: '新选项' })
  syncCascaderToField()
}

function onCascaderRemove(path: number[]) {
  if (path.length === 1) {
    cascaderNodes.splice(path[0], 1)
  } else {
    const parentPath = path.slice(0, -1)
    const idx = path[path.length - 1]
    const parent = getNodeByPath(parentPath)
    if (parent?.children) parent.children.splice(idx, 1)
  }
  syncCascaderToField()
}

function onCascaderNodeUpdate(path: number[], patch: Record<string, any>) {
  const node = getNodeByPath(path)
  if (node) Object.assign(node, patch)
  syncCascaderToField()
}

function deleteField() {
  if (!store.selectedFieldId) return
  store.removeField(store.selectedFieldId)
}
</script>

<style scoped>
.property-panel { padding: 16px; }
.property-panel :deep(.el-form-item) { margin-bottom: 12px; }
.panel-nav {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-bottom: 2px solid #e4e7ed;
}
.nav-item {
  padding: 8px 14px;
  font-size: 13px;
  color: #909399;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
  user-select: none;
}
.nav-item:hover { color: #409eff; }
.nav-item.active {
  color: #409eff;
  border-bottom-color: #409eff;
  font-weight: 600;
}
.panel-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.prop-form :deep(.el-form-item) { margin-bottom: 14px; }
.prop-form :deep(.el-slider__button) { opacity: 0; transition: opacity 0.2s; }
.prop-form :deep(.el-form-item):hover .el-slider__button { opacity: 1; }

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin: 0 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid #ebeef5;
}
.col-px-hint {
  display: block;
  width: 100%;
  font-size: 11px;
  color: #909399;
  margin-bottom: 8px;
}
.cascader-template-info { font-size: 12px; color: #909399; }
.option-row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
.delete-btn { width: 100%; margin-top: 16px; }
.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 14px;
  min-height: 120px;
}
.name-overflow { color: #f56c6c; font-size: 12px; }
.placeholder-warning {
  font-size: 12px;
  color: #f56c6c;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.placeholder-warning-close {
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  opacity: 0.6;
}
.placeholder-warning-close:hover { opacity: 1; }
</style>
