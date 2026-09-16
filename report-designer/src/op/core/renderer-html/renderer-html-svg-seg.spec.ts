/**
 * renderer-html svg part 输出 —— PR-D.1 bug fix 验证
 *
 * ★ 关键 bug:userW 设了但 !lockRatio(或 computedH 已知)时,旧 renderer 只输出 width
 *   style,让 SVG 的 preserveAspectRatio="none" + viewBox 自动算 span 高度。
 *   在窄列场景(<25mm cell),bwip-js 输出的 bars 视图单位被等比缩放变窄(0.234mm)→
 *   扫码枪扫不出。
 *
 * 修复后:userW 设了 + computedH 已知 → 同步输出 width AND height,SVG 严格按自然
 *   aspect 渲染 → bars 厚度 = (control.width / viewBox_width) × viewBox_unit
 *   不会被纵向拉伸变窄。
 *
 * 测试范围:
 * 1. userW=undefined, userH=undefined → 无 style,SVG viewBox 撑满(老行为)
 * 2. userW + userH 都设 → 严格按用户设值
 * 3. userW + computedW/computedH → 同步输出 width+height(★ 关键修复)
 * 4. userW + lockRatio + computedW/computedH → 同步输出 width+height
 * 5. userW + 无 computedH → 退回老行为(罕见,兜底)
 * 6. userH only → 只输出 height
 */
import { describe, expect, it } from 'vitest'
import type {
  LayoutPage,
  PlacedTable,
  RenderCell,
  RenderPart,
  RenderRow,
} from '@op/core/layout-engine/types'
import type { SegmentDisplayOpts } from '@op/types/control'
import { renderPage } from '@op/core/renderer-html'

const DUMMY_SVG = '<svg viewBox="0 0 64 125"><rect/></svg>'

function makeCellWithSvg(
  display: SegmentDisplayOpts | undefined,
  computedW?: number,
  computedH?: number,
): RenderCell {
  const part: RenderPart = {
    kind: 'svg',
    svg: DUMMY_SVG,
    meta: {
      display,
      field: 'order.orderNo',
      value: 'RM-2026-00001',
      formatKind: 'barcode',
      bcid: 'code128',
      computedW,
      computedH,
      aspect: 0.512,
    },
  }
  return {
    text: '',
    align: 'left',
    parts: [part],
  }
}

function renderCellSvgSeg(cell: RenderCell): string {
  const row: RenderRow = {
    kind: 'data',
    height: 15,
    cells: [cell],
    dataIndex: 0,
  }
  const table: PlacedTable = {
    kind: 'table',
    id: 't1',
    control: {
      id: 't1',
      type: 'table',
      left: 0,
      top: 0,
      width: 60,
      height: 30,
      columns: [{ id: 'c1', width: 60 }],
    } as PlacedTable['control'],
    columns: [{ id: 'c1', width: 60 }],
    columnWidths: [60],
    headerRows: [],
    rows: [row],
    footerRows: [],
    isLastSlice: true,
    left: 0,
    top: 0,
    width: 60,
    height: 30,
  }
  const page: LayoutPage = {
    index: 0,
    pageNo: 1,
    header: [],
    body: [table],
    footer: [],
  }
  return renderPage(page)
}

describe('renderer-html svg part —— PR-D.1 bug fix', () => {
  /** 抽取 svg-seg span 的 style 属性,用于 scope 断言(避免表/页宽干扰) */
  function spanStyle(html: string): string | undefined {
    const m = html.match(/<span class="op-code-seg"([^>]*)>/)
    if (!m) return undefined
    // m[1] 可能为空字符串(无 style),区分「span 无 style attr」与「span 不存在」
    return m[1].trim() === '' ? undefined : m[1]
  }

  it('display undefined → 无 sizeStyle,SVG 用 viewBox 撑满 cell', () => {
    const html = renderCellSvgSeg(makeCellWithSvg(undefined))
    expect(html).toContain('<span class="op-code-seg">')
    expect(spanStyle(html)).toBeUndefined()
  })

  it('userW + userH 都设 → 输出 userW + userH(用户优先)', () => {
    const html = renderCellSvgSeg(makeCellWithSvg({ widthMm: 40, heightMm: 30 }, 40, 30))
    expect(spanStyle(html)).toBe(' style="width:40mm;height:30mm"')
  })

  it('★ PR-D.1 fix:userW + 无 lockRatio + computedH → 同步输出 width AND height', () => {
    // 模拟 table-engine 算出的 naturalDims 路径:userW=15mm + colWidth=30mm → clamp 不到,
    // 但 computedH = 15/aspect = 29.3mm(自然高度,避免 bars 被压窄)
    const html = renderCellSvgSeg(makeCellWithSvg({ widthMm: 15 }, 15, 29.3))
    expect(spanStyle(html)).toBe(' style="width:15mm;height:29.3mm"')
  })

  it('★ PR-D.1 fix:userW + lockRatio + computedW/computedH → 同步输出精确尺寸', () => {
    const html = renderCellSvgSeg(
      makeCellWithSvg({ widthMm: 30, lockRatio: true }, 26, 50.78),
    )
    expect(spanStyle(html)).toBe(' style="width:26mm;height:50.78mm"')
  })

  it('userW + 无 computedH → 兜底老行为(只输出 width)', () => {
    // 罕见场景:naturalDims cache miss + 同步补码失败 → meta.computedW/H 都缺失
    const html = renderCellSvgSeg(makeCellWithSvg({ widthMm: 15 }))
    expect(spanStyle(html)).toBe(' style="width:15mm"')
  })

  it('只设 userH → 只输出 height', () => {
    const html = renderCellSvgSeg(makeCellWithSvg({ heightMm: 20 }, 30, 20))
    // computedW=30 存在 + userH=20 → 走 computedW 分支输出 width=30 + height=20
    expect(spanStyle(html)).toBe(' style="width:30mm;height:20mm"')
  })

  it('只设 userH + 无 computed → 只输出 height', () => {
    const html = renderCellSvgSeg(makeCellWithSvg({ heightMm: 20 }))
    expect(spanStyle(html)).toBe(' style="height:20mm"')
  })

  it('QR scaleFactor 路径:computedW=computedH(方形) → 同步输出双维', () => {
    // 模拟 PR-D QR cell:scaleFactor=2 → effectiveQrSizeMm=60 → clamp 后 30mm
    const html = renderCellSvgSeg(
      makeCellWithSvg({ scaleFactor: 2 }, 30, 30),
    )
    expect(spanStyle(html)).toBe(' style="width:30mm;height:30mm"')
  })
})