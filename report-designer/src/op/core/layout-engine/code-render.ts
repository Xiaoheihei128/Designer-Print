/**
 * code-render —— 段级码/图渲染纯函数
 *
 * 职责：
 * - 把 (text, opts) 转成 SVG 字符串或图片 src（与 control 类型解耦）
 * - 供表格 cell 段级调用 + 顶层 BarcodeControl/QrcodeControl/ImageControl 调用
 * - 唯一 async：`renderQrcodeSvg`（qrcode 库 toString 异步）
 *
 * 复用关系：
 * - data-binder.ts 的 renderBarcodeSvg / renderQrcodeSvg / makeSvgResponsive / resolveImageSrc binding 分支
 *   改为薄壳委托到本文件（保持现有 export 不变）
 * - bwip-js 同步；qrcode 库异步（用 Promise.all 并行预生成）
 */
import * as BwipJs from '@bwip-js/generic'
import QRCode from 'qrcode'
import type { SegmentDisplayOpts } from '@op/types/control'
import type { EvalContext } from '@op/core/layout-engine/expression'
import { resolveBinding } from '@op/core/layout-engine/expression'
import type { Segment } from '@op/types/control'

/* ============================================================
 * 形态段标识（用于预生成 cache key）
 * ============================================================ */

/** 段级 svg 缓存 key —— value 参与,因为不同字段值渲染出不同 svg */
export type SegSvgKey = string

export function makeSegSvgKey(segIdx: number, seg: Segment, value: string): SegSvgKey {
  const path = seg.kind === 'field' ? seg.path : seg.kind === 'expr' ? seg.src : ''
  return `${segIdx}:${path}:${value}`
}

/* ============================================================
 * 段级几何适配（cell 几何 → bwip-js/qrcode 参数）
 * ============================================================ */

export interface BarcodeRenderOpts {
  /** bwip-js bcid（CODE128 / EAN13 / CODE39 / UPC ...），默认 code128 */
  bcid?: string
  /** 是否在码下方显示文本，默认 true */
  showText?: boolean
  /** 目标宽度（mm），缺省 30 */
  widthMm?: number
  /** 目标高度（mm），缺省 30；bar 高度按 0.6× 算 */
  heightMm?: number
}

export interface QrcodeRenderOpts {
  /** 纠错等级 L/M/Q/H，默认 M */
  errorLevel?: 'L' | 'M' | 'Q' | 'H'
}

export interface ImageResolveOpts {
  /** 字段路径（走 resolveBinding 解值） */
  path: string
  ctx: EvalContext
}

/* ============================================================
 * 纯函数
 * ============================================================ */

/**
 * 让 SVG 自适应容器：去掉固定 width/height，保留 viewBox 由外层容器缩放。
 * bwip-js / qrcode 输出的 SVG 都带写死的 width/height，直接嵌入会溢出容器框。
 *
 * @param mode 'meet'（默认，等比留白）/ 'none'（拉伸填满，条形码用）
 */
export function makeSvgResponsive(svg: string, mode: 'meet' | 'none' = 'meet'): string {
  let out = svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/i, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/i, '<svg$1')
  const ratio = mode === 'none' ? 'none' : 'xMidYMid meet'
  out = out.replace(/<svg\b/i, `<svg preserveAspectRatio="${ratio}" width="100%" height="100%"`)
  return out
}

/**
 * 条形码 SVG 同步生成（bwip-js）。
 * 与原 data-binder.ts:174 行为一致：bar 高度 = 控件高 × 0.6，padding = 0.04× 控件高。
 */
