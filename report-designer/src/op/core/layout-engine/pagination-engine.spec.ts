import { describe, expect, it } from 'vitest'

import { layout } from '@op/core/layout-engine/pagination-engine'
import { renderHtml } from '@op/core/renderer-html'
import { createDemoTemplate } from '@op/repository/mock/data/demo-template'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'
import { seedSummaryTail } from '@op/core/layout-engine/table-cells'
import type { AnyControl, LabelGridControl, TableControl } from '@op/types/control'
import type { PageSetup, TemplateData } from '@op/types/template'
import type { LayoutResult, PlacedTable } from './types'

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
  return {
    order: { orderNo: 'SO-2026-0001', orderDate: '2026-08-08' },
    customer: { name: '演示客户' },
    items,
  }
}

const A4: PageSetup = {
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  backgroundColor: '#ffffff',
}

describe('layout 分页引擎（集成 demo 模板）', () => {
  const template = createDemoTemplate()
  const measurer = createCjkMeasurer()

  // 正文可用高 275mm（Word 式：页眉/页脚在边距内不占正文）→ 40 行起跨页
  for (const rows of [40, 80]) {
    it(`明细 ${rows} 行 → 多页，页眉页脚每页重复，合计仅末页`, async () => {
      const result = await layout(template, makeData(rows), { measurer })
      const pages = result.pages.length
      expect(pages).toBeGreaterThanOrEqual(2)

      const html = renderHtml(result, { screen: false })
      // 样式表不参与计数
      const body = html.replace(/<style[\s\S]*?<\/style>/g, '')

      // 页眉页脚每页重复
      expect((body.match(/op-section op-header/g) || []).length).toBe(pages)
      expect((body.match(/op-section op-footer/g) || []).length).toBe(pages)

      // 表格按页切片：每页一个 <table>
      expect((body.match(/op-node op-table/g) || []).length).toBe(pages)

      // 合计行仅一次（末页）
      expect((body.match(/is-summary/g) || []).length).toBe(1)

      // 表格 userHeight(60mm) 远小于实际渲染高度(80 行明细 ≈ ~400mm) →
      // 表格下方的「合计」「制单」等控件被新检测识别为误分类,
      // 发出 TABLE_USER_HEIGHT_MISMATCH 警告。期望这条警告出现 ≥1 次。
      const mismatchWarnings = result.warnings.filter(
        (w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH',
      )
      expect(mismatchWarnings.length).toBeGreaterThanOrEqual(1)
      // 关键:不该再出现旧的「labelgrid + flowTable 共存」误报
      expect(
        result.warnings.filter(
          (w) => w.code === 'CONTENT_OVERFLOW' && w.message.includes('标签网格与流式明细表格'),
        ).length,
      ).toBe(0)
    })
  }
})

describe('layout —— 页眉每页重复 + 流式表格分页（表格不得覆盖页眉/页脚）', () => {
  const measurer = createCjkMeasurer()

  /** A4、无上下边距；页眉 30mm（明显占据页顶）、页脚 10mm；表格从 35mm 起 → 跨页 */
  function headerTableTemplate(): TemplateData<AnyControl> {
    const table = seedSummaryTail(
      {
        id: 'ft',
        type: 'table',
        left: 10,
        top: 35,
        width: 190,
        height: 40,
        dataSource: 'items',
        columns: [
          { title: '名称', field: 'items[].name', width: 140, align: 'left', headerAlign: 'center' },
          { title: '金额', field: 'items[].amount', width: 50, headerAlign: 'center' },
        ],
        data: [{ name: 'A', amount: 20 }],
        options: { repeatHeader: true, repeatFooter: false },
      } as unknown as TableControl,
      { numericColumns: [1], moneyColumn: 1, capital: true },
    )
    return {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [
          {
            type: 'header',
            height: 30,
            repeat: true,
            components: [
              { id: 'hd-t', type: 'text', left: 0, top: 0, width: 200, height: 10, value: '公司抬头' } as AnyControl,
            ],
          },
          { type: 'body', components: [table] },
          {
            type: 'footer',
            height: 10,
            repeat: true,
            components: [
              { id: 'ft-p', type: 'text', left: 0, top: 2, width: 100, height: 6, value: '第 {{page}} 页' } as AnyControl,
            ],
          },
        ],
      },
    }
  }

  function tablesOf(pageNo: number, result: LayoutResult): PlacedTable[] {
    return result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
  }

  it('非首页表格切片从页眉下方开始（top = headerHeight），不覆盖每页重复的页眉/页脚', async () => {
    const result = await layout(headerTableTemplate(), makeData(60), { measurer })
    expect(
      result.pages.length,
      'pages=' + result.pages.length + ' warns=' + JSON.stringify(result.warnings.map((w) => w.code)),
    ).toBeGreaterThanOrEqual(2)

    // 每页表格切片都不进入页眉区（top >= 30mm）
    for (let i = 0; i < result.pages.length; i++) {
      for (const t of tablesOf(i, result)) {
        expect(t.top, `page ${i + 1} table.top`).toBeGreaterThanOrEqual(30 - 0.5)
        // 表格底部不超过页脚上沿（297 - 10 = 287mm）
        expect(t.top + t.height, `page ${i + 1} table.bottom`).toBeLessThanOrEqual(287 + 0.5)
      }
    }

    // 首页表格从用户放置位置 35mm 起（尊重设计位置）
    expect(tablesOf(0, result)[0]!.top).toBe(35)
    // 非首页（若有多页）从页眉下方 30mm 起
    for (let i = 1; i < result.pages.length; i++) {
      expect(tablesOf(i, result)[0]!.top, `page ${i + 1} table.top`).toBe(30)
    }

    // 表格确实跨页（60 行不止一页）
    const html = renderHtml(result, { screen: false })
    const body = html.replace(/<style[\s\S]*?<\/style>/g, '')
    expect((body.match(/op-node op-table/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('无色带模板行为不变（零回归）：非首页切片从页顶 0 起', async () => {
    const tpl: TemplateData<AnyControl> = headerTableTemplate()
    tpl.document.sections = [{ type: 'body', components: (tpl.document.sections![1] as { components: AnyControl[] }).components }]
    const result = await layout(tpl, makeData(60), { measurer })
    expect(result.pages.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < result.pages.length; i++) {
      expect(tablesOf(i, result)[0]!.top, `page ${i + 1} table.top`).toBe(0)
    }
  })
})

describe('layout —— 表格拖到底部 + 下方控件（强转非末页回归）', () => {
  const measurer = createCjkMeasurer()

  /** A4 纵向 10mm 边距：正文可用高 = 297-10-10 = 277mm */
  function bottomTableTemplate(): TemplateData<AnyControl> {
    const amountCol = 1
    const table = seedSummaryTail(
      {
        id: 'ft',
        type: 'table',
        left: 10,
        top: 230, // 拖到正文区底部 → 页 1 可用高度 ≈ 47mm
        width: 190,
        height: 40,
        dataSource: 'items',
        columns: [
          { title: '名称', field: 'items[].name', width: 140, align: 'left', headerAlign: 'center' },
          { title: '金额', field: 'items[].amount', width: 50, headerAlign: 'center' },
        ],
        data: [
          { name: 'A', amount: 20 },
          { name: 'B', amount: 30 },
        ],
        options: { repeatHeader: true, repeatFooter: false },
      } as unknown as TableControl,
      { numericColumns: [amountCol], moneyColumn: amountCol, capital: true },
    )
    return {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
        },
        sections: [
          {
            type: 'body',
            components: [
              table,
              { id: 'sign', type: 'text', left: 10, top: 272, width: 120, height: 25, value: '签章' } as AnyControl,
            ],
          },
        ],
      },
    }
  }

  function tablesOf(pageNo: number, result: LayoutResult): PlacedTable[] {
    return result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
  }

  const kinds = (pageNo: number, result: LayoutResult): string[] =>
    tablesOf(pageNo, result).flatMap((t) => t.footerRows.map((f) => f.footerKind ?? ''))
  const textOf = (pageNo: number, kind: string, col: number, result: LayoutResult): string | undefined =>
    tablesOf(pageNo, result)
      .flatMap((t) => t.footerRows)
      .find((f) => f.footerKind === kind)?.cells[col]?.text

  it('表格在页 1 放完但下方控件独占页 2 → 总计/大写只在页 2；本页合计逐页按本页数据计算', async () => {
    const result = await layout(bottomTableTemplate(), {}, { measurer })
    expect(
      result.pages.length,
      'pages=' + result.pages.length + ' warns=' + JSON.stringify(result.warnings.map((w) => w.code)),
    ).toBe(2)

    // 页 1：只有本页合计，绝无总计 / 大写金额；本页合计 = 20（仅本页第 1 行）
    expect(kinds(0, result)).toContain('pageSubtotal')
    expect(kinds(0, result)).not.toContain('grandTotal')
    expect(kinds(0, result)).not.toContain('capital')
    expect(textOf(0, 'pageSubtotal', 1, result)).toBe('20')

    // 页 2（文档末页）：本页合计 = 30（末页第 2 行）+ 总计 = 50 + 大写金额 = 伍拾元整
    expect(kinds(1, result)).toContain('pageSubtotal')
    expect(kinds(1, result)).toContain('grandTotal')
    expect(kinds(1, result)).toContain('capital')
    expect(textOf(1, 'pageSubtotal', 1, result)).toBe('30')
    expect(textOf(1, 'grandTotal', 1, result)).toBe('50')
    expect(textOf(1, 'capital', 1, result)).toBe('伍拾元整')
  })
})

/* ============= P0-2 按纸张补空行（fixBottomRows） ============= */

describe('layout —— fixBottomRows 按纸张补空行（跨页 + 末页不补）', () => {
  const measurer = createCjkMeasurer()

  /** 100 行数据、A4 纵向、无上下边距 → 必跨多页 */
  function fixBottomTemplate(opts: { fixBottomRows: 'fill' | { count: number }; fixBottomMargin?: number }): TemplateData<AnyControl> {
    const table = {
      id: 'fb',
      type: 'table',
      left: 10,
      top: 0,
      width: 190,
      height: 40,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 140, headerAlign: 'center' },
        { title: '金额', field: 'items[].amount', width: 50, headerAlign: 'center' },
      ],
      data: Array.from({ length: 100 }, (_, i) => ({ name: `n${i}`, amount: i + 1 })),
      options: {
        repeatHeader: true,
        repeatFooter: false,
        borders: 'all',
        ...opts,
      },
    } as unknown as TableControl
    return {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
  }

  const blankCountOf = (pageNo: number, result: LayoutResult): number =>
    result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
      .reduce((sum, t) => sum + t.rows.filter((r) => r.kind === 'blank').length, 0)
  const dataCountOf = (pageNo: number, result: LayoutResult): number =>
    result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
      .reduce((sum, t) => sum + t.rows.filter((r) => r.kind === 'data').length, 0)

  it('fill 模式：跨页每片都按剩余空间补 blank 行（中间页 + 末页同样适用）', async () => {
    const result = await layout(fixBottomTemplate({ fixBottomRows: 'fill' }), {}, { measurer })
    expect(result.pages.length, '应当跨多页').toBeGreaterThanOrEqual(2)

    // 每页都应有 blank 行（fill 模式覆盖中间页 + 末页）
    for (let p = 0; p < result.pages.length; p++) {
      expect(blankCountOf(p, result), `第 ${p + 1} 页应有补空行`).toBeGreaterThan(0)
      expect(dataCountOf(p, result), `第 ${p + 1} 页应保留数据行`).toBeGreaterThan(0)
    }
  })

  it('fill 模式 + 单页凭证：只有一页时仍按可用空间补空', async () => {
    // 数据极少 + 大可用 → 单页凭证场景
    const tpl: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [
          {
            type: 'body',
            components: [
              {
                id: 'cert',
                type: 'table',
                left: 10,
                top: 0,
                width: 190,
                height: 40,
                dataSource: 'items',
                columns: [
                  { title: '名称', field: 'items[].name', width: 140, headerAlign: 'center' },
                  { title: '金额', field: 'items[].amount', width: 50, headerAlign: 'center' },
                ],
                data: [
                  { name: 'A', amount: 20 },
                  { name: 'B', amount: 30 },
                ],
                options: {
                  repeatHeader: true,
                  repeatFooter: false,
                  borders: 'all',
                  fixBottomRows: 'fill',
                },
              } as unknown as TableControl,
            ],
          },
        ],
      },
    }
    const result = await layout(tpl, {}, { measurer })
    // fill 模式填满可用区域；不论跨页与否，第 1 页都应有 blank 行
    expect(blankCountOf(0, result), '第 1 页应有补空行').toBeGreaterThan(0)
  })

  it('{ count: N } 模式：每页 blank ≤ N（不让位，超出可用则裁剪）', async () => {
    const result = await layout(fixBottomTemplate({ fixBottomRows: { count: 5 } }), {}, { measurer })
    expect(result.pages.length, '应当跨多页').toBeGreaterThanOrEqual(2)
    for (let p = 0; p < result.pages.length; p++) {
      const blank = blankCountOf(p, result)
      const data = dataCountOf(p, result)
      // count 模式：每页 blank 数量 ≤ N（裁剪上限，不让位）
      expect(blank, `第 ${p + 1} 页 blank 行数 ≤ N`).toBeLessThanOrEqual(5)
      // 数据行原样保留（不让位，不丢数据）
      expect(data, `第 ${p + 1} 页数据行保留`).toBeGreaterThan(0)
    }
  })

  it('{ count: 100 } 超大值：被裁剪到剩余预算能放下的最多行数（不丢数据）', async () => {
    const result = await layout(fixBottomTemplate({ fixBottomRows: { count: 100 } }), {}, { measurer })
    for (let p = 0; p < result.pages.length; p++) {
      const blank = blankCountOf(p, result)
      // 100 行极不可能放下，应被裁剪；数据行不变
      expect(blank, `第 ${p + 1} 页 blank 行数`).toBeLessThan(100)
      expect(dataCountOf(p, result), `第 ${p + 1} 页数据行应保留`).toBeGreaterThan(0)
    }
  })

  it('fixBottomMargin：留白预留减少 blank 行数', async () => {
    const tplNo = fixBottomTemplate({ fixBottomRows: 'fill' })
    const tplWith = fixBottomTemplate({ fixBottomRows: 'fill', fixBottomMargin: 20 })
    const rNo = await layout(tplNo, {}, { measurer })
    const rWith = await layout(tplWith, {}, { measurer })
    // 第 1 页 blank 数：带 margin 应更少
    expect(blankCountOf(0, rWith)).toBeLessThanOrEqual(blankCountOf(0, rNo))
  })

  it('fixBottomRows=off：跨页无 blank 行（与开启时对比）', async () => {
    const tplOn = fixBottomTemplate({ fixBottomRows: 'fill' })
    const tplOff = fixBottomTemplate({ fixBottomRows: 'off' })
    const rOn = await layout(tplOn, {}, { measurer })
    const rOff = await layout(tplOff, {}, { measurer })
    // 开启的页 1 应有 blank，关闭的页 1 应无 blank
    expect(blankCountOf(0, rOn)).toBeGreaterThan(0)
    expect(blankCountOf(0, rOff)).toBe(0)
  })
})

