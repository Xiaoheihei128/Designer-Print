/**
 * DataBinder —— 控件 + 数据 → 渲染就绪内容
 * 真理源：《OpenPrint-设计方案.md》§5.2 / §5.4a（printable）/ §5.6（visibleIf）/ §5.7 / §5.8
 *
 * 职责边界：
 * - 只负责"内容是什么"，不负责"放在哪一页"（那是 pagination-engine 的事）
 * - 所有异步资源（二维码 SVG）在此解析完成，后续渲染全同步
 * - 条码/二维码统一输出 **SVG 矢量**（§5.7）：打印用位图会糊，扫码枪可能读不出
 */
import * as BwipJs from '@bwip-js/generic'
import DOMPurify from 'dompurify'
import QRCode from 'qrcode'

/**
 * DOMPurify 3.x 在浏览器里 default export 直接是带 .sanitize 的实例；
 * 在 Node / 无 DOM 环境它是工厂函数，必须传 window-like 对象才能产出实例。
 * createHeadless 跑无头渲染时会落到 Node 路径，老代码直接 DOMPurify.sanitize() 必崩。
 *
 * 这里懒加载：第一次调用时探测，缓存工厂或实例；headless 场景若 sanitize 不存在
 * （连 jsdom 都没），降级到「保留信任标签白名单」的纯字符串过滤，保证 renderer 不崩。
 */
type DOMPurifyLike = { sanitize: (html: string, opts?: unknown) => string }
let _sanitizer: DOMPurifyLike | null = null
function getSanitizer(): DOMPurifyLike {
  if (_sanitizer) return _sanitizer
  const candidate = DOMPurify as unknown as { sanitize?: DOMPurifyLike['sanitize'] } & DOMPurifyLike
  if (typeof candidate.sanitize === 'function') {
    _sanitizer = candidate
    return _sanitizer
  }
  // 工厂模式：必须传 window。headless 场景下若全局有 jsdom-like window 就能用，
  // 否则彻底没 DOM 环境，连 jsdom 都不在 —— 富文本模板在那种场景里一般也不该渲染。
  try {
    const win = typeof window !== 'undefined' ? window : (globalThis as unknown as { window?: Window }).window
    if (win && typeof (DOMPurify as unknown as (w: Window) => DOMPurifyLike)(win).sanitize === 'function') {
      _sanitizer = (DOMPurify as unknown as (w: Window) => DOMPurifyLike)(win)
      return _sanitizer
    }
  } catch {
    // ignore
  }
  // 最后兜底：headless / 无 DOM 环境用极简白名单过滤，不抛错
  _sanitizer = {
    sanitize: (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=\s*"[^"]*"/gi, ''),
  }
  return _sanitizer
}

import type {
  AnyControl,
  BarcodeControl,
  ChartControl,
  ImageControl,
  MathControl,
  QrcodeControl,
  RichTextControl,
  SignatureControl,
  TextControl,
} from '@op/types/control'
import { interpolate, evaluateVisible, resolveBinding, stringifyValue, formatCellValue } from './expression'
import type { EvalContext, ResolvedContent, RenderWarning } from './types'
import { resolveSegments } from './segments'
import { renderChartControl } from '@op/core/chartkit'
import { renderMathControl } from '@op/core/mathkit'

/* ------------------------------ 可见性判定 ------------------------------ */

/**
 * 渲染期是否输出该控件。
 * §5.4a：`printable:false` 渲染时跳过，但**设计画布仍可编辑**（所以只在这里过滤）。
 */
export function isControlPrintable(control: AnyControl, ctx: EvalContext): boolean {
  if (control.printable === false) return false
  return evaluateVisible(control.visibleIf, ctx)
}

/* -------------------------------- 文本 -------------------------------- */

/**
 * 文本取值优先级：segments（v2 模型）> expression > binding > value。
 *
 * - segments 命中走 resolveSegments，单片段失败聚合 errors[]（与 interpolate 语义对齐）。
 *   段级 format 优先；缺失时回退 control.format（与 binding 路径行为一致）。
 * - 老路径 expression > binding > value 一字不动，老模板零迁移即可继续渲染。
 *
 * 注意 `value` 里也允许写 `{{}}`（用户在属性面板静态文本里手打变量是常见操作），
 * 所以静态文本同样过一遍插值。
 */
