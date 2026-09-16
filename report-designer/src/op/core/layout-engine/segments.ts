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
import type { EvalContext, RenderPart } from './types'
import { evaluate, resolveBinding, formatCellValue } from './expression'
import { isAggToken } from './aggregate'
import { resolveImageSrcForSegment } from './code-render'

/* -------------------------------- 求值 -------------------------------- */

export interface ResolveSegmentsOptions {
  /** 段级 format 缺失时的兜底（通常为 cell.format ?? col.format） */
  fallbackFormat?: CellFormat
  /**
   * 段级 SVG 缓存查找函数 —— 由 pagination-engine 在 buildTableModel 之前预生成。
   * 接受 (segIdx, path, value) → svg 字符串|undefined。
   * 命中后,占位 text:'' 被替换成 {kind:'svg'}。
   * 未传或未命中 → 保留 {kind:'text', text:''} 占位,运行期仍可渲染（只是没有 svg 形态）。
   *
   * 用 lookup 函数而非 Map:让 caller 自定 key 策略(同 cell 内 resolveSegments 的
   * segIdx 是 cell-local;caller 负责把它转成全局 key,例如 `${cellIdx}:${segIdx}:...`)。
   */
  svgLookup?: (segIdx: number, path: string, value: string) => string | undefined
}

export interface ResolveSegmentsResult {
  text: string
  /** ★ 段级渲染分段：含 svg/image 的形态段 + text 段混排 */
  parts: RenderPart[]
  errors: string[]
}

/** 段级形态专属空值占位（按用户决策：不回落示例码，显示轻量灰色提示） */
function emptyDisplayLabel(kind: 'qrcode' | 'barcode' | 'image'): string {
  return kind === 'qrcode' ? '(空二维码)' : kind === 'barcode' ? '(空条码)' : '(空图)'
}

/**
 * 形态段默认显示尺寸(mm)。用户没显式设 display.heightMm/widthMm 时使用——
 * 否则 measureRowHeight 只兜底 `fontSize * 1.5` ≈ 13.5mm,远不够 SVG 真实尺寸。
 * 表格 td 用 `width:100% height:100% preserveAspectRatio="none"` 把 SVG 强压,
 * SVG 被切 → 行看起来"被截断"。
 *
 * - qrcode:紧凑型,15mm 方块够 4 级纠错 30 字符
 * - barcode:Code128+showText 默认需 25mm(条码 ~15mm + 数字行 ~10mm)
 * - image:15mm 默认(可由 fit 配合 columnWidth 自适应)
 *
 * PR-A:同时透传 userDisplay.lockRatio / fitMode,renderer 据此决定精确 vs 自适应输出。
 * 注:本函数保留默认 heightMm 兜底逻辑(25/15mm),PR-C.5/C 才完整改 measurer。
 */
function defaultDisplayForFormat(
  kind: 'qrcode' | 'barcode' | 'image',
  userDisplay?: {
    widthMm?: number
    heightMm?: number
    lockRatio?: boolean
    fitMode?: 'auto' | 'fixed'
  },
): {
  widthMm?: number
  heightMm: number
  lockRatio?: boolean
  fitMode?: 'auto' | 'fixed'
} {
  const defaultH = kind === 'barcode' ? 25 : 15
  return {
    widthMm: userDisplay?.widthMm,
    heightMm: userDisplay?.heightMm ?? defaultH,
    lockRatio: userDisplay?.lockRatio,
    fitMode: userDisplay?.fitMode,
  }
}

/**
 * 求值 segments 数组 —— 拼接各片段字符串 + 输出结构化 parts
 *
 * - 空数组 / undefined → `{ text: '', parts: [], errors: [] }`
 * - 任一段失败不影响其它段，错误信息塞 errors[]
 * - field 段识别 seg.format.kind === 'qrcode'|'barcode'|'image':
 *   - 非空值 → image 段立即 resolveImageSrcForSegment 出 src;qrcode/barcode
 *     段输出 {kind:'text', text:''} 占位(SVG 由 precomputeCodeSvgs 后续塞回)
 *   - 空值 → {kind:'text', text:'(空形态)'} 灰色提示,符合用户「不回落示例码」决策
 */
export function resolveSegments(
  segments: Segment[] | undefined,
  ctx: EvalContext,
  opts: ResolveSegmentsOptions = {},
): ResolveSegmentsResult {
  if (!segments || segments.length === 0) {
    return { text: '', parts: [], errors: [] }
  }

  const errors: string[] = []
  const textParts: string[] = []
  const renderParts: RenderPart[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    try {
      const out = resolveOne(seg, ctx, opts, i)
      textParts.push(out.text)
      renderParts.push(...out.parts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`segment[${i}] (${seg.kind}): ${msg}`)
      textParts.push('')
    }
  }

  return { text: textParts.join(''), parts: renderParts, errors }
}

/**
 * 单段求值：返回 text(老 string 契约)+ parts(段级结构化结果)
 * - text 段 → parts 只有 1 个 {kind:'text'}
 * - field 段(普通) → parts 1 个 {kind:'text', text:formatCellValue 走老路径}
 * - field 段(形态 + 非空值) → image 立即出 src;qrcode/barcode 占位
 *   {kind:'text', text:''} 待预生成塞回 svg
 * - field 段(形态 + 空值) → {kind:'text', text:'(空形态)'} 占位
 * - expr 段 → {kind:'text', text:String(v)}
 */
