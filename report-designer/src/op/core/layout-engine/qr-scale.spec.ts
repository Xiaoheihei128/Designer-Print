/**
 * qr-scale 单测 —— PR-D 二维码倍率单源模块
 *
 * 覆盖:
 * - 常量:QR_BASE_MM、QR_SCALE_OPTIONS 严格 10 档单调递增(2026-09-16 用户扩到 5×)
 * - normalizeQrScale:undefined / 0 / 负 / NaN / 边界 / clamp / step 量化
 * - effectiveQrSizeMm:scaleFactor 优先 / widthMm 兼容 / 无输入
 * - migrateQrDisplay:已迁移 / 未迁移 / widthMm 转 scaleFactor / heightMm 删除 / 无 display
 */
import { describe, expect, it } from 'vitest'
import {
  QR_BASE_MM,
  QR_SCALE_MAX,
  QR_SCALE_MIN,
  QR_SCALE_OPTIONS,
  QR_SCALE_STEP,
  effectiveQrSizeMm,
  migrateQrDisplay,
  normalizeQrScale,
} from './qr-scale'

describe('qr-scale —— 常量', () => {
  it('QR_BASE_MM = 30(沿用 PR-C.5 基准)', () => {
    expect(QR_BASE_MM).toBe(30)
  })

  it('QR_SCALE_* 范围 [0.5, 5.0] step 0.5', () => {
    expect(QR_SCALE_MIN).toBe(0.5)
    expect(QR_SCALE_MAX).toBe(5)
    expect(QR_SCALE_STEP).toBe(0.5)
  })

  it('QR_SCALE_OPTIONS 严格 10 档单调递增', () => {
    expect(QR_SCALE_OPTIONS.length).toBe(10) // [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
    for (let i = 1; i < QR_SCALE_OPTIONS.length; i++) {
      expect(QR_SCALE_OPTIONS[i]).toBeGreaterThan(QR_SCALE_OPTIONS[i - 1]!)
      expect(QR_SCALE_OPTIONS[i]! - QR_SCALE_OPTIONS[i - 1]!).toBeCloseTo(QR_SCALE_STEP, 10)
    }
    expect(QR_SCALE_OPTIONS[0]).toBe(QR_SCALE_MIN)
    expect(QR_SCALE_OPTIONS[QR_SCALE_OPTIONS.length - 1]).toBe(QR_SCALE_MAX)
  })
})

describe('normalizeQrScale —— 边界 + clamp + step 量化', () => {
  it('undefined / NaN / Infinity → undefined', () => {
    expect(normalizeQrScale(undefined)).toBeUndefined()
    expect(normalizeQrScale(Number.NaN)).toBeUndefined()
    expect(normalizeQrScale(Infinity)).toBeUndefined()
    expect(normalizeQrScale(-Infinity)).toBeUndefined()
  })

  it('0 / 负数 → undefined(视为"未设")', () => {
    expect(normalizeQrScale(0)).toBeUndefined()
    expect(normalizeQrScale(-1)).toBeUndefined()
    expect(normalizeQrScale(-0.5)).toBeUndefined()
  })

  it('下界以下 clamp 到 0.5', () => {
    expect(normalizeQrScale(0.1)).toBe(0.5)
    expect(normalizeQrScale(0.25)).toBe(0.5)
    expect(normalizeQrScale(0.4)).toBe(0.5)
  })

  it('上界以上 clamp 到 5', () => {
    expect(normalizeQrScale(5.5)).toBe(5)
    expect(normalizeQrScale(10)).toBe(5)
    expect(normalizeQrScale(100)).toBe(5)
  })

  it('step 量化(round-half-up)覆盖全 10 档', () => {
    expect(normalizeQrScale(0.5)).toBe(0.5)
    expect(normalizeQrScale(0.6)).toBe(0.5) // < 0.75 → 0.5
    expect(normalizeQrScale(0.75)).toBe(1) // 0.5 + 0.25 → round-half-up
    expect(normalizeQrScale(1.25)).toBe(1.5)
    expect(normalizeQrScale(1.3)).toBe(1.5)
    expect(normalizeQrScale(1.5)).toBe(1.5)
    expect(normalizeQrScale(1.7)).toBe(1.5) // < 1.75 → 1.5
    expect(normalizeQrScale(1.75)).toBe(2)
    expect(normalizeQrScale(2.5)).toBe(2.5)
    expect(normalizeQrScale(2.6)).toBe(2.5)
    expect(normalizeQrScale(2.75)).toBe(3)
    expect(normalizeQrScale(3)).toBe(3)
    // 新增 3.5× / 4× / 4.5× / 5× 边界
    expect(normalizeQrScale(3.25)).toBe(3.5)
    expect(normalizeQrScale(3.5)).toBe(3.5)
    expect(normalizeQrScale(3.75)).toBe(4)
    expect(normalizeQrScale(4)).toBe(4)
    expect(normalizeQrScale(4.25)).toBe(4.5)
    expect(normalizeQrScale(4.5)).toBe(4.5)
    expect(normalizeQrScale(4.75)).toBe(5)
    expect(normalizeQrScale(5)).toBe(5)
  })
})

