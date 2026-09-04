/**
 * 设计期表格 HTML 渲染单测（table-design-render.ts）
 *
 * 覆盖：renderTableGridHtml 标记（data-row/data-col、类名、占位符、纵向合并）、
 * gridColXs / gridRowHeights / computeGridLayout 几何、hitTestCell 命中测试。
 * 重点确保"设计所见"与运行期类名一致，且无 cells 的旧模板能正常回落。
 */
import { describe, expect, it } from 'vitest'
import type { TableControl } from '@op/types/control'
import {
  computeGridLayout,
  gridColXs,
  gridRowHeights,
  hitTestCell,
  renderTableGridHtml,
} from './table-design-render'
import { seedSummaryTail } from '@op/core/layout-engine/table-cells'

function baseTable(over: Partial<TableControl> = {}): TableControl {
  return {
    id: 't1',
    type: 'table',
    left: 0,
    top: 0,
    width: 180,
    height: 60,
    columns: [
      { title: '序号', expression: '{{rowIndex + 1}}', width: 15, align: 'center', headerAlign: 'center' },
      { title: '名称', field: 'name', width: 60 },
      { title: '数量', field: 'qty', width: 25, align: 'right', headerAlign: 'center' },
    ],
    options: { borders: 'all', verticalAlign: 'middle' },
    ...over,
  }
}

