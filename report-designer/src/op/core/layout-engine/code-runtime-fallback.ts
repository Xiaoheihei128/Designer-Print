/**
 * code-runtime-fallback —— 段级码/图的 naturalDims 缓存 + 同步补码
 *
 * ★ PR-C.5 引入(必修):解决 4 个严重问题中的 #2(clamp)和 #3(cache miss)
 *   - cache key 不分 bcid/errorLevel → 由 code-render.ts:198 makeCodeKey 修
 *   - CSS clamp vs measurer 不对称 → clampUserWidthToColumn 在 measurer 入口前置
 *   - 动态数据 cache miss → ensureCodeNaturalDimsSync 同步补码
 *
 * 设计要点:
 * - naturalDims 是 (path, value, bcid, errorLevel) → NaturalCodeDims 的映射
 * - 同步补码:cache miss 时 measurer 调用 ensureCodeNaturalDimsSync 跑一次 bwip-js (~1ms)
 * - 失败兜底:bwip-js 抛错(字符不支持)返回 undefined,让 caller fallback 到 25mm + warning
 *
 * 与 code-render.ts 的关系:
 * - precomputeCodeSvgsForCells 改用 makeCodeKey 生成 cache key
 * - pagination-engine 在预生成 svg 后,再预生成 naturalDims 缓存,一并传入 buildTableModel
 */
import * as BwipJs from '@bwip-js/generic'
import type { CellFormat, Segment } from '@op/types/control'
import type { RenderWarning } from './types'

/* ============================================================
 * 类型
 * ============================================================ */

/**
 * 段级码/图的自然尺寸。
 * aspect = naturalWidthMm / naturalHeightMm(用户 lockRatio 时按此比例反推另一维)。
 *
 * 二维码永远 1:1(由 ensureCodeNaturalDimsSync 直接写死),条码 aspect 取决于
 * (bcid, text 字符数),由 measureNaturalBarcodeDimsSync 在 30×30mm 探针 SVG 中解析 viewBox 得出。
 */
export interface NaturalCodeDims {
  naturalWidthMm: number
  naturalHeightMm: number
  /** naturalWidthMm / naturalHeightMm */
  aspect: number
}

/* ============================================================
 * Cache key —— 必须包含 bcid/errorLevel,否则同 path 不同格式会撞车(行高算错)
 * ============================================================ */

/**
 * Cache key 策略:`${path}:${value}:${bcid || ''}:${errorLevel || ''}`
 * - path + value:绑定的字段路径 + 当前值(同一字段不同值出不同 svg)
 * - bcid:条码类型(CODE128/EAN13/CODE39...),不同 bcid 输出 svg 完全不同
 * - errorLevel:二维码纠错等级(L/M/Q/H),影响 module 数量 → 影响 svg 复杂程度
 *
 * 注:bcid/errorLevel 缺省时填空串占位,确保 key 长度固定(避免空字符串拼接歧义)。
 */
export function makeCodeKey(path: string, value: string, fmt: CellFormat): string {
  const bcid = (fmt.bcid ?? '')
  const errorLevel = (fmt.errorLevel ?? '')
  return `${path}:${value}:${bcid}:${errorLevel}`
}

/* ============================================================
 * 同步补码 —— cache miss 时调一次 bwip-js 拿 naturalDims,写入 cache
 * ============================================================ */

/**
 * 同步测一段条码的 naturalDims:在 30×30mm 探针容器跑 bwip-js,解析 SVG viewBox 反推实际渲染尺寸。
 *
 * 算法:
 * 1. 用 (30, 30) 探针调用 bwip-js —— 已知容器宽高 = 30mm
 * 2. 解析输出 SVG 的 viewBox(viewBox 在 makeSvgResponsive 后保留,bwip-js 用 px 为单位)
 * 3. 按 96dpi 把 viewBox 像素 → mm:1px = 25.4/96 mm
 * 4. naturalWidthMm/naturalHeightMm 即条码真实渲染宽高(已含 padding + text)
 * 5. aspect = naturalWidthMm / naturalHeightMm
 *
 * 注:此函数只用于 PR-C.5 同步补码 + PR-C 预生成缓存,运行期 cache hit 后不调用。
 */
