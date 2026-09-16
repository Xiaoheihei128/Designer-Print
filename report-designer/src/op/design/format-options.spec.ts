import { describe, expect, it } from 'vitest'
import { makeFormat } from './format-options'

/**
 * makeFormat —— 段级形态默认值(PR-D QR scaleFactor)
 *
 * PR-A:qrcode/barcode/image 默认 fitMode='auto'
 * PR-D:qrcode 默认 scaleFactor=1(基准 30mm × 30mm)
 *   barcode/image 不改,沿用 fitMode='auto'(走 naturalDims 兜底)
 */
describe('makeFormat —— 段级形态默认 display', () => {
  it('qrcode 默认 scaleFactor=1 + fitMode="auto" + errorLevel="M"', () => {
    const fmt = makeFormat('qrcode')
    expect(fmt.kind).toBe('qrcode')
    expect(fmt.errorLevel).toBe('M')
    expect(fmt.display).toEqual({ scaleFactor: 1, fitMode: 'auto' })
  })

  it('barcode 默认 fitMode="auto",不带 scaleFactor(QR 专属)', () => {
    const fmt = makeFormat('barcode')
    expect(fmt.kind).toBe('barcode')
    expect(fmt.bcid).toBe('code128')
    expect(fmt.showText).toBe(true)
    expect(fmt.display).toEqual({ fitMode: 'auto' })
    // ★ PR-D:scaleFactor 是 QR 专属,barcode 不应继承
    expect(fmt.display?.scaleFactor).toBeUndefined()
  })

  it('image 默认 fitMode="auto",不带 scaleFactor', () => {
    const fmt = makeFormat('image')
    expect(fmt.kind).toBe('image')
    expect(fmt.fit).toBe('contain')
    expect(fmt.display).toEqual({ fitMode: 'auto' })
    expect(fmt.display?.scaleFactor).toBeUndefined()
  })
})