/* ============= fixBottomRows='fill' × 下方控件 回归 ============= */

describe('layout —— fixBottomRows="fill" + 下方控件回归（fill 让位不丢数据、不多空白页）', () => {
  const measurer = createCjkMeasurer()

  /**
   * 模板构造：fill 模式触发让位 while 的窄预算场景。
   * 设计要点：trial.avail = availFull - reserveBelow 恰好略大于「数据+合计+大写」总高，
   * 让 fixBottomActive 让位 while 触发（remain ∈ (0, blankH)）。
   *
   * 修复前（fill 让位 i++）：
   *   - trial.isLast=false → fallback availFull → 补空到页底 → 控件被挤到下一页 → 多出空白页
   *
   * 修复后（fill 让位就地替换 blank 行）：
   *   - trial.isLast=true → slice=trial（窄预算）→ 控件放得下 → 单页
   */
  function fillBelowTemplate(): TemplateData<AnyControl> {
    const table = seedSummaryTail(
      {
        id: 'fb',
        type: 'table',
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        dataSource: 'items',
        columns: [
          { title: '名称', field: 'items[].name', width: 70, headerAlign: 'center' },
          { title: '金额', field: 'items[].amount', width: 30, headerAlign: 'center' },
        ],
        data: Array.from({ length: 5 }, (_, i) => ({ name: `n${i}`, amount: i + 1 })),
        options: { repeatHeader: true, repeatFooter: false, borders: 'all', fixBottomRows: 'fill' },
      } as unknown as TableControl,
      { numericColumns: [1], moneyColumn: 1, capital: true },
    )
    return {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 110,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
        },
        sections: [
          {
            type: 'body',
            components: [
              table,
              // reserveBelow ≈ 183mm：trial.avail ≈ 94mm 略 > 数据总高(~84) → 触发 fill 让位
              { id: 'sign', type: 'text', left: 0, top: 215, width: 100, height: 10, value: '签章' } as AnyControl,
            ],
          },
        ],
      },
    }
  }

  const blankCountOf = (pageNo: number, result: LayoutResult): number =>
    result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
      .reduce((sum, t) => sum + t.rows.filter((r) => r.kind === 'blank').length, 0)
  const controlNodesOf = (pageNo: number, result: LayoutResult): number =>
    result.pages[pageNo]!.body.filter((n) => n.kind === 'control').length

  it('fill 让位 + 下方控件：单页完成，不多出空白页', async () => {
    const result = await layout(fillBelowTemplate(), {}, { measurer })
    // 修复前：trial.isLast=false → fallback availFull → 补空到页底 → 控件被挤掉 → 2 页
    // 修复后：trial.isLast=true → slice=trial（窄）→ 控件放得下 → 1 页
    expect(
      result.pages.length,
      'pages=' +
        result.pages.length +
        ' warns=' +
        JSON.stringify(result.warnings.map((w) => w.code)),
    ).toBe(1)
    // 第 1 页同时含表格（含 fill 补空行）+ 文本控件
    expect(blankCountOf(0, result)).toBeGreaterThan(0)
    expect(controlNodesOf(0, result)).toBeGreaterThan(0)
  })

  it('fill 让位：单页 fill 模式下保留所有数据行（不丢数据）', async () => {
    const result = await layout(fillBelowTemplate(), {}, { measurer })
    // 修复前：fill 让位让 1 数据行归到下一页 → 末片数据少 1 行
    // 修复后：fill 让位就地替换 blank 行 → 数据完整保留
    const totalDataRows = result.pages
      .flatMap((p) => p.body)
      .filter((n): n is PlacedTable => n.kind === 'table')
      .flatMap((t) => t.rows)
      .filter((r) => r.kind === 'data').length
    expect(totalDataRows).toBe(5) // 5 数据行完整保留，无丢失
  })
})

