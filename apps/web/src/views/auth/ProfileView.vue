<template>
  <div class="profile-root">
    <div class="profile-banner" />

    <div class="profile-body">
      <!-- 头像 + 身份 -->
      <div class="identity-block">
        <el-avatar
          :size="88"
          :src="user?.avatarUrl"
          icon="UserFilled"
          class="avatar"
        />
        <h2 class="display-name">
          {{ user?.nickname }}
        </h2>
        <p class="display-email">
          {{ user?.email }}
        </p>
        <el-button
          text
          size="small"
          @click="toggleEdit"
        >
          {{ editing ? '取消' : '编辑资料' }}
        </el-button>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-icon status-icon">
            <el-icon :size="20">
              <CircleCheckFilled />
            </el-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">
              <el-tag
                :type="user?.status === 'active' ? 'success' : 'warning'"
                size="small"
                effect="dark"
              >
                {{ user?.status === 'active' ? '正常' : user?.status || '-' }}
              </el-tag>
            </span>
            <span class="stat-label">账号状态</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon login-icon">
            <el-icon :size="20">
              <Clock />
            </el-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ loginTime }}</span>
            <span class="stat-label">最后登录</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon reg-icon">
            <el-icon :size="20">
              <Calendar />
            </el-icon>
          </div>
          <div class="stat-body">
            <span class="stat-value">{{ registerDate }}</span>
            <span class="stat-label">注册时间</span>
          </div>
        </div>
      </div>

      <!-- 账号信息 / 编辑 -->
      <div class="section-card">
        <h4 class="section-title">
          {{ editing ? '编辑资料' : '账号信息' }}
        </h4>

        <div
          v-if="!editing"
          class="info-grid"
        >
          <div class="info-item">
            <span class="info-label">昵称</span>
            <span class="info-value">{{ user?.nickname }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">邮箱</span>
            <span class="info-value">{{ user?.email }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">用户 ID</span>
            <span class="info-value info-mono">{{ user?.id }}</span>
          </div>
        </div>

        <el-form
          v-else
          label-position="top"
          @submit.prevent="saveProfile"
        >
          <!-- 头像 -->
          <el-form-item label="头像">
            <div class="avatar-edit-row">
              <div
                class="avatar-upload"
                @click="triggerUpload"
              >
                <el-avatar
                  :size="64"
                  :src="editAvatar"
                  icon="UserFilled"
                />
                <div class="upload-overlay">
                  <el-icon :size="18">
                    <Upload />
                  </el-icon>
                </div>
              </div>
              <div class="avatar-actions">
                <el-button
                  size="small"
                  type="primary"
                  plain
                  @click="triggerUpload"
                >
                  上传图片
                </el-button>
              </div>
            </div>
          </el-form-item>

          <el-form-item label="昵称">
            <el-input
              v-model="editNickname"
              maxlength="100"
              placeholder="输入新昵称"
            />
          </el-form-item>

          <el-form-item label="邮箱">
            <el-input
              :model-value="user?.email"
              disabled
            />
            <span class="field-note">邮箱暂不支持修改</span>
          </el-form-item>

          <div class="edit-actions">
            <el-button
              type="primary"
              :loading="saving"
              @click="saveProfile"
            >
              保存
            </el-button>
          </div>

          <el-divider />

          <div class="pwd-section">
            <el-button
              text
              size="small"
              class="pwd-toggle"
              @click="showPwd = !showPwd"
            >
              <el-icon :size="14">
                <Lock />
              </el-icon>
              {{ showPwd ? '取消修改' : '修改密码' }}
            </el-button>
            <template v-if="showPwd">
              <el-form-item label="原密码">
                <el-input
                  v-model="pwdForm.oldPassword"
                  type="password"
                  show-password
                  placeholder="输入当前密码"
                />
              </el-form-item>
              <el-form-item label="新密码">
                <el-input
                  v-model="pwdForm.newPassword"
                  type="password"
                  show-password
                  placeholder="至少6位"
                />
              </el-form-item>
              <el-form-item label="确认新密码">
                <el-input
                  v-model="pwdForm.confirmPwd"
                  type="password"
                  show-password
                  placeholder="再次输入新密码"
                  @keyup.enter="changePassword"
                />
              </el-form-item>
              <div class="pwd-actions">
                <el-button
                  type="primary"
                  size="small"
                  :loading="changingPwd"
                  @click="changePassword"
                >
                  确认修改
                </el-button>
              </div>
            </template>
          </div>
        </el-form>
      </div>

      <!-- 长期记忆（阶段 8 §3.7）：跨对话的偏好/身份/常用对象，AI 后续会话会参考；只读 + 可删 -->
      <div class="section-card">
        <div class="section-head">
          <h4 class="section-title">
            长期记忆
          </h4>
          <span class="section-hint">AI 会记住你的偏好与常用对象，并在新的对话里参考</span>
        </div>

        <div
          v-if="memoryLoading"
          class="memory-empty"
        >
          加载中…
        </div>
        <div
          v-else-if="memories.length === 0"
          class="memory-empty"
        >
          暂无长期记忆
        </div>
        <ul
          v-else
          class="memory-list"
        >
          <li
            v-for="m in memories"
            :key="m.id"
            class="memory-item"
          >
            <el-tag
              size="small"
              effect="plain"
              :type="kindTagType(m.kind)"
              class="memory-tag"
            >
              {{ KIND_LABEL[m.kind] || m.kind }}
            </el-tag>
            <div class="memory-body">
              <span class="memory-key">{{ m.key }}</span>
              <span
                class="memory-value"
                :title="m.value"
              >{{ m.value }}</span>
            </div>
            <div class="memory-meta">
              <span class="memory-time">{{ fmtTime(m.updatedAt) }}</span>
              <el-tooltip
                content="删除这条记忆"
                placement="top"
              >
                <el-icon
                  class="memory-remove"
                  :size="15"
                  aria-label="删除这条记忆"
                  @click="removeMemory(m)"
                >
                  <Close />
                </el-icon>
              </el-tooltip>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheckFilled, Clock, Calendar, Upload, Lock, Close } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import http from '@/api/client'

const auth = useAuthStore()
const wsStore = useWorkspaceStore()
const user = computed(() => auth.currentUser)

// ==================== 长期记忆（阶段 8 §3.7 / 8.4） ====================
interface MemoryItem {
  id: string
  kind: string
  key: string
  value: string
  confidence: number
  updatedAt?: number
}

const KIND_LABEL: Record<string, string> = {
  preference: '偏好',
  identity: '身份',
  entity: '常用对象',
  conclusion: '结论',
}

/** 不同类型用不同颜色的标签，便于一眼区分 */
const KIND_TAG_TYPE: Record<string, 'primary' | 'success' | 'warning' | 'info'> = {
  preference: 'primary',
  identity: 'success',
  entity: 'warning',
  conclusion: 'info',
}

function kindTagType(kind: string) {
  return KIND_TAG_TYPE[kind] || 'info'
}

const memories = ref<MemoryItem[]>([])
const memoryLoading = ref(false)

function agentToken(): string {
  return localStorage.getItem('access_token') || ''
}

async function loadMemories() {
  memoryLoading.value = true
  try {
    const ws = wsStore.currentId || ''
    const res = await fetch(
      `/agent-api/api/v1/agent/memory?workspaceId=${encodeURIComponent(ws)}`,
      { headers: { Authorization: `Bearer ${agentToken()}` } },
    )
    if (!res.ok) { memories.value = []; return }
    const body = await res.json()
    memories.value = Array.isArray(body) ? body : (body.data || [])
  } catch {
    memories.value = []
  } finally {
    memoryLoading.value = false
  }
}

async function removeMemory(item: MemoryItem) {
  try {
    await ElMessageBox.confirm(`确定删除这条记忆吗？\n「${item.key}」`, '删除记忆', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  try {
    const res = await fetch(`/agent-api/api/v1/agent/memory/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${agentToken()}` },
    })
    if (res.ok) {
      memories.value = memories.value.filter((m) => m.id !== item.id)
      ElMessage.success('已删除')
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    ElMessage.error('删除失败')
  }
}

function fmtTime(t?: number): string {
  return t ? new Date(t).toLocaleString('zh-CN') : '-'
}

onMounted(loadMemories)

const editing = ref(false)
const editNickname = ref('')
const editAvatar = ref('')
const saving = ref(false)
const showPwd = ref(false)
const changingPwd = ref(false)

const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPwd: '' })