export function measureNaturalBarcodeDimsSync(text: string, opts: {
  bcid?: string
  showText?: boolean
}): NaturalCodeDims {
  const probeHeightMM = 30
  const probeWidthMM = 30
  const barHeightMM = Math.max(2, probeHeightMM * 0.6)
  const paddingMM = Math.max(0.5, probeHeightMM * 0.04)
  // 注:不在此处 try/catch —— 让 bwip-js 抛错(bcid 非法 / 字符不支持)向上传播,
  //   由 ensureCodeNaturalDimsSync / precomputeCodeNaturalDims 在调用方按策略处理
  //   (前者返 undefined 让 caller fallback,后者跳过 entry 让运行期再尝试)
  const svg = BwipJs.toSVG({
    bcid: (opts.bcid ?? 'code128').toLowerCase(),
    text,
    scale: 2,
    height: barHeightMM,
    // 与 renderBarcodeSvgSync 同样公式:控件宽mm × 96/72 ÷ scale
    width: Math.max(1, probeWidthMM * (96 / 72) / 2),
    paddingtop: paddingMM,
    paddingbottom: paddingMM,
    // ★ PR-E.1:与 renderBarcodeSvgSync 同步 paddingwidth=10,保证 measurer 测到的
    //   naturalDims 也包含 quiet zone → 行高算对 → 渲染时 SVG 不会溢出 cell
    paddingwidth: 10,
    includetext: opts.showText ?? true,
    textxalign: 'center',
    textsize: 12,
  })
  // 解析 viewBox:格式 `viewBox="x y w h"` (px 单位)
  const m = svg.match(/<svg[^>]*\bviewBox="([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)"/i)
  if (!m) {
    return { naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 }
  }
  const vbW = parseFloat(m[3]!)
  const vbH = parseFloat(m[4]!)
  if (!Number.isFinite(vbW) || !Number.isFinite(vbH) || vbW <= 0 || vbH <= 0) {
    return { naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 }
  }
  // 96dpi:1mm = 96/25.4 px → 1px = 25.4/96 mm
  const mmPerPx = 25.4 / 96
  const naturalWidthMm = vbW * mmPerPx
  const naturalHeightMm = vbH * mmPerPx
  return {
    naturalWidthMm,
    naturalHeightMm,
    aspect: naturalWidthMm / naturalHeightMm,
  }
}

/**
 * 同步补码 cache miss —— measurer 在 cache miss 时调用此函数同步跑一次 bwip-js,
 * 写回 cache。bwip-js 抛错(字符不支持/bcid 错误)返回 undefined,让 caller 走 25mm fallback。
 *
 * @returns { dims, runtimeFallback } - dims=undefined 表示同步补码失败;runtimeFallback=true 表示本次为 cache miss 触发的补码(慢路径)。
 */
export function ensureCodeNaturalDimsSync(
  path: string,
  value: string,
  fmt: CellFormat,
  cache: Map<string, NaturalCodeDims>,
): { dims: NaturalCodeDims | undefined; runtimeFallback: boolean } {
  const key = makeCodeKey(path, value, fmt)
  if (cache.has(key)) {
    return { dims: cache.get(key)!, runtimeFallback: false }
  }
  // cache miss → 同步补码
  try {
    if (fmt.kind === 'barcode') {
      const dims = measureNaturalBarcodeDimsSync(value, {
        bcid: fmt.bcid,
        showText: fmt.showText,
      })
      cache.set(key, dims)
      return { dims, runtimeFallback: true }
    }
    if (fmt.kind === 'qrcode') {
      // qrcode 永远 1:1,无需跑 bwip-js
      const dims: NaturalCodeDims = { naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 }
      cache.set(key, dims)
      return { dims, runtimeFallback: true }
    }
    return { dims: undefined, runtimeFallback: true }
  } catch {
    return { dims: undefined, runtimeFallback: true }
  }
}

/* ============================================================
 * Clamp —— 静默 clamp userWidth 到列宽 - 内边距,避免 CSS 隐式压缩
 * ============================================================ */

