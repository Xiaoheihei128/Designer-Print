import { describe, it, expect } from 'vitest'
import { generateJobId } from './client'

describe('generateJobId', () => {
  it('格式为 MMDD + 6 位随机，共 10 位数字', () => {
    const id = generateJobId(new Date('2026-08-13T10:00:00'))
    expect(id).toHaveLength(10)
    expect(id).toMatch(/^\d{10}$/)
    // 今日 08-13 → 前缀 0813
    expect(id.startsWith('0813')).toBe(true)
  })

  it('随机尾段为 6 位（不足前补 0）', () => {
    const id = generateJobId(new Date('2026-01-05T00:00:00'))
    expect(id.startsWith('0105')).toBe(true)
    expect(id.slice(4)).toMatch(/^\d{6}$/)
  })

  it('多次调用尾段大概率不同', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(generateJobId().slice(4))
    // 50 次抽样几乎必然出现碰撞以外的情况；极端碰撞属概率事件，放宽到 >=49 唯一
    expect(seen.size).toBeGreaterThanOrEqual(49)
  })
})