function toggleEdit() {
  if (!editing.value) {
    editNickname.value = user.value?.nickname || ''
    editAvatar.value = user.value?.avatarUrl || ''
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPwd = ''
    showPwd.value = false
  }
  editing.value = !editing.value
}

/** 头像换图依赖对象存储（MinIO），暂未开放 */
function triggerUpload() {
  ElMessage.info('功能暂未开放')
}

const loginTime = computed(() => {
  const d = user.value?.lastLoginAt
  return d ? new Date(d).toLocaleString('zh-CN') : '-'
})

const registerDate = computed(() => {
  const d = user.value?.createdAt
  return d ? new Date(d).toLocaleString('zh-CN') : '-'
})

async function saveProfile() {
  if (!editNickname.value.trim()) { ElMessage.warning('昵称不能为空'); return }
  saving.value = true
  try {
    const res = await http.patch('/auth/me', {
      nickname: editNickname.value.trim(),
      avatarUrl: editAvatar.value || undefined,
    }) as any
    auth.user = res.data || res
    ElMessage.success('已保存')
    editing.value = false
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally { saving.value = false }
}

async function changePassword() {
  if (!pwdForm.oldPassword) { ElMessage.warning('请输入原密码'); return }
  if (!pwdForm.newPassword || pwdForm.newPassword.length < 6) { ElMessage.warning('新密码至少6位'); return }
  if (pwdForm.newPassword !== pwdForm.confirmPwd) { ElMessage.warning('两次输入的新密码不一致'); return }
  changingPwd.value = true
  try {
    await http.patch('/auth/me/password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    })
    ElMessage.success('密码已修改')
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPwd = ''
    showPwd.value = false
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '修改失败')
  } finally { changingPwd.value = false }
}
</script>

<style scoped>
.profile-root {
  background: var(--app-bg-page);
  padding-bottom: 40px;
}

.profile-banner {
  height: 100px;
  background: #dbeafe;
  border-radius: 0 0 16px 16px;
}

.profile-body {
  max-width: 820px;
  margin: 0 auto;
  padding: 0 20px 40px;
}

/* ====== 头像 + 身份 ====== */
.identity-block {
  text-align: center;
  margin-top: -44px;
  margin-bottom: 32px;
  position: relative;
}

.avatar {
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.display-name {
  margin: 16px 0 4px;
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}

.display-email {
  margin: 0 0 12px;
  font-size: 14px;
  color: #909399;
}

/* ====== 统计卡片 ====== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-icon { background: #f0fdf4; color: #22c55e; }
.login-icon  { background: #eff6ff; color: #3b82f6; }
.reg-icon    { background: #fefce8; color: #eab308; }

.stat-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-label {
  font-size: 12px;
  color: #9ca3af;
}

/* ====== 信息卡片 ====== */
.section-card {
  background: #fff;
  border-radius: 10px;
  padding: 24px 28px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  margin-bottom: 20px;
}

.section-title {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.info-grid {
  display: flex;
  flex-direction: column;
}

.info-item {
  display: flex;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f2f3f5;
}

.info-item:last-child { border-bottom: none; }

.info-label {
  width: 72px;
  flex-shrink: 0;
  font-size: 14px;
  color: #909399;
}

.info-value {
  font-size: 14px;
  color: #303133;
}

.info-mono {
  font-family: 'SF Mono', 'Cascadia Code', monospace;
  font-size: 12px;
  color: #909399;
}

/* ====== 编辑表单 ====== */
.avatar-edit-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-upload {
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  transition: box-shadow 0.2s;
}
.avatar-upload:hover { box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.18); }
.avatar-upload .el-avatar { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); }

.upload-overlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s;
}