/**
 * Clamp userWidthMm 到列宽 - padding(避免 CSS max-width:100% 隐式压后
 * measurer 还按原值算行高,导致 Bug A 复发)。
 *
 * 返回 undefined 表示无需 clamp(userWidth 未设或 ≤ maxW)。
 *
 * @param paddingMm 默认 4mm(2mm 左右各 2mm,默认 cellPadding × 2)
 */
export function clampUserWidthToColumn(
  userWidth: number | undefined,
  colWidthMm: number,
  paddingMm = 4,
): { actual: number; clamped: boolean } {
  if (userWidth === undefined) return { actual: 0, clamped: false }
  const maxW = Math.max(1, colWidthMm - paddingMm)
  const actual = Math.min(userWidth, maxW)
  return { actual, clamped: actual < userWidth }
}

/* ============================================================
 * WarningCode 工厂 —— measurer 用此发出 cache miss 警告
 * ============================================================ */

/**
 * 生成 CODE_NATURAL_DIMS_RUNTIME_FALLBACK 警告(cache miss + 同步补码成功)。
 * 由 caller 注入 controlId。
 */
export function makeRuntimeFallbackWarning(
  field: string,
  controlId?: string,
): RenderWarning {
  return {
    code: 'CODE_NATURAL_DIMS_RUNTIME_FALLBACK',
    message: `字段「${field}」的码/图未在预生成缓存中,运行时同步补码 (~1ms)。建议在预生成阶段覆盖该值。`,
    controlId,
  }
}

/**
 * 生成 CODE_NATURAL_DIMS_FAILED 警告(cache miss + 同步补码失败,bwip-js 抛错)。
 */
export function makeNaturalDimsFailedWarning(
  field: string,
  controlId?: string,
): RenderWarning {
  return {
    code: 'CODE_NATURAL_DIMS_FAILED',
    message: `字段「${field}」的码/图无法测量自然尺寸(bwip-js 抛错,可能字符不支持),回退 25mm 兜底。`,
    controlId,
  }
}

/* ============================================================
 * 预生成入口 —— pagination-engine 在 buildTableModel 前调用
 * ============================================================ */

/**
 * 把 cells 二维网格 flatten 后统一预生成 naturalDims 缓存。
 * key 用 makeCodeKey(path, value, fmt) —— 同 path 同 value 不同 bcid/errorLevel 独立 entry,
 * 避免"同字段不同格式共享 cache 导致行高错"(PR-C.5 必修 bug #1)。
 *
 * 行为契约:
 * - barcode 字段值非空 → 跑一次 bwip-js 探针(30×30mm)+ 解析 SVG viewBox → 缓存 naturalDims
 * - qrcode 字段值非空 → 永远 1:1,直接写 30×30 占位
 * - 其它(普通 field/text/expr) → 跳过
 * - bwip-js 抛错 → 跳过该 entry,让运行期 ensureCodeNaturalDimsSync 再尝试 + 发警告
 */
export function precomputeCodeNaturalDims(
  cellSegments: Segment[][],
  valuesByPath: Map<string, Set<string>>,
): Map<string, NaturalCodeDims> {
  const cache = new Map<string, NaturalCodeDims>()
  for (const segs of cellSegments) {
    for (const seg of segs) {
      if (seg.kind !== 'field') continue
      const fmt = seg.format
      if (!fmt) continue
      const fkind = fmt.kind
      if (fkind !== 'qrcode' && fkind !== 'barcode') continue
      const values = valuesByPath.get(seg.path)
      if (!values || values.size === 0) continue
      for (const value of values) {
        if (!value) continue
        const key = makeCodeKey(seg.path, value, fmt)
        if (cache.has(key)) continue
        if (fkind === 'barcode') {
          try {
            const dims = measureNaturalBarcodeDimsSync(value, {
              bcid: fmt.bcid,
              showText: fmt.showText,
            })
            cache.set(key, dims)
          } catch {
            // bwip-js 抛错(字符不支持等) → 跳过,运行期会发 CODE_NATURAL_DIMS_FAILED
          }
        } else {
          // qrcode 永远 1:1
          cache.set(key, { naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 })
        }
      }
    }
  }
  return cache
}