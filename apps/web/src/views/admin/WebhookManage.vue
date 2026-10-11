<template>
  <div>
    <div class="page-header">
      <h2>Webhook 管理</h2>
      <el-button
        type="primary"
        @click="openCreate"
      >
        添加 Webhook
      </el-button>
    </div>
    <el-table
      v-loading="loading"
      :data="webhooks"
      stripe
    >
      <el-table-column
        prop="url"
        label="URL"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span class="mono">{{ row.url }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="事件"
        width="220"
        align="center"
      >
        <template #default="{ row }">
          <el-tag
            v-for="ev in (row.events as string[])"
            :key="ev"
            size="small"
            style="margin-right:4px"
          >
            {{ eventLabel(ev) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="状态"
        width="80"
        align="center"
      >
        <template #default="{ row }">
          <el-switch
            v-model="row.isActive"
            size="small"
            @change="(v:boolean) => toggleStatus(row,v)"
          />
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="280"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            size="small"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            size="small"
            @click="testHook(row)"
          >
            测试
          </el-button>
          <el-button
            size="small"
            type="primary"
            @click="showDeliveries(row)"
          >
            日志
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="deleteWH(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <!-- 空态：放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          v-if="!loading"
          description="暂无 Webhook"
          :image-size="80"
        />
      </template>
    </el-table>

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="showDialog"
      :title="editingId ? '编辑 Webhook' : '添加 Webhook'"
      width="500px"
    >
      <el-form
        :model="form"
        label-width="80px"
      >
        <el-form-item
          label="URL"
          required
        >
          <el-input
            v-model="form.url"
            placeholder="https://example.com/webhook"
          />
        </el-form-item>
        <el-form-item label="事件">
          <el-checkbox-group v-model="form.events">
            <el-checkbox label="submission.created">
              数据提交
            </el-checkbox>
            <el-checkbox label="submission.updated">
              数据更新
            </el-checkbox>
            <el-checkbox label="form.published">
              表单发布
            </el-checkbox>
            <el-checkbox label="form.archived">
              表单归档
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="密钥">
          <el-input
            v-model="form.secret"
            placeholder="HMAC 签名密钥（可选）"
          >
            <template #append>
              <el-button @click="generateSecret">
                生成
              </el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          @click="doSave"
        >
          {{ editingId ? '保存' : '添加' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 投递日志抽屉 -->
    <el-drawer
      v-model="deliveryDrawer"
      title="投递日志"
      size="600px"
    >
      <el-table
        v-loading="deliveryLoading"
        :data="deliveries"
        stripe
        size="small"
      >
        <el-table-column
          prop="event"
          label="事件"
          width="130"
          align="center"
        />
        <el-table-column
          label="状态"
          width="70"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.status >= 200 && row.status < 300 ? 'success' : 'danger'"
              size="small"
            >
              {{ row.status || 'FAIL' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="耗时"
          width="75"
          align="center"
        >
          <template #default="{ row }">
            {{ row.duration }}ms
          </template>
        </el-table-column>
        <el-table-column
          prop="error"
          label="错误"
          min-width="150"
          align="center"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ row.error || '-' }}
          </template>
        </el-table-column>
        <el-table-column
          label="时间"
          width="175"
          align="center"
        >
          <template #default="{ row }">
            {{ fmt(row.createdAt) }}
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import http from '@/api/client'

const route = useRoute()
const formId = ref((route.query.formId as string) || route.params.formId as string || '')

const webhooks = ref<any[]>([])
const loading = ref(false)

// 对话框
const showDialog = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = reactive({ url: '', events: [] as string[], secret: '' })

// 投递日志
const deliveryDrawer = ref(false)
const deliveries = ref<any[]>([])
const deliveryLoading = ref(false)

function eventLabel(ev: string) {
  const m: Record<string, string> = {
    'submission.created': '提交创建', 'submission.updated': '提交更新',
    'form.published': '表单发布', 'form.archived': '表单归档',
  }
  return m[ev] || ev
}

async function fetchWebhooks() {
  if (!formId.value) { webhooks.value = []; return }
  loading.value = true
  try {
    const res = await http.get(`/forms/${formId.value}/webhooks`) as any
    webhooks.value = (res?.data || res)?.data || res?.data || res || []
  } finally { loading.value = false }
}
onMounted(fetchWebhooks)

function openCreate() {
  editingId.value = null
  form.url = ''; form.events = []; form.secret = ''
  showDialog.value = true
}
function openEdit(row: any) {
  editingId.value = row.id
  form.url = row.url; form.events = [...(row.events || [])]; form.secret = row.secret || ''
  showDialog.value = true
}
function generateSecret() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'whsec_'
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)]
  form.secret = s
}

async function doSave() {
  saving.value = true
  try {
    if (editingId.value) {
      await http.patch(`/forms/${formId.value}/webhooks/${editingId.value}`, {
        url: form.url, events: form.events, secret: form.secret || undefined,
      })
      ElMessage.success('已更新')
    } else {
      await http.post(`/forms/${formId.value}/webhooks`, {
        url: form.url, events: form.events, secret: form.secret || undefined,
      })
      ElMessage.success('已创建')
    }
    showDialog.value = false
    fetchWebhooks()
  } catch (e: any) { if (e?.__handled) return; ElMessage.error('操作失败') }
  finally { saving.value = false }
}

async function toggleStatus(row: any, v: boolean) {
  try {
    await http.patch(`/forms/${formId.value}/webhooks/${row.id}`, { isActive: v })
  } catch { row.isActive = !v; ElMessage.error('更新失败') }
}

async function testHook(row: any) {
  try {
    const res = await http.post(`/forms/${formId.value}/webhooks/${row.id}/test`) as any
    const d = res?.data || res
    ElMessage.success(`测试完成 — 状态 ${d.status}, 耗时 ${d.duration}ms`)
  } catch (e: any) { if (e?.__handled) return; ElMessage.error('测试失败') }
}

async function deleteWH(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除该 Webhook？删除后无法恢复。`, '删除确认', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
    await http.delete(`/forms/${formId.value}/webhooks/${row.id}`)
    ElMessage.success('已删除')
    fetchWebhooks()
  } catch { /* cancel */ }
}

async function showDeliveries(row: any) {
  deliveryDrawer.value = true
  deliveryLoading.value = true
  try {
    const res = await http.get(`/forms/${formId.value}/webhooks/${row.id}/deliveries`) as any
    deliveries.value = (res?.data || res)?.list || []
  } finally { deliveryLoading.value = false }
}

function fmt(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.mono { font-family: monospace; font-size: 13px; }
</style>
