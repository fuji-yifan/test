<template>
  <div class="settings-page">
    <div class="page-header">
      <el-button text @click="$router.back()"><el-icon><ArrowLeft /></el-icon> 返回</el-button>
      <h2>{{ formName }}</h2>
    </div>

    <el-card class="section-card">
      <template #header><span class="section-title">基本信息</span></template>
      <el-form label-width="100px" :model="form" @submit.prevent>
        <el-form-item label="表单名称">
          <el-input v-model="form.name" placeholder="请输入表单名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="可选描述" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" placeholder="选择分类" clearable>
            <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="section-card">
      <template #header><span class="section-title">提交设置</span></template>
      <el-form label-width="120px" :model="form">
        <el-form-item label="提交上限">
          <el-input-number v-model="form.maxSubmissions" :min="0" />
          <span class="hint">0 表示不限制</span>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="save-bar">
      <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import http from '@/api/client'

const CATEGORIES = ['人事', '财务', '行政', '销售', '运营', '项目']

const route = useRoute()
const formId = route.params.formId as string
const formName = ref('')
const saving = ref(false)

const form = reactive({
  name: '',
  description: '',
  category: '',
  maxSubmissions: 0,
})

onMounted(async () => {
  try {
    const res = await http.get(`/forms/${formId}`) as any
    const data = res.data || res
    formName.value = data.name || ''
    Object.assign(form, {
      name: data.name || '',
      description: data.description || '',
      category: data.category || '',
      maxSubmissions: data.maxSubmissions || 0,
    })
  } catch { /* */ }
})

async function save() {
  saving.value = true
  try {
    await http.patch(`/forms/${formId}`, {
      name: form.name,
      description: form.description,
      category: form.category || undefined,
      maxSubmissions: form.maxSubmissions,
    })
    formName.value = form.name
    ElMessage.success('保存成功')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.page-header h2 { margin: 0; }
.section-card { margin-bottom: 16px; }
.section-title { font-weight: 600; font-size: 15px; }
.hint { color: #909399; font-size: 12px; margin-left: 8px; }
.save-bar { margin-top: 8px; }
</style>
