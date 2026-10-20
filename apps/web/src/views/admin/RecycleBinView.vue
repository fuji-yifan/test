<template>
  <div>
    <div class="page-header">
      <el-tooltip content="返回" placement="top">
        <el-button
          text
          @click="$router.back()"
        >
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <h2>回收站</h2>
    </div>

    <el-table
      v-loading="loading"
      :data="forms"
      stripe
      :row-class-name="rowClass"
    >
      <el-table-column
        type="index"
        label="#"
        width="55"
        align="center"
      />
      <el-table-column
        label="表单"
        min-width="200"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.name }}
          <!-- 表单还在、只删了个别版本：整行标灰，避免和「整表在回收站」混在一起 -->
          <span
            v-if="!row.deletedAt"
            class="versions-only-hint"
          >仅删版本</span>
        </template>
      </el-table-column>
      <el-table-column
        label="可恢复的版本"
        min-width="200"
        align="center"
      >
        <template #default="{ row }">
          <template v-if="row.versions?.length">
            <!-- 表单已进回收站：版本没被删，点「恢复」会连同全部版本一起回来；点版本号可预览该版本 -->
            <template v-if="row.deletedAt">
              <el-tag
                v-for="v in row.versions"
                :key="v.version"
                size="small"
                type="info"
                class="version-tag version-tag--clickable"
                :title="`预览 v${v.version}`"
                @click="openVersionPreview(row, v)"
              >
                v{{ v.version }}
              </el-tag>
            </template>
            <!-- 表单仍在：只列被单独删除的版本，可逐个恢复（预览在右侧「操作」列的下拉里） -->
            <template v-else>
              <div class="version-actions">
                <el-button
                  v-for="v in row.versions"
                  :key="v.version"
                  size="small"
                  @click="restoreVersion(row, v)"
                >
                  恢复 v{{ v.version }}
                </el-button>
              </div>
            </template>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        label="删除时间"
        min-width="180"
        align="center"
      >
        <template #default="{ row }">
          {{ formatDate(row.deletedAt || row.versions?.[0]?.deletedAt) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        min-width="220"
        align="center"
        fixed="right"
      >
        <template #default="{ row }">
          <div class="op-actions">
            <!-- 预览下拉：可看表单当前结构，也可看回收站里的任意历史版本 -->
            <el-dropdown
              trigger="click"
              @visible-change="(open: boolean) => setPreviewMenuOpen(row.id, open)"
              @command="(cmd: string) => handlePreviewCommand(cmd, row)"
            >
              <el-button size="small">
                预览
                <el-icon
                  class="el-icon--right preview-arrow"
                  :class="{ 'is-open': previewMenuOpen[row.id] }"
                >
                  <ArrowDown />
                </el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <!-- 回收站里列出的本来就是被删的版本，没必要再标「已删除」；
                       只有整表已删且没有任何版本（从未保存过内容）时，才用「当前版本」占位 -->
                  <el-dropdown-item
                    v-if="!row.versions?.length"
                    command="current"
                  >
                    当前版本
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-for="v in row.versions || []"
                    :key="v.version"
                    :command="`v${v.version}`"
                  >
                    v{{ v.version }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <!-- 表单仍在、只是删了版本的行，没有整表恢复/彻底删除的含义 -->
            <template v-if="row.deletedAt">
              <el-button
                size="small"
                type="primary"
                @click="restoreForm(row)"
              >
                恢复
              </el-button>
              <el-button
                size="small"
                type="danger"
                @click="purgeForm(row)"
              >
                删除
              </el-button>
            </template>
          </div>
        </template>
      </el-table-column>

      <!-- 空态：放进表格内，替换掉 el-table 自带的「暂无数据」 -->
      <template #empty>
        <el-empty
          description="回收站为空"
          :image-size="80"
        />
      </template>
    </el-table>

    <!-- 预览弹窗：右上角自带 ×，不需要页脚关闭按钮。
         destroy-on-close + :key 是必须的：PreviewPanel 的画布几何在 setup 时按 schema 算一次、不随 prop 变，
         复用同一实例连续看不同表单会留下上一张的排版 -->
    <el-dialog
      v-model="showPreview"
      :title="`${previewName}（预览）`"
      width="900px"
      destroy-on-close
    >
      <div class="form-preview-box">
        <PreviewPanel
          v-if="previewSchema"
          :key="previewFormId"
          :schema="previewSchema"
          hide-actions
          hide-title
        />
        <el-empty
          v-else
          description="该表单从未保存过内容"
          :image-size="80"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowDown } from '@element-plus/icons-vue'
import type { FormSchema } from '@furmx/sdk'
import http from '@/api/client'
import { useConfirmAction } from '@/composables'
import PreviewPanel from '@/components/PreviewPanel.vue'

interface RecycleVersion {
  version: number
  deletedAt: string
  /** 该版本的 schema 快照（回收站接口已一并返回），用于按版本预览 */
  schema?: FormSchema
}
interface RecycleForm {
  id: string
  name: string
  deletedAt: string
  schema: FormSchema
  versions: RecycleVersion[]
}

const route = useRoute()
const wsId = computed(() => route.params.wsId as string)
const { confirm } = useConfirmAction()

const loading = ref(false)
const forms = ref<RecycleForm[]>([])

const showPreview = ref(false)
const previewName = ref('')
const previewFormId = ref('')
const previewSchema = ref<FormSchema | null>(null)

/** 每行预览下拉的展开态，用于把箭头图标在朝下/朝上之间切换 */
const previewMenuOpen = ref<Record<string, boolean>>({})
function setPreviewMenuOpen(rowId: string, open: boolean) {
  previewMenuOpen.value[rowId] = open
}

async function fetchRecycle() {
  loading.value = true
  try {
    const res: any = await http.get(`/workspaces/${wsId.value}/forms/recycle`)
    const payload = res?.data ?? res
    forms.value = (payload?.list ?? []) as RecycleForm[]
  } catch {
    forms.value = []
  } finally {
    loading.value = false
  }
}

/** 操作列预览下拉：current = 表单当前结构，vN = 该历史版本的快照 */
function handlePreviewCommand(cmd: string, row: RecycleForm) {
  if (cmd === 'current') return openPreview(row)
  const version = Number(cmd.replace(/^v/, ''))
  const v = row.versions?.find((x) => x.version === version)
  if (v) openVersionPreview(row, v)
}

/** 预览某个历史版本的快照（不是表单当前 schema） */
function openVersionPreview(f: RecycleForm, v: RecycleVersion) {
  previewName.value = `${f.name} v${v.version}`
  // key 带上版本号：连续预览同一张表的不同版本时必须重建 PreviewPanel 实例
  previewFormId.value = `${f.id}-v${v.version}`
  previewSchema.value = v.schema?.fields?.length ? v.schema : null
  showPreview.value = true
}

function openPreview(f: RecycleForm) {
  previewName.value = f.name
  previewFormId.value = f.id
  // 没存过内容的表单 schema 是空对象，PreviewPanel 拿不到 fields 会渲染成空白，直接走空态
  previewSchema.value = f.schema?.fields?.length ? f.schema : null
  showPreview.value = true
}

async function restoreForm(f: RecycleForm) {
  try {
    await http.post(`/forms/${f.id}/restore`)
    ElMessage.success('已恢复表单')
    await fetchRecycle()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '恢复失败')
  }
}

async function restoreVersion(f: RecycleForm, v: RecycleVersion) {
  try {
    await http.post(`/forms/${f.id}/versions/${v.version}/restore`)
    ElMessage.success(`已恢复版本 v${v.version}`)
    await fetchRecycle()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '恢复失败')
  }
}

