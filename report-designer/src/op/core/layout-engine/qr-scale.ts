/**
 * qr-scale —— 二维码倍率(PR-D)的单源常量与计算工具
 *
 * 解决:QR 永远 1:1,让用户调 width/height 不直观,改用「倍率」(scaleFactor)。
 * - 基准 1× = 30mm × 30mm(沿用 PR-C.5 naturalDims 的硬编码值)
 * - 范围 0.5× ~ 5.0×,step 0.5(10 档)
 *
 * 本模块是 **单源**:
 * - 类型层 [SegmentDisplayOpts.scaleFactor](@op/types/control) 用 number 字段
 * - UI 层 [QrScaleInput.vue](@op/design/panels/props/QrScaleInput) 滑块/输入框用 QR_SCALE_OPTIONS
 * - 渲染层 [PrintQrcode.regenerate](@op/design/canvas/controls/PrintQrcode) 用 effectiveQrSizeMm
 * - 测量层 [computePartHeightFromNaturalDims](@op/core/layout-engine/table-engine) 用 normalizeQrScale
 * - 迁移层 [loadNormalize](@op/design/stores/designer) 用 migrateQrDisplay
 *
 * 任何对范围 / step / 基准的修改都必须先改本模块,再跑全套单测。
 */

import type { SegmentDisplayOpts } from '@op/types/control'

/* ------------------------------ 常量 ------------------------------ */

/** QR 1× 倍率基准尺寸（mm × mm）。沿用 PR-C.5 naturalDims 硬编码值 */
export const QR_BASE_MM = 30

/** 倍率下界（含） */
export const QR_SCALE_MIN = 0.5

/** 倍率上界（含） */
export const QR_SCALE_MAX = 5.0

/** 倍率粒度（步长） */
export const QR_SCALE_STEP = 0.5

/**
 * 倍率预设数组(10 档)。
 * - 用于 NSlider marks / NSelect options
 * - 测试期望:exactly 10 个值,严格单调递增,落在 [MIN, MAX] 区间
 */
export const QR_SCALE_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const

/** 类型化:倍率预设值类型 */
export type QrScale = (typeof QR_SCALE_OPTIONS)[number]

/* ------------------------------ 函数 ------------------------------ */

/**
 * 把任意 number 输入标准化到 [MIN, MAX] 区间并量化到 step 网格。
 *
 * - undefined / NaN / Infinity → undefined（透传"未设"）
 * - 0 / 负数 → undefined（视为"未设"）
 * - 0.1 → 0.5(clamp + step 量化)
 * - 10 → 5.0(clamp 上界)
 * - 1.3 → 1.5(round-half-up,符合「0.5/1/1.5/2/2.5/3/3.5/4/4.5/5」档位)
 *
 * 取整策略:Math.round (round-half-up)。
 * - 1.25 → 1.5
 * - 1.75 → 2.0
 * 测试覆盖边界 0.5 / 1.5 / 2.5 / 3 / 3.5 / 4 / 4.5 / 5。
 */
export function normalizeQrScale(v: number | undefined): QrScale | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  if (v <= 0) return undefined
  // step 量化（注意:JavaScript 浮点 0.5 × 0.5 = 0.25,需先除 step 再乘,避免累积误差）
  const stepped = Math.round(v / QR_SCALE_STEP) * QR_SCALE_STEP
  // clamp
  if (stepped < QR_SCALE_MIN) return QR_SCALE_MIN as QrScale
  if (stepped > QR_SCALE_MAX) return QR_SCALE_MAX as QrScale
  return stepped as QrScale
}

/**
 * 由 display 字段导出有效 QR 边长（mm）。
 *
 * 优先级:
 * 1. display.scaleFactor → 30mm × scaleFactor
 * 2. 兼容老数据:display.widthMm 直接当绝对 mm 用（用户原本输入的 mm 即 mm）
 * 3. 都没有 → undefined（让 renderer 走 fitMode='auto' cell 撑满行为）
 *
 * 注意:本函数不读 heightMm(QR 永远方形,heightMm 无意义)。
 */
export function effectiveQrSizeMm(display: SegmentDisplayOpts | undefined): number | undefined {
  const sf = normalizeQrScale(display?.scaleFactor)
  if (sf !== undefined) return QR_BASE_MM * sf
  if (typeof display?.widthMm === 'number' && display.widthMm > 0) {
    return display.widthMm
  }
  return undefined
}

/**
 * 老 QR 模板迁移:display.widthMm → display.scaleFactor。
 *
 * 触发条件:
 * - display 存在 && display.scaleFactor 未设 && display.widthMm > 0
 *
 * 迁移结果:
 * - scaleFactor = normalizeQrScale(widthMm / QR_BASE_MM)(clamp + step)
 * - 删除 widthMm / heightMm(QR 永远方形,heightMm 无意义)
 * - 保留 fitMode / lockRatio(虽然对 QR 无意义,但不强制删除以减少风险)
 *
 * - 已迁移过(scaleFactor 已设) → 原样返回
 * - 无 widthMm → 原样返回
 * - display 是 undefined → 返回 undefined
 */
export function migrateQrDisplay(
  display: SegmentDisplayOpts | undefined,
): SegmentDisplayOpts | undefined {
  if (!display) return display
  if (display.scaleFactor !== undefined) return display
  if (typeof display.widthMm !== 'number' || display.widthMm <= 0) return display
  const sf = normalizeQrScale(display.widthMm / QR_BASE_MM)
  if (sf === undefined) return display
  // 删除 widthMm / heightMm(若有),其余字段透传
  const { widthMm: _w, heightMm: _h, ...rest } = display
  return { ...rest, scaleFactor: sf }
}