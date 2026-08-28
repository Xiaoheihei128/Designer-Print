/**
 * previewData store —— 把「字段目录 + 业务数据」组合成预览数据
 *
 * 组合规则（优先级从高到低）：
 * 1. businessData.data 已注入 → 直接用它（matcher / db 真实行 / sample-built）
 * 2. 否则按 catalog flatFields 用 sample 合成 N 行
 *
 * 这条链让"预览 = 导出"：同一份 data 喂给 render({ template, data })。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useFieldCatalogStore } from './fieldCatalog'
import { useBusinessDataStore } from './businessData'
import { buildBusinessDataFromCatalog } from '@op/design/preview/preview-data'

export const usePreviewDataStore = defineStore('previewData', () => {
  const catalog = useFieldCatalogStore()
  const biz = useBusinessDataStore()

  /** 预览明细行数（sample 合成模式生效；matcher / db 真实行不受限） */
  // 检验报告典型行数；样例文本不变化，数字随行递增
  const previewRowCount = ref(8)

  const data = computed<Record<string, unknown>>(() => {
    // Pinia setup-store 自动解包 refs：biz.data / catalog.flatFields 已是值，无需 .value
    if (biz.data) return biz.data
    return buildBusinessDataFromCatalog(catalog.flatFields, previewRowCount.value)
  })

  function setPreviewRowCount(n: number): void {
    previewRowCount.value = Math.max(0, Math.floor(n))
  }

  return { data, previewRowCount, setPreviewRowCount }
})