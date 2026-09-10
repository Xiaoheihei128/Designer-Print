/**
 * label-grid-mode —— LabelGridControl 模式化包装字段类型契约
 *
 * Commit 4 的范围:仅做类型 + 序列化铁律,运行时行为(渲染分支)在 Commit 6/8。
 * 此 spec 锁死「5 个新字段在 LabelGridControl 类型上 optional,不影响其他字段」
 * —— 防止后续重构意外丢字段,老模板加载路径 mode 缺失时走标准分支。
 */
import { describe, expect, it } from 'vitest'
import type { LabelGridControl, AnyControl } from './control'

/* ------------------------------ 测试夹具 ------------------------------ */

const children: AnyControl[] = []

function makeBase(over: Partial<LabelGridControl> = {}): LabelGridControl {
  return {
    id: 'grid-1',
    type: 'labelgrid',
    left: 0,
    top: 0,
    width: 180,
    height: 90,
    columns: 3,
    dataSource: 'ReportItems',
    children,
    ...over,
  }
}

describe('LabelGridControl —— 模式化包装字段', () => {
  it('老模板:mode 等 5 个新字段全部缺失 → 仍是合法 LabelGridControl', () => {
    const old: LabelGridControl = makeBase()
    expect(old.mode).toBeUndefined()
    expect(old.forceNewPage).toBeUndefined()
    expect(old.cornerRadius).toBeUndefined()
    expect(old.cardBorder).toBeUndefined()
    expect(old.appendixHeader).toBeUndefined()
    // 关键:不含新字段时与原始结构等价,序列化后字段数不变
    const keys = Object.keys(old).sort()
    expect(keys).not.toContain('mode')
    expect(keys).not.toContain('cornerRadius')
  })

  it('标准模式:mode="standard" + 缺省其余 4 字段', () => {
    const grid: LabelGridControl = makeBase({ mode: 'standard' })
    expect(grid.mode).toBe('standard')
  })

  it('附录模式:mode + forceNewPage + cornerRadius + cardBorder + appendixHeader 全配', () => {
    const grid: LabelGridControl = makeBase({
      mode: 'appendix',
      forceNewPage: true,
      cornerRadius: 3,
      cardBorder: true,
      appendixHeader: '附录:样本照片',
    })
    expect(grid).toMatchObject({
      mode: 'appendix',
      forceNewPage: true,
      cornerRadius: 3,
      cardBorder: true,
      appendixHeader: '附录:样本照片',
    })
  })

  it('round-trip 模拟:JSON.stringify → JSON.parse 后字段全部还原(序列化铁律)', () => {
    const grid: LabelGridControl = makeBase({
      mode: 'appendix',
      forceNewPage: true,
      cornerRadius: 4,
      cardBorder: false,
      appendixHeader: '附录',
    })
    const json = JSON.stringify(grid)
    const parsed = JSON.parse(json) as LabelGridControl
    expect(parsed.mode).toBe('appendix')
    expect(parsed.forceNewPage).toBe(true)
    expect(parsed.cornerRadius).toBe(4)
    expect(parsed.cardBorder).toBe(false)
    expect(parsed.appendixHeader).toBe('附录')
    // 反向:老模板缺失 mode → 仍能正确解析(prototype 不强校验)
    const oldJson = JSON.stringify(makeBase())
    const oldParsed = JSON.parse(oldJson) as LabelGridControl
    expect(oldParsed.mode).toBeUndefined()
  })

  it('cornerRadius 边界:0 = 不圆角,>0 走 roundRect', () => {
    const zero: LabelGridControl = makeBase({ mode: 'appendix', cornerRadius: 0 })
    expect(zero.cornerRadius).toBe(0)
    const rounded: LabelGridControl = makeBase({ mode: 'appendix', cornerRadius: 2.5 })
    expect(rounded.cornerRadius).toBe(2.5)
  })

  it('forceNewPage 仅在 appendix 模式下生效(类型上不强制,业务上由分支判断)', () => {
    // 类型上允许任意组合 —— 渲染分支(label-grid.ts forceNewPage 分支)
    // 仅当 mode==='appendix' 时消费此字段。模式字段缺失走 standard 分支,
    // 即便填了 forceNewPage 也被忽略。
    const standardWithForcePage: LabelGridControl = makeBase({
      mode: 'standard',
      forceNewPage: true,
    })
    expect(standardWithForcePage.mode).toBe('standard')
    expect(standardWithForcePage.forceNewPage).toBe(true)
  })
})
