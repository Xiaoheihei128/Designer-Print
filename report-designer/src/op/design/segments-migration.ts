/**
 * segments-migration —— 老 schema → segments 数组的 lazy 迁移工具
 *
 * 设计动机（plan §"持久化策略 —— lazy migrate in editor"）：
 * - save 时**不**做规范化迁移（避免 undo 栈 / auto-save churn 与 diff 噪音）
 * - 渲染层 resolveSegments 已有 fallback，老 JSON 完全可工作
 * - 唯一需要"现代化"的时机是 Properties Panel 第一次打开（用户编辑时）
 *
 * 调用约定：
 * - Properties Panel 父组件 `watch(control)` 时调用 ensureSegments(cell)
 * - 返回值与原值浅相等 → 不发 update（避免无谓更新）
 * - 不等 → 调 setControlSilently(id, next)（不进 undo 栈）
 *
 * 关键约束：
 * - isAggToken(cell.text) 永远不动 —— buildFooterRow 直接读 cell.text
 * - cell.segments 已存在 → 已是新模型，直接返回
 * - cell 完全空 → 原样返回（无可迁移内容）
 */
import type { TableCell, TextControl, BarcodeControl, QrcodeControl } from '@op/types/control'
import { legacyToSegments } from '@op/core/layout-engine/segments'
import { isAggToken } from '@op/core/layout-engine/aggregate'

/** 4 类三态控件的并集（segments 字段仅在它们上存在） */
export type TriStateControl =
  | TextControl
  | TableCell
  | BarcodeControl
  | QrcodeControl

/**
 * 浅相等比较：检测 next 是否相对 c 有用户可见变化（用于决定是否触发 update）
 * - segments 字段必须显式比较：有 vs 无 / 内容不同 都是变化
 * - 老字段一致性只在双方都没有 segments 时作为兜底
 */
function sameLegacy(c: TriStateControl, next: TriStateControl): boolean {
  // ★ segments 字段差异是核心信号：c 没有 + next 有 → 必有变化（迁移发生）
  const cHasSeg = Boolean(c.segments)
  const nHasSeg = Boolean(next.segments)
  if (cHasSeg !== nHasSeg) return false
  if (cHasSeg) {
    // 双方都有 segments → 序列化比对
    return JSON.stringify(c.segments) === JSON.stringify(next.segments)
  }
  // 双方都没有 segments → 老字段一致性
  return (
    (c as { contentType?: string }).contentType === (next as { contentType?: string }).contentType &&
    ('value' in c ? (c as { value?: string }).value === (next as { value?: string }).value : true) &&
    ('text' in c ? (c as { text?: string }).text === (next as { text?: string }).text : true) &&
    ('binding' in c ? (c as { binding?: string }).binding === (next as { binding?: string }).binding : true) &&
    ('field' in c ? (c as { field?: string }).field === (next as { field?: string }).field : true) &&
    ('expression' in c
      ? (c as { expression?: string }).expression === (next as { expression?: string }).expression
      : true)
  )
}

/**
 * 确保控件已迁移到 segments（idempotent）
 *
 * 迁移优先级（按控件类型分派，与 legacyToSegments 一致）：
 * - text/cell:    expression > binding/field > value/text
 * - barcode/qrcode: binding > value
 *
 * 返回值：
 * - 与原值浅相等 → 原值（避免触发更新）
 * - 不等 → 新对象（含 segments 字段）
 * - cell 完全空或为 agg token → 原值（无内容可迁 / 不可迁）
 */
export function ensureSegments<T extends TriStateControl>(control: T): T {
  // 已是新模型
  if (control.segments) return control

  // 单元格：agg-token 永远不动（buildFooterRow 直接读 cell.text）
  if ('text' in control && isAggToken(control.text)) return control

  // 派生 legacy segments
  const type = (() => {
    if ('type' in control) {
      const t = (control as { type: string }).type
      if (t === 'barcode' || t === 'qrcode') return t as 'barcode' | 'qrcode'
      if (t === 'text') return 'text' as const
    }
    // TableCell
    return 'cell' as const
  })()

  const segs = legacyToSegments({
    type,
    value: 'value' in control ? (control as { value?: string }).value : undefined,
    text: 'text' in control ? (control as { text?: string }).text : undefined,
    binding: 'binding' in control ? (control as { binding?: string }).binding : undefined,
    field: 'field' in control ? (control as { field?: string }).field : undefined,
    expression: 'expression' in control ? (control as { expression?: string }).expression : undefined,
    contentType: (control as { contentType?: 'fixed' | 'variable' | 'expression' }).contentType,
  })

  if (!segs) return control // 无可迁移内容

  const next = { ...control, segments: segs } as T
  return sameLegacy(control, next) ? control : next
}

/**
 * 永远按"最新 cell 字段"派生 segments —— 修复画布→三态输入框反向同步。
 *
 * 与 ensureSegments 的核心区别：
 * - ensureSegments：仅当 segments 缺失时派生（lazy migration）；
 * - rebuildSegmentsFromCell：在 segments 已存在时也重新比对，防止
 *   "segments 与老字段（text/field/expression）漂移"导致 UI 看不到最新状态。
 *
 * 触发场景：用户在画布上用 contentEditable 改完文本，patchCellText 写了 cell.text
 * 但 segments 仍是老值。effectiveCell 通过本函数重派生 → ContentValueEditor
 * 拿到的 segments prop 自动更新（画布→输入框的反向同步）。
 *
 * 不变式：
 * - 聚合 token `{{#xxx}}` 永远不动（buildFooterRow 直接读 cell.text）
 * - 派生失败（无 contentType 且无任何字段）→ 原值
 * - 序列化比对幂等：segments 已是当前 cell 字段的精确表达 → 返回原引用
 * - 派生值与当前 segments 不一致 → 返回新对象，**清空老字段**避免双源并存
 *
 * 注意：本函数只做"派生"，不写回。写回由 caller（CellToolbar.watch(migrate)）触发。
 */
export function rebuildSegmentsFromCell<T extends TriStateControl>(c: T): T {
  // 1) agg-token 永远不动
  if ('text' in c && isAggToken((c as { text?: string }).text)) return c

  // 2) 派生 legacy segments（与 ensureSegments 同款 type 分派）
  const type = (() => {
    if ('type' in c) {
      const t = (c as { type: string }).type
      if (t === 'barcode' || t === 'qrcode') return t as 'barcode' | 'qrcode'
      if (t === 'text') return 'text' as const
    }
    return 'cell' as const
  })()

  const segs = legacyToSegments({
    type,
    value: 'value' in c ? (c as { value?: string }).value : undefined,
    text: 'text' in c ? (c as { text?: string }).text : undefined,
    binding: 'binding' in c ? (c as { binding?: string }).binding : undefined,
    field: 'field' in c ? (c as { field?: string }).field : undefined,
    expression: 'expression' in c ? (c as { expression?: string }).expression : undefined,
    contentType: (c as { contentType?: 'fixed' | 'variable' | 'expression' }).contentType,
  })

  // 3) 派生失败（无可迁移内容）→ 原值
  if (!segs) return c

  // 4) 序列化比对：segments 已是当前 cell 字段的精确表达 → 幂等返回
  if (Array.isArray(c.segments) && JSON.stringify(c.segments) === JSON.stringify(segs)) {
    return c
  }

  // 5) 漂移或缺失：重建 segments + 清空老字段（避免 segments 与老字段双源并存）
  return {
    ...c,
    segments: segs,
    text: undefined,
    field: undefined,
    expression: undefined,
    binding: undefined,
    value: undefined,
  } as T
}