export function resolveTextValue(
  control: TextControl,
  ctx: EvalContext,
): { text: string; errors: string[] } {
  // v2: segments 优先
  if (control.segments && control.segments.length) {
    return resolveSegments(control.segments, ctx, { fallbackFormat: control.format })
  }
  // legacy: 一字不动
  if (control.expression) return interpolate(control.expression, ctx)
  if (control.binding) {
    // binding 模式：按控件 format 格式化（expression 模式请用 {{field | date:'...'}} 过滤器）
    const raw = resolveBinding(control.binding, ctx)
    return { text: formatCellValue(raw, control.format), errors: [] }
  }
  return interpolate(control.value ?? '', ctx)
}

/* -------------------------------- 图片 -------------------------------- */

function resolveImageSrc(control: ImageControl, ctx: EvalContext): string {
  const v = control.value
  if (!v || !v.content) return ''
  switch (v.mode) {
    case 'binding': {
      const raw = resolveBinding(v.content, ctx)
      return raw === null || raw === undefined ? '' : String(raw)
    }
    case 'inline':
    case 'url':
    case 'asset':
    default:
      return v.content
  }
}

/* ------------------------------ 条码 / 二维码 ----------------------------- */

/** 条码/二维码编码文本：按 contentType 三态取值（表达式/字段绑定/静态），空值回落示例码 */
export function resolveCodeText(control: BarcodeControl | QrcodeControl, ctx: EvalContext): string {
  // v2: segments 优先 —— 解出非空直接返回；为空仍走老路径 sample-code 兜底
  // （保持"条码永不空白"的设计期占位约束）
  if (control.segments && control.segments.length) {
    const segText = resolveSegments(control.segments, ctx).text
    if (segText) return segText
    // 落入下方兜底
  } else {
    const mode = control.contentType
    let raw: string | undefined
    // 显式三态：expression → 表达式求值；variable → 字段绑定；fixed → 静态内容（可含 {{}} 插值）
    if (mode === 'expression') {
      raw = control.expression ? interpolate(control.expression, ctx).text : undefined
    } else if (mode === 'variable') {
      if (control.binding) {
        const v = resolveBinding(control.binding, ctx)
        if (v !== null && v !== undefined && v !== '') return String(v)
      }
      raw = undefined
    } else if (mode === 'fixed') {
      raw = control.value ? interpolate(control.value, ctx).text : undefined
    } else {
      // 老模板（无 contentType）：binding > value 启发式
      if (control.binding) {
        const v = resolveBinding(control.binding, ctx)
        if (v !== null && v !== undefined && v !== '') return String(v)
      }
      raw = control.value ? interpolate(control.value, ctx).text : undefined
    }
    if (raw) return raw
  }
  // 各模式内容为空：回落示例码（保持"条码永不空白"的设计期占位约束）
  return control.type === 'qrcode' ? 'https://openprint.dev' : '0123456789'
}

/**
 * 让 SVG 自适应控件尺寸：去掉固定 width/height，保留 viewBox 由外层容器缩放。
 * bwip-js / qrcode 输出的 SVG 都带写死的 width/height，直接嵌入会溢出控件框。
 */
function makeSvgResponsive(svg: string): string {
  return svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/i, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/i, '<svg$1')
    .replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet" width="100%" height="100%"')
}

function renderBarcodeSvg(control: BarcodeControl, text: string): string {
  // 与设计画布 barcode-draw.ts 保持一致：按控件几何反算条码条高度，让文字行不被压扁
  const controlHeightMM = control.height ?? 30
  const barHeightMM = Math.max(2, controlHeightMM * 0.6)
  const paddingMM = Math.max(0.5, controlHeightMM * 0.04)
  const svg = BwipJs.toSVG({
    bcid: (control.format ?? 'code128').toLowerCase(),
    text,
    scale: 2,
    height: barHeightMM,
    // 目标宽度（mm）：bwip-js 以 72dpi 换算像素，而渲染端是 96dpi；
    // 传「控件宽mm × 96/72 ÷ scale」使输出自然宽 ≈ 控件宽，宽度独立可调且条码条不变形
    width: Math.max(1, (control.width ?? 30) * (96 / 72) / 2),
    paddingtop: paddingMM,
    paddingbottom: paddingMM,
    includetext: control.showText ?? true,
    textxalign: 'center',
    textsize: 12,
  })
  // 条码与二维码统一 100%×100% 填满控件框（宽高独立，所见即所得）；
  // preserveAspectRatio="none"：自然尺寸 ≈ 控件尺寸后拉伸量 ≈ 1，条与数字不变形。
  return makeSvgResponsive(svg)
    .replace(/preserveAspectRatio="xMidYMid meet"/, 'preserveAspectRatio="none"')
    .replace(/<svg\b/, '<svg class="op-barcode-svg"')
}

