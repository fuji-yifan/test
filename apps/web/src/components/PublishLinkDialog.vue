<template>
  <el-dialog
    :model-value="visible"
    title="表单已发布"
    width="480px"
    @update:model-value="$emit('update:visible', $event)"
    @close="reset"
  >
    <div class="publish-body">
      <el-alert
        title="发布成功"
        type="success"
        :closable="false"
        show-icon
        style="margin-bottom:16px"
      />
      <p class="tip">
        将以下链接分享给填写人，无需登录即可填写：
      </p>
      <div class="link-row">
        <el-input
          :model-value="formLink"
          readonly
        />
        <el-button
          type="primary"
          @click="copyLink"
        >
          复制
        </el-button>
      </div>
      <p
        v-if="copied"
        class="copy-ok"
      >
        已复制到剪贴板
      </p>
    </div>
    <template #footer>
      <el-button @click="close">
        关闭
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  visible: boolean
  formId: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const copied = ref(false)

const formLink = computed(() => `${window.location.origin}/f/${props.formId}`)

function copyLink() {
  navigator.clipboard.writeText(formLink.value).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }).catch(() => {
    // fallback
    const input = document.createElement('input')
    input.value = formLink.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  })
}

function close() {
  emit('update:visible', false)
}

function reset() {
  copied.value = false
}
</script>

<style scoped>
.publish-body { text-align: left; }
.tip { font-size: 14px; color: #606266; margin-bottom: 12px; }
.link-row { display: flex; gap: 8px; }
.link-row .el-input { flex: 1; }
.copy-ok { font-size: 13px; color: #67c23a; margin-top: 8px; text-align: right; }
</style>