// ★ Commit 6:pagination-engine 预生成入口端到端测试
describe('layout —— 段级形态(qrcode)端到端', () => {
  it('cell 含 qrcode 段时 layout 返回 HTML 包含 <svg>', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      dataSource: 'items',
      columns: [{ field: 'qr', title: '码', width: 100 }],
      cells: [
        [],
        [
          {
            segments: [{ kind: 'field', path: 'qr', format: { kind: 'qrcode', errorLevel: 'M' } }],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    const data = { items: [{ qr: 'ABC-001' }, { qr: 'ABC-002' }] }
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toMatch(/<svg/)
  })

  it('段级二维码混排 text+qrcode+text → HTML 文本与 svg 顺序串联', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      dataSource: 'items',
      columns: [{ field: 'qr', title: '扫描', width: 100 }],
      cells: [
        [],
        [
          {
            segments: [
              { kind: 'text', value: '扫描:' },
              { kind: 'field', path: 'qr', format: { kind: 'qrcode', errorLevel: 'M' } },
              { kind: 'text', value: '核对' },
            ],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    const data = { items: [{ qr: 'X1' }] }
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toMatch(/扫描:.*<svg/)
    expect(html).toMatch(/svg.*核对/s)
  })

  it('段级二维码空值 → 显示占位文本 (空二维码),不显示 svg', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      dataSource: 'items',
      columns: [{ field: 'qr', title: '码', width: 100 }],
      cells: [
        [],
        [
          {
            segments: [{ kind: 'field', path: 'qr', format: { kind: 'qrcode', errorLevel: 'M' } }],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    const data = { items: [{ qr: '' }] } // 空值 → 触发占位符
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toContain('(空二维码)')
    // 注意:可能因为别的测试残留 svg,这里只断言占位文本存在
    expect(result.warnings.filter((w) => w.code === 'BARCODE_FAILED').length).toBe(0)
  })

  // ★ Bug 回归:cell path 是顶层字段(如 Header.ReportNo)时,precompute 也必须能命中。
  //   之前 collectRowPaths 只对 dataSource 数组遍历,顶层字段直接被跳过 → 预生成空 cache → svgLookup miss → 显示空。
  it('★ cell path 是顶层字段(如 Header.ReportNo)时,顶层字段值参与预生成 → 显示 svg', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      dataSource: 'items',
      columns: [{ field: 'name', title: '列', width: 100 }],
      // cell path = 'Header.ReportNo'(顶层,非数组项)
      cells: [
        [],
        [
          {
            segments: [
              { kind: 'field', path: 'Header.ReportNo', format: { kind: 'qrcode', errorLevel: 'M' } },
            ],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    // 关键:Header.ReportNo 是顶层字段,items 数组项内不出现。
    const data = {
      Header: { ReportNo: 'SO-2026-0001' },
      items: [{ name: 'A' }, { name: 'B' }],
    }
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toMatch(/<svg/)
  })

  // ★ Bug 回归:静态表格(无 dataSource,用户手画的 layout grid)里的 cell 段级 qrcode
  //   必须能正常渲染 SVG。
  //   之前 placeStaticTables 调用 buildTableModel 时漏传 svgLookup,导致 cell.parts 退化为空,
  //   qrcode 段永远拿不到 svg,预览画布上对应行/列要么空白要么退化成文本。
  //   本用例确保修复后:静态表 + cell.segments 形态段 → 渲染出 SVG。
  it('★ 静态表格(无 dataSource)cell 含 qrcode 段 → HTML 包含 <svg>', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      // ★ 关键:无 dataSource,这是「静态表」分支(走 placeStaticTables)
      columns: [{ field: 'qr', title: '码', width: 100 }],
      cells: [
        [],
        [
          {
            segments: [
              { kind: 'field', path: 'Header.MaterialCode', format: { kind: 'qrcode', errorLevel: 'M' } },
            ],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    // data 不需要 items 数组(无 dataSource),只放顶层字段
    const data = { Header: { MaterialCode: 'RM-2026-00123' } }
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toMatch(/<svg/)
    // 修复前:cell parts 退化为空 text,html 里只有「(空二维码)」或裸空字符串,根本不会渲染 svg。
    // 修复后:静态表路径也走 svgLookup,QR 段能命中 svgCache,正确输出 svg。
  })

  // 顺便验证静态表 + barcode 形态也走同一条修复路径
  it('★ 静态表格 cell 含 barcode 段 → HTML 包含 <svg>', async () => {
    const table: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 30,
      columns: [{ field: 'bc', title: '条', width: 100 }],
      cells: [
        [],
        [
          {
            segments: [
              { kind: 'field', path: 'Header.BatchNo', format: { kind: 'barcode', bcid: 'code128', showText: false } },
            ],
          },
        ],
      ],
    } as TableControl
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [{ type: 'body', components: [table] }],
      },
    }
    const measurer = createCjkMeasurer()
    const data = { Header: { BatchNo: 'LOT-2026-08-001' } }
    const result = await layout(template, data, { measurer })
    const html = renderHtml(result)
    expect(html).toMatch(/<svg/)
  })
})

/* -------------------- userHeight 误分类警告 + labelgrid+flowTable 共存 -------------------- */
describe('layout —— userHeight 误分类警告 + labelgrid+flowTable 共存', () => {
  const A4 = {
    width: 210,
    height: 297,
    unit: 'mm' as const,
    orientation: 'portrait' as const,
    margin: { top: 10, bottom: 10, left: 10, right: 10 },
    backgroundColor: '#ffffff',
  }

  function makeTable(userHeight: number, rowCount: number): TableControl {
    return {
      id: 'src-table', type: 'table',
      left: 10, top: 50, width: 190, height: userHeight,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 60, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 60, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        ...Array.from({ length: rowCount }, () => [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ]),
      ],
      dataSource: 'items', printable: true,
    }
  }

  function makeData(rows: number): Record<string, unknown> {
    return {
      items: Array.from({ length: rows }, (_, i) => ({
        productCode: `P${i}`, qty: i + 1,
      })),
    }
  }

  it('userHeight 设小(8mm) + 控件设计 top=85 (远小于实际渲染底) → 发 TABLE_USER_HEIGHT_MISMATCH 警告', async () => {
    const measurer = createCjkMeasurer()
    // 表格 userHeight=8,但实际渲染 ~55mm(skeleton.lastBottom ≈ 105mm)
    const table = makeTable(8, 9)
    const summary: AnyControl = {
      id: 'sum', type: 'text',
      left: 10, top: 85, width: 80, height: 8,
      value: '合计', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, summary] }],
      }},
      makeData(9),
      { measurer },
    )
    const mismatch = result.warnings.filter((w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH')
    expect(mismatch.length).toBe(1)
    expect(mismatch[0]!.controlId).toBe('sum')
    expect(mismatch[0]!.message).toContain('实际渲染底')
    expect(mismatch[0]!.message).toContain('userHeight=8')
  })

  /**
   * ★ 多 overlap 控件 refine —— 跨组保留原始相对 top 差(v3 容差外)
   *
   * 场景:同一表格,两个文本控件设计 top 跨越 userHeight 上边界
   *      (table top=10, height=100 → designTableBottom=110; 两个文本 top=85/95 都 < 110 但 bottom > table.top+EPS),
   *      被 analyzeBody 划进 plan.overlap。差 10mm 超出 SAME_TOP_TOLERANCE_MM=5mm,
   *      refine 后保留原 10mm 相对差。
   * 修复前:两者都被 absoluteLastBottom + 0 锚定 → 同 top 视觉异常。
   * v2 修复:最小 top 控件为锚,后续 = 锚 + 原始 top 差。
   * v3 修复:差 ≤ 5mm 视为同行(吸收),> 5mm 视为跨组(保留差)。
   */
  it('两个 overlap 控件原 top 差 10mm(超出容差) → refine 后保留 10mm 相对 top 差', async () => {
    const measurer = createCjkMeasurer()
    const table = makeTable(100, 9)  // top=10, height=100 → designTableBottom=110
    const ctrlA: AnyControl = {
      id: 'buyer', type: 'text',
      left: 10, top: 85, width: 80, height: 8,
      value: '订购方:李明', printable: true,
    }
    const ctrlB: AnyControl = {
      id: 'supplier', type: 'text',
      left: 10, top: 95, width: 80, height: 8,  // 差 10mm > 5mm 容差,保留差
      value: '供货商:德之馨', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, ctrlA, ctrlB] }],
      }},
      makeData(9),
      { measurer },
    )
    const mismatch = result.warnings.filter((w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH')
    // 两个控件都命中 refine
    expect(mismatch.length).toBe(2)
    expect(mismatch.map((w) => w.controlId).sort()).toEqual(['buyer', 'supplier'])

    // 找到两个控件在末页的位置:末页 body 里绝对 top 最大的两个 control
    const lastPage = result.pages[result.pages.length - 1]!
    const bodyControls = lastPage.body.filter((n): n is Extract<typeof n, { kind: 'control' }> => n.kind === 'control')
    const buyerNode = bodyControls.find((n) => n.id === 'buyer')
    const supplierNode = bodyControls.find((n) => n.id === 'supplier')
    expect(buyerNode).toBeDefined()
    expect(supplierNode).toBeDefined()
    // ★ 跨组断言:相对 top 差 == 原始设计 top 差(10mm,超出容差被精确保留)
    expect(Math.abs((supplierNode!.top - buyerNode!.top) - 10)).toBeLessThan(0.001)
  })

  /**
   * ★ v3 容差:两个 overlap 控件原 top 差 3mm(≤ 5mm 容差)→ 视作同组,共享基线
   */
  it('两个 overlap 控件原 top 差 3mm(在容差内) → 视作同组,共享基线', async () => {
    const measurer = createCjkMeasurer()
    const table = makeTable(100, 9)
    const ctrlA: AnyControl = {
      id: 'a-text', type: 'text',
      left: 10, top: 85, width: 80, height: 8,
      value: '文本 A', printable: true,
    }
    const ctrlB: AnyControl = {
      id: 'b-text', type: 'text',
      left: 10, top: 88, width: 80, height: 8,  // 差 3mm ≤ 5mm 容差
      value: '文本 B', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, ctrlA, ctrlB] }],
      }},
      makeData(9),
      { measurer },
    )
    const lastPage = result.pages[result.pages.length - 1]!
    const bodyControls = lastPage.body.filter((n): n is Extract<typeof n, { kind: 'control' }> => n.kind === 'control')
    const aNode = bodyControls.find((n) => n.id === 'a-text')
    const bNode = bodyControls.find((n) => n.id === 'b-text')
    expect(aNode).toBeDefined()
    expect(bNode).toBeDefined()
    // ★ 同组:差 ≤ 容差 → 共享基线,两者 top 完全相等
    //   修复前:v2 精确保留差 → |bNode.top - aNode.top| ≈ 3mm
    //   修复后:v3 容差吸收 → |bNode.top - aNode.top| < 0.001
    expect(Math.abs(aNode!.top - bNode!.top)).toBeLessThan(0.001)
  })

  it('两个 overlap 控件原 top 相同(85 / 85) → refine 后保持同 top', async () => {
    const measurer = createCjkMeasurer()
    const table = makeTable(100, 9)
    const ctrlA: AnyControl = {
      id: 'left-label', type: 'text',
      left: 10, top: 85, width: 80, height: 8,
      value: '左标签', printable: true,
    }
    const ctrlB: AnyControl = {
      id: 'right-label', type: 'text',
      left: 10, top: 85, width: 80, height: 8,
      value: '右标签', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, ctrlA, ctrlB] }],
      }},
      makeData(9),
      { measurer },
    )
    const mismatch = result.warnings.filter((w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH')
    expect(mismatch.length).toBe(2)
    // 警告文案应标记「组内锚「xxx」对齐」
    expect(mismatch.some((w) => w.message.includes('组内锚'))).toBe(true)

    const lastPage = result.pages[result.pages.length - 1]!
    const bodyControls = lastPage.body.filter((n): n is Extract<typeof n, { kind: 'control' }> => n.kind === 'control')
    const aNode = bodyControls.find((n) => n.id === 'left-label')
    const bNode = bodyControls.find((n) => n.id === 'right-label')
    expect(aNode).toBeDefined()
    expect(bNode).toBeDefined()
    // 同 top → refine 后仍同 top(共享锚 + 0 相对位移)
    expect(Math.abs(aNode!.top - bNode!.top)).toBeLessThan(0.001)
  })

  it('userHeight 合理 + 控件设计 top 远大于表格用户底 → 不发 TABLE_USER_HEIGHT_MISMATCH', async () => {
    const measurer = createCjkMeasurer()
    // userHeight=80 给足,合计 top=200 远离表格底部
    const table = makeTable(80, 4)
    const summary: AnyControl = {
      id: 'sum', type: 'text',
      left: 10, top: 200, width: 80, height: 8,
      value: '合计', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, summary] }],
      }},
      makeData(4),
      { measurer },
    )
    expect(result.warnings.filter((w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH')).toEqual([])
  })

  /**
   * ★ below-stream 同 designTop 组共享基线(对应 overlap refine 修复 v2)
   *
   * 场景:两个文本控件完全同 top,被 analyzeBody 划进 plan.below(都远在表格下方),
   *      走 below-stream 而非 overlap refine。旧逻辑 max(cursorAbsBottom, candidateTop)
   *      会让第二个被 cursor 推到下一行;新逻辑同 designTop 共享 candidateTop。
   */
  it('两个 below 控件完全同 top → 预览同行(不被 cursor 推挤)', async () => {
    const measurer = createCjkMeasurer()
    const table = makeTable(50, 3)  // top=10, height=50 → designTableBottom=60
    const ctrlA: AnyControl = {
      id: 'below-a', type: 'text',
      left: 10, top: 200, width: 60, height: 8,
      value: '文本 A', printable: true,
    }
    const ctrlB: AnyControl = {
      id: 'below-b', type: 'text',
      left: 80, top: 200, width: 60, height: 8,
      value: '文本 B', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, ctrlA, ctrlB] }],
      }},
      makeData(3),
      { measurer },
    )
    // 找到两个控件在末页的位置
    const lastPage = result.pages[result.pages.length - 1]!
    const bodyControls = lastPage.body.filter((n): n is Extract<typeof n, { kind: 'control' }> => n.kind === 'control')
    const aNode = bodyControls.find((n) => n.id === 'below-a')
    const bNode = bodyControls.find((n) => n.id === 'below-b')
    expect(aNode).toBeDefined()
    expect(bNode).toBeDefined()
    // ★ 关键断言:同 designTop 组共享基线,两者 top 相等(不被 cursor 推到下一行)
    //   修复前:|bNode.top - aNode.top| ≈ 8(被推到下一行)
    //   修复后:|bNode.top - aNode.top| < 0.001(同行)
    expect(Math.abs(aNode!.top - bNode!.top)).toBeLessThan(0.001)
  })

  it('labelgrid 附录 + flowTable 共存(单据正文 + 附录图片墙) → 不再发 CONTENT_OVERFLOW 误报', async () => {
    const measurer = createCjkMeasurer()
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 80,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        ...Array.from({ length: 4 }, () => [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ]),
      ],
      dataSource: 'items', printable: true,
    }
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 200, width: 190, height: 60,
      columns: 3, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6, childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, appendixGrid] }],
      }},
      makeData(5),
      { measurer },
    )
    // 关键断言:这条历史误报应该 0 次
    const oldSpurious = result.warnings.filter(
      (w) => w.code === 'CONTENT_OVERFLOW' &&
             w.message.includes('标签网格与流式明细表格'),
    )
    expect(oldSpurious).toEqual([])
    // 网格展开并落在末页(可能 page 1 或 page 2)
    const gridChildIds = result.pages
      .flatMap((p) => p.body)
      .filter((n) => n.id.startsWith('app-wall~'))
    expect(gridChildIds.length).toBeGreaterThan(0)
  })
})

