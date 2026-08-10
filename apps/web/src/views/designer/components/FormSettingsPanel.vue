<template>
  <el-form
    label-position="top"
    size="small"
  >
    <h5 class="section-title">
      表单
    </h5>
    <el-form-item label="表单标题">
      <el-input
        :model-value="store.schema.settings.formTitle || ''"
        placeholder="留空则不显示标题"
        @input="(v: string) => updateSetting('formTitle', v)"
      />
    </el-form-item>
    <el-form-item label="尺寸">
      <el-radio-group
        :model-value="store.schema.settings.size"
        @change="(v: string) => updateSetting('size', v)"
      >
        <el-radio value="small">
          小
        </el-radio>
        <el-radio value="default">
          默认
        </el-radio>
        <el-radio value="large">
          大
        </el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item label="提交文案">
      <el-input
        :model-value="store.schema.settings.submitText"
        @input="(v: string) => updateSetting('submitText', v)"
      />
    </el-form-item>

    <h5 class="section-title">
      画布
    </h5>
    <el-form-item label="显示网格">
      <el-switch v-model="store.showGrid" />
    </el-form-item>
    <el-form-item label="画布列数">
      <el-input-number
        :model-value="store.schema.settings.canvasCols || 24"
        :min="24"
        :max="48"
        :step="1"
        @change="(v: number | undefined) => updateSetting('canvasCols', v ?? 24)"
      />
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { useDesignerStore } from '../stores/designer'

const store = useDesignerStore()

function updateSetting(key: string, value: unknown) {
  store.updateSettings({ [key]: value })
}
</script>