function resolveOne(
  seg: Segment,
  ctx: EvalContext,
  opts: ResolveSegmentsOptions,
  segIdx: number,
): { text: string; parts: RenderPart[] } {
  if (seg.kind === 'text') {
    const v = seg.value ?? ''
    return { text: v, parts: [{ kind: 'text', text: v }] }
  }
  if (seg.kind === 'field') {
    if (!seg.path) return { text: '', parts: [] }
    const raw = resolveBinding(seg.path, ctx)
    const fmt = seg.format ?? opts.fallbackFormat
    const fkind = fmt?.kind
    // ★ 段级形态分支
    if (fkind === 'image' || fkind === 'qrcode' || fkind === 'barcode') {
      // 形态对空值:显示占位(用户决策 — 不回落示例码)
      if (raw === null || raw === undefined || raw === '') {
        return {
          text: emptyDisplayLabel(fkind),
          parts: [{ kind: 'text', text: emptyDisplayLabel(fkind) }],
        }
      }
      const value = String(raw)
      if (fkind === 'image') {
        // 图片:立即出 src
        const src = resolveImageSrcForSegment(seg.path, ctx)
        return {
          text: '',
          parts: [
            {
              kind: 'image',
              src,
              alt: seg.path,
              meta: { display: defaultDisplayForFormat('image', fmt?.display), fit: fmt?.fit },
            },
          ],
        }
      }
      // qrcode/barcode:占位 {kind:'text', text:''},svg 由 svgLookup 命中则替换
      if (opts.svgLookup) {
        const svg = opts.svgLookup(segIdx, seg.path, value)
        if (svg) {
          return {
            text: '',
            // ★ PR-C.5:meta 携带 field/value/formatKind/bcid/errorLevel,供 measureRowHeight
            //   查 naturalDims 缓存(renderPart 不持有 segment 引用,只能塞到 meta 里)
            parts: [
              {
                kind: 'svg',
                svg,
                meta: {
                  display: defaultDisplayForFormat(fkind, fmt?.display),
                  field: seg.path,
                  value,
                  formatKind: fkind === 'barcode' ? 'barcode' : 'qrcode',
                  bcid: fmt?.bcid,
                  errorLevel: fmt?.errorLevel,
                },
              },
            ],
          }
        }
      }
      return { text: '', parts: [{ kind: 'text', text: '' }] }
    }
    // 普通 field 段:走老 formatCellValue 路径
    const formatted = formatCellValue(raw, fmt)
    return { text: formatted, parts: [{ kind: 'text', text: formatted }] }
  }
  // seg.kind === 'expr'
  const v = evaluate(seg.src, ctx)
  const text = v === null || v === undefined ? '' : String(v)
  return { text, parts: [{ kind: 'text', text }] }
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
  // ★ 新增：空字符串或纯空白 → 视为"无内容"，返回 null 而不是生成 [{text:''}]
  //   否则 ensureSegments 会把"用户主动清空"的控件迁移成"1 个空 text 段"，
  //   ContentValueEditor 看到 segments.length=1 但 segmentsToText=''，出现
  //   "1 个片段 + textarea 空 + 预览 (空)"的不一致状态，且后续画布走 segments 路径
  //   显示空是巧合（resolveSegments([]) 与 resolveSegments([{text:''}]) 都返回 ''），
  //   但 segment 标签"1 个片段"暴露了脏数据。
  //   重要：保留对 '  {{#totalSum}}  '（含聚合 token 的带前后缀） 的支持 —— 聚合 token
  //   整体保留为单 text 段，即使前后空白也算有效内容。
  const hasMeaningfulFixedText =
    typeof fixedText === 'string' && fixedText.trim() !== ''

  // ★ 0) text/value 含 {{...}} 混合内容 → 直接按文本切分（保留前后缀）
  // 优先级最高 —— 用户显式输入 {{...}}suffix 即表达"我要混合内容"意图，
  // 不能被 field 字段覆盖（field 通常是早期自动绑定残留，与用户最新输入不一致）。
  // 例：cell.text='{{ReportItems[].TestStandard}}kg' + cell.field='ReportItems[].TestStandard'
  //     → 必须拆成 [{expr, TestStandard}, {text, ' kg'}]，否则 "kg" 后缀丢失
  if (hasMeaningfulFixedText && /\{\{[\s\S]+?\}\}/.test(fixedText!)) {
    return splitFixedText(fixedText!)
  }

  // 1) 显式 contentType 优先
  if (ct === 'variable') {
    if (bindPath) return [{ kind: 'field', path: bindPath }]
    // variable 但无 binding —— 回落到 fixed
  } else if (ct === 'expression' && src.expression) {
    return [{ kind: 'expr', src: src.expression }]
  } else if (ct === 'fixed' && hasMeaningfulFixedText) {
    return splitFixedText(fixedText!)
  }

  // 2) 启发式回退
  if (isCode) {
    if (bindPath) return [{ kind: 'field', path: bindPath }]
    if (typeof src.value === 'string' && src.value.trim() !== '') return splitFixedText(src.value)
    return null
  }

  // text / cell 优先级: expression > binding > field > value/text
  if (src.expression) return [{ kind: 'expr', src: src.expression }]
  if (src.binding) return [{ kind: 'field', path: src.binding }]
  if (src.field) return [{ kind: 'field', path: src.field }]
  if (hasMeaningfulFixedText) return splitFixedText(fixedText!)

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
 *
 * 导出供 patchCellText / write 路径复用，避免在 design 层反向依赖 core 层。
 */
export function splitFixedText(text: string): Segment[] {
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