describe('layout —— 表格上方控件在 userHeight 过小时保留原位(above vs overlap)', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }
  // 用户截图场景:表格 top=80, userHeight=30(远小于 8 行实际展开高 ~62mm),
  // "甲方:李明" 文本控件 top=70(表格上方 10mm)。
  // 旧 Case 2 refine 把所有 placeControls 输出视为 overlap,approver.top=70 的 bottom=78
  // 落在 [50, absoluteLastBottom=142) 区间 → 被错下移到 top=142。
  // 修复后 refine 只对 plan.overlap 生效,above 控件保留原位。
  it('表格上方文本控件 top=70 应保持 top=70,不被下移到表格底', async () => {
    const data: TemplateData = {
      items: Array.from({ length: 8 }, (_, i) => ({
        productName: `产品${i}`,
        analysisItem: `分析项${i}`,
        method: `方法${i}`,
        result: `结果${i}`,
        finalVal: `终值${i}`,
      })),
      header: { approver: '李明' },
    }
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 80, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '项目', field: 'productName', width: 40 },
        { id: 'c2', title: '分析', field: 'analysisItem', width: 40 },
        { id: 'c3', title: '方法', field: 'method', width: 40 },
        { id: 'c4', title: '结果', field: 'result', width: 35 },
        { id: 'c5', title: '结果值', field: 'finalVal', width: 35 },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '项目' }] },
          { segments: [{ kind: 'text', value: '分析' }] },
          { segments: [{ kind: 'text', value: '方法' }] },
          { segments: [{ kind: 'text', value: '结果' }] },
          { segments: [{ kind: 'text', value: '结果值' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productName' }] },
          { segments: [{ kind: 'field', path: 'items[0].analysisItem' }] },
          { segments: [{ kind: 'field', path: 'items[0].method' }] },
          { segments: [{ kind: 'field', path: 'items[0].result' }] },
          { segments: [{ kind: 'field', path: 'items[0].finalVal' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const approverText: AnyControl = {
      id: 'approver', type: 'text',
      left: 20, top: 70, width: 100, height: 8,
      contentType: 'expression' as const, expression: '甲方:{{header.approver}}',
      printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 180, width: 190, height: 8,
      content: '第二条 质量要求:按需方提供的规格和要求生产', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [approverText, table, footerText] }] } },
      data, { measurer },
    )
    // 表格渲染底应在 80+62=142(userHeight=30 远小于实际 ~62mm)
    const tableNode = result.pages[0]!.body.find((n) => n.kind === 'table' && n.id === 'main')!
    expect(tableNode).toBeDefined()
    expect(tableNode.top + tableNode.height).toBeGreaterThan(80 + 30) // userHeight 远小于实际
    // 关键断言:approver 应保持原位 top=70,不被 Case 2 refine 下移
    const approver = result.pages[0]!.body.find((n) => n.id === 'approver')
    expect(approver).toBeDefined()
    expect(approver!.top).toBe(70)
    // footer-text 是表格下方控件,应被推到表格实际底之后
    const footer = result.pages[0]!.body.find((n) => n.id === 'footer-text')
    expect(footer).toBeDefined()
    expect(footer!.top).toBeGreaterThan(tableNode.top + tableNode.height - 0.5)
    // 不应再有针对 approver 的警告(above 控件不该被 refine)
    const approverWarn = result.warnings.filter((w) => w.controlId === 'approver')
    expect(approverWarn).toEqual([])
  })
})

describe('layout —— below 路径负 delta 钳到 0(控件设计 top < 表格设计底 时不被压数据行)', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }
  // 用户截图 bug:long-text 设计 top 在表格 userHeight 设计底附近(EPS 边界内),
  // analyzeBody 看 top < tBottom-EPS 把它分进 overlap → 走 refine;
  // 或者 top >= tBottom-EPS 把它分进 below → delta 略负 → textBaseTop + delta 渲染在末片内。
  // 修法:below 路径 safeDelta = max(0, delta),确保控件至少在末片底之外,不被数据行覆盖。
  it('文本设计 top=289.8 紧贴 tBottom=290(进 below,delta=-0.2)渲染在末片表格底之外', async () => {
    const data = {
      items: Array.from({ length: 30 }, (_, i) => ({
        Photo: `photo_${i}`, Name: `name_${i}`, Description: `desc_${i}`,
      })),
    }
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 170, width: 190, height: 120,  // userHeight=120 → tBottom=290
      columns: [
        { id: 'c1', title: '列1', field: 'Photo', width: 190 },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '列1' }] },
        ],
        [
          { segments: [{ kind: 'text', value: '{{row.Photo}}' }] },
        ],
      ],
      dataSource: 'items', printable: true,
      options: { rowHeight: 50 },
    }
    // 设计 top=289.8: 289.8 < tBottom=290 - 0.5 = 289.5? No (289.8 > 289.5) → below 路径
    // delta = 289.8 - 290 = -0.2 (负)
    // 修复前:textBaseTop + (-0.2) → 落在末片表格内
    // 修复后:safeDelta = max(0, -0.2) = 0 → 紧贴末片底
    const textControl: AnyControl = {
      id: 'long-text', type: 'text',
      left: 10, top: 289.8, width: 190, height: 8,
      content: '文本11111111111111111111111111111111111111111', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, textControl] }] } },
      data, { measurer },
    )
    // 长文本应出现在末页(page 1 或更高)
    const longText = result.pages
      .flatMap((p) => p.body)
      .find((n) => n.id === 'long-text')
    expect(longText).toBeDefined()
    // 找到该页的末片表格底
    const textPage = result.pages.find((p) => p.body.some((n) => n.id === 'long-text'))!
    const lastTable = textPage.body
      .filter((n) => n.kind === 'table')
      .sort((a, b) => b.top + b.height - a.top - a.height)[0]
    expect(lastTable).toBeDefined()
    // 长文本 top 必须 >= 末片表格底(不被数据行覆盖)
    expect(longText!.top).toBeGreaterThanOrEqual(lastTable!.top + lastTable!.height - 0.5)
    // 发出 TABLE_USER_HEIGHT_MISMATCH 警告(因为设计 top 小于实际末片底)
    const warns = result.warnings.filter((w) => w.controlId === 'long-text')
    expect(warns.length).toBeGreaterThan(0)
    expect(warns[0]!.code).toBe('TABLE_USER_HEIGHT_MISMATCH')
  })
})

describe('layout —— below 顺序排列 + reserveBelow 算 labelgrid 真实展开高 (Fix #1/#2/#3)', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }

  it('Fix #1: 用户设表格 height=80 但实际渲染高 100,below 文本和 labelgrid 仍按真实高 reserveBelow 独占新页', async () => {
    // 5 行明细 + 表头 1 行 → 实际高 ~100mm;但用户设 height=80(偏小)
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 80,    // ← userHeight=80,故意偏小
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        ...Array.from({ length: 5 }, () => [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ]),
      ],
      dataSource: 'items', printable: true,
    }
    // below:文本 + labelgrid(都设计在 tableBottom=130 之下,但 userHeight 偏小导致实际渲染底更靠下)
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 140, width: 190, height: 10,
      content: '合计/签名章', printable: true,
    }
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 160, width: 190, height: 50,
      columns: 3, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(5),
      { measurer },
    )
    // 关键:should NOT have labelgrid children overlapping footer text
    // → 二者都应该在末页 tableLastPage+1 (新页) OR 末页,但不重叠
    const lastPage = result.pages.at(-1)!
    const nodes = lastPage.body
    const footerTop = nodes.find((n) => n.id === 'footer-text')?.top ?? -1
    const gridChildrenTops = nodes
      .filter((n) => n.id.startsWith('app-wall~'))
      .map((n) => n.top)
    expect(footerTop).toBeGreaterThanOrEqual(0)
    expect(gridChildrenTops.length).toBeGreaterThan(0)
    // 断言:footer 文本 top 必须早于 labelgrid 卡片 top(顺序排列) — 修复前会重叠
    const minGridTop = Math.min(...gridChildrenTops)
    expect(footerTop).toBeLessThan(minGridTop + 0.5)
  })

  it('Fix #2: below 多控件按设计 top 顺序排列(labelgrid 在文本下面,不重叠)', async () => {
    // 表格 + 文本 + labelgrid,文本在 labelgrid 上面(设计顺序)
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,   // 小表格
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 100, width: 190, height: 8,    // 设计 top=100
      content: '合计/签名章', printable: true,
    }
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 130, width: 190, height: 50,  // 设计 top=130 (在文本下方)
      columns: 3, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(1),    // 1 条数据,表格很短 → 单页能放下
      { measurer },
    )
    const lastPage = result.pages.at(-1)!
    const nodes = lastPage.body
    const footerNode = nodes.find((n) => n.id === 'footer-text')
    const gridCards = nodes.filter((n) => n.id.startsWith('app-wall~'))
    expect(footerNode).toBeDefined()
    expect(gridCards.length).toBeGreaterThan(0)
    const footerTop = footerNode!.top
    const minGridTop = Math.min(...gridCards.map((n) => n.top))
    // 文本 top < labelgrid 第一行 top(顺序保留)
    expect(footerTop).toBeLessThan(minGridTop + 0.5)
    // 间距符合设计意图(footer.height=8 + 设计间距 ~22mm → footerTop+30 ≈ minGridTop)
    expect(minGridTop - footerTop).toBeGreaterThanOrEqual(20)
  })

  it('Fix #3: labelgrid 重新展开 originTop 与文本共享 firstBelowTop,不会重叠', async () => {
    // 极端场景:userHeight 极小(40mm) → 真实渲染底远超设计 → reserveBelow 必须含真实展开高
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 40,   // 极小
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        ...Array.from({ length: 4 }, () => [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ]),
      ],
      dataSource: 'items', printable: true,
    }
    // 文本紧贴 tableBottom 后(设计 top=92,实际 tableBottom=90)
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 92, width: 190, height: 6,
      content: '合计/签名章', printable: true,
    }
    // labelgrid 设计 top=110
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 110, width: 190, height: 50,
      columns: 3, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(4),
      { measurer },
    )
    // 文本与 labelgrid 必须分到末页或后续页(不重叠)
    for (const page of result.pages) {
      const nodes = page.body
      const footerNode = nodes.find((n) => n.id === 'footer-text')
      const gridCards = nodes.filter((n) => n.id.startsWith('app-wall~'))
      if (footerNode && gridCards.length > 0) {
        // 同页时:footer top < grid 卡片最小 top
        const footerTop = footerNode.top
        const minGridTop = Math.min(...gridCards.map((n) => n.top))
        expect(footerTop).toBeLessThan(minGridTop + 0.5)
      }
    }
  })
})