export function renderBarcodeSvgSync(text: string, opts: BarcodeRenderOpts = {}): string {
  const controlHeightMM = opts.heightMm ?? 30
  const controlWidthMM = opts.widthMm ?? 30
  const barHeightMM = Math.max(2, controlHeightMM * 0.6)
  const paddingMM = Math.max(0.5, controlHeightMM * 0.04)
  // ★ PR-E.1 bug fix:加 paddingwidth 给 bwip-js,水平留 quiet zone (≈3mm at controlWidthMM=30)
  //   扫码枪需要左右 quiet zone ≥ 10 modules(≈2.5mm @ 0.25mm/bar)。bwip-js 默认 paddingwidth=1
  //   在 scale=2 时仅 2 单位 ≈ 0.18mm,完全不够,手动拉伸 cell 后仍然扫不出。
  //   paddingwidth=10 单位(20 units @ scale=2) ≈ 3.5mm at 30mm 显示,扫枪可解码。
  const widthPassedToBwip = Math.max(1, controlWidthMM * (96 / 72) / 2)
  const svg = BwipJs.toSVG({
    bcid: (opts.bcid ?? 'code128').toLowerCase(),
    text,
    scale: 2,
    height: barHeightMM,
    // 目标宽度（mm）：bwip-js 以 72dpi 换算像素，而渲染端是 96dpi；
    // 传「控件宽mm × 96/72 ÷ scale」使输出自然宽 ≈ 控件宽，宽度独立可调且条码条不变形
    width: widthPassedToBwip,
    paddingtop: paddingMM,
    paddingbottom: paddingMM,
    paddingwidth: 10,
    includetext: opts.showText ?? true,
    textxalign: 'center',
    textsize: 12,
  })
  // ★ DEBUG:打日志,看字段值 → bwip-js 输入参数 → 输出 svg 元数据全链路
  //   包含:字段原始值、用户设定 size、换算后传入 bwip-js 的 width、viewBox、
  //   第一根 bar 实际位置(算 quiet zone mm)→ 验证 PR-E.1 quiet zone 是否够
  const viewMatch = svg.match(/<svg[^>]*\bviewBox="([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)"/i)
  const pathMatch = svg.match(/<path[^>]*\bd="(M[\d.\-]+)/)
  const firstBarX = pathMatch ? parseFloat(pathMatch[1]!.slice(1)) : null
  const vbW = viewMatch ? parseFloat(viewMatch[3]!) : null
  const quietZoneMm = vbW && firstBarX !== null
    ? {
        left: +(firstBarX * (controlWidthMM / vbW)).toFixed(3),
        right: +(((vbW - (firstBarX + (vbW - 2 * 10 * 2))) * (controlWidthMM / vbW)).toFixed(3)),
      }
    : null
  console.log('[barcode-render] 字段 → 条形码', {
    字段值: text,
    bcid: opts.bcid ?? 'code128',
    showText: opts.showText ?? true,
    用户尺寸: { widthMm: opts.widthMm, heightMm: opts.heightMm },
    换算后: {
      controlHeightMM,
      controlWidthMM,
      barHeightMM: barHeightMM.toFixed(2),
      paddingMM: paddingMM.toFixed(2),
      width传给bwip: widthPassedToBwip.toFixed(2),
      paddingwidth: 10,
    },
    输出svg: {
      viewBox: viewMatch ? `${viewMatch[1]} ${viewMatch[2]} ${viewMatch[3]} ${viewMatch[4]}` : '?',
      firstBarX,
      vbW,
      quietZoneMm,
    },
  })
  return makeSvgResponsive(svg, 'none')
    .replace(/<svg\b/, '<svg class="op-barcode-svg"')
}

/**
 * 二维码 SVG 异步生成（qrcode 库 toString 异步）。
 * 阻塞点 → 必须用 precomputeCodeSvgs 预生成缓存，buildTableModel 同步消费。
 */
export async function renderQrcodeSvgSync(text: string, opts: QrcodeRenderOpts = {}): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: opts.errorLevel ?? 'M',
    margin: 0,
  })
  return makeSvgResponsive(svg, 'meet')
}

/**
 * 段级图片 src 解析：纯 binding 模式（字段路径 → resolveBinding → String）。
 * 顶层 ImageControl 另有 inline/url/asset 模式，留在 data-binder.ts 不动。
 */