describe('effectiveQrSizeMm —— 由 display 算有效边长', () => {
  it('无 display → undefined(走 cell 撑满)', () => {
    expect(effectiveQrSizeMm(undefined)).toBeUndefined()
  })

  it('仅 scaleFactor → 30mm × scaleFactor', () => {
    expect(effectiveQrSizeMm({ scaleFactor: 1 })).toBe(30)
    expect(effectiveQrSizeMm({ scaleFactor: 0.5 })).toBe(15)
    expect(effectiveQrSizeMm({ scaleFactor: 1.5 })).toBe(45)
    expect(effectiveQrSizeMm({ scaleFactor: 2 })).toBe(60)
    expect(effectiveQrSizeMm({ scaleFactor: 3 })).toBe(90)
    expect(effectiveQrSizeMm({ scaleFactor: 4 })).toBe(120)
    expect(effectiveQrSizeMm({ scaleFactor: 5 })).toBe(150)
  })

  it('兼容老数据:仅 widthMm → 当绝对 mm 用', () => {
    expect(effectiveQrSizeMm({ widthMm: 45 })).toBe(45)
    expect(effectiveQrSizeMm({ widthMm: 15 })).toBe(15)
  })

  it('scaleFactor 优先(共存时 scaleFactor 胜出)', () => {
    expect(effectiveQrSizeMm({ scaleFactor: 2, widthMm: 45 })).toBe(60) // scaleFactor 胜
  })

  it('widthMm ≤ 0 → undefined', () => {
    expect(effectiveQrSizeMm({ widthMm: 0 })).toBeUndefined()
    expect(effectiveQrSizeMm({ widthMm: -1 })).toBeUndefined()
  })

  it('fitMode 不影响计算(只是渲染层语义)', () => {
    expect(effectiveQrSizeMm({ scaleFactor: 1, fitMode: 'auto' })).toBe(30)
    expect(effectiveQrSizeMm({ scaleFactor: 1, fitMode: 'fixed' })).toBe(30)
  })
})

describe('migrateQrDisplay —— 老模板 widthMm → scaleFactor', () => {
  it('undefined → undefined', () => {
    expect(migrateQrDisplay(undefined)).toBeUndefined()
  })

  it('已迁移(scaleFactor 已设)→ 原样返回', () => {
    const d = { scaleFactor: 2, fitMode: 'auto' as const }
    expect(migrateQrDisplay(d)).toBe(d) // 引用相等,无新对象
  })

  it('无 widthMm(scaleFactor 也没有)→ 原样返回', () => {
    const d = { fitMode: 'auto' as const }
    expect(migrateQrDisplay(d)).toBe(d)
  })

  it('widthMm > 0 + 无 scaleFactor → 转 scaleFactor + 删 widthMm/heightMm', () => {
    const result = migrateQrDisplay({ widthMm: 45, heightMm: 45, fitMode: 'auto' as const })
    expect(result).toEqual({ scaleFactor: 1.5, fitMode: 'auto' })
    expect(result).not.toHaveProperty('widthMm')
    expect(result).not.toHaveProperty('heightMm')
  })

  it('widthMm=15 → scaleFactor=0.5', () => {
    expect(migrateQrDisplay({ widthMm: 15 })).toEqual({ scaleFactor: 0.5 })
  })

  it('widthMm=30 → scaleFactor=1(基准)', () => {
    expect(migrateQrDisplay({ widthMm: 30 })).toEqual({ scaleFactor: 1 })
  })

  it('widthMm=60 → scaleFactor=2', () => {
    expect(migrateQrDisplay({ widthMm: 60 })).toEqual({ scaleFactor: 2 })
  })

  it('widthMm=90 → scaleFactor=3', () => {
    expect(migrateQrDisplay({ widthMm: 90 })).toEqual({ scaleFactor: 3 })
  })

  it('widthMm=105 → scaleFactor=3.5', () => {
    expect(migrateQrDisplay({ widthMm: 105 })).toEqual({ scaleFactor: 3.5 })
  })

  it('widthMm=120 → scaleFactor=4', () => {
    expect(migrateQrDisplay({ widthMm: 120 })).toEqual({ scaleFactor: 4 })
  })

  it('widthMm=150 → scaleFactor=5(刚好上界)', () => {
    expect(migrateQrDisplay({ widthMm: 150 })).toEqual({ scaleFactor: 5 })
  })

  it('widthMm 超出 5× (如 200)→ clamp 到 5', () => {
    expect(migrateQrDisplay({ widthMm: 200 })).toEqual({ scaleFactor: 5 })
  })

  it('widthMm 小于 1× (如 5)→ clamp 到 0.5', () => {
    expect(migrateQrDisplay({ widthMm: 5 })).toEqual({ scaleFactor: 0.5 })
  })

  it('widthMm ≤ 0 → 原样返回(无效输入不迁移)', () => {
    const d = { widthMm: 0 }
    expect(migrateQrDisplay(d)).toBe(d)
    const d2 = { widthMm: -10 }
    expect(migrateQrDisplay(d2)).toBe(d2)
  })

  it('保留 lockRatio / fitMode 等其他字段', () => {
    const result = migrateQrDisplay({
      widthMm: 45,
      fitMode: 'fixed' as const,
      lockRatio: true,
    })
    expect(result).toEqual({
      scaleFactor: 1.5,
      fitMode: 'fixed',
      lockRatio: true,
    })
  })
})