describe('renderTableGridHtml', () => {
  it('数据表：输出表格根类 op-table + 运行期同款修饰类', () => {
    const html = renderTableGridHtml(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(html).toContain('class="op-node op-table b-all va-middle ts-none"')
    expect(html).toContain('table-layout:fixed')
  })

  it('边框修复：不再内联 border-collapse:collapse（否则被 overlay overflow:hidden 切掉右/下边）', () => {
    const html = renderTableGridHtml(baseTable({ dataSource: 'items' }))
    expect(html).not.toContain('border-collapse:collapse')
    // 外框走 tableCss 的 separate + 末行/末列补边，四边始终完整
    expect(html).toContain('table-layout:fixed')
  })

  it('样式预设：默认 none 挂 ts-none，指定后挂对应类', () => {
    const def = renderTableGridHtml(baseTable({ dataSource: 'items', options: { borders: 'all', verticalAlign: 'middle' } }))
    expect(def).toContain('ts-none')
    const zebra = renderTableGridHtml(baseTable({ dataSource: 'items', options: { borders: 'all', verticalAlign: 'middle', tableStyle: 'zebra' } }))
    expect(zebra).toContain('ts-zebra')
  })

  it('聚合尾行对齐运行期类名：本页合计→is-subtotal，总计/大写金额→is-summary', () => {
    const t = seedSummaryTail(
      baseTable({
        dataSource: 'items',
        columns: [
          { title: '名称', field: 'items[].name', width: 60 },
          { title: '数量', field: 'items[].qty', width: 25, align: 'right', headerAlign: 'center' },
        ],
        data: [{ name: 'A', qty: 2 }],
      }),
      { numericColumns: [1], moneyColumn: 1, capital: true },
    )
    const html = renderTableGridHtml(t)
    expect(html).toContain('is-subtotal')
    expect(html).toContain('is-summary')
  })

  it('每个 td 带 data-row/data-col，便于 overlay 编辑写回', () => {
    const html = renderTableGridHtml(baseTable({ dataSource: 'items' }))
    expect(html).toContain('data-row="0"')
    expect(html).toContain('data-col="2"')
  })

  it('行类与语义匹配：表头 / 数据样例行 / 静态', () => {
    const html = renderTableGridHtml(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(html).toContain('class="is-header"')
    expect(html).toContain('class="is-data is-template"')
    expect(html).toContain('class="is-static"')
  })

  it('绑定的数据样例行：渲染为字段占位符而非空', () => {
    const html = renderTableGridHtml(baseTable({ dataSource: 'items' }))
    // Plan B：字段段 placeholder 走 segments 单源 → {{name}}（去掉老模板的 item. 前缀）
    expect(html).toContain('{{name}}')
    expect(html).toContain('{{qty}}')
    // 表头占位符走 expression（splitFixedText 已剥 {{}} → rowIndex + 1）
    expect(html).toContain('{{rowIndex + 1}}')
  })

  it('静态文字行：原样输出字面量', () => {
    const cells = [
      [{ text: '列1' }, { text: '列2' }, { text: '列3' }],
      [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      [{ text: '合计：' }, {}, {}],
    ]
    const html = renderTableGridHtml(baseTable({ dataSource: 'items', cells, staticRows: 1 }))
    expect(html).toContain('合计：')
    expect(html).toContain('列1')
  })

  it('空单元格输出 <br> 占位，避免高度塌陷', () => {
    // 布局网格（无 dataSource）多数静态格为空 → 输出 <br>
    const html = renderTableGridHtml(baseTable({ designRows: 3 }))
    expect(html).toContain('<br>')
  })

  it('横向合并：输出 colspan 属性', () => {
    const t = baseTable({ dataSource: 'items' })
    const cells = [
      [{ text: 'H' }, { text: '' }, { text: '' }],
      [{ field: 'a', colSpan: 2 }, { text: '' }, { field: 'c' }],
    ]
    const html = renderTableGridHtml({ ...t, cells, staticRows: 0 })
    expect(html).toContain('colspan="2"')
  })

  it('options.summaryRow 开启时画布追加 is-summary 虚拟行（修复 Bug：右栏改标签画布无反应）', () => {
    const html = renderTableGridHtml(
      baseTable({
        dataSource: 'items',
        options: {
          borders: 'all',
          verticalAlign: 'middle',
          summaryRow: { type: 'sum', fields: ['qty'], label: '总金额' },
        },
      }),
    )
    // 虚拟行存在 + 标签同步
    expect(html).toContain('class="is-summary"')
    expect(html).toContain('>总金额<')
  })

  it('options.summaryRow 改 label 时同步显示新文本', () => {
    const a = renderTableGridHtml(
      baseTable({
        dataSource: 'items',
        options: { summaryRow: { type: 'sum', fields: ['qty'], label: '合计' } },
      }),
    )
    const b = renderTableGridHtml(
      baseTable({
        dataSource: 'items',
        options: { summaryRow: { type: 'sum', fields: ['qty'], label: '总金额' } },
      }),
    )
    expect(a).toContain('>合计<')
    expect(b).toContain('>总金额<')
    expect(b).not.toContain('>合计<')
  })

  /**
   * ★ Bug 修复：表头 cell 经用户在画布上键入文字 + 退出编辑后，patchCellText 会把
   *   内容写到 cell.segments 并清空 cell.text。渲染端必须能从 segments 单源读出
   *   文本，而不是回退到空 cell.text 导致画布变空。
   *   修复前：bound=false（无 contentType/field/expression）+ cell.text=undefined → 显示空。
   *   修复后：bound 判定把「segments 非空」也算上 → 走 placeholderOf → segmentsToText。
   */
  it('★ Bug：表头 cell 有 segments 但 cell.text=undefined → 显示 segments 文本（不再为空）', () => {
    // 模拟「用户在画布上键入"你好吗"后点表格外」的最终态：cell.segments 有内容，cell.text 已被 patchCellText 清空
    const cells = [
      [{ segments: [{ kind: 'text', value: '你好吗' }] }, { text: '标题' }],
    ]
    const html = renderTableGridHtml(
      baseTable({
        designRows: 1,
        cells,
        columns: [
          { title: '列1', width: 60 },
          { title: '列2', width: 60 },
        ],
      }),
    )
    // 关键：表头 td 必须包含「你好吗」，而不是空 <br>
    expect(html).toContain('>你好吗<')
    // 表头另一列保持原文本
    expect(html).toContain('>标题<')
  })

  /**
   * 回归：cell 完全没有 segments、cell.text 有值 → 仍走 cell.text 老路径（兼容老模板）
   */
  it('★ 回归：cell 无 segments + cell.text 有值 → 走 cell.text 老路径', () => {
    const cells = [[{ text: '老模板文本' }]]
    const html = renderTableGridHtml(
      baseTable({
        designRows: 1,
        cells,
        columns: [{ title: '列', width: 60 }],
      }),
    )
    expect(html).toContain('>老模板文本<')
  })
})

describe('几何布局', () => {
  it('gridColXs：长度 colCount+1，末值=表格宽，单调递增', () => {
    const xs = gridColXs(baseTable({ dataSource: 'items' }))
    expect(xs.length).toBe(4)
    expect(xs[0]).toBe(0)
    expect(xs[3]).toBe(180)
    expect(xs[1]! < xs[2]!).toBe(true)
  })

  it('gridRowHeights：返回 rowCount 个正值', () => {
    const hs = gridRowHeights(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(hs.length).toBe(3)
    expect(hs.every((h) => h > 0)).toBe(true)
  })

  it('computeGridLayout：汇总 colXs/rowYs/rowCount/colCount', () => {
    const g = computeGridLayout(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(g.colCount).toBe(3)
    expect(g.rowCount).toBe(3)
    expect(g.colXs.length).toBe(4)
    expect(g.rowYs.length).toBe(4)
    expect(g.rowYs[0]).toBe(0)
  })
})

describe('hitTestCell', () => {
  const layout = computeGridLayout(baseTable({ dataSource: 'items', staticRows: 1 }))

  it('左上角命中第 0 行第 0 列', () => {
    expect(hitTestCell(layout, 0.01, 0.01)).toEqual({ row: 0, col: 0 })
  })

  it('右下角命中末行末列', () => {
    const hit = hitTestCell(layout, 0.99, 0.99)
    expect(hit).toEqual({ row: layout.rowCount - 1, col: layout.colCount - 1 })
  })

  it('越界（frac 超出 [0,1]）返回 null', () => {
    expect(hitTestCell(layout, -0.1, 0.5)).toBeNull()
    expect(hitTestCell(layout, 0.5, 1.2)).toBeNull()
  })

  it('落在第 2 列区间命中 col=1', () => {
    // colXs 近似 [0, ~25, ~136, 180]，中间点应落第 1 列
    const x = (layout.colXs[1]! + layout.colXs[2]!) / 2 / layout.colXs[3]!
    const hit = hitTestCell(layout, x, 0.01)
    expect(hit?.col).toBe(1)
  })
})
