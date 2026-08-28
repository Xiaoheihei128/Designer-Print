<script setup lang="ts">
/**
 * BindingEditor —— 字段绑定编辑器（点选 path，非手敲）
 * Phase 5：接 dataSource store 的扁平字段列表，替换 Phase 3 的硬编码 MOCK_FIELDS。
 */
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'

const props = defineProps<{
  value?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:value': [value: string | undefined]
}>()

const catalog = useFieldCatalogStore()

const options = computed(() => {
  return catalog.flatFields.map((f) => ({
    label: `${f.label}（${f.path}）`,
    value: f.path,
  }))
})

const innerValue = computed({
  get: () => props.value ?? null,
  set: (v: string | null) => emit('update:value', v ?? undefined),
})
</script>

<template>
  <NSelect
    v-model:value="innerValue"
    :options="options"
    size="small"
    filterable
    tag
    clearable
    :placeholder="placeholder ?? '选择或输入绑定字段'"
    :loading="catalog.loading"
  />
</template>