export function resolveImageSrcForSegment(path: string, ctx: EvalContext): string {
  const raw = resolveBinding(path, ctx)
  return raw === null || raw === undefined ? '' : String(raw)
}

/* ============================================================
 * 预生成缓存（commit 6 在 pagination-engine 入口调用）
 * ============================================================ */

/** 一组 segments 一次性预生成所有码 svg，返回 cache map */
export async function precomputeCodeSvgs(
  segments: Segment[],
  ctx: EvalContext,
): Promise<Map<SegSvgKey, string>> {
  const cache = new Map<SegSvgKey, string>()
  const tasks: Array<Promise<void>> = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (seg.kind !== 'field') continue
    const fmt = seg.format
    if (!fmt) continue
    const fkind = fmt.kind
    if (fkind !== 'qrcode' && fkind !== 'barcode') continue
    const raw = resolveBinding(seg.path, ctx)
    const value = raw === null || raw === undefined ? '' : String(raw)
    if (!value) continue // 空值不预生成（由 resolveSegments 输出占位符）
    const key = makeSegSvgKey(i, seg, value)
    if (fkind === 'barcode') {
      // 同步：直接 push 到 cache
      const svg = renderBarcodeSvgSync(value, {
        bcid: fmt.bcid,
        showText: fmt.showText,
        widthMm: fmt.display?.widthMm,
        heightMm: fmt.display?.heightMm,
      })
      cache.set(key, svg)
    } else {
      // 异步：丢进 Promise.all
      tasks.push(
        renderQrcodeSvgSync(value, { errorLevel: fmt.errorLevel }).then((svg) => {
          cache.set(key, svg)
        }),
      )
    }
  }
  await Promise.all(tasks)
  return cache
}

/**
 * 跨 cell 预生成：把 cells 二维网格 flatten 后统一预生成。
 * key 用 `${path}:${value}` —— 同 path 同 value 的 svg 内容一定相同(码内容决定 svg),
 * 跨 cell 同形态段可共用一份缓存,无需 cellIdx 隔开。
 *
 * valuesByPath 是 path→Set<value> 的样本集合 —— 由 caller 提前从 data 收集所有可能值,
 * 我们无需在 pagination-engine 上下文做 resolveBinding(那需要 rowCtx,难做)。
 * 对 (path, value) 笛卡尔积生成 svg:每对 path × 每个 value 生成一次。
 */
export async function precomputeCodeSvgsForCells(
  cellSegments: Segment[][],
  valuesByPath: Map<string, Set<string>>,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>()
  const tasks: Array<Promise<void>> = []
  for (const segs of cellSegments) {
    for (const seg of segs) {
      if (seg.kind !== 'field') continue
      const fmt = seg.format
      if (!fmt) continue
      const fkind = fmt.kind
      if (fkind !== 'qrcode' && fkind !== 'barcode') continue
      // 取 path 对应的所有 value 样本(空集合 → 跳过)
      const values = valuesByPath.get(seg.path)
      if (!values || values.size === 0) continue
      for (const value of values) {
        if (!value) continue
        const key = `${seg.path}:${value}`
        if (cache.has(key)) continue
        if (fkind === 'barcode') {
          const svg = renderBarcodeSvgSync(value, {
            bcid: fmt.bcid,
            showText: fmt.showText,
            widthMm: fmt.display?.widthMm,
            heightMm: fmt.display?.heightMm,
          })
          cache.set(key, svg)
        } else {
          tasks.push(
            renderQrcodeSvgSync(value, { errorLevel: fmt.errorLevel }).then((svg) => {
              cache.set(key, svg)
            }),
          )
        }
      }
    }
  }
  await Promise.all(tasks)
  return cache
}

/* ============================================================
 * 形态段 display 配置构建（cell 渲染层用）
 * ============================================================ */

export function displayOptsFromFormat(seg: Segment): SegmentDisplayOpts | undefined {
  if (seg.kind !== 'field' || !seg.format) return undefined
  return seg.format.display
}