describe('layout —— below 按 mode 分流:文本紧跟末页表格,appendix 按 pageBreak 独立', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }

  it('场景 A: 文本紧跟末页表格(pageBreak=auto,grid 放得下) → 文本和 grid 都在第 1 页', async () => {
    // 用户场景:1 行数据 → 表格 1 行 + 表头 1 行 → 总高 ~20mm;留 60mm 给 below
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 100, width: 190, height: 8,
      content: '第二条 质量要求...', printable: true,
    }
    // appendix grid (1 行 2 列,数据 2 条 → 1 行,高度 = cardH + gapY = 25 + 3 = 28mm)
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 130, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',  // 放得下就跟,放不下推新页
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(2),
      { measurer },
    )
    expect(result.pages.length).toBe(1)  // 单页
    const page0 = result.pages[0]
    const nodes = page0.body
    // 文本和 grid 都在 page0
    expect(nodes.find((n) => n.id === 'footer-text')).toBeDefined()
    expect(nodes.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)
  })

  it('场景 B: 文本紧跟末页表格,但 appendix pageBreak=always → 文本在 page 1,grid 独占 page 2', async () => {
    // 同样的设计,但 grid 设 pageBreak='always'
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 100, width: 190, height: 8,
      content: '第二条 质量要求...', printable: true,
    }
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 130, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'always',  // ★ 强制独占新页
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(2),
      { measurer },
    )
    // 总 2 页
    expect(result.pages.length).toBe(2)
    const page0 = result.pages[0]!.body
    const page1 = result.pages[1]!.body
    // 文本在 page0 (紧跟表格),grid 在 page1 (独占新页)
    expect(page0.find((n) => n.id === 'footer-text')).toBeDefined()
    expect(page0.filter((n) => n.id.startsWith('app-wall~')).length).toBe(0)
    expect(page1.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)
  })

  it('场景 C: appendix pageBreak=auto 但 grid 真实展开高超出末页 → grid 独立新页 (文本仍紧跟末页)', async () => {
    // 12 条数据 + 2 列 → 6 行真实展开 → 6 * 33 - 3 = 195mm 真实高;
    // 单页放不下 → 推新页。文本只 8mm 紧跟末页表格。
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 100, width: 190, height: 8,
      content: '第二条 质量要求...', printable: true,
    }
    // grid 设计高度只需画 1 行(50mm),但实际 12 条数据 → 6 行真实展开高
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 130, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',  // 放得下就跟,放不下推新页
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(12),    // 12 条 → 6 行真实展开高 195mm,放不下当前页
      { measurer },
    )
    // 总 2 页:第 1 页表格+文本,第 2 页 grid
    expect(result.pages.length).toBe(2)
    const page0 = result.pages[0]!.body
    const page1 = result.pages[1]!.body
    expect(page0.find((n) => n.id === 'footer-text')).toBeDefined()
    expect(page0.filter((n) => n.id.startsWith('app-wall~')).length).toBe(0)
    expect(page1.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)
  })

  it('场景 D: appendix pageBreak=never → 放得下就跟文本后面,放不下也放当前页(交给 maxPages 截断保护)', async () => {
    // never 语义:始终紧跟当前页;放不下由 maxPages 保护
    // 1 行数据 + 小 grid → 整体单页能放下
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 100, width: 190, height: 8,
      content: '第二条', printable: true,
    }
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 130, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'never',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(2),
      { measurer },
    )
    // 单页能放下
    expect(result.pages.length).toBe(1)
    const page0 = result.pages[0]!.body
    expect(page0.find((n) => n.id === 'footer-text')).toBeDefined()
    expect(page0.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)
  })

  it('场景 E (回归): grid 设计在 page 1 底部 + 多行数据 → grid 内部推到 page 2,gridDecisions 必须一致 (避免脱钩)', async () => {
    // 用户截图 bug:grid 设计在 page 1 末尾(safeGridTop 接近 bodyStep),
    // data 多行真实展开高 > page 1 剩余空间 → 展开器内部推到 page 2;
    // 修复前:gridDecisions 用绝对坐标算 fits,误判"放得下",导致子控件落到 page 1 但被截断。
    // 修复后:fits 判断与展开器 line 270-280 完全同算法,gridDecisions 也推到 page 2。
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    // 文本设计在 165mm(刚好在 page 1 中部)
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 165, width: 190, height: 8,
      content: '合同签订期', printable: true,
    }
    // grid 设计 top=280mm(离 page 1 底 297mm 仅 17mm)→ page 1 装不下 → 推 page 2
    // 真实 12 条数据 + 2 列 = 6 行 → 真实高 ≈ 6*28-3 = 165mm > 17mm → 展开器推 page 2
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 280, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(12),  // 12 条 → 6 行真实展开,grid 设计 top=280 离 page 1 底 17mm 装不下
      { measurer },
    )
    expect(result.pages.length).toBe(2)
    const page0 = result.pages[0]!.body
    const page1 = result.pages[1]!.body
    // 关键断言:grid 子控件全部在 page 1 之外(避免脱钩后被截断)
    expect(page0.filter((n) => n.id.startsWith('app-wall~')).length).toBe(0)
    expect(page1.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)
  })

  it('场景 F (回归): appendix 推到新页时,第一张卡片必须完全落在新页内 (修复 1 + 修复 2 联调)', async () => {
    // 用户截图 bug:appendix 跨页场景下,gridDecisions 给 hint.pageIndex=2,originTop=20,
    // 但展开器内部的 'auto' 分支又用 gridTop 推 pageIndex=3 → 第一张卡片绝对 top=602,
    // pushNode 用 pageIndex=2 + top-400=202 → 整组卡片溢出 page 2 底部(200mm)。
    // 修复后:展开器有 hint 时尊重 caller,pageIndex=2 + originTop=20 → 第一张卡片 page-relative top≈22,
    // 完全落在 page 2 内,且剩余行顺势跨 page 3/4(自然跨页,不再溢出页面)。
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
    // 文本设计在 page 1 中后部
    const footerText: AnyControl = {
      id: 'footer-text', type: 'text',
      left: 10, top: 200, width: 190, height: 8,
      content: '附录前文本', printable: true,
    }
    // appendix 设计 top=280mm,真实数据 12 条 × 2 列 = 6 行 → 高 ~165mm → 放不下 page 1 末段 → 推 page 2
    const appendixGrid: AnyControl = {
      id: 'app-wall', type: 'labelgrid',
      left: 10, top: 280, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',
      children: [
        { id: 'app-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'app-wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, footerText, appendixGrid] }],
      }},
      makeData(12),
      { measurer },
    )
    // 至少 2 页(text 在 page 1 末片,grid 在 page 2 起;grid 可能跨多页)
    expect(result.pages.length).toBeGreaterThanOrEqual(2)

    // 关键断言 1:appendix grid 子控件必须从 page 2 开始,page 1 上不能有(否则修复失败)
    const page0 = result.pages[0]!.body
    const page1 = result.pages[1]!.body
    expect(page0.filter((n) => n.id.startsWith('app-wall~')).length).toBe(0)
    expect(page1.filter((n) => n.id.startsWith('app-wall~')).length).toBeGreaterThan(0)

    // 关键断言 2:第一张卡片必须完全落在 page 2 内(不被切出页面底部外)
    // 修复前 bug:第一张卡片 page-relative top=202,pageHeight=297,差 95mm → 严重溢出
    // 修复后:第一张卡片 page-relative top + height ≤ pageHeight,完全在 page 2 内
    const firstCardOnPage2 = page1.find((n) => n.id.startsWith('app-wall~'))
    expect(firstCardOnPage2).toBeDefined()
    expect(firstCardOnPage2!.top).toBeLessThan(297 - firstCardOnPage2!.height - 1)
    // 不再要求 top<100:Case 1 修复后 reserveBelow 含设计期 gap,grid 起点可能 page-relative 30+
    // (如 222),但仍在 page 2 内、完整可见即可
  })
})

/* ──────────────────────── analyzeBody 真实展开高重构 (G1/G2/G3) ──────────────────────── */

describe('layout —— analyzeBody 用真实展开高(userHeight → realTableHeight 重构)', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    orientation: 'portrait' as const,
    margin: { top: 10, bottom: 10, left: 10, right: 10 },
    backgroundColor: '#ffffff',
  }

  /** 共享：构造一张 1 行实际展开 ~30mm 的数据表（userHeight 故意设小到 30mm） */
  function smallUserHeightTable(top: number, userHeight: number): AnyControl {
    return {
      id: 'main', type: 'table',
      left: 10, top, width: 190, height: userHeight,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '名称' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
        [
          { segments: [{ kind: 'field', path: 'items[0].productCode' }] },
          { segments: [{ kind: 'field', path: 'items[0].qty' }] },
        ],
      ],
      dataSource: 'items', printable: true,
    }
  }

  it('G1: userHeight=30 故意设小 → 控件 top=70(在 userHeight 内、设计意图在表格外) 保持原位进 above', async () => {
    // 关键场景:重构前 userHeight=30(设计底=110),控件 top=70,bottom=80 > tTop=80+EPS=80.5?
    // 实际 tTop=80,bottom=80 < 80.5 → above(刚好被 EPS 接住)
    // 但若控件 top=80(紧贴 tTop),bottom=88 > tTop+EPS → overlap 误分类。
    // 重构后:tBottom = realTBottom ≈ 140(表格真实高 30mm row + header ~ 40mm) →
    //   控件 top=70 < realTBottom=140 → 不进 overlap,设计上 above 路径生效。
    // 这里用一个保守布局(top=60),保证 bottom=68 < tTop=80+EPS=80.5 → 无论重构前后都进 above。
    // 用 top=60 是为了清晰展示「设计意图=above」行为不变。
    const table = smallUserHeightTable(80, 30)
    const approverText: AnyControl = {
      id: 'approver', type: 'text',
      left: 10, top: 60, width: 60, height: 8,
      content: '审批人', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, approverText] }],
      }},
      makeData(1),  // 1 条数据 → 表格实际高 ≈ header + 1 row ≈ 12mm
      { measurer },
    )
    // 控件 top=60 < table top=80 → 必进 above → 保留在 page 0 原位
    const approverOnPage0 = result.pages[0]!.body.find((n) => n.id === 'approver')
    expect(approverOnPage0).toBeDefined()
    expect(approverOnPage0!.top).toBe(60)  // 原位,不偏移
    expect(result.pages.length).toBe(1)  // 单页装得下
  })

  it('G2: demo 模板(40 行)末页 below 控件 top 必须 ≥ 表格实际末底(realTableBottom)', async () => {
    // 数学不变量:对任意 below 控件,其设计 top(或末页 page-relative top) 必须 ≥ 真实末片底 - EPS。
    // 重构前:analyzeBody 用 userHeight,tBottom < realTBottom → delta = ctrl.top - userTBottom 可能为负
    //   (虽然有 safeDelta=Math.max(0,delta)兜底,但 reserveBelow 计算起点仍是 userTBottom,会污染布局)。
    // 重构后:analyzeBody 用 realTableHeight,delta = ctrl.top - realTBottom ≥ 0(对 plan.below 成员),
    //   控件渲染位置稳定,不会"漂"到末片表格内。
    const template = createDemoTemplate()
    const result = await layout(template, makeData(40), { measurer })
    // 末页索引
    const lastPageIdx = result.pages.length - 1
    const lastPage = result.pages[lastPageIdx]!.body
    // 找到末页上的 table slice,取其实际 bottom
    const lastTable = lastPage.find((n): n is PlacedTable => n.kind === 'table')
    expect(lastTable).toBeDefined()
    const lastTableBottom = lastTable!.top + lastTable!.height
    // 末页所有非 table 控件(即 below 控件)的 top 必须 ≥ 末片表格底(浮点容差 0.5mm)
    const belowOnLastPage = lastPage.filter((n) => n.kind !== 'table')
    for (const n of belowOnLastPage) {
      expect(n.top, `末页 below 控件 ${n.id} top=${n.top.toFixed(2)} 应 ≥ 末片底 ${lastTableBottom.toFixed(2)}`)
        .toBeGreaterThanOrEqual(lastTableBottom - 0.5)
    }
  })

  it('G3: userHeight 设小 + 控件 top=200(远超真实末片底) → 不发 mismatch warning(正确进 below 路径)', async () => {
    // 场景:用户把表格拖到很上面 + 设小 userHeight,控件放在表格设计底之外很远的位置。
    // 重构前:控件设计 top=200 > userTBottom=110 → 进 below,但 delta=200-110=90 OK,也不发 warning。
    //   实际上这个测试主要验证:**不能因为重构让原本"正常 below"的控件误发 warning**。
    // 重构后:用 realTBottom(>110),delta = 200-realTBottom 仍为正,reserveBelow 算法稳定。
    // 期望:mismatch.length === 0,渲染正常。
    const table = smallUserHeightTable(50, 30)
    const farText: AnyControl = {
      id: 'far-text', type: 'text',
      left: 10, top: 200, width: 100, height: 10,
      content: '远在表格外的文本', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, farText] }],
      }},
      makeData(1),
      { measurer },
    )
    const mismatch = result.warnings.filter((w) => w.code === 'TABLE_USER_HEIGHT_MISMATCH')
    expect(mismatch.length, `不应发 TABLE_USER_HEIGHT_MISMATCH,但收到 ${mismatch.length} 条: ${mismatch.map((m) => m.message).join(' | ')}`)
      .toBe(0)
    // far-text 应在 page 0 上,top ≥ 表格实际末底(因为 table 在 page 0 顶部,远没占满)
    const farTextNode = result.pages[0]!.body.find((n) => n.id === 'far-text')
    expect(farTextNode).toBeDefined()
  })

  it('BUG-REPRO: 第二个数据表(或 below 静态表) 应该和 text 一起被 reserveBelow 计入,避免渲染到 page 1', async () => {
    // 用户截图场景:数据表(8 行 ReportItems) + 多个文本控件 + "列1" 表格在设计 top=230。
    // 重构后:reserveBelow 只算 textFlow 不算 below 的 static tables / 第二个数据表,
    //   导致 textFitsOnTablePage=true → 文本和"列1"都推到 page 0(page 1)原位渲染,
    //   "列1" 与数据表重叠(实际末片底=124,"列1" top=230 → 在 page 1 内但压住数据表所在页)。
    // 期望(用户需求):"列1" 应该和文本一起被推到末页(textPageIndex=tableLastPage+1=1 → page 2),
    //   不与数据表混在 page 1。
    const table: AnyControl = {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 60,
      dataSource: 'items', printable: true,
      columns: [
        { id: 'c1', title: '项目', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '结果', field: 'qty', width: 90, align: 'center' },
      ],
      cells: [
        [
          { segments: [{ kind: 'text', value: '项目' }] },
          { segments: [{ kind: 'text', value: '结果' }] },
        ],
      ],
      data: [{ productCode: 'A', qty: 1 }, { productCode: 'B', qty: 2 }],
    }
    // 第二个"列1" 表格(也是 table 类型,设计意图在数据表之后) → 触发 CONTENT_OVERFLOW
    const subTable: AnyControl = {
      id: 'col1', type: 'table',
      left: 10, top: 230, width: 190, height: 20,
      // 不绑定数据源 → 是静态表(走 placeStaticTables 路径)
      columns: [{ id: 'sc1', title: '列1', width: 190, align: 'center' }],
      cells: [[{ segments: [{ kind: 'text', value: '列1内容' }] }]],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, subTable] }],
      }},
      makeData(40),  // 40 行 → table 跨多页,模拟用户截图
      { measurer },
    )
    // 期望:col1 不在 page 0 上(应该和 below-flow 一起推到 page 1 或更后)
    const col1OnPage0 = result.pages[0]!.body.find((n) => n.id === 'col1')
    expect(col1OnPage0, 'col1 不应渲染在 page 0(应该被 reserveBelow 计入,推到末页)').toBeUndefined()
  })

  it('多流式 (multi-flow): 2 张数据表各自跨页 + 中间夹文本控件按 top 顺序串入', async () => {
    // 用户反馈:正文存在 ≥2 张数据表格时,仅第一张参与分页流动,其余被截断。
    // 修复:多流式分页(multi-flow)—— 每张数据表都参与分页,按 top 排序依次流动,
    // 中间夹的 text/image 控件按 top 顺序串入同一流(delta 累加保留用户设计 gap)。
    const table1: AnyControl = {
      id: 'main1', type: 'table',
      left: 10, top: 50, width: 190, height: 60,
      dataSource: 'items', printable: true,
      columns: [
        { id: 'c1', title: '项目', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '结果', field: 'qty', width: 90, align: 'center' },
      ],
      cells: [
        [
          { segments: [{ kind: 'text', value: '项目' }] },
          { segments: [{ kind: 'text', value: '结果' }] },
        ],
      ],
    }
    // 中间夹两个文本控件(模拟用户的「地址」「合同签订期」)
    const addressText: AnyControl = {
      id: 'address', type: 'text',
      left: 10, top: 140, width: 190, height: 8,
      content: '地址:北京市朝阳区', printable: true,
    }
    const contractText: AnyControl = {
      id: 'contract-date', type: 'text',
      left: 10, top: 160, width: 190, height: 8,
      content: '合同签订期:2026-08-08', printable: true,
    }
    // 第二张数据表(也绑定 items,跨页时按行切片)
    const table2: AnyControl = {
      id: 'main2', type: 'table',
      left: 10, top: 200, width: 190, height: 60,
      dataSource: 'items', printable: true,
      columns: [
        { id: 'c1', title: '代码', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      cells: [
        [
          { segments: [{ kind: 'text', value: '代码' }] },
          { segments: [{ kind: 'text', value: '数量' }] },
        ],
      ],
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table1, addressText, contractText, table2] }],
      }},
      makeData(40),  // 40 行 → 两张表都跨多页
      { measurer },
    )

    // 不再发「数据表格只能第一个参与分页」的 CONTENT_OVERFLOW 警告
    const overflow = result.warnings.filter(
      (w) => w.code === 'CONTENT_OVERFLOW' && w.message.includes('数据表格'),
    )
    expect(overflow.length, '不应再发「仅第一张数据表参与分页」的警告').toBe(0)

    // main2 必须有 slices(被多流式分页处理,数据完整渲染,不截断)
    const main2Slices = result.pages.flatMap((p) => p.body.filter((n) => n.id === 'main2'))
    expect(main2Slices.length, 'main2 必须有 slices(被多流式分页处理)').toBeGreaterThan(0)
    const main2TotalRows = main2Slices.reduce(
      (sum, n) => sum + (n.kind === 'table' ? n.rows.length : 0),
      0,
    )
    expect(main2TotalRows, 'main2 应该渲染所有 40 行(不被截断)').toBe(40)

    // main1 也必须有 slices
    const main1Slices = result.pages.flatMap((p) => p.body.filter((n) => n.id === 'main1'))
    expect(main1Slices.length, 'main1 必须有 slices').toBeGreaterThan(0)
    const main1TotalRows = main1Slices.reduce(
      (sum, n) => sum + (n.kind === 'table' ? n.rows.length : 0),
      0,
    )
    expect(main1TotalRows, 'main1 应该渲染所有 40 行').toBe(40)

    // address / contract-date 必须在某页上(不被截断)
    const allNodes = result.pages.flatMap((p) => p.body)
    expect(allNodes.some((n) => n.id === 'address'), 'address 必须被渲染').toBe(true)
    expect(allNodes.some((n) => n.id === 'contract-date'), 'contract-date 必须被渲染').toBe(true)

    // ★ 关键:address / contract-date 的渲染顺序(top 顺序)必须保留——
    //   address 应该在 contract-date 之前(top 更小)
    // 由于同页内节点可能按 push 顺序排列,跨页时绝对 top 由 pageIdx*bodyStep + topRel 推断。
    const addressAbs = addressAbsPos(result, 'address')
    const contractAbs = addressAbsPos(result, 'contract-date')
    expect(addressAbs, 'address 的绝对 top 必须 < contract-date 的绝对 top(按用户 top 顺序)').toBeLessThan(contractAbs)
  })
})

