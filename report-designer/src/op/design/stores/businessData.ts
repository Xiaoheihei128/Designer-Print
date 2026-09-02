/**
 * businessData store —— 业务数据从哪来
 *
 * 单一职责：
 * - 持有当前预览/导出的业务数据对象
 * - 提供三种注入入口：
 *   - setFromMatcher()：/matcher 跨页面真实业务数据
 *   - buildFromCatalog()：用字段目录 sample 合成
 *   - setFromDbRows()：客户端数据库真实行
 *
 * 与 fieldCatalog / previewData 的边界：
 * - fieldCatalog 只管字段定义，本 store 只管业务数据
 * - previewData 组合两者：本 store.data 为 null 时 fallback 到 catalog sample 合成
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FieldDef } from '@op/types/datasource'
import { buildBusinessDataFromCatalog, mapDbRowsToBusinessData } from '@op/design/preview/preview-data'
import { collectLeafPaths } from '@op/design/preview/collect-leaf-paths'

export type BusinessDataSource = 'matcher' | 'sample-built' | 'db-rows' | 'manual' | null

export const useBusinessDataStore = defineStore('businessData', () => {
  const data = ref<Record<string, unknown> | null>(null)
  const source = ref<BusinessDataSource>(null)

  /**
   * 当前 data 的 leaf path 集合（与 introspectJson 路径语义对齐）。
   * 用途：fieldCatalog.diffCoverage 判断「目录有 / 数据无」（missingFromData），
   *       DataSourceTree 「数据中的新字段」分组（数据有 / 目录无）。
   *
   * data=null 时返回空集合，UI 据此判断「无业务数据可对比」。
   */
  const dataPathSet = computed<ReadonlySet<string>>(() => {
    if (!data.value) return new Set()
    return collectLeafPaths(data.value)
  })
  const hasBusinessData = computed(() => data.value !== null)

  /** /matcher 跨页面真实业务数据 */
  function setFromMatcher(d: Record<string, unknown>): void {
    data.value = d
    source.value = 'matcher'
  }

  /** 用 catalog 字段 sample 合成 N 行 */
  function buildFromCatalog(fields: FieldDef[], rows: number): void {
    data.value = buildBusinessDataFromCatalog(fields, rows)
    source.value = 'sample-built'
  }

  /** 客户端数据库真实行 */
  function setFromDbRows(rows: Array<Record<string, unknown>>, fields?: FieldDef[]): void {
    if (fields && fields.length > 0) {
      data.value = mapDbRowsToBusinessData(fields, rows)
    } else {
      // 兜底：把 rows 直接作为数据对象（顶层结构由 rows 自身决定）
      data.value = rows[0] ?? {}
    }
    source.value = 'db-rows'
  }

  function clear(): void {
    data.value = null
    source.value = null
  }

  return { data, source, dataPathSet, hasBusinessData, setFromMatcher, buildFromCatalog, setFromDbRows, clear }
})