/**
 * 回归:防止「序列化铁律」被遗漏 —— toControl 必须回写所有新增字段,
 * 否则 buildTemplate → serialize → controls.value = synced.body 会清掉 store 字段。
 *
 * 不实例化 PrintLabelGrid(其构造会跑 fabric + canvas draw,环境重),
 * 直接把 applyControlProps/toControl 作为原型方法剥离到 stub 上跑,
 * 只测「字段读写契约」,这是本 bug 的全部相关代码。
 */
import { describe, it, expect } from 'vitest'
import { PrintLabelGrid } from './PrintLabelGrid'
import type { LabelGridControl } from '@op/types/control'

function makeControl(): LabelGridControl {
  return {
    id: 'g1',
    type: 'labelgrid',
    left: 0, top: 0, width: 120, height: 90,
    columns: 3, gapX: 2, gapY: 3, cardWidth: 38, cardHeight: 30,
    mode: 'appendix',
    dataSource: 'Items',
    children: [],
    printable: true,
  }
}

/**
 * 通过 Object.create 拿到原型方法,塞一个空 `this` 即可调用。
 * (不能 new PrintLabelGrid(),因为它走 FabricImage 构造 + 画布 draw,
 * 需要 jsdom + node-canvas 才能跑通,本 spec 只想验证字段读写契约。)
 */
function callApply(obj: Partial<PrintLabelGrid>, control: LabelGridControl): void {
  // stub 出 applyControlProps 末尾 this.set / this.regenerate 需要的钩子
  ;(obj as any).set = () => {}
  ;(obj as any).regenerate = () => {}
  ;(PrintLabelGrid.prototype.applyControlProps as Function).call(obj, control)
}
function callToControl(obj: Partial<PrintLabelGrid>): LabelGridControl {
  return (PrintLabelGrid.prototype.toControl as Function).call(obj) as LabelGridControl
}

describe('PrintLabelGrid —— 序列化铁律(append/apply/to round-trip)', () => {
  it('applyControlProps 接收 appendixTitle / maxItems / titleRepeat / pageBreak', () => {
    const obj: any = {}
    callApply(obj, {
      ...makeControl(),
      appendixTitle: { text: '附录:样本照片', style: { fontSize: 14 } },
      maxItems: 5,
      titleRepeat: false,
      pageBreak: 'never',
    })
    expect(obj.appendixTitle).toEqual({ text: '附录:样本照片', style: { fontSize: 14 } })
    expect(obj.maxItems).toBe(5)
    expect(obj.titleRepeat).toBe(false)
    expect(obj.pageBreak).toBe('never')
  })

  it('toControl 回写 appendixTitle / maxItems / titleRepeat / pageBreak', () => {
    const obj: any = {
      appendixTitle: { text: 'X' },
      maxItems: 3,
      titleRepeat: true,
      pageBreak: 'always',
      // readBaseGeometry 需要的最小几何字段
      controlId: 'g1', left: 0, top: 0, angle: 0,
      getScaledWidth: () => 120, getScaledHeight: () => 90,
      columns: 3, gapX: 2, gapY: 3, cardWidth: 38, cardHeight: 30,
      showLines: true, children: [], printable: true,
    }
    const c = callToControl(obj)
    expect(c.appendixTitle).toEqual({ text: 'X' })
    expect(c.maxItems).toBe(3)
    expect(c.titleRepeat).toBe(true)
    expect(c.pageBreak).toBe('always')
  })

  it('round-trip:apply → to 不丢新字段', () => {
    const obj: any = {
      controlId: 'g1', left: 0, top: 0, angle: 0,
      getScaledWidth: () => 120, getScaledHeight: () => 90,
      columns: 3, gapX: 2, gapY: 3, cardWidth: 38, cardHeight: 30,
      showLines: true, children: [], printable: true,
    }
    callApply(obj, {
      ...makeControl(),
      appendixTitle: { text: 'round-trip' },
      maxItems: 7,
      titleRepeat: true,
      pageBreak: 'never',
    })
    const c = callToControl(obj)
    expect(c.appendixTitle?.text).toBe('round-trip')
    expect(c.maxItems).toBe(7)
    expect(c.titleRepeat).toBe(true)
    expect(c.pageBreak).toBe('never')
  })

  it('未设新字段的旧模板不应被强行写入(undefined 也保留)', () => {
    const obj: any = {
      controlId: 'g1', left: 0, top: 0, angle: 0,
      getScaledWidth: () => 120, getScaledHeight: () => 90,
      columns: 3, gapX: 2, gapY: 3, cardWidth: 38, cardHeight: 30,
      showLines: true, children: [], printable: true,
    }
    const c = callToControl(obj)
    expect(c.appendixTitle).toBeUndefined()
    expect(c.maxItems).toBeUndefined()
    expect(c.titleRepeat).toBeUndefined()
  })
})