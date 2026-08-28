/**
 * 业务数据构造 —— 从字段目录合成预览用的业务数据
 *
 * 两个独立入口：
 * - buildBusinessDataFromCatalog(fields, rows)：用 FieldDef.sample 合成 N 行
 * - mapDbRowsToBusinessData(rows, columns)：把数据库真实行映射为业务数据
 *
 * 字段路径形如 `ReportItems[].AnalysisItem` / `Header.ReportNo`：
 * - `Header.ReportNo` → 顶层 `Header.ReportNo`（单值字段）
 * - `ReportItems[].AnalysisItem` → 顶层 `ReportItems`，数组元素含 `AnalysisItem`（明细字段）
 *
 * 路径前缀由字段目录的 path 决定 — 不再硬编码 `items` vs `ReportItems`。
 */
import type { FieldDef } from '@op/types/datasource'

/** 序号类字段：值直接用行号，方便肉眼核对分页边界 */
const SEQ_RE = /^(seq|index|no|rowno|序号)$/i
/** 编码类字段：拼上行号，让每行看起来不一样 */
const CODE_RE = /(code|no|sn|编码|编号|单号)$/i

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean)
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    const next = cur[k]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cur[k] = {}
    }
    cur = cur[k] as Record<string, unknown>
  }
  const last = keys.at(-1)
  if (last) cur[last] = value
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0')
}

/** 按行号给样例值加变化，避免整张表每行完全一样看不出分页 */
function varyValue(field: FieldDef, leaf: string, rowIndex: number): unknown {
  const sample = field.sample

  if (SEQ_RE.test(leaf)) return rowIndex + 1

  if (typeof sample === 'number') {
    const factor = 1 + ((rowIndex % 5) - 2) * 0.1
    const v = sample * factor
    return Number.isInteger(sample) ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100
  }

  if (typeof sample === 'boolean') return rowIndex % 2 === 0
  if (sample === null || sample === undefined || sample === '') return ''

  const text = String(sample)
  if (CODE_RE.test(leaf)) return `${text}-${pad(rowIndex + 1)}`
  return text
}

/** 把一行 db 记录按叶子字段名映射（无 sample 合成，保留原始值） */
function mapRow(
  src: Record<string, unknown>,
  leaves: Array<{ leaf: string; field: FieldDef }>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const { leaf, field } of leaves) {
    if (leaf in src) row[leaf] = src[leaf]
    else row[leaf] = field.type === 'number' ? 0 : ''
  }
  return row
}

/**
 * 从字段目录合成预览数据：每个数组路径合成 N 行，每行按 leaf 字段名取样。
 * 字段为空时返回 `{}`，渲染器会给出 DATASOURCE_EMPTY 告警而不是静默出空白页。
 */
export function buildBusinessDataFromCatalog(
  fields: FieldDef[],
  rowCount = 8,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const arrays = new Map<string, Array<{ leaf: string; field: FieldDef }>>()

  for (const field of fields) {
    if (field.hidden) continue
    const marker = field.path.indexOf('[]')
    if (marker < 0) {
      setPath(data, field.path, field.sample ?? '')
      continue
    }
    const arrayPath = field.path.slice(0, marker)
    const leaf = field.path.slice(marker + 2).replace(/^\./, '')
    if (!leaf) continue
    const list = arrays.get(arrayPath)
    if (list) list.push({ leaf, field })
    else arrays.set(arrayPath, [{ leaf, field }])
  }

  for (const [arrayPath, leaves] of arrays) {
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {}
      for (const { leaf, field } of leaves) setPath(row, leaf, varyValue(field, leaf, i))
      // 金额 = 数量 × 单价：让合计行的数字自洽，否则一眼假
      const qty = row.qty
      const price = row.price
      if (typeof qty === 'number' && typeof price === 'number' && 'amount' in row) {
        row.amount = Math.round(qty * price * 100) / 100
      }
      rows.push(row)
    }
    setPath(data, arrayPath, rows)
  }

  return data
}

/**
 * 把 db 真实行映射为业务数据：
 * - 自动识别每个数组路径（按 `[]` 标记）
 * - 每行直接用原值，不再 sample 合成
 *
 * columns 用于推断顶层字段：单值字段（非数组）若未在 rows 里出现，用 column.sample 兜底
 */
export function mapDbRowsToBusinessData(
  fields: FieldDef[],
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const arrays = new Map<string, Array<{ leaf: string; field: FieldDef }>>()

  for (const field of fields) {
    if (field.hidden) continue
    const marker = field.path.indexOf('[]')
    if (marker < 0) {
      setPath(data, field.path, field.sample ?? '')
      continue
    }
    const arrayPath = field.path.slice(0, marker)
    const leaf = field.path.slice(marker + 2).replace(/^\./, '')
    if (!leaf) continue
    const list = arrays.get(arrayPath)
    if (list) list.push({ leaf, field })
    else arrays.set(arrayPath, [{ leaf, field }])
  }

  for (const [arrayPath, leaves] of arrays) {
    const mapped = rows.map((src) => mapRow(src, leaves))
    setPath(data, arrayPath, mapped)
  }

  return data
}