function purgeForm(f: RecycleForm) {
  confirm(
    () => http.delete(`/forms/${f.id}/purge`),
    {
      title: '彻底删除确认',
      message: `确定彻底删除表单「${f.name}」？将连同它的所有版本快照和已提交数据一并删除，且无法恢复。`,
      confirmText: '彻底删除',
      successMsg: '已彻底删除',
      type: 'warning',
    },
    () => fetchRecycle(),
  )
}

/** 只删了个别版本的行（表单本身仍在）整行标灰，与整表在回收站的行区分 */
function rowClass({ row }: { row: RecycleForm }) {
  return row.deletedAt ? '' : 'versions-only-row'
}

function formatDate(d: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-' }

onMounted(fetchRecycle)
watch(() => route.params.wsId, fetchRecycle)
</script>

<style scoped>
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.version-tag { margin: 0 4px; }
.version-tag--clickable { cursor: pointer; }
/* 展开时箭头翻转 180°，与下拉的开合保持同一节奏 */
.preview-arrow { transition: transform 0.25s ease; }
.preview-arrow.is-open { transform: rotate(180deg); }
/* 按钮间距统一交给 gap；Element Plus 默认的 .el-button + .el-button 12px 左外边距要清掉，否则间距不均 */
.op-actions,
.version-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.op-actions :deep(.el-button + .el-button),
.version-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.versions-only-hint {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
/* 标灰用背景而不是 opacity：动作按钮要保持可点、不能被看成禁用态 */
:deep(.versions-only-row > td.el-table__cell) {
  background: var(--el-fill-color-light) !important;
  color: var(--el-text-color-secondary);
}
/* 与 ChatPanel 的表单预览弹窗同一套宽度与滚动规则：900px 下表单铺满，不出横向滚动条 */
.form-preview-box { max-height: 60vh; overflow: auto; }
</style>
