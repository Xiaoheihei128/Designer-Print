import { describe, expect, it } from 'vitest'

import { layout } from '@op/core/layout-engine/pagination-engine'
import { renderHtml, renderPage, renderStyle } from '@op/core/renderer-html'
import { createDemoTemplate } from '@op/repository/mock/data/demo-template'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'
import type { RectControl, TableControl } from '@op/types/control'
import type {
  LayoutPage,
  PlacedControl,
  PlacedTable,
  RenderCell,
  RenderRow,
} from '@op/core/layout-engine/types'

function rectControl(overrides: Partial<RectControl>): RectControl {
  return {
    id: 'r1',
    type: 'rect',
    left: 0,
    top: 0,
    width: 40,
    height: 25,
    ...overrides,
  }
}

function makeData(rows: number): Record<string, unknown> {
  const items = Array.from({ length: rows }, (_, i) => {
    const qty = (i % 5) + 1
    const price = 10 + (i % 9)
    return {
      productCode: `P${String(i + 1).padStart(4, '0')}`,
      productName: `商品${i + 1}`,
      spec: '规格A',
      unit: '件',
      qty,
      price,
      amount: qty * price,
    }
  })
  return { order: { orderNo: 'SO-001' }, customer: { name: '客户' }, items }
}

describe('renderer-html —— HTML 输出', () => {
  const template = createDemoTemplate()
  const measurer = createCjkMeasurer()

  it('renderHtml 输出多页文档结构', async () => {
    const result = await layout(template, makeData(30), { measurer })
    const html = renderHtml(result, { screen: false })
    expect(html).toContain('op-doc')
    expect(html).toContain('op-page')
    expect(html).toContain('op-page-wrap')
    expect(html).toContain('销售出库单')
  })

  it('renderStyle 注入打印分页样式', async () => {
    const result = await layout(template, makeData(10), { measurer })
    const style = renderStyle(result, { screen: false })
    expect(style).toContain('@page')
    expect(style).toContain('break-after')
  })

  describe('renderShape —— 形状样式', () => {
    /** 用一个只含单个形状控件的页面直接喂给 renderPage 验证 CSS 输出 */
    function renderShapeHtml(c: RectControl): string {
      const node: PlacedControl = {
        kind: 'control',
        id: c.id,
        left: c.left,
        top: c.top,
        width: c.width,
        height: c.height,
        content: { kind: 'shape' },
        control: c,
      }
      const page: LayoutPage = {
        index: 0,
        pageNo: 1,
        header: [],
        body: [node],
        footer: [],
      }
      return renderPage(page)
    }

    it('四角独立圆角输出四值 border-radius', () => {
      const html = renderShapeHtml(
        rectControl({ cornerRadiusTL: 5, cornerRadiusTR: 10, cornerRadiusBR: 15, cornerRadiusBL: 20 }),
      )
      expect(html).toContain('border-radius:5px 10px 15px 20px')
    })

    it('仅设置部分角时，未设置角回落到统一 cornerRadius', () => {
      const html = renderShapeHtml(rectControl({ cornerRadius: 8, cornerRadiusTR: 30 }))
      // TR=30 覆盖统一值，其余三角=8
      expect(html).toContain('border-radius:8px 30px 8px 8px')
    })

    it('统一 cornerRadius 输出单值 border-radius', () => {
      const html = renderShapeHtml(rectControl({ cornerRadius: 8 }))
      expect(html).toContain('border-radius:8px')
      expect(html).not.toContain('8px 8px 8px 8px')
    })

    it('虚线模式输出 border-style:dashed', () => {
      const html = renderShapeHtml(rectControl({ strokeDashArray: [6, 4] }))
      expect(html).toContain('border-style:dashed')
    })

    it('圆形（正方形外接框）输出 border-radius:50%', () => {
      const html = renderShapeHtml(rectControl({ shape: 'circle', width: 40, height: 40 }))
      expect(html).toContain('border-radius:50%')
      expect(html).toContain('op-circle')
    })

    it('圆形宽高不等时为椭圆（仍用 border-radius:50%，CSS 自动椭圆化）', () => {
      const html = renderShapeHtml(rectControl({ shape: 'circle', width: 60, height: 30 }))
      expect(html).toContain('border-radius:50%')
    })
  })

  describe('blank 行（P0-2 按纸张补空行）', () => {
    /** 构造一个含 blank 行的 PlacedTable，喂给 renderPage 验证 HTML 输出 */
    function blankTableHtml(rows: RenderRow[]): string {
      const cell = (text: string): RenderCell => ({ text, align: 'left' })
      const dataRow: RenderRow = {
        kind: 'data',
        height: 8,
        dataIndex: 0,
        cells: [cell('A'), cell('1')],
      }
      const blankRow: RenderRow = {
        kind: 'blank',
        height: 8,
        cells: [cell(''), cell('')],
      }
      const table: PlacedTable = {
        kind: 'table',
        id: 't',
        left: 0,
        top: 0,
        width: 40,
        height: 40,
        control: { id: 't', type: 'table' } as TableControl,
        columns: [
          { title: '名称', width: 20 },
          { title: '数量', width: 20 },
        ],
        columnWidths: [20, 20],
        headerRows: [{ kind: 'header', height: 8, cells: [cell('名称'), cell('数量')] }],
        rows: [dataRow, ...rows],
        footerRows: [],
        isLastSlice: false,
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

    it('blank 行输出 <tr class="is-blank">，单元格内容空', () => {
      const html = blankTableHtml([
        { kind: 'blank', height: 8, cells: [{ text: '', align: 'left' }, { text: '', align: 'left' }] },
        { kind: 'blank', height: 8, cells: [{ text: '', align: 'left' }, { text: '', align: 'left' }] },
      ])
      expect((html.match(/<tr class="is-blank"/g) || []).length).toBe(2)
      expect((html.match(/<tr class="is-data"/g) || []).length).toBe(1)
    })

    it('blank 行的 td 保留边框（让补空行视觉上"是表格的一行"），仅去 padding', () => {
      const html = blankTableHtml([
        { kind: 'blank', height: 8, cells: [{ text: '', align: 'left' }, { text: '', align: 'left' }] },
      ])
      // 渲染器不输出内联 border-top/border-bottom（边框由 .op-table.b-all td 类规则兜底画横线）
      const blankTr = html.match(/<tr class="is-blank"[\s\S]*?<\/tr>/)![0]!
      const blankTdMatches = blankTr.match(/<td[^>]*>/g)
      expect(blankTdMatches).toBeTruthy()
      for (const td of blankTdMatches!) {
        expect(td).not.toContain('border-top')
        expect(td).not.toContain('border-bottom')
      }
      // 空白单元格：内容用 <br> 占位，确保 cell 有最小高度（即使 padding:0 也能撑开行高）
      expect(blankTr).toContain('<br>')
    })
  })

  /* ============= M3 P0-1 vMerge 同值纵向合并（运行期 HTML 输出） ============= */

  describe('vMerge —— 运行期 HTML 输出', () => {
    /** 构造一个含 vMerge 锚点行的 PlacedTable */
    function vMergeTableHtml(rows: RenderRow[]): string {
      const table: PlacedTable = {
        kind: 'table',
        id: 't',
        left: 0,
        top: 0,
        width: 40,
        height: 40,
        control: { id: 't', type: 'table' } as TableControl,
        columns: [
          { title: '客户', width: 20 },
          { title: '金额', width: 20 },
        ],
        columnWidths: [20, 20],
        headerRows: [
          { kind: 'header', height: 8, cells: [{ text: '客户', align: 'center' }, { text: '金额', align: 'center' }] },
        ],
        rows,
        footerRows: [],
        isLastSlice: false,
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

    it('vMerge 锚点行：cell.rowSpan=N → HTML 输出 rowspan="N"', () => {
      const html = vMergeTableHtml([
        {
          kind: 'data',
          height: 24,
          dataIndex: 0,
          cells: [
            { text: '阿里', align: 'left', rowSpan: 3 },
            { text: '100', align: 'right' },
          ],
        },
      ])
      // 锚点 td 含 rowspan="3"
      expect(html).toMatch(/<td[^>]*rowspan="3"[^>]*>阿里<\/td>/)
      // 第二个单元格（金额列）无 rowSpan 属性
      const amtTd = html.match(/<td[^>]*>100<\/td>/)![0]!
      expect(amtTd).not.toContain('rowspan')
    })

    it('vMerge 锚点行高 × N：合并组视觉占 N × 单行高（数据样例）', () => {
      // 锚点 row.height 应等于"合并组高度"——engine 已写入，渲染期直接透传
      const html = vMergeTableHtml([
        {
          kind: 'data',
          height: 24, // 3 × 8
          dataIndex: 0,
          cells: [
            { text: 'A', align: 'left', rowSpan: 2 },
            { text: '1', align: 'right' },
          ],
        },
        {
          kind: 'data',
          height: 8,
          dataIndex: 1,
          cells: [
            { text: 'B', align: 'left' },
            { text: '2', align: 'right' },
          ],
        },
      ])
      // 渲染期 <tr height="24mm"> / <tr height="8mm">
      expect(html).toMatch(/<tr class="is-data"[^>]*style="height:24mm"/)
      expect(html).toMatch(/<tr class="is-data"[^>]*style="height:8mm"/)
      // 仅锚点输出 rowspan
      expect((html.match(/rowspan="2"/g) || []).length).toBe(1)
    })

    it('vMerge 仅合并指定列：被吞行不渲染被吞列的 <td>，其他列照常输出', () => {
      // 这是用户报的 bug 的回归用例：
      // 勾选 col 0「同值合并」→ 行 1/2/3 同值时，row 1 锚点 rowspan=3，
      // row 2/3 在 col 0 不输出 <td>，但 col 1/2/3 照常输出自己的值
      const html = vMergeTableHtml([
        {
          kind: 'data',
          height: 8,
          dataIndex: 0,
          cells: [
            { text: '外观', align: 'left', rowSpan: 3 }, // 锚点：rowspan=3
            { text: 'data1_col2', align: 'left' },
            { text: 'data1_col3', align: 'left' },
            { text: 'data1_col4', align: 'left' },
          ],
        },
        {
          kind: 'data',
          height: 8,
          dataIndex: 1,
          cells: [
            { text: '外观', align: 'left', consumed: true }, // 被吞
            { text: 'data2_col2', align: 'left' },
            { text: 'data2_col3', align: 'left' },
            { text: 'data2_col4', align: 'left' },
          ],
        },
        {
          kind: 'data',
          height: 8,
          dataIndex: 2,
          cells: [
            { text: '外观', align: 'left', consumed: true }, // 被吞
            { text: 'data3_col2', align: 'left' },
            { text: 'data3_col3', align: 'left' },
            { text: 'data3_col4', align: 'left' },
          ],
        },
      ])
      // 3 个数据行都在 tr 里
      const trMatches = html.match(/<tr class="is-data"/g)
      expect(trMatches).toHaveLength(3)
      // 每个被吞行只有 3 个 td（col 1/2/3 跳过 col 0）
      const consumedRowRegex = /<tr class="is-data"(?:(?!<\/tr>)[\s\S])*?<\/tr>/g
      const allRows = html.match(consumedRowRegex) ?? []
      // 第 1 行（锚点）：4 个 td
      expect((allRows[0]!.match(/<td/g) || []).length).toBe(4)
      // 第 2 行（被吞）：3 个 td（col 0 被 rowspan 吞掉，渲染器跳过）
      expect((allRows[1]!.match(/<td/g) || []).length).toBe(3)
      // 第 3 行（被吞）：3 个 td
      expect((allRows[2]!.match(/<td/g) || []).length).toBe(3)
      // 被吞行各自的数据保留（关键！不能再丢失其他列的数据）
      expect(allRows[1]).toContain('data2_col2')
      expect(allRows[1]).toContain('data2_col3')
      expect(allRows[1]).toContain('data2_col4')
      expect(allRows[2]).toContain('data3_col2')
      expect(allRows[2]).toContain('data3_col3')
      expect(allRows[2]).toContain('data3_col4')
      // 锚点行：rowspan=3 写在 col 0
      expect(allRows[0]).toContain('rowspan="3"')
    })
  })
})
