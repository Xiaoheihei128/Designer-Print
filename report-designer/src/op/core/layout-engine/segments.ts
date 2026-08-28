/**
 * segments —— 内容片段数组求值器（v2 模型）
 *
 * 把"3 选 1 互斥字段（value/binding/expression + contentType）"升级为
 * "有序的多片段数组"。任意文本/字段/表达式自由组合，例如：
 *   [{kind:'text', value:'外观：'},
 *    {kind:'field', path:'items[].name'},
 *    {kind:'text', value:' kg'}]
 *
 * 设计要点（与 plan §"硬约束清单"对齐）：
 * 1. **单片段失败不抛** —— errors[] 聚合（与 interpolate 语义对齐；与 evaluate 抛错语义不同，
 *    因为 segments 是"分段独立求值"，任一段失败不能阻断其它段）
 * 2. **空 segments → ''**（与 empty segments 数组一致）
 * 3. **空 path field → ''**（与 data-binder.ts:91-93 空 binding 行为对齐）
 * 4. **field 段调 formatCellValue**（段级 format > fallbackFormat > 无）
 * 5. **text / expr 段不调 formatCellValue**（与现状 text/expr 模式行为一致）
 * 6. **agg-token 守门**：splitFixedText 命中 isAggToken 保持整体单 text 段，
 *    由 dataCellText/staticCellText 顶层用 isAggToken 短路返回 ''，让 buildFooterRow 接管
 *
 * legacyToSegments 负责把老 schema 字段（value/binding/expression/contentType + text/field）
 * 压成 segments，用于渲染层 fallback 与 Properties Panel lazy migration。
 */
import type { Segment, CellFormat } from '@op/types/control'
import type { EvalContext } from './types'
import { evaluate, resolveBinding, formatCellValue } from './expression'
import { isAggToken } from './aggregate'

/* -------------------------------- 求值 -------------------------------- */

export interface ResolveSegmentsOptions {
  /** 段级 format 缺失时的兜底（通常为 cell.format ?? col.format） */
  fallbackFormat?: CellFormat
}

export interface ResolveSegmentsResult {
  text: string
  errors: string[]
}

/**
 * 求值 segments 数组 —— 拼接各片段字符串
 *
 * - 空数组 / undefined → `{ text: '', errors: [] }`
 * - 任一段失败不影响其它段，错误信息塞 errors[]
 */
export function resolveSegments(
  segments: Segment[] | undefined,
  ctx: EvalContext,
  opts: ResolveSegmentsOptions = {},
): ResolveSegmentsResult {
  if (!segments || segments.length === 0) {
    return { text: '', errors: [] }
  }

  const errors: string[] = []
  const parts: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    try {
      parts.push(resolveOne(seg, ctx, opts))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`segment[${i}] (${seg.kind}): ${msg}`)
      parts.push('')
    }
  }

  return { text: parts.join(''), errors }
}

function resolveOne(
  seg: Segment,
  ctx: EvalContext,
  opts: ResolveSegmentsOptions,
): string {
  if (seg.kind === 'text') {
    return seg.value ?? ''
  }
  if (seg.kind === 'field') {
    if (!seg.path) return ''
    const raw = resolveBinding(seg.path, ctx)
    const fmt = seg.format ?? opts.fallbackFormat
    return formatCellValue(raw, fmt)
  }
  // seg.kind === 'expr'
  const v = evaluate(seg.src, ctx)
  if (v === null || v === undefined) return ''
  return String(v)
}

/* -------------------------------- 老模板兼容 -------------------------------- */

export type LegacySourceType = 'text' | 'cell' | 'barcode' | 'qrcode'

/**
 * 老 schema 字段集合（text 与 value 名字不同，按 ctor 分派读取）。
 * 不传 type 时按 text/cell 优先级（expression > binding/field > value/text）。
 */
export interface LegacySource {
  type?: LegacySourceType
  /** TextControl / BarcodeControl / QrcodeControl 的固定值 */
  value?: string
  /** TableCell 的固定文字（与 value 同义，按 ctor 选） */
  text?: string
  /** TextControl / BarcodeControl / QrcodeControl 的字段绑定路径 */
  binding?: string
  /** TableCell 的字段绑定路径 */
  field?: string
  /** expression 字段（4 类控件共用） */
  expression?: string
  contentType?: 'fixed' | 'variable' | 'expression'
}

