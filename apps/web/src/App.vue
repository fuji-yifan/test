<template>
  <component :is="layout">
    <router-view />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BlankLayout from '@/layouts/BlankLayout.vue'
import RenderLayout from '@/layouts/RenderLayout.vue'

const route = useRoute()

const layoutMap: Record<string, any> = {
  default: DefaultLayout,
  blank: BlankLayout,
  render: RenderLayout,
}

const layout = computed(() => {
  const name = (route.meta.layout as string) || 'blank'
  return layoutMap[name] || BlankLayout
})
</script>