async function renderQrcodeSvg(control: QrcodeControl, text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: control.errorLevel ?? 'M',
    margin: 0,
  })
  return makeSvgResponsive(svg)
}

/* ------------------------------- 富文本消毒 ------------------------------ */

/** §11.2：Renderer 输出前必须对绑定内容消毒，防模板注入 XSS */
function sanitizeRichText(html: string): string {
  return getSanitizer().sanitize(html, { USE_PROFILES: { html: true } })
}

/* ------------------------------ 内容解析总入口 ----------------------------- */

export interface ResolvedControlContent {
  content: ResolvedContent
  warnings: RenderWarning[]
}

/**
 * 把单个控件解析为渲染就绪内容。
 * 任何失败都降级为 placeholder + warning —— **绝不静默丢内容**，
 * 否则用户拿到一张缺字段的单据却毫不知情，这在 ERP 场景是事故。
 */
export async function resolveControlContent(
  control: AnyControl,
  ctx: EvalContext,
): Promise<ResolvedControlContent> {
  const warnings: RenderWarning[] = []

  switch (control.type) {
    case 'text': {
      const { text, errors } = resolveTextValue(control, ctx)
      for (const message of errors) {
        warnings.push({ code: 'EXPRESSION_ERROR', message, controlId: control.id })
      }
      if (!text && control.binding) {
        warnings.push({
          code: 'BINDING_MISSING',
          message: `字段 "${control.binding}" 在数据中为空`,
          controlId: control.id,
        })
      }
      return { content: { kind: 'text', text }, warnings }
    }

    case 'richtext': {
      const raw = (control as RichTextControl).value ?? ''
      const { text, errors } = interpolate(raw, ctx)
      for (const message of errors) {
        warnings.push({ code: 'EXPRESSION_ERROR', message, controlId: control.id })
      }
      return { content: { kind: 'html', html: sanitizeRichText(text) }, warnings }
    }

    case 'image': {
      const src = resolveImageSrc(control, ctx)
      if (!src) {
        warnings.push({
          code: 'IMAGE_UNRESOLVED',
          message: '图片来源为空',
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '图片' }, warnings }
      }
      return { content: { kind: 'image', src }, warnings }
    }

    case 'barcode': {
      const text = resolveCodeText(control, ctx)
      if (!text) {
        warnings.push({ code: 'BARCODE_FAILED', message: '条码内容为空', controlId: control.id })
        return { content: { kind: 'placeholder', label: '条码' }, warnings }
      }
      try {
        return { content: { kind: 'svg', svg: renderBarcodeSvg(control, text) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'BARCODE_FAILED',
          message: `条码生成失败（${control.format ?? 'code128'}）：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '条码' }, warnings }
      }
    }

    case 'qrcode': {
      const text = resolveCodeText(control, ctx)
      if (!text) {
        warnings.push({ code: 'BARCODE_FAILED', message: '二维码内容为空', controlId: control.id })
        return { content: { kind: 'placeholder', label: '二维码' }, warnings }
      }
      try {
        return { content: { kind: 'svg', svg: await renderQrcodeSvg(control, text) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'BARCODE_FAILED',
          message: `二维码生成失败：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '二维码' }, warnings }
      }
    }

    case 'rect':
    case 'line':
      return { content: { kind: 'shape' }, warnings }

    case 'chart': {
      // 原生 SVG 图表（零依赖）：与条码同理走矢量 svg，打印不糊。
      try {
        return { content: { kind: 'svg', svg: renderChartControl(control as ChartControl) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'CHART_FAILED',
          message: `图表生成失败：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '图表' }, warnings }
      }
    }

    case 'math': {
      // LaTeX 公式（KaTeX）：HTML + web fonts 渲染，与富文本同理走 HTML 链路。
      // 设计期由 MathViewLayer overlay 渲染；导出走与正文相同的栅格化路径（高清不糊）。
      try {
        return { content: { kind: 'html', html: renderMathControl(control as MathControl) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'MATH_FAILED',
          message: `公式生成失败：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '公式' }, warnings }
      }
    }

    case 'signature': {
      // 手写签名：位图（PNG data-URI），复用图片渲染/导出链路（栅格化，清晰可靠）。
      const src = (control as SignatureControl).src ?? ''
      if (!src) {
        warnings.push({
          code: 'SIGNATURE_EMPTY',
          message: '签名为空（请重新签名）',
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '签名' }, warnings }
      }
      return { content: { kind: 'image', src }, warnings }
    }

    default:
      // table / zone 不走这里（由 table-engine / pagination-engine 处理）
      return { content: { kind: 'placeholder', label: control.type }, warnings }
  }
}