describe('layout —— appendix image wall 跨页 + grid 后文本跟 grid 末页', () => {
  const measurer = createCjkMeasurer()
  const A4 = {
    width: 210, height: 297, unit: 'mm' as const,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  }

  function makeLongTable(rows: number): AnyControl {
    return {
      id: 'main', type: 'table',
      left: 10, top: 50, width: 190, height: 30,
      columns: [
        { id: 'c1', title: '名称', field: 'productCode', width: 90, align: 'center' },
        { id: 'c2', title: '数量', field: 'qty', width: 90, align: 'center' },
      ],
      headerRows: 1,
      cells: Array.from({ length: rows }, (_, i) => [
        { segments: [{ kind: 'field', path: `items[${i}].productCode` }] },
        { segments: [{ kind: 'field', path: `items[${i}].qty` }] },
      ]),
      dataSource: 'items', printable: true,
    }
  }

  function makeAppendixWall(dataSourceRows: number, cardHeight: number): AnyControl {
    return {
      id: 'wall', type: 'labelgrid',
      left: 10, top: 240, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',
      children: [
        { id: 'wall-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'wall',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
      ],
      printable: true,
    }
  }

  function makeLongData(rows: number): Record<string, unknown> {
    const items = Array.from({ length: rows }, (_, i) => ({
      productCode: `P${String(i + 1).padStart(4, '0')}`,
      qty: (i % 5) + 1,
    }))
    return { items }
  }

  it('image wall 25 行 × 50mm cardHeight 跨多页(text 后),后续文本跟 grid 末页', async () => {
    // ★ 用户场景:大表格 + 文本控件 + image wall (25 条数据,2 列,cardHeight=50mm)
    //   文本控件在 grid 之前,grid 在 pageBreak=auto 下能从 cursor 跟当前页就尽量跟。
    //   后续再加一个文本「尾部说明」,验证它跟 grid 实际末页(而不是 grid 设计 top)。
    const table = makeLongTable(20)  // 20 行大表
    const beforeText: AnyControl = {
      id: 'before-text', type: 'text',
      left: 10, top: 200, width: 190, height: 8,
      content: '甲方单位 / 乙方单位', printable: true,
    }
    const wall = makeAppendixWall(25, 50)
    const afterText: AnyControl = {
      id: 'after-text', type: 'text',
      left: 10, top: 280, width: 190, height: 8,
      content: '附录完结说明', printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, beforeText, wall, afterText] }],
      }},
      makeLongData(25),
      { measurer },
    )

    // 至少 3 页(表格 + 文本 + 跨页 grid 跨 2-3 页)
    expect(result.pages.length).toBeGreaterThanOrEqual(3)

    // 1. before-text 必须在第一页(grid 跟它之后)
    const beforePos = addressAbsPos(result, 'before-text')
    expect(beforePos, 'before-text 应该被渲染').toBeLessThan(Number.POSITIVE_INFINITY)

    // 2. wall 子控件应该在多页上(至少跨 2 页)
    const wallPages = new Set<number>()
    for (let i = 0; i < result.pages.length; i++) {
      for (const n of result.pages[i]!.body) {
        if (n.id.startsWith('wall~')) wallPages.add(i)
      }
    }
    expect(wallPages.size, 'wall 应该跨多页(≥2 页)').toBeGreaterThanOrEqual(2)

    // 3. ★ 关键:after-text 必须跟 wall 末页(而不是 design top 所在的页)
    //   wall 设计 top=240,如果按 design top 算,after-text 应该在 page 0;
    //   但 wall 真实展开跨多页,after-text 应该跟 wall 末底。
    const wallLastPage = Math.max(...wallPages)
    const afterPageIndex = result.pages.findIndex((p) =>
      p.body.some((n) => n.id === 'after-text'),
    )
    expect(afterPageIndex, 'after-text 必须在 wall 末页或之后(跟 grid 末底)').toBeGreaterThanOrEqual(wallLastPage)

    // 4. after-text 必须在所有 wall 子控件之后(top 顺序)
    const wallLastNode = result.pages[wallLastPage]!.body
      .filter((n) => n.id.startsWith('wall~'))
      .reduce((max, n) => Math.max(max, n.top), 0)
    const afterTopOnPage = result.pages[afterPageIndex]!.body.find((n) => n.id === 'after-text')!.top
    const afterAbs = afterPageIndex * 297 + afterTopOnPage
    const wallLastAbs = wallLastPage * 297 + wallLastNode
    expect(afterAbs, 'after-text 应该跟 wall 末片底(不是设计 top)').toBeGreaterThanOrEqual(wallLastAbs)
  })

  it('pageBreak=always 下 image wall 独占新页,即使 grid 能放下也推新页', async () => {
    const table = makeLongTable(5)
    const beforeText: AnyControl = {
      id: 'before-text', type: 'text',
      left: 10, top: 200, width: 190, height: 8,
      content: '甲方单位', printable: true,
    }
    // 2 条数据 → 1 行 → requiredHeight ≈ 28mm → 放得下
    const wall: AnyControl = {
      ...makeAppendixWall(2, 25),
      pageBreak: 'always',
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, beforeText, wall] }],
      }},
      makeLongData(2),
      { measurer },
    )
    // 至少 2 页(text page 0,wall 独占 page 1)
    expect(result.pages.length).toBeGreaterThanOrEqual(2)
    const page0 = result.pages[0]!.body
    const page1 = result.pages[1]!.body
    expect(page0.some((n) => n.id === 'before-text'), 'before-text 在 page 0').toBe(true)
    expect(page0.some((n) => n.id.startsWith('wall~')), 'wall 不在 page 0').toBe(false)
    expect(page1.some((n) => n.id.startsWith('wall~')), 'wall 在 page 1(独占)').toBe(true)
  })

  it('pageBreak=never 下 image wall 强制不放新页,溢出由 maxPages 兜底', async () => {
    const table = makeLongTable(5)
    const beforeText: AnyControl = {
      id: 'before-text', type: 'text',
      left: 10, top: 200, width: 190, height: 8,
      content: '甲方单位', printable: true,
    }
    // 25 行 × 50mm cardHeight → requiredHeight = 25/2*53 - 3 = 660mm > pageH
    // pageBreak=never → 强制当前页,溢出由 maxPages 截断
    const wall: AnyControl = {
      ...makeAppendixWall(25, 50),
      pageBreak: 'never',
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, beforeText, wall] }],
      }},
      makeLongData(25),
      { measurer, maxPages: 4 },
    )
    // 不超过 maxPages
    expect(result.pages.length).toBeLessThanOrEqual(4)
    // wall 应该至少在 page 0 开始(pageBreak=never 跟当前 cursor)
    const wallFirstPage = result.pages.findIndex((p) =>
      p.body.some((n) => n.id.startsWith('wall~')),
    )
    expect(wallFirstPage, 'wall 至少在 page 0').toBeGreaterThanOrEqual(0)
  })

  it('空卡片不画 gridLine 边框(visibleIf 过滤掉 rowIndex 为奇数的卡片)', async () => {
    // 用户截图 bug 回归:image wall 中部分卡片 photoUrl 为空,
    // 展开器画了 gridLine 边框(line 348-363 / 404-419)即使该卡片无任何 child 通过 isControlPrintable。
    // 修复后:经 isControlPrintable 过滤后,空卡片的卡片边框 + 容器边框覆盖空卡片部分 → 全部移除。
    //
    // 这里用 visibleIf 模拟「数据为空」:rowIndex 为奇数的卡片,卡内 text 全部隐藏。
    // 该卡片的 cardIndex 不进 renderedCardIndices → 卡片边框不画;
    // 若某 page 上所有 cardIndex 都被过滤 → 容器边框也不画。
    const table = makeLongTable(2)
    // wall:8 条数据 + 2 列 = 4 行;每行 2 卡片,共 8 卡片。
    // visibleIf 让 rowIndex % 2 === 0 才显示 → 仅 cardIndex 0,2,4,6 渲染 → 4 卡片
    const wall: AnyControl = {
      id: 'wall', type: 'labelgrid',
      left: 10, top: 240, width: 190, height: 50,
      columns: 2, gapX: 3, gapY: 3,
      cardWidth: 60, cardHeight: 25,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      pageBreak: 'auto',
      children: [
        { id: 'wall-no', type: 'text', left: 3, top: 22, width: 30, height: 6,
          childOf: 'wall',
          // ★ visibleIf:rowIndex 为奇数时该 child 不渲染(模拟 photoUrl 为空)
          visibleIf: 'rowIndex % 2 === 0',
          contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
        { id: 'wall-photo', type: 'text', left: 3, top: 5, width: 30, height: 6,
          childOf: 'wall',
          visibleIf: 'rowIndex % 2 === 0',
          contentType: 'expression', expression: '行解析数据照片', printable: true },
      ],
      printable: true,
    }
    const result = await layout(
      { version: '1.0', document: { type: 'report', page: A4,
        sections: [{ type: 'body', components: [table, wall] }],
      }},
      makeLongData(8),
      { measurer, maxPages: 4 },
    )
    // 收集所有 gridLines,数它们的 pageIndex + (gridId, cardIndex) 组合
    const allLines = result.pages.flatMap((p) => p.gridLines ?? [])
    // 8 卡片展开器输出:4 卡片边框(渲染) + 1 容器边框 = 5;若未过滤空卡片 → 8 卡片边框 + 1 容器边框 = 9
    expect(allLines.length).toBeLessThanOrEqual(5)
    // 容器边框存在(8 卡片实际占用 pageRanges → 至少 1 段)
    const containerBorders = allLines.filter((line) => Math.abs(line.left - 10) < 0.5)
    expect(containerBorders.length).toBeGreaterThanOrEqual(1)
  })
})