.avatar-upload:hover .upload-overlay { opacity: 1; }

.avatar-actions {
  flex: 1;
  display: flex;
  align-items: center;
}

.edit-actions {
  margin-top: 8px;
}

.pwd-section {
  display: flex;
  flex-direction: column;
}

.pwd-toggle {
  color: #909399;
  align-self: flex-end;
}

.pwd-actions {
  text-align: right;
  margin-top: 8px;
}

.field-note {
  font-size: 12px;
  color: #c0c4cc;
  margin-top: 4px;
  display: block;
}

/* ====== 长期记忆 ====== */
.section-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-bottom: 16px;
}

.section-head .section-title { margin: 0; }

.section-hint {
  font-size: 12px;
  color: #9ca3af;
}

.memory-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}

.memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 每条记忆做成独立卡片，比纯分隔线更易扫读 */
.memory-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  transition: background-color 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.memory-item:hover {
  background: #fff;
  border-color: #dfe3e8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.memory-tag {
  flex-shrink: 0;
  margin-top: 1px;
}

.memory-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.memory-key {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-value {
  font-size: 13px;
  line-height: 1.5;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 1px;
}

.memory-time {
  font-size: 12px;
  color: #c0c4cc;
  white-space: nowrap;
}

/* 删除叉叉：与历史对话面板一致（默认 40% 透明，卡片悬浮时显现） */
.memory-remove {
  flex-shrink: 0;
  padding: 4px;
  border-radius: 6px;
  color: #c0c4cc;
  cursor: pointer;
  opacity: 0.4;
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
}

.memory-item:hover .memory-remove {
  opacity: 1;
}

.memory-remove:hover {
  color: #f56c6c;
  background: #fef0f0;
}

/* ====== 暗色 ====== */
html.dark .profile-banner { background: #1e3a5f; }
html.dark .display-name { color: #e2e8f0; }
html.dark .stat-card, html.dark .section-card { background: #1e293b; }
html.dark .stat-value { color: #e2e8f0; }
html.dark .stat-label { color: #64748b; }
html.dark .status-icon { background: rgba(34,197,94,0.12); }
html.dark .login-icon  { background: rgba(59,130,246,0.12); }
html.dark .reg-icon    { background: rgba(234,179,8,0.12); }
html.dark .section-title { color: #e2e8f0; }
html.dark .info-item { border-bottom-color: #2d3748; }
html.dark .info-value { color: #cbd5e1; }
html.dark .info-label { color: #64748b; }
html.dark .section-hint { color: #64748b; }
html.dark .memory-item {
  background: #18212f;
  border-color: #2d3748;
}
html.dark .memory-item:hover {
  background: #1e293b;
  border-color: #3f4d63;
  box-shadow: none;
}
html.dark .memory-key { color: #e2e8f0; }
html.dark .memory-value { color: #94a3b8; }
html.dark .memory-time { color: #64748b; }
html.dark .memory-remove { color: #64748b; }
html.dark .memory-remove:hover {
  color: var(--el-color-danger, #f56c6c);
  background: rgba(245, 108, 108, 0.12);
}
</style>
