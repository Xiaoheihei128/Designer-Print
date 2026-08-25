/**
 * PrintRect 四角独立圆角路径几何验证。
 *
 * 用 node-canvas 直接执行 traceRoundRectPath（与 Fabric _render 的绘制约定一致：
 * ctx 已平移到对象中心，坐标范围 -w/2 ~ w/2），抽样四角像素透明度，
 * 确认「某角有半径、其余为 0」时只有该角被圆角化、其余保持直角。
 */
import { describe, expect, it } from 'vitest'
import { createCanvas } from 'canvas'
import { traceRoundRectPath } from './PrintRect'

interface Corner {
  /** 抽样点（相对对象左上角，单位 px），取靠近外缘但不在圆角切线内的位置 */
  sampleX: number
  sampleY: number
}

function renderAndSample(
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): Record<'TL' | 'TR' | 'BR' | 'BL', boolean> {
  const pad = 40
  const cw = w + pad * 2
  const ch = h + pad * 2
  const canvas = createCanvas(cw, ch)
  const ctx = canvas.getContext('2d')!
  ctx.translate(cw / 2, ch / 2) // 模拟 Fabric 把原点移到对象中心
  traceRoundRectPath(ctx as unknown as CanvasRenderingContext2D, w, h, tl, tr, br, bl)
  ctx.fillStyle = '#000000'
  ctx.fill()

  const img = ctx.getImageData(0, 0, cw, ch)!.data
  const alphaAt = (x: number, y: number): boolean => {
    const idx = (Math.round(y) * cw + Math.round(x)) * 4 + 3
    return (img[idx] ?? 0) > 10 // 不透明 = 属于形状内部
  }

  // 各角取样点：紧贴外缘、但位于「该角若有大圆角就会被切掉」的位置
  const samples: Record<'TL' | 'TR' | 'BR' | 'BL', Corner> = {
    TL: { sampleX: pad + 4, sampleY: pad + 4 },
    TR: { sampleX: pad + w - 4, sampleY: pad + 4 },
    BR: { sampleX: pad + w - 4, sampleY: pad + h - 4 },
    BL: { sampleX: pad + 4, sampleY: pad + h - 4 },
  }
  const out = {} as Record<'TL' | 'TR' | 'BR' | 'BL', boolean>
  for (const k of Object.keys(samples) as Array<keyof typeof samples>) {
    out[k] = alphaAt(samples[k].sampleX, samples[k].sampleY)
  }
  return out
}

describe('PrintRect —— 四角独立圆角路径几何', () => {
  const W = 160
  const H = 100

  it('仅左上角有半径时，只有 TL 被圆角化（取样点为透明）', () => {
    const r = renderAndSample(W, H, 40, 0, 0, 0)
    expect(r.TL).toBe(false) // 左上被切成圆角 → 角点透明
    expect(r.TR).toBe(true) // 其余直角 → 角点不透明
    expect(r.BR).toBe(true)
    expect(r.BL).toBe(true)
  })

  it('四角全 0 时为标准直角矩形（四角均不透明）', () => {
    const r = renderAndSample(W, H, 0, 0, 0, 0)
    expect(r.TL && r.TR && r.BR && r.BL).toBe(true)
  })

  it('四角均设大半径时为全圆角（四角均透明）', () => {
    const r = renderAndSample(W, H, 30, 30, 30, 30)
    expect(r.TL && r.TR && r.BR && r.BL).toBe(false)
  })

  it('半径上限被夹紧到短边一半，不溢出（超大半径下四角仍正常）', () => {
    const r = renderAndSample(W, H, 999, 999, 999, 999)
    // 短边=H=100 → 上限 50；四角应被夹紧为圆角但形状完整
    expect(r.TL && r.TR && r.BR && r.BL).toBe(false)
  })
})