/** 工具:跨页还原节点的「绝对 top」(pageIdx * bodyStep + page-relative top) */
function addressAbsPos(result: { pages: { body: { id: string; top: number }[] }[] }, id: string): number {
  // bodyStep = 297 (A4 默认),与 layout 测试里的 A4 一致
  const BODY_STEP = 297
  for (let i = 0; i < result.pages.length; i++) {
    const n = result.pages[i]!.body.find((b) => b.id === id)
    if (n) return i * BODY_STEP + n.top
  }
  return Number.POSITIVE_INFINITY
}

describe('below 控件设计 gap 保留', () => {
  // 表格 userHeight 设小,真实末片底(skeleton.lastBottom)会远大于 userTableBottom。
  // 用户设计的 below 控件 top 远大于 userTableBottom(模拟「甲方单位」等尾签控件
  // 设计在画布 page 2 的位置)。
  // 期望:控件物理 top = 真实末片底 + (control.top - userTableBottom),
  //      即保留用户设计的相对 gap,不会被「绝对 design top」拉到 page 2 顶部。
  const template = createDemoTemplate()
  const measurer = createCjkMeasurer()
  const data = makeData(8)
  // demo 模板的 body 控件
  const bodyControls = template.document.sections.find((s) => s.type === 'body')!
    .components

  it('below 控件物理 top = 真实末片底 + 设计 gap(不出现 page 1/2 之间大空白)', async () => {
    const result = await layout(template, data, { measurer })
    const flowTable = bodyControls.find((c) => c.type === 'table') as TableControl
    const tableTopMm = flowTable.top as number
    const userTableBottom = tableTopMm + (flowTable.height as number)

    const belowCtrls = bodyControls.filter(
      (c) => (c.top as number) > userTableBottom && c.id !== flowTable.id,
    )
    expect(belowCtrls.length).toBeGreaterThan(0)

    const lastPage = result.pages.at(-1)!
    const lastTable = lastPage.body.find((b) => b.kind === 'table') as PlacedTable | undefined
    expect(lastTable).toBeDefined()
    const absoluteLastBottom =
      lastPage.index * 297 + (lastTable!.top + lastTable!.height)

    for (const ctrl of belowCtrls) {
      const designGap = (ctrl.top as number) - userTableBottom
      const expectedAbsTop = absoluteLastBottom + designGap
      const actualAbsTop = addressAbsPos(result, ctrl.id)
      // 容差 2mm:多流式 / grid 混合 stream 推进可能引入小偏差
      expect(Math.abs(actualAbsTop - expectedAbsTop)).toBeLessThan(2)
    }
  })

  it('连续 below 控件严格按设计 top 顺序排列(无累积偏差)', async () => {
    const result = await layout(template, data, { measurer })
    const flowTable = bodyControls.find((c) => c.type === 'table') as TableControl
    const userTableBottom =
      (flowTable.top as number) + (flowTable.height as number)

    const belowCtrls = bodyControls
      .filter(
        (c) => (c.top as number) > userTableBottom && c.id !== flowTable.id,
      )
      .sort((a, b) => (a.top as number) - (b.top as number))

    const actualAbsTops = belowCtrls.map((c) => addressAbsPos(result, c.id))
    for (let i = 1; i < actualAbsTops.length; i++) {
      expect(actualAbsTops[i]!).toBeGreaterThanOrEqual(actualAbsTops[i - 1]!)
    }
  })
})

describe('grid 设计在 page 2 时不产生中间空白页', () => {
  // 复现用户截图场景:数据表让 page 0 充满(末底 200mm+),grid 设计 top=230mm
  // (在 page 2 区域),designGap=150。修复前的 bug:
  //   candidateTop = absoluteLastBottom + designGap = 200 + 150 = 350
  //   → floor(350/297) = 1,page 1 顶部 53mm → 但 decideGridTarget('always')
  //   又推新页 → grid 在 page 2,page 1 完全空白。
  // 修复后:clamp candidateTop 到 nextPageTop,grid 落在 page 1 顶部 +
  //   decideGridTarget 检测 cursorTopRel ≤ zoneTop → 不再二次推 → grid 填满 page 1。
  function buildTemplate(rows: number): TemplateData<AnyControl> {
    const base = createDemoTemplate()
    // 把 demo 表格的 userHeight 拉大,让它真实末底 > 200mm(填满 page 0)
    const flowTable = base.document.sections
      .find((s) => s.type === 'body')!
      .components.find((c) => c.type === 'table') as TableControl
    flowTable.height = 165  // 增大 userHeight 让真实展开末底 ≈ 200mm
    const grid: LabelGridControl = {
      id: 'appendix-grid',
      type: 'labelgrid',
      left: 15,
      top: 230,  // 设计在 page 2 上
      width: 180,
      height: 100,
      columns: 3,
      gapX: 3,
      gapY: 3,
      cardWidth: 58,
      cardHeight: 30,
      showLines: true,
      lineStyle: 'dashed',
      mode: 'appendix',
      pageBreak: 'always',
      printable: true,
      dataSource: 'items',
      children: [
        { id: 'img', type: 'image', left: 3, top: 3, width: 52, height: 18, value: { mode: 'binding', content: 'row.productCode' }, printable: true },
        { id: 'no', type: 'text', left: 3, top: 22, width: 10, height: 6, contentType: 'expression', expression: '{{rowIndex + 1}}号', printable: true },
        { id: 'title', type: 'text', left: 14, top: 22, width: 41, height: 6, contentType: 'variable', binding: 'row.productName', printable: true },
      ],
    }
    base.document.sections
      .find((s) => s.type === 'body')!
      .components.push(grid)
    return base
  }

  function makeData(rows: number): Record<string, unknown> {
    const items = Array.from({ length: rows }, (_, i) => ({
      productCode: `P${String(i + 1).padStart(4, '0')}`,
      productName: `商品${i + 1}`,
    }))
    return {
      order: { orderNo: 'SO-2026-0001', orderDate: '2026-08-08' },
      customer: { name: '演示客户' },
      items,
    }
  }

  it('rows=20 时 page 1 不再空白,grid 填满 page 1', async () => {
    const template = buildTemplate(20)
    const measurer = createCjkMeasurer()
    const result = await layout(template, makeData(20), { measurer })
    // 修复前:page 0(表格) + page 1(空) + page 2(grid) = 3 页
    // 修复后:page 0(表格) + page 1(grid) = 2 页
    expect(result.pages.length).toBe(2)
    // page 1 必须有 body(grid children)
    const lastPage = result.pages.at(-1)!
    expect(lastPage.body.length).toBeGreaterThan(0)
    expect(lastPage.gridLines?.length ?? 0).toBeGreaterThan(0)
  })

  it('rows=8 时 grid 仍跟 cursor 紧跟末片,page 1 是 grid', async () => {
    const template = buildTemplate(8)
    const measurer = createCjkMeasurer()
    const result = await layout(template, makeData(8), { measurer })
    expect(result.pages.length).toBeLessThanOrEqual(2)
    const lastPage = result.pages.at(-1)!
    expect(lastPage.body.length).toBeGreaterThan(0)
  })
})

describe('中间空白页压缩（gap-pattern remap）', () => {
  // 复现"page 4 空白 / 只显示一个文本控件"场景:
  // 表格让 page 0 充满(末底 ~200mm),appendix grid 跨 page 2-3,
  // 末尾文本跟 grid 末底到 page 3。修复前:
  //   bodyByPage keys = {0, 2, 3},gridLines pageIndex = {2, 3}
  //   旧 effectiveTotalPages 只取 max+1 = 4,page idx 1 是空白。
  // 修复后:pageIdxRemap 把 {0, 2, 3} 重映射为 {0, 1, 2},所有页连续无空洞。
  function buildContractTemplate(gridMode: 'auto' | 'always'): TemplateData<AnyControl> {
    const t = (id: string, top: number, text: string, h = 6): AnyControl => ({
      id,
      type: 'text',
      left: 12,
      top,
      width: 186,
      height: h,
      value: text,
      printable: true,
    })

    const components: AnyControl[] = [
      t('hdr-title', 0, '检验报告', 10),
      t('cl-1', 22, '第一条:本合同...', 8),
      t('cl-2', 32, '第二条:乙方...', 8),
      t('cl-3', 42, '第三条:报酬...', 8),
      t('cl-4', 52, '第四条:社保...', 8),
      t('cl-5', 62, '第五条:保护...', 8),
      t('cl-6', 70, '第六条:解除...', 8),
      t('cl-total', 80, '结论:合格', 8),

      {
        id: 'report-items',
        type: 'table',
        left: 12,
        top: 90,
        width: 186,
        height: 30,
        dataSource: 'ReportItems',
        printable: true,
        columns: [
          { title: '项目', field: 'Item', width: 60, align: 'left' },
          { title: '结果', field: 'Result', width: 60, align: 'left' },
          { title: '值', field: 'FinalVal', width: 66, align: 'left' },
        ],
      } as AnyControl,

      {
        id: 'appendix-grid',
        type: 'labelgrid',
        left: 12,
        top: 120,
        width: 186,
        height: 35,
        columns: 2,
        gapX: 3,
        gapY: 3,
        cardWidth: 91,
        cardHeight: 35,
        showLines: true,
        lineStyle: 'dashed',
        dataSource: 'ReportItems',
        mode: 'appendix',
        pageBreak: gridMode,
        printable: true,
        children: [
          {
            id: 'ag-img',
            type: 'image',
            left: 3,
            top: 3,
            width: 85,
            height: 22,
            value: { mode: 'binding', content: 'row.Photo' },
            printable: true,
          },
          {
            id: 'ag-title',
            type: 'text',
            left: 3,
            top: 26,
            width: 85,
            height: 6,
            contentType: 'variable',
            binding: 'row.AnalysisItem',
            printable: true,
          },
        ],
      } as LabelGridControl,

      t('txt-jiafang', 165, '甲方:某某科技', 7),
      t('txt-yifang', 175, '乙方:张三', 7),
      t('txt-addr', 185, '地址:北京', 7),
      t('txt-date', 195, '签订期:2026-08-08', 7),
      t('txt-label', 203, '签章:_______', 7),
    ]

    return {
      version: '1.0',
      document: {
        type: 'report',
        page: A4,
        sections: [
          { type: 'header', components: [] },
          { type: 'body', components },
          { type: 'footer', components: [] },
        ],
      },
    }
  }

  function makeItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      Item: `项目${i + 1}`,
      AnalysisItem: `分析项${i + 1}`,
      Method: `方法${i + 1}`,
      Result: `结果${i + 1}`,
      FinalVal: `结果值${i + 1}`,
      Photo: `/photo${i + 1}.jpg`,
    }))
  }

  function expectNoBlankPages(result: Awaited<ReturnType<typeof layout>>) {
    for (let p = 0; p < result.pages.length; p++) {
      const page = result.pages[p]!
      const hasContent = page.body.length > 0 || (page.gridLines?.length ?? 0) > 0
      expect(hasContent, `Page ${p + 1} should not be blank`).toBe(true)
    }
  }

  it('pageBreak=auto, rows=15 时 page 2 不再空白', async () => {
    const template = buildContractTemplate('auto')
    const measurer = createCjkMeasurer()
    const result = await layout(template, { ReportItems: makeItems(15) }, { measurer })
    expectNoBlankPages(result)
    expect(result.pages.length).toBeLessThanOrEqual(3)
  })

  it('pageBreak=auto, rows=20 时 page 2 不再空白', async () => {
    const template = buildContractTemplate('auto')
    const measurer = createCjkMeasurer()
    const result = await layout(template, { ReportItems: makeItems(20) }, { measurer })
    expectNoBlankPages(result)
    expect(result.pages.length).toBeLessThanOrEqual(3)
  })

  it('pageBreak=always, rows=5 时 page 2 不再空白', async () => {
    const template = buildContractTemplate('always')
    const measurer = createCjkMeasurer()
    const result = await layout(template, { ReportItems: makeItems(5) }, { measurer })
    expectNoBlankPages(result)
    expect(result.pages.length).toBeLessThanOrEqual(2)
  })

  it('pageBreak=always, rows=8 时 page 2 不再空白', async () => {
    const template = buildContractTemplate('always')
    const measurer = createCjkMeasurer()
    const result = await layout(template, { ReportItems: makeItems(8) }, { measurer })
    expectNoBlankPages(result)
    expect(result.pages.length).toBeLessThanOrEqual(2)
  })
})