/**
 * 把老 schema 字段压成 segments
 *
 * 返回值：
 * - null：所有字段都空，无可迁移内容（caller 应保持原状）
 * - []：与 null 同义，备用
 * - Segment[]：按 ctor 优先级压成的数组
 *
 * 优先级（按 type 分派，与现状渲染回退路径严格对齐）：
 * - text/cell:    expression > binding/field > value/text
 * - barcode/qrcode: binding > value（不识别 expression 字段 —— 与 resolveCodeText 一致）
 *
 * 字段名差异（text 控件用 value/binding，cell 控件用 text/field）由 type 决定读取哪个。
 */
export function legacyToSegments(src: LegacySource): Segment[] | null {
  const ct = src.contentType
  // 兼容字段名：cell 用 text/text ctor，控件用 value
  const isCell = src.type === 'cell'
  const isCode = src.type === 'barcode' || src.type === 'qrcode'
  const fixedText = isCell ? src.text : src.value
  const bindPath = isCell ? src.field : src.binding

  // ★ 0) text/value 含 {{...}} 混合内容 → 直接按文本切分（保留前后缀）
  // 优先级最高 —— 用户显式输入 {{...}}suffix 即表达"我要混合内容"意图，
  // 不能被 field 字段覆盖（field 通常是早期自动绑定残留，与用户最新输入不一致）。
  // 例：cell.text='{{ReportItems[].TestStandard}}kg' + cell.field='ReportItems[].TestStandard'
  //     → 必须拆成 [{expr, TestStandard}, {text, ' kg'}]，否则 "kg" 后缀丢失
  if (typeof fixedText === 'string' && /\{\{[\s\S]+?\}\}/.test(fixedText)) {
    return splitFixedText(fixedText)
  }

  // 1) 显式 contentType 优先
  if (ct === 'variable') {
    if (bindPath) return [{ kind: 'field', path: bindPath }]
    // variable 但无 binding —— 回落到 fixed
  } else if (ct === 'expression' && src.expression) {
    return [{ kind: 'expr', src: src.expression }]
  } else if (ct === 'fixed' && typeof fixedText === 'string') {
    return splitFixedText(fixedText)
  }

  // 2) 启发式回退
  if (isCode) {
    if (bindPath) return [{ kind: 'field', path: bindPath }]
    if (typeof src.value === 'string') return splitFixedText(src.value)
    return null
  }

  // text / cell 优先级: expression > binding > field > value/text
  if (src.expression) return [{ kind: 'expr', src: src.expression }]
  if (src.binding) return [{ kind: 'field', path: src.binding }]
  if (src.field) return [{ kind: 'field', path: src.field }]
  if (typeof fixedText === 'string') return splitFixedText(fixedText)

  return null
}

/**
 * 把 fixed 文本按 `{{...}}` 切分成 text / expr 段
 *
 * - 命中 agg token（`{{#pageSum}}` 等）→ 整体保留为 1 个 text 段（由 caller 用 isAggToken 短路）
 * - 普通 `{{...}}` → 1 个 expr 段（保持与老模板走 expression 路径的行为一致：
 *   老模板里 `{{path}}` 经 interpolate → evaluate 求值，结果与 resolveBinding 等价）
 * - 中间与两端的字面量 → text 段
 *
 * 注：本函数不区分纯 path 与含运算/管道 —— 都归为 expr。
 * 真正"现代化"的纯 path 翻译由 Properties Panel lazy migration（ensureSegments）负责。
 */
function splitFixedText(text: string): Segment[] {
  if (!text) return [{ kind: 'text', value: '' }]
  if (isAggToken(text)) return [{ kind: 'text', value: text }]
  if (!text.includes('{{')) return [{ kind: 'text', value: text }]

  const parts: Segment[] = []
  const re = /\{\{([\s\S]*?)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ kind: 'text', value: text.slice(last, m.index) })
    }
    parts.push({ kind: 'expr', src: m[1]!.trim() })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    parts.push({ kind: 'text', value: text.slice(last) })
  }
  return parts.length ? parts : [{ kind: 'text', value: text }]
}