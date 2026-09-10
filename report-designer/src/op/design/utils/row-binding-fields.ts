/**
 * row-binding-fields —— 派生「首卡行上下文（row.*）」字段选项
 *
 * LabelGrid 首卡子控件绑定字段时,运行期由 expandLabelGrids 注入 rowCtx
 * (label-grid.ts:289-291),子控件可写 `row.Photo`、`row.AnalysisItem`。
 * 但设计期 VariableModal 只展示全局字段树(Header.*、Footer.*、ReportItems[]),
 * 用户必须手敲 `row.Photo` —— 此 util 把这种手敲体验变成点选。
 *
 * ## 用法
 * ```ts
 * import { deriveRowScopedFields } from '@op/design/utils/row-binding-fields'
 *
 * // 在 VariableModal computed 里:
 * const rowFields = computed(() => deriveRowScopedFields({
 *   hostLabelGrid: props.hostLabelGrid,
 *   activeSource: catalog.activeSource,
 *   flatFields: catalog.flatFields,
 * }))
 * ```
 */
import type { FieldDef, DataSourceMeta } from '@op/types/datasource'
import type { LabelGridControl } from '@op/types/control'

/** 行上下文派生字段视图模型 */
export interface RowScopedField {
  /** 回写路径(emit 用),如 'row.Photo' */
  path: string
  /** 中文名 */
  label: string
  /** 字段类型(string / number / image ...) */
  type: string
  /**
   * 示例取样路径(在 previewData 里按此路径解析首项示例值)。
   * 保留数组路径 `ReportItems[].Photo`,而非 row 路径,因为 previewData
   * 没有 row 上下文,只有全局对象。返回的 sample 字段是 fallback。
   */
  samplePath: string
  /** 取样失败时的回退示例 */
  sample: unknown
}

export interface DeriveRowScopedFieldsInput {
  hostLabelGrid: LabelGridControl | null | undefined
  activeSource: DataSourceMeta | null | undefined
  flatFields: readonly FieldDef[]
}

/**
 * 从 LabelGrid.dataSource(数组路径如 'ReportItems')对应的明细表派生 row.*
 * 选项。无 hostLabelGrid / 未配 dataSource / 对应表不存在 / 对应表无 fields → 返回 null。
 *
 * 注意:hostLabelGrid 存在但 dataSource 缺失时(纯布局平铺模式)返回 null,
 * 而不是空数组 — 让 caller 决定整块隐藏分组,无需额外 if 判断。
 *
 * ## 算法
 *   1. 在 activeSource.tables 找 isArray=true 且 pathPrefix 去 `[]` 后 = dataSource 的明细表
 *   2. 取 flatFields 里 tableId 匹配的字段,过滤 path 必须以 `<prefix>[]` 开头
 *   3. 把 `<prefix>[].<leaf>` 转成 `row.<leaf>`(纯字段路径,不带 {{}})
 *   4. 若结果为空 → 返回 null(让分组隐藏)
 */
export function deriveRowScopedFields(input: DeriveRowScopedFieldsInput): RowScopedField[] | null {
  const { hostLabelGrid, activeSource, flatFields } = input
  if (!hostLabelGrid?.dataSource) return null
  const tables = activeSource?.tables ?? []
  const arrayTable = tables.find(
    (t) => t.isArray && (t.pathPrefix ?? '').replace(/\[\]\.?,?$/, '') === hostLabelGrid.dataSource,
  )
  if (!arrayTable) return null
  const prefix = (arrayTable.pathPrefix ?? '').replace(/\[\]\.?,?$/, '') // 'ReportItems'
  const sep = prefix + '[]' // 'ReportItems[]'
  const fields = flatFields
    .filter((f) => f.tableId === arrayTable.id && f.path.startsWith(sep))
    .map<RowScopedField>((f) => {
      const leaf = f.path.slice(sep.length).replace(/^\./, '')
      return {
        path: 'row.' + leaf,
        label: f.label,
        type: f.type,
        samplePath: f.path,
        sample: f.sample,
      }
    })
  return fields.length > 0 ? fields : null
}

/**
 * 派生分组标签(用于 VariableModal 「首卡行上下文」分组的标题)。
 * 例:`'首卡行上下文(订单明细)'`
 */
export function deriveRowScopedGroupLabel(
  input: DeriveRowScopedFieldsInput,
): string | null {
  const { hostLabelGrid, activeSource } = input
  if (!hostLabelGrid?.dataSource) return null
  const tables = activeSource?.tables ?? []
  const arrayTable = tables.find(
    (t) => t.isArray && (t.pathPrefix ?? '').replace(/\[\]\.?,?$/, '') === hostLabelGrid.dataSource,
  )
  return arrayTable ? `首卡行上下文(${arrayTable.name})` : null
}