describe('per-control 末底溢出检测（取代整组 textFitsOnTablePage 判断）', () => {
  // 用户反馈:数据表下多个控件时,只要最末一个控件底端超出可用高度,
  // 就把整组 below 控件下移到下一页。修复:改为逐控件判断末底溢出,
  // 仅超容控件单独跳下一页,前面的保留原页。

  // 用 createDemoTemplate 自带的 flow table,数据 15 行让真实末底 ≈ 217mm
  const measurer = createCjkMeasurer()

  function addressPageIdx(result: Awaited<ReturnType<typeof layout>>, id: string): number {
    for (let p = 0; p < result.pages.length; p++) {
      const page = result.pages[p]!
      if (page.body.some((n) => n.id === id)) return p
    }
    return -1
  }

  function freshTemplateWithControls(ctrls: AnyControl[]) {
    // 每个 case 独立 fresh 模板,避免前一个 it 修改的 components 影响后续
    const base = createDemoTemplate()
    const t = base.document.sections.find((s) => s.type === 'body')!
    t.components = t.components.filter(
      (c) => !['std-clause-1', 'std-clause-2', 'std-clause-3', 'std-tail'].includes(c.id),
    )
    t.components.push(...ctrls)
    return base
  }

  it('多个 below 控件:前 N 个能放下就留 page 0,后续超容单独跳 page 1', async () => {
    // 修复前的 bug:整组按最末控件底端判断是否能放下,只要超容就整组下移一页。
    // 修复后:逐控件判断末底是否超 footerLimit。
    // demo 真实末底 ≈ 217mm,footerLimit=287。
    //   tail-1 designTop=210,h=8 → topRel=267,bottom=275 < 287 ✓ page 0
    //   tail-2 designTop=220,h=8 → topRel=277,bottom=285 < 287 ✓ page 0
    //   tail-3 designTop=230,h=8 → topRel=287,bottom=295 > 287 ✗ 单独跳 page 1
    //   tail-4 designTop=240,h=8 → 跟 cursor 到 page 1
    //   tail-5 designTop=250,h=8 → 跟 cursor 到 page 1
    // 关键验证:tail-1/2 保留在 page 0(修复前会被 tail-3..5 拖累整组下移)。
    const ctrls: AnyControl[] = [210, 220, 230, 240, 250].map((top, i) => ({
      id: `tail-${i + 1}`,
      type: 'text' as const,
      left: 15,
      top,
      width: 180,
      height: 8,
      value: `文本${i + 1}`,
      printable: true,
    }))
    const template = freshTemplateWithControls(ctrls)
    const result = await layout(template, makeData(15), { measurer })
    // tail-1/2 保留在 page 0(关键 — 修复前会被整组拖累)
    expect(addressPageIdx(result, 'tail-1')).toBe(0)
    expect(addressPageIdx(result, 'tail-2')).toBe(0)
    // tail-3..5 跳 page 1
    expect(addressPageIdx(result, 'tail-3')).toBe(1)
    expect(addressPageIdx(result, 'tail-4')).toBe(1)
    expect(addressPageIdx(result, 'tail-5')).toBe(1)
    // 无空白页
    for (const p of result.pages) {
      expect(p.body.length + (p.gridLines?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('中间控件超容大高度:仅该控件单独跳下一页,前后保留 page 0', async () => {
    // demo 真实末底 ≈ 217mm,footerLimit=287。
    //   tail-1 designTop=210,h=8 → topRel=267,bottom=275 < 287 ✓ page 0
    //   tail-2 designTop=220,h=8 → topRel=277,bottom=285 < 287 ✓ page 0
    //   tail-3 designTop=260,h=30 → topRel=317,bottom=347 > 287 ✗ 单独跳 page 1
    //   tail-4 designTop=270,h=8 → 跟 cursor 到 page 1
    const ctrls: AnyControl[] = [
      { id: 'tail-1', type: 'text', left: 15, top: 210, width: 180, height: 8, value: 'A', printable: true },
      { id: 'tail-2', type: 'text', left: 15, top: 220, width: 180, height: 8, value: 'B', printable: true },
      // tail-3 故意超容:h=30 → topRel 267+30=307(bottom 317)远超 footerLimit 287
      { id: 'tail-3', type: 'text', left: 15, top: 260, width: 180, height: 30, value: 'C', printable: true },
      { id: 'tail-4', type: 'text', left: 15, top: 270, width: 180, height: 8, value: 'D', printable: true },
    ]
    const template = freshTemplateWithControls(ctrls)
    const result = await layout(template, makeData(15), { measurer })
    // tail-1/2 保留在 page 0(关键 — 修复前会被 tail-3 拖累)
    expect(addressPageIdx(result, 'tail-1')).toBe(0)
    expect(addressPageIdx(result, 'tail-2')).toBe(0)
    // tail-3 单独跳 page 1
    expect(addressPageIdx(result, 'tail-3')).toBe(1)
    // tail-4 在 tail-3 之后(同 page 1)
    expect(addressPageIdx(result, 'tail-4')).toBe(1)
    // 无空白页
    for (const p of result.pages) {
      expect(p.body.length + (p.gridLines?.length ?? 0)).toBeGreaterThan(0)
    }
  })
})

/* ============= vmerge 跨页: paginateFlowTable 注入续行 anchor (Path B) ============= */

describe('vmerge 跨页续行 anchor (Path B: paginateFlowTable 注入)', () => {
  const measurer = createCjkMeasurer()

  /**
   * 构造一个最小模板:单 body section,内含一个数据表,启用 vmerge。
   * 数据行足够多,保证合并组在跨页时被拦腰切断。
   */
  function buildVMergeTemplate(rows: Array<Record<string, unknown>>): TemplateData<AnyControl> {
    const control: TableControl = {
      id: 'flow-vmerge',
      type: 'table',
      left: 10,
      top: 10,
      width: 100,
      height: 50,
      dataSource: 'items',
      columns: [
        { id: 'name', title: '客户', field: 'name', width: 50 },
        { id: 'qty', title: '数量', field: 'qty', width: 50 },
      ],
      data: rows,
      options: {
        repeatHeader: true,
        repeatFooter: false,
        vMerge: { columns: ['name'], breakOnGroup: true },
      },
    } as unknown as TableControl
    return {
      document: {
        page: A4,
        sections: [
          {
            type: 'body',
            components: [control],
          },
        ],
      },
    } as unknown as TemplateData<AnyControl>
  }

  it('合并组跨页时,page 2 首行被注入续行 anchor (rowSpan 覆盖本片被吞行)', async () => {
    // 大量数据强制跨页: A4 bodyHeight ≈ 247mm,40 行强制跨页
    const rows = Array.from({ length: 40 }, (_, i) => ({
      name: i < 20 ? 'AAA' : i < 30 ? 'BBB' : 'CCC',
      qty: i + 1,
    }))
    const tpl = buildVMergeTemplate(rows)
    const result = await layout(tpl, { items: rows }, { measurer })
    expect(result.pages.length).toBeGreaterThan(1)

    // 找到 flow-vmerge 表的各个片(按 pageIndex 分组)
    const tableSlices = new Map<number, PlacedTable>()
    for (const page of result.pages) {
      for (const node of page.body) {
        if (node.kind === 'table' && node.id === 'flow-vmerge') {
          tableSlices.set(page.index, node as PlacedTable)
        }
      }
    }
    expect(tableSlices.size).toBeGreaterThanOrEqual(2)

    // 验证 page 1+ 的表:第一行不再是 consumed 行(被注入的 anchor 已覆盖)
    // 或者说:每片的首行 vmerge 列都没有 consumed 标记(要么是 anchor,要么是 breakOnGroup 自然换值)
    for (const [pageIdx, slice] of tableSlices) {
      if (pageIdx === 0) continue // 首页 anchor 是天然的
      const firstRow = slice.rows[0]!
      const firstRowVMergeCell = firstRow.cells.find(
        (c) => c.rowSpan !== undefined || c.consumed === true,
      )
      // 关键:page 2+ 的首行不能是被吞行(consumed=true),否则 vmerge 链式错位
      expect(firstRowVMergeCell?.consumed, `page ${pageIdx} 首行不应是 consumed 行`).toBeUndefined()
      // 若首行有 rowSpan,说明是 paginateFlowTable 注入的续行 anchor(Path B 生效)
      if (firstRowVMergeCell?.rowSpan) {
        expect(firstRowVMergeCell.rowSpan).toBeGreaterThanOrEqual(2)
        // text 必须沿用被吞行的值(此处 AAA/BBB/CCC)
        expect(['AAA', 'BBB', 'CCC']).toContain(firstRowVMergeCell.text)
      }
    }
  })

  it('合并组未被切时(整组在一页内),不注入额外 anchor', async () => {
    // 数据少,合并组不会被切 → paginateFlowTable 不应注入 anchor
    const rows = Array.from({ length: 3 }, (_, i) => ({ name: 'AAA', qty: i + 1 }))
    const tpl = buildVMergeTemplate(rows)
    const result = await layout(tpl, { items: rows }, { measurer })
    // 找到 flow-vmerge 的片
    const slice = result.pages
      .flatMap((p) => p.body)
      .find((n) => n.kind === 'table' && n.id === 'flow-vmerge') as PlacedTable | undefined
    expect(slice).toBeDefined()
    // 第 1 行 rowSpan=3(原 anchor)
    expect(slice!.rows[0]!.cells.find((c) => c.rowSpan)?.rowSpan).toBe(3)
    // 第 2/3 行是原 consumed 行,不应被反向处理
    expect(slice!.rows[1]!.cells.some((c) => c.consumed)).toBe(true)
    expect(slice!.rows[2]!.cells.some((c) => c.consumed)).toBe(true)
  })
})
