import { describe, expect, it } from 'vitest'

import {
  buildTableModel,
  normalizeColumnWidths,
  sliceTable,
} from '@op/core/layout-engine/table-engine'
import { isDataTable, seedSummaryTail } from '@op/core/layout-engine/table-cells'
import type { TableColumn, TableControl } from '@op/types/control'
import type { EvalContext } from './types'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'

type Model = ReturnType<typeof buildTableModel>

describe('normalizeColumnWidths —— 列宽归一化', () => {
  it('按比例缩放使列宽和 = totalWidth', () => {
    const cols: TableColumn[] = [
      { title: 'A', field: 'a', width: 10 },
      { title: 'B', field: 'b', width: 20 },
    ]
    const out = normalizeColumnWidths(cols, 30)
    expect(out).toEqual([10, 20])
    expect(out.reduce((s, w) => s + w, 0)).toBeCloseTo(30, 6)
  })

  it('全部为 0 时均分', () => {
    const cols: TableColumn[] = [{ title: 'A', field: 'a', width: 0 }, { title: 'B', field: 'b', width: 0 }]
    const out = normalizeColumnWidths(cols, 10)
    expect(out[0]).toBeCloseTo(5, 6)
    expect(out[1]).toBeCloseTo(5, 6)
  })

  it('含 0 宽列时保持 0，其余按比例', () => {
    const cols: TableColumn[] = [
      { title: 'A', field: 'a', width: 2 },
      { title: 'B', field: 'b', width: 0 },
      { title: 'C', field: 'c', width: 2 },
    ]
    const out = normalizeColumnWidths(cols, 8)
    expect(out[0]).toBeCloseTo(4, 6)
    expect(out[1]).toBe(0)
    expect(out[2]).toBeCloseTo(4, 6)
    expect(out.reduce((s, w) => s + w, 0)).toBeCloseTo(8, 6)
  })
})

describe('buildTableModel —— 表格建模', () => {
  const measurer = createCjkMeasurer()
  const control = {
    id: 'tbl',
    type: 'table',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    dataSource: 'items',
    columns: [
      { field: 'name', title: '名称', width: 60, align: 'left' },
      { field: 'qty', title: '数量', width: 40, align: 'right' },
    ],
    options: { repeatHeader: true },
  } as unknown as Parameters<typeof buildTableModel>[0]['control']

  it('根据 dataSource 生成与数据等量的数据行', () => {
    const ctx = { data: { items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }, { name: 'C', qty: 3 }] } }
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    expect(model.rows.length).toBe(3)
    expect(model.columnWidths.length).toBe(2)
    expect(model.columnWidths.reduce((s, w) => s + w, 0)).toBeCloseTo(100, 6)
    expect(model.headerRows.length).toBeGreaterThan(0)
    expect(model.isLayoutGrid).toBe(false)
  })

  it('无数据源时退化为布局网格（固定行数）', () => {
    const grid = { ...control, dataSource: '' } as unknown as Parameters<typeof buildTableModel>[0]['control']
    const model = buildTableModel({ control: grid, ctx: { data: {} }, measurer, widthMm: 100, heightMm: 50 })
    expect(model.isLayoutGrid).toBe(true)
    expect(model.rows.length).toBeGreaterThan(0)
  })

  /** 取出第一条数据行的第 col 列渲染文本 */
  function dataCellText(ctrl: Parameters<typeof buildTableModel>[0]['control'], ctx: EvalContext, col: number): string {
    const model = buildTableModel({ control: ctrl, ctx, measurer, widthMm: 100, heightMm: 50 })
    const row = model.rows.find((r) => r.kind === 'data')
    if (!row) throw new Error('no data row')
    return (row.cells[col] as { text: string }).text
  }

  it('列格式 decimal：数字按小数位+千分位渲染', () => {
    const c = {
      ...control,
      columns: [{ field: 'price', title: '单价', width: 40, align: 'right', format: { kind: 'decimal', digits: 2 } }],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c, { data: { items: [{ price: 1234.5 }] } }, 0)).toBe('1,234.50')
  })

  it('列格式 currency：带币种符号', () => {
    const c = {
      ...control,
      columns: [{ field: 'amount', title: '金额', width: 40, align: 'right', format: { kind: 'currency', code: 'CNY' } }],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c, { data: { items: [{ amount: 9999.9 }] } }, 0)).toBe('¥9,999.90')
  })

  it('单元格 format 覆盖列 format', () => {
    const c = {
      ...control,
      columns: [{ field: 'qty', title: '数量', width: 40, align: 'right', format: { kind: 'decimal', digits: 2 } }],
      cells: [
        [{ text: '数量' }],
        [{ field: 'qty', format: { kind: 'int' } }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c, { data: { items: [{ qty: 1234.5 }] } }, 0)).toBe('1,235')
  })

  it('单元格显式三态：variable / expression / fixed 各按模式取值（segments 单源）', () => {
    // variable：cell 单 field 段优先（即使列也有 field，也以单元格为准）
    const c1 = {
      ...control,
      columns: [{ field: 'name', title: '名称', width: 60 }],
      cells: [
        [{ segments: [{ kind: 'text', value: '名称' }] }],
        [{ segments: [{ kind: 'field', path: 'qty' }] }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c1, { data: { items: [{ name: 'A', qty: 7 }] } }, 0)).toBe('7')

    // expression：单 expr 段，scope 含 row / rowIndex
    const c2 = {
      ...control,
      columns: [{ field: 'name', title: '名称', width: 60 }],
      cells: [
        [{ segments: [{ kind: 'text', value: '名称' }] }],
        [{ segments: [{ kind: 'expr', src: 'row.qty * 2' }] }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c2, { data: { items: [{ qty: 3 }] } }, 0)).toBe('6')

    // fixed：单 text 段（即使列有 field 也不走绑定）
    const c3 = {
      ...control,
      columns: [{ field: 'name', title: '名称', width: 60 }],
      cells: [
        [{ segments: [{ kind: 'text', value: '名称' }] }],
        [{ segments: [{ kind: 'text', value: 'N/A' }] }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c3, { data: { items: [{ name: 'A' }] } }, 0)).toBe('N/A')
  })

  it('空 segments 数据样例行回落到列 field（不打断整列）', () => {
    // 单元格 segments=[] → dataCellText 返回 ''，列 field 在 cellFromColumn 已落到 cells[1]
    // 本用例验证：把 cells[1] 清空（segments=[]）后，dataCellText 不再兜底列
    // —— 列回退仅 staticCellText 负责（布局网格的 emptyRow 场景）
    const c = {
      ...control,
      columns: [{ field: 'qty', title: '数量', width: 60 }],
      cells: [
        [{ segments: [{ kind: 'text', value: '数量' }] }],
        [{ segments: [] }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    expect(dataCellText(c, { data: { items: [{ qty: 5 }] } }, 0)).toBe('')
  })

  it('表头/静态行三态：field 段 / expr 段（segments 单源）', () => {
    const c = {
      ...control,
      dataSource: '',
      headerRows: 1,
      staticRows: 1,
      cells: [
        // 表头：field 段绑 order.no
        [{ segments: [{ kind: 'field', path: 'order.no' }] }, { segments: [{ kind: 'text', value: '数量' }] }],
        // 静态尾行：expr 段插值合计
        [{ segments: [{ kind: 'expr', src: 'order.total' }] }, { segments: [{ kind: 'text', value: '' }] }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    const ctx = { data: { order: { no: 'NO-001', total: 5 } } }
    const model = buildTableModel({ control: c, ctx, measurer, widthMm: 100, heightMm: 50 })
    expect(model.headerRows[0]!.cells[0]!.text).toBe('NO-001')
    const staticRow = model.rows.find((r) => r.kind === 'static')
    expect(staticRow).toBeTruthy()
    expect(staticRow!.cells[0]!.text).toBe('5')
  })

  it('表头/静态行绑定 cell.field 应解析主表标量（回归：staticCellText 曾忽略 field）', () => {
    const c = {
      ...control,
      dataSource: '',
      headerRows: 1,
      staticRows: 1,
      cells: [
        [{ field: 'order.no' }, { text: '数量' }],
        [{ field: 'order.total' }, { text: '' }],
      ],
    } as unknown as Parameters<typeof buildTableModel>[0]['control']
    const ctx = { data: { order: { no: 'NO-001', total: 5 } } }
    const model = buildTableModel({ control: c, ctx, measurer, widthMm: 100, heightMm: 50 })
    // 表头单元格：绑定 order.no → 解析出主表标量（修复前为空）
    expect(model.headerRows[0]!.cells[0]!.text).toBe('NO-001')
    // 静态尾行单元格：绑定 order.total → 解析出 5
    const staticRow = model.rows.find((r) => r.kind === 'static')
    expect(staticRow).toBeTruthy()
    expect(staticRow!.cells[0]!.text).toBe('5')
  })
})

describe('sliceTable —— 分页切片（含空尾片回归）', () => {
  function mkModel(rowCount: number): Model {
    return {
      control: { id: 't', type: 'table', options: { repeatHeader: true, repeatFooter: false } } as Model['control'],
      columns: [],
      columnWidths: [],
      headerRows: [{ kind: 'header', height: 8, cells: [] }],
      rows: Array.from({ length: rowCount }, (_, i) => ({
        kind: 'data',
        height: 8,
        dataIndex: i,
        cells: [],
      })) as Model['rows'],
      footerRows: [{ kind: 'summary', height: 8, cells: [{ text: '合计', align: 'left' }] }],
      dataRows: [],
      warnings: [],
      isLayoutGrid: false,
    } as Model
  }

  it('从 start=0 切片：取全部行，末片挂合计行', () => {
    const model = mkModel(3)
    const slice = sliceTable(model, { avail: 100, start: 0 })
    expect(slice.rows.length).toBe(3)
    expect(slice.footerRows.length).toBeGreaterThan(0) // 末片 + 空间充足 → 合计行
    expect(slice.isLast).toBe(true)
    expect(slice.nextStart).toBe(3)
  })

  it('空尾片（start 越界）不挂合计行，也不产出多余数据行', () => {
    const model = mkModel(3)
    const slice = sliceTable(model, { avail: 100, start: 3 })
    expect(slice.rows.length).toBe(0) // 关键回归：不再渲染第二个空表
    expect(slice.footerRows.length).toBe(0) // 关键回归：空尾片不再挂合计
    expect(slice.isLast).toBe(true)
    expect(slice.nextStart).toBe(3)
  })

  it('空间不足时本页少放，nextStart 后移（行预算含 0.2mm 边框，防渲染溢出压页脚）', () => {
    const model = mkModel(5)
    // 默认 borders:'all'：header 8+0.2、每行 8+0.2。avail=24 → budget=24-8.2=15.8，
    // 仅放得下 1 行（1×8.2=8.2≤15.8；第 2 行 16.4>15.8）——宁少排一行，不压页脚。
    const slice = sliceTable(model, { avail: 24, start: 0 })
    expect(slice.rows.length).toBe(1)
    expect(slice.nextStart).toBe(1)
    expect(slice.isLast).toBe(false)
  })
})

/* ----------------------- 合计行（options.summaryRow） ----------------------- */

function mkSummaryControl(opts: TableControl['options']): Parameters<typeof buildTableModel>[0]['control'] {
  return {
    id: 'tbl',
    type: 'table',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    dataSource: 'items',
    columns: [
      { field: 'name', title: '名称', width: 60, align: 'left' },
      { field: 'qty', title: '数量', width: 40, align: 'right' },
    ],
    options: opts,
  } as unknown as Parameters<typeof buildTableModel>[0]['control']
}

describe('buildTableModel —— 合计行（options.summaryRow）', () => {
  const measurer = createCjkMeasurer()

  it('求和：表尾合计行在聚合列显示总和，首列显示标签', () => {
    const ctx = { data: { items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }, { name: 'C', qty: 3 }] } }
    const model = buildTableModel({
      control: mkSummaryControl({ summaryRow: { type: 'sum', fields: ['qty'], label: '合计' } }),
      ctx,
      measurer,
      widthMm: 100,
      heightMm: 50,
    })
    expect(model.footerRows.length).toBe(1)
    const row = model.footerRows[0]!
    expect(row.kind).toBe('summary')
    expect(row.cells[0]!.text).toBe('合计')
    const qtyCell = row.cells.find((c) => c.text === '6')
    expect(qtyCell).toBeTruthy()
    expect(qtyCell!.bold).toBe(true)
    expect(qtyCell!.align).toBe('right')
  })

  it('计数：聚合列显示数据总行数', () => {
    const ctx = { data: { items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }, { name: 'C', qty: 3 }] } }
    const model = buildTableModel({
      control: mkSummaryControl({ summaryRow: { type: 'count', fields: ['qty'], label: '合计' } }),
      ctx,
      measurer,
      widthMm: 100,
      heightMm: 50,
    })
    const row = model.footerRows[0]!
    expect(row.cells.find((c) => c.text === '3')).toBeTruthy()
  })

  it('未配置合计行时不生成表尾', () => {
    const ctx = { data: { items: [{ name: 'A', qty: 1 }] } }
    const model = buildTableModel({
      control: mkSummaryControl({}),
      ctx,
      measurer,
      widthMm: 100,
      heightMm: 50,
    })
    expect(model.footerRows.length).toBe(0)
  })
})

describe('buildTableModel —— 分组小计（groupBy + summaryRow）', () => {
  const measurer = createCjkMeasurer()
  const control = {
    id: 'tbl',
    type: 'table',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    dataSource: 'items',
    groupBy: 'cat',
    columns: [
      { field: 'name', title: '名称', width: 60, align: 'left' },
      { field: 'qty', title: '数量', width: 40, align: 'right' },
    ],
    options: { summaryRow: { type: 'sum', fields: ['qty'], label: '合计' } },
  } as unknown as Parameters<typeof buildTableModel>[0]['control']

  it('按分组字段生成组头 + 每组小计 + 末尾总计', () => {
    const ctx = {
      data: {
        items: [
          { name: 'A', qty: 1, cat: 'x' },
          { name: 'B', qty: 2, cat: 'x' },
          { name: 'C', qty: 3, cat: 'y' },
        ],
      },
    }
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    expect(model.rows.some((r) => r.kind === 'group')).toBe(true)
    const subs = model.rows.filter((r) => r.kind === 'subtotal')
    expect(subs.length).toBe(2)
    // 每组内求和：x=1+2=3，y=3，均显示 3
    expect(subs.every((s) => s.cells.find((c) => c.text === '3'))).toBe(true)
    // 末尾总计 = 1+2+3 = 6
    const total = model.footerRows.find((r) => r.kind === 'summary')
    expect(total?.cells.find((c) => c.text === '6')).toBeTruthy()
  })

  it('分组小计应用自定义标签与样式', () => {
    const ctx = {
      data: {
        items: [
          { name: 'A', qty: 1, cat: 'x' },
          { name: 'B', qty: 2, cat: 'x' },
        ],
      },
    }
    const model = buildTableModel({
      control: {
        id: 'tbl',
        type: 'table',
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        dataSource: 'items',
        groupBy: 'cat',
        columns: [
          { field: 'name', title: '名称', width: 60, align: 'left' },
          { field: 'qty', title: '数量', width: 40, align: 'right' },
        ],
        options: {
          summaryRow: {
            type: 'sum',
            fields: ['qty'],
            label: '总计',
            subtotalLabel: '${key} 分组小计',
            subtotalStyle: { bold: true, backgroundColor: '#EEF3FF', color: '#c00' },
          },
        },
      } as unknown as Parameters<typeof buildTableModel>[0]['control'],
      ctx,
      measurer,
      widthMm: 100,
      heightMm: 50,
    })
    const subs = model.rows.filter((r) => r.kind === 'subtotal')
    expect(subs.length).toBe(1)
    expect(subs[0]!.cells[0]!.text).toBe('x 分组小计')
    // 整行套用 subtotalStyle（标签格也应带颜色）
    expect(subs[0]!.cells[0]!.color).toBe('#c00')
    expect(subs[0]!.cells[0]!.background).toBe('#EEF3FF')
    // 聚合列显示本组求和 1+2=3
    expect(subs[0]!.cells.find((c) => c.text === '3')).toBeTruthy()
  })

  it('自定义合计表达式在表尾生效（footer 显示求值结果）', () => {
    const ctx = { data: { items: [{ name: 'A', amount: 10 }, { name: 'B', amount: 20 }] } }
    const model = buildTableModel({
      control: {
        id: 'tbl',
        type: 'table',
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        dataSource: 'items',
        // 首列为非聚合列（放标签），第二列为聚合列（放自定义求值结果）
        columns: [
          { field: 'name', title: '名称', width: 60, align: 'left' },
          { field: 'amount', title: '金额', width: 40, align: 'right' },
        ],
        options: {
          summaryRow: {
            type: 'custom',
            fields: ['amount'],
            label: '自定义合计',
            expression: 'sum.amount + 5',
          },
        },
      } as unknown as Parameters<typeof buildTableModel>[0]['control'],
      ctx,
      measurer,
      widthMm: 100,
      heightMm: 50,
    })
    expect(model.footerRows.length).toBe(1)
    const row = model.footerRows[0]!
    expect(row.kind).toBe('summary')
    expect(row.cells[0]!.text).toBe('自定义合计')
    // 聚合列显示 (10+20) + 5 = 35
    expect(row.cells.find((c) => c.text === '35')).toBeTruthy()
  })
})

describe('rowSpan 纵向合并渲染', () => {
  const measurer = createCjkMeasurer()

  it('布局网格：纵向合并时下方被吞单元格不进 cells，锚点带 rowSpan', () => {
    const control = {
      id: 'tbl',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 40,
      columns: [
        { title: 'A', width: 50 },
        { title: 'B', width: 50 },
      ],
      headerRows: 0,
      designRows: 2,
      cells: [
        [
          { rowSpan: 2, text: '合并' },
          { text: '右1' },
        ],
        [
          { text: '下左' },
          { text: '下右' },
        ],
      ],
      options: {},
    } as unknown as TableControl

    const model = buildTableModel({ control, ctx: { data: {} }, measurer, widthMm: 100, heightMm: 40 })
    expect(model.isLayoutGrid).toBe(true)
    // 第 0 行：锚点(合并, rowSpan=2) + 右1 → 2 个单元格
    expect(model.rows[0]!.cells.length).toBe(2)
    expect(model.rows[0]!.cells[0]!.rowSpan).toBe(2)
    // 第 1 行：被吞的"下左"不出现，只剩"下右" → 1 个单元格
    expect(model.rows[1]!.cells.length).toBe(1)
    expect(model.rows[1]!.cells[0]!.text).toBe('下右')
  })

  it('数据行模板的 rowSpan 被强制为 1（不跨记录）', () => {
    const control = {
      id: 'tbl',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 60,
      dataSource: 'items',
      columns: [
        { field: 'name', title: '名称', width: 50 },
        { field: 'qty', title: '数量', width: 50 },
      ],
      cells: [
        [{ text: '名称' }, { text: '数量' }],
        [{ rowSpan: 2, field: 'name' }, { field: 'qty' }],
      ],
      options: {},
    } as unknown as TableControl

    const ctx = { data: { items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }] } }
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 60 })
    // 每条数据行的首格不应带 rowSpan（避免跨记录合并）
    expect(model.rows.every((r) => r.cells[0]!.rowSpan === undefined)).toBe(true)
  })
})

describe('buildTableModel —— 内嵌 data（与 dataSource 字段解耦）', () => {
  const measurer = createCjkMeasurer()

  it('无 dataSource、带 data 时按内嵌数据生成数据行并解析字段', () => {
    const control = {
      id: 'tbl',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      // 注意：这里刻意不设置 dataSource
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        { title: '数量', field: 'items[].qty', width: 50 },
      ],
      headerRows: 1,
      data: [
        { name: 'A', qty: 1 },
        { name: 'B', qty: 2 },
      ],
      options: { pageRows: 'auto', repeatHeader: true, borders: 'all' },
    } as unknown as TableControl

    // 全局 ctx 里没有任何 items，证明数据完全来自 control.data
    const ctx = { data: {} } as unknown as EvalContext
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    expect(model.rows).toHaveLength(2)
    expect(model.rows[0]!.cells[0]!.text).toBe('A')
    expect(model.rows[1]!.cells[1]!.text).toBe('2')
    // 表头来自 columns.title
    expect(model.headerRows[0]!.cells[0]!.text).toBe('名称')
  })

  it('isDataTable 对内嵌 data 返回 true（供 analyzeBody 识别为分页流表）', () => {
    const withData = {
      id: 't',
      type: 'table',
      columns: [],
      data: [{ a: 1 }],
    } as unknown as TableControl
    expect(isDataTable(withData)).toBe(true)
    const empty = {
      id: 't2',
      type: 'table',
      columns: [],
      data: [],
    } as unknown as TableControl
    expect(isDataTable(empty)).toBe(false)
  })
})

describe('sliceTable —— 分页聚合（本页合计 / 总计 / 大写金额）', () => {
  const measurer = createCjkMeasurer()
  const amountCol = 1

  function mkSeededTable(): Model {
    const control = {
      id: 't',
      type: 'table',
      left: 0,
      top: 0,
      width: 180,
      height: 50,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 120, align: 'left', headerAlign: 'center' },
        { title: '金额', field: 'items[].amount', width: 60, align: 'right', headerAlign: 'center' },
      ],
      // 10 行内嵌数据，金额 10,20,...,100（全表合计 550）
      data: Array.from({ length: 10 }, (_, i) => ({ name: 'x' + (i + 1), amount: (i + 1) * 10 })),
      options: { repeatHeader: true, repeatFooter: false, pageRows: 2 } as TableControl['options'],
    } as unknown as TableControl
    const seeded = seedSummaryTail(control, { numericColumns: [amountCol], moneyColumn: amountCol, capital: true })
    return buildTableModel({ control: seeded, ctx: {} as EvalContext, measurer, widthMm: 180, heightMm: 50 })
  }

  function sliceAll(model: Model): ReturnType<typeof sliceTable>[] {
    const out: ReturnType<typeof sliceTable>[] = []
    let start = 0
    for (let p = 0; p < 20; p++) {
      const s = sliceTable(model, { avail: 1000, start })
      out.push(s)
      if (s.isLast) break
      start = s.nextStart
    }
    return out
  }

  const num = (t: string | undefined): number => Number((t ?? '').replace(/,/g, ''))

  it('每页本页合计 = 本页数据行之和；非末页不出现总计 / 大写金额', () => {
    const slices = sliceAll(mkSeededTable())
    expect(slices.length).toBe(5) // 10 行 / 每页 2 行
    slices.forEach((s, p) => {
      const subtotal = s.footerRows.find((r) => r.kind === 'subtotal')
      expect(subtotal, `第 ${p + 1} 页应有本页合计`).toBeTruthy()
      const pageSum = num(subtotal!.cells[amountCol]!.text)
      const expected = (p * 2 + 1) * 10 + (p * 2 + 2) * 10
      expect(pageSum).toBe(expected)
      if (p < slices.length - 1) {
        expect(s.footerRows.some((r) => r.footerKind === 'grandTotal')).toBe(false)
        expect(s.footerRows.some((r) => r.footerKind === 'capital')).toBe(false)
      }
    })
  })

  it('末页出现总计（全表之和=550）与大写金额（伍佰伍拾元整）；末页本页合计=末页本页之和', () => {
    const slices = sliceAll(mkSeededTable())
    const last = slices[slices.length - 1]!
    const total = last.footerRows.find((r) => r.footerKind === 'grandTotal')
    const cap = last.footerRows.find((r) => r.footerKind === 'capital')
    expect(total, '末页应有总计').toBeTruthy()
    expect(cap, '末页应有大写金额').toBeTruthy()
    expect(num(total!.cells[amountCol]!.text)).toBe(550) // 10+20+...+100
    expect(cap!.cells[amountCol]!.text).toBe('伍佰伍拾元整')
    // 末页本页合计 = 末页本页数据（第 9、10 行 90+100）
    const subtotal = last.footerRows.find((r) => r.kind === 'subtotal')
    expect(num(subtotal!.cells[amountCol]!.text)).toBe(190)
  })
})

/* ============= P0-2 fixBottomRows 按纸张补空行 ============= */

describe('sliceTable —— P0-2 fixBottomRows 按纸张补空行', () => {
  // 100mm avail + 30mm 表头 = 70mm 给数据/补空
  // 数据行高 8mm → fill 模式应填 ~8 行
  // 补空行高 = max(6, avgDataRowHeight(实际数据行))
  function baseControl(opts: Partial<TableControl['options']> = {}): TableControl {
    return {
      id: 'tbl-fb',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      columns: [
        { title: '序号', expression: '{{rowIndex + 1}}', width: 20 },
        { title: '金额', field: 'amount', width: 40 },
        { title: '名称', field: 'name', width: 40 },
      ],
      options: { borders: 'all', repeatHeader: true, repeatFooter: false, ...opts },
      dataSource: 'items',
    } as unknown as TableControl
  }

  it('fill 模式：中间页数据行 + 补空行填满至 avail', () => {
    const control = baseControl({ fixBottomRows: 'fill' })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: 10 + i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // avail 设很小 30mm：循环只放下 0-1 数据行，剩余预算大 → 触发补空
    const slice = sliceTable(model, { avail: 30, start: 0 })
    const dataCount = slice.rows.filter((r) => r.kind === 'data').length
    const blankCount = slice.rows.filter((r) => r.kind === 'blank').length
    expect(dataCount).toBeGreaterThanOrEqual(0)
    expect(slice.isLast).toBe(false)
    expect(blankCount).toBeGreaterThan(0)
  })

  it('末页也补空：单页凭证场景下 fill 模式按可用空间补空', () => {
    const control = baseControl({ fixBottomRows: 'fill' })
    const items = Array.from({ length: 3 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 1,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // avail 远大于数据+合计高 → 触发补空（凭证场景：把表格块延展至页面底部，供手写留白）
    const slice = sliceTable(model, { avail: 200, start: 0 })
    expect(slice.isLast).toBe(true)
    expect(slice.rows.filter((r) => r.kind === 'blank').length).toBeGreaterThan(0)
  })

  it('{ count: 5 }：固定补空 5 行 blank（数据行原样保留，不让位）', () => {
    const control = baseControl({ fixBottomRows: { count: 5 } })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // avail 设大一些，让 picked 数据行（≈ 20×6.69+5=138.8）后还能放下 5 个 blank
    const slice = sliceTable(model, { avail: 300, start: 0 })
    const blankCount = slice.rows.filter((r) => r.kind === 'blank').length
    // count 模式：每片都补 N=5 行 blank（只要 N ≤ floor(remainBudget/blankH)）
    expect(blankCount).toBe(5)
  })

  it('{ count: 100 } 超出可用：裁剪到能放下的最多行数（不丢数据）', () => {
    const control = baseControl({ fixBottomRows: { count: 100 } })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    const slice = sliceTable(model, { avail: 300, start: 0 })
    const blankCount = slice.rows.filter((r) => r.kind === 'blank').length
    const dataCount = slice.rows.filter((r) => r.kind === 'data').length
    expect(blankCount).toBeLessThan(100) // 100 放不下，被裁剪
    expect(dataCount).toBeGreaterThan(0) // 数据行不丢
  })

  it('{ count: 0 }：0 行 blank（合法，验证 picked 中无 blank）', () => {
    const control = baseControl({ fixBottomRows: { count: 0 } })
    const items = Array.from({ length: 10 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    const slice = sliceTable(model, { avail: 300, start: 0 })
    expect(slice.rows.filter((r) => r.kind === 'blank').length).toBe(0)
  })

  it('fixBottomMargin：减量补空（mm 留白预留）', () => {
    const control = baseControl({ fixBottomRows: 'fill', fixBottomMargin: 10 })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    const sliceFull = sliceTable(
      buildTableModel({ control: baseControl({ fixBottomRows: 'fill' }), ctx, measurer: createCjkMeasurer() }),
      { avail: 100, start: 0 },
    )
    const sliceMargin = sliceTable(model, { avail: 100, start: 0 })
    // 有 margin 的 blank 行更少
    expect(sliceMargin.rows.filter((r) => r.kind === 'blank').length).toBeLessThanOrEqual(
      sliceFull.rows.filter((r) => r.kind === 'blank').length,
    )
  })

  it('与 pageRows 数字互斥：pageRows 优先，warning PAGE_ROWS_CONFLICT', () => {
    const control = baseControl({ fixBottomRows: 'fill', pageRows: 5 })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    const slice = sliceTable(model, { avail: 200, start: 0 })
    expect(slice.warnings.some((w) => w.code === 'PAGE_ROWS_CONFLICT')).toBe(true)
    // pageRows 决定 5 行；fixBottomRows 被忽略
    expect(slice.rows.length).toBe(5)
    expect(slice.rows.filter((r) => r.kind === 'blank').length).toBe(0)
  })

  it('fixBottomRows=off：完全无补空', () => {
    const control = baseControl({ fixBottomRows: 'off' })
    const items = Array.from({ length: 20 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 3,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    const slice = sliceTable(model, { avail: 100, start: 0 })
    expect(slice.rows.filter((r) => r.kind === 'blank').length).toBe(0)
  })

  // ★ 修复回归：fill 让位不能让数据行归到下一页（这是与 { min: N } 模式的关键差异）。
  // 之前 fill 让位会让 picked.pop() + i++，把让出行推到下一页，
  // 触发 paginateFlowTable 的 trial.isLast=false → fallback → 补空到页底，
  // 把下方控件挤出本页产生空白页。现在 fill 让位改为就地替换为同高 blank 行。
  it('fill 让位：让出数据行就地替换为 blank 行（不丢数据、isLast 不变、nextStart 不变）', () => {
    const control = baseControl({ fixBottomRows: 'fill' })
    const items = Array.from({ length: 3 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 1,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // 实测行高 6.69mm。avail=30mm：3 数据(≈23) + header(≈5) = ≈28，remain ≈ 2 < blankH(6.69)
    // → 触发 fill 让位 while（minDataKeep=1，dataCount=3>1）
    const slice = sliceTable(model, { avail: 30, start: 0 })
    // ★ 关键不变量：
    expect(slice.isLast).toBe(true)             // 让位没改 i（fill 模式），isLast 不变 false
    expect(slice.nextStart).toBe(3)             // 不让到下一页
    const dataCount = slice.rows.filter((r) => r.kind === 'data').length
    const blankCount = slice.rows.filter((r) => r.kind === 'blank').length
    expect(dataCount).toBeGreaterThanOrEqual(1) // fill minDataKeep=1：至少保留 1 行（实测剩 2）
    expect(blankCount).toBeGreaterThan(0)       // 让位替换 + 补空（实测 2 blank）
  })

  it('fill 让位：2 数据行 + 紧 avail，触发让位后保留 ≥1 数据行', () => {
    const control = baseControl({ fixBottomRows: 'fill' })
    const items = Array.from({ length: 2 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 1,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // 实测行高 6.69mm。avail=26mm：header(≈5) + 2 数据(≈15) = ≈20，remain ≈ 6 < blankH(6.69)
    // → 触发 fill 让位：dataCount=2>minDataKeep(1) → pop 1，dataCount=1，minDataKeep=1 → 终止
    const slice = sliceTable(model, { avail: 26, start: 0 })
    // fill minDataKeep=1 兜底：保留 1 数据行，避免出"全 blank 无数据"退化页
    expect(slice.rows.filter((r) => r.kind === 'data').length).toBeGreaterThanOrEqual(1)
    expect(slice.rows.filter((r) => r.kind === 'blank').length).toBeGreaterThan(0)
  })

  // 回归：{ count: N } 模式不走让位（minDataKeep=∞）—— 即使 remainBudget < blankH，
//   数据行原样保留，只把 blank 裁剪到能放下的最多行数；不触发让位 i++ 路径。
  it('{ count: 2 } 不让位：紧 avail 时数据行原样保留（nextStart === 数据行数）', () => {
    const control = baseControl({ fixBottomRows: { count: 2 } })
    const items = Array.from({ length: 3 }, (_, i) => ({ amount: i, name: `n${i}` }))
    const ctx: EvalContext = {
      rows: items,
      data: { items },
      pageIndex: 1,
      pageCount: 1,
      measure: { width: 80, text: () => ({ width: 0, height: 8 }) },
    }
    const model = buildTableModel({ control, ctx, measurer: createCjkMeasurer() })
    // 行高实测 6.69mm。avail=30mm：3 数据(≈23) + header(≈5) = ≈28，remain ≈ 2 < blankH(6.69)
    // → count 模式：minDataKeep=∞ → 让位 while 不触发，数据行不归到下一页
    const slice = sliceTable(model, { avail: 30, start: 0 })
    const dataInSlice = slice.rows.filter((r) => r.kind === 'data').length
    // 数据行不丢：nextStart 与数据行数一致（不向下一页让位）
    expect(slice.nextStart).toBe(dataInSlice)
    // remainBudget 太小放不下 N=2 行 blank → 裁剪到 0（仍是合法输出）
    const blankCount = slice.rows.filter((r) => r.kind === 'blank').length
    expect(blankCount).toBeLessThanOrEqual(2)
  })
})

describe('buildBlankPlans —— 补空行生成', () => {
  it('count=0 返回空数组', async () => {
    const { buildBlankPlans } = await import('./group-engine')
    expect(buildBlankPlans(0, 8, [30, 30, 40])).toEqual([])
  })

  it('生成 N 行，每行 cells 数 = 列数（与 colWidths 对齐）', async () => {
    const { buildBlankPlans } = await import('./group-engine')
    const rows = buildBlankPlans(3, 8, [30, 30, 40])
    expect(rows).toHaveLength(3)
    expect(rows[0]!.kind).toBe('blank')
    expect(rows[0]!.height).toBe(8)
    expect(rows[0]!.cells).toHaveLength(3)
    expect(rows[0]!.cells.every((c) => c.text === '')).toBe(true)
  })
})

describe('avgDataRowHeight —— 平均数据行高', () => {
  it('有数据行：返回平均值', async () => {
    const { avgDataRowHeight } = await import('./group-engine')
    const rows = [
      { kind: 'header' as const, height: 10, cells: [] },
      { kind: 'data' as const, height: 6, cells: [], dataIndex: 0 },
      { kind: 'data' as const, height: 10, cells: [], dataIndex: 1 },
      { kind: 'static' as const, height: 20, cells: [] },
    ]
    expect(avgDataRowHeight(rows)).toBe(8)
  })

  it('无数据行：回落到 6mm（MIN_ROW_HEIGHT）', async () => {
    const { avgDataRowHeight } = await import('./group-engine')
    expect(
      avgDataRowHeight([
        { kind: 'header' as const, height: 10, cells: [] },
        { kind: 'static' as const, height: 20, cells: [] },
      ]),
    ).toBe(6)
  })
})

/* ============= M3 P0-1 vMerge 同字段纵向合并（集成 buildTableModel） ============= */

describe('buildTableModel —— vMerge 集成', () => {
  const measurer = createCjkMeasurer()

  /** 构造一个含 id 的列配置，便于 vMerge 用列 id 引用 */
  function buildVMergeControl(opts: {
    columns?: Array<{ id: string; title: string; field: string; width: number }>
    vMerge?: { columns: string[]; breakOnGroup?: boolean; breakOnPage?: boolean }
    groupBy?: string
    data: Array<Record<string, unknown>>
  }): TableControl {
    return {
      id: 'vmt',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      dataSource: 'items',
      columns: opts.columns as TableColumn[],
      data: opts.data,
      groupBy: opts.groupBy,
      options: {
        repeatHeader: true,
        repeatFooter: false,
        vMerge: opts.vMerge,
      },
    } as unknown as TableControl
  }

  const cols = (): Array<{ id: string; title: string; field: string; width: number }> => [
    { id: 'name', title: '客户', field: 'name', width: 50 },
    { id: 'qty', title: '数量', field: 'qty', width: 50 },
  ]

  it('1) vMerge 仅合并指定列：其他列每行独立显示数据，被吞行不删除', () => {
    const control = buildVMergeControl({
      columns: cols(),
      vMerge: { columns: ['name'] },
      data: [
        { name: 'A', qty: 1 },
        { name: 'A', qty: 2 },
        { name: 'A', qty: 3 },
        { name: 'B', qty: 4 },
      ],
    })
    const ctx: EvalContext = { data: { items: control.data } } as EvalContext
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    // 关键修正：4 行数据全部保留（被吞行不删除）
    const dataRows = model.rows.filter((r) => r.kind === 'data')
    expect(dataRows.length).toBe(4)
    // 锚点 row 写 rowSpan=3（> 1 时写）；被吞行 row 0/1/2 上 name 列打 consumed=true
    expect(dataRows[0]!.cells[0]!.rowSpan).toBe(3)
    expect(dataRows[0]!.cells[0]!.consumed).toBeUndefined() // 锚点自身非 consumed
    expect(dataRows[1]!.cells[0]!.consumed).toBe(true) // 被吞
    expect(dataRows[2]!.cells[0]!.consumed).toBe(true)
    expect(dataRows[3]!.cells[0]!.consumed).toBeUndefined() // B 单独
    // 其他列（qty）不受影响，每行独立显示自己的数据
    expect(dataRows[0]!.cells[1]!.text).toBe('1')
    expect(dataRows[1]!.cells[1]!.text).toBe('2')
    expect(dataRows[2]!.cells[1]!.text).toBe('3')
    expect(dataRows[3]!.cells[1]!.text).toBe('4')
    // 行高不放大：HTML rowspan=N 让锚格视觉占 N 行高（浏览器自动撑满）
    // 所以每行 height 应一致
    expect(dataRows[0]!.height).toBeCloseTo(dataRows[1]!.height, 6)
  })

  it('2) vMerge 与 repeatHeader 共存：表头后第一行即开始合并', () => {
    const control = buildVMergeControl({
      columns: cols(),
      vMerge: { columns: ['name'] },
      data: [
        { name: 'X', qty: 1 },
        { name: 'X', qty: 2 },
      ],
    })
    const ctx: EvalContext = { data: { items: control.data } } as EvalContext
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    // 2 行数据全部保留
    expect(model.rows.length).toBe(2)
    expect(model.rows[0]!.kind).toBe('data')
    expect(model.rows[0]!.cells[0]!.rowSpan).toBe(2)
    // 第 2 行 name 列被吞
    expect(model.rows[1]!.cells[0]!.consumed).toBe(true)
    // 第 2 行 qty 列仍显示自己的数据
    expect(model.rows[1]!.cells[1]!.text).toBe('2')
  })

  it('3) vMerge 与 P0-2 补空行：补空行（kind=blank）不参与 vMerge，但被吞行（kind=data）保留在 model.rows', () => {
    const control = buildVMergeControl({
      columns: cols(),
      vMerge: { columns: ['name'] },
      data: [
        { name: 'A', qty: 1 },
        { name: 'B', qty: 2 },
      ],
    })
    const ctx: EvalContext = { data: { items: control.data } } as EvalContext
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    // P0-2 补空逻辑发生在 sliceTable（不是 buildTableModel），所以 model.rows 不含 blank。
    // 这里验证：vMerge 计算后 2 个独立数据行都在（A/B 不同值 → 不合并）
    expect(model.rows.length).toBe(2)
    expect(model.rows[0]!.cells[0]!.rowSpan).toBeUndefined() // A 单独
    expect(model.rows[1]!.cells[0]!.rowSpan).toBeUndefined() // B 单独
    expect(model.rows[0]!.dataIndex).toBe(0)
    expect(model.rows[1]!.dataIndex).toBe(1)
  })

  it('4) 列下标变化（id 稳定）：vMerge 通过列 id 命中正确列', () => {
    // 列顺序变为 [qty, name]，但 vMerge 配 name → 应命中下标 1
    const altColumns = [
      { id: 'qty', title: '数量', field: 'qty', width: 50 },
      { id: 'name', title: '客户', field: 'name', width: 50 },
    ]
    const control = buildVMergeControl({
      columns: altColumns,
      vMerge: { columns: ['name'] },
      data: [
        { name: '阿里', qty: 1 },
        { name: '阿里', qty: 2 },
      ],
    })
    const ctx: EvalContext = { data: { items: control.data } } as EvalContext
    const model = buildTableModel({ control, ctx, measurer, widthMm: 100, heightMm: 50 })
    // 2 行保留
    expect(model.rows.length).toBe(2)
    // name 在列 1，应被合并
    expect(model.rows[0]!.cells[1]!.rowSpan).toBe(2)
    expect(model.rows[1]!.cells[1]!.consumed).toBe(true)
    // qty 在列 0，未启用 vMerge → 不写 rowSpan 也不 consumed
    expect(model.rows[0]!.cells[0]!.rowSpan).toBeUndefined()
    expect(model.rows[1]!.cells[0]!.consumed).toBeUndefined()
  })
})

/* ============= Bug7 修复：cell.segments 单 text 段 + 聚合 token → buildFooterRow 识别 ============= */

describe('Bug7 修复：cell.segments 单 text 段 agg token → 走 buildFooterRow 渲染大写', () => {
  /**
   * v2 模型下用户用 ContentValueEditor「聚合」按钮插入 token：
   *   textToSegments('{{#totalCap}}') → [{ kind: 'text', value: '{{#totalCap}}' }]
   *   → cell.text=undefined, cell.segments=[{text,'{{#totalCap}}'}]
   * 老 buildFooterRow 只读 cell.text → 识别不到 token → fk='static' → 画布显示字面 '{{#totalCap}}'
   * 修复后 buildFooterRow 也读 cell.segments（单 text 段），按 capital 渲染大写金额
   */
  function buildModel(control: TableControl, ctx: EvalContext): Model {
    return buildTableModel({
      control,
      ctx,
      measurer: createCjkMeasurer(),
      widthMm: control.width,
      heightMm: control.height,
    })
  }

  function sliceAll(model: Model): Array<ReturnType<typeof sliceTable>> {
    const slices: Array<ReturnType<typeof sliceTable>> = []
    let start = 0
    for (let p = 0; p < 20; p++) {
      const s = sliceTable(model, { avail: 1000, start })
      slices.push(s)
      if (s.isLast) break
      start = s.nextStart
    }
    return slices
  }

  it('segments 单 text 段 + {{#totalCap}} → 末页 footerKind=capital + 渲染大写金额', () => {
    const ctrl: TableControl = {
      id: 't1',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 60,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        { title: '金额', field: 'items[].amount', width: 50 },
      ],
      // ★ 关键：cell.segments 单 text 段为 agg token，cell.text 为空
      cells: [
        [{ text: '名称' }, { text: '金额' }],
        [{ field: 'name' }, { field: 'amount' }],
        [{ text: '大写：' }, { segments: [{ kind: 'text', value: '{{#totalCap}}' }] }],
      ],
      staticRows: 1,
    }
    const ctx: EvalContext = { data: { items: [{ name: 'A', amount: 100 }, { name: 'B', amount: 50 }] } }
    const model = buildModel(ctrl, ctx)
    const last = sliceAll(model).at(-1)!
    const cap = last.footerRows.find((r) => r.footerKind === 'capital')
    expect(cap, '末页应识别 capital 行').toBeTruthy()
    // 大写金额：100 + 50 = 150 → 壹佰伍拾元整
    expect(cap!.cells[1]!.text).toBe('壹佰伍拾元整')
  })

  it('cell.text 老路径（v1）也仍正常识别（回归保护）', () => {
    const ctrl: TableControl = {
      id: 't2',
      type: 'table',
      left: 0,
      top: 0,
      width: 100,
      height: 60,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        { title: '金额', field: 'items[].amount', width: 50 },
      ],
      cells: [
        [{ text: '名称' }, { text: '金额' }],
        [{ field: 'name' }, { field: 'amount' }],
        [{ text: '大写：' }, { text: '{{#totalCap}}' }],
      ],
      staticRows: 1,
    }
    const ctx: EvalContext = { data: { items: [{ name: 'A', amount: 200 }] } }
    const model = buildModel(ctrl, ctx)
    const last = sliceAll(model).at(-1)!
    const cap = last.footerRows.find((r) => r.footerKind === 'capital')
    expect(cap).toBeTruthy()
    expect(cap!.cells[1]!.text).toBe('贰佰元整')
  })
})

/* ============= Bug10 修复：#totalCount / #pageCount 在非数值列也应计算 ============= */

describe('Bug10 修复：count token（pageCount/totalCount）不依赖列字段类型', () => {
  /**
   * count token 语义：rows.length，与列字段无关。
   * 老 buildFooterRow 用 `numeric && field` 双重门 → 字符串列（实测值 FinalVal 等）
   * 的 #totalCount 被吞，画布显示空。
   * 修复后：count token 直接标记 isAgg + tokenKind，不再被「非数值列」分支吞掉。
   */
  function buildModel(control: TableControl, ctx: EvalContext): Model {
    return buildTableModel({
      control,
      ctx,
      measurer: createCjkMeasurer(),
      widthMm: control.width,
      heightMm: control.height,
    })
  }
  function sliceAll(model: Model): Array<ReturnType<typeof sliceTable>> {
    const slices: Array<ReturnType<typeof sliceTable>> = []
    let start = 0
    for (let p = 0; p < 20; p++) {
      const s = sliceTable(model, { avail: 1000, start })
      slices.push(s)
      if (s.isLast) break
      start = s.nextStart
    }
    return slices
  }

  it('#totalCount 放在字符串列（FinalVal=文字）→ 末页 grandTotal 行 text = 数据行数', () => {
    const ctrl: TableControl = {
      id: 't10',
      type: 'table',
      left: 0, top: 0, width: 100, height: 60,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        // 字符串列：实测值/结论等文字
        { title: '实测', field: 'items[].finalVal', width: 50 },
      ],
      cells: [
        [{ text: '名称' }, { text: '实测' }],
        [{ field: 'name' }, { field: 'finalVal' }],
        // 末行：「合计」 + #totalCount；#totalCount 在字符串列
        [{ text: '合计' }, { text: '{{#totalCount}}' }],
      ],
      staticRows: 1,
    }
    const ctx: EvalContext = {
      data: {
        items: [
          { name: 'A', finalVal: '符合规定' },
          { name: 'B', finalVal: '合格' },
          { name: 'C', finalVal: '94.6%' },
        ],
      },
    }
    const model = buildModel(ctrl, ctx)
    const last = sliceAll(model).at(-1)!
    const summary = last.footerRows.find((r) => r.footerKind === 'grandTotal')
    expect(summary, '末页应识别 grandTotal 行').toBeTruthy()
    // 修复点：count 列（第 2 列）text = '3'
    expect(summary!.cells[1]!.text).toBe('3')
  })

  it('#pageCount 放在字符串列 → 本页合计行 text = 本页数据行数', () => {
    const ctrl: TableControl = {
      id: 't11',
      type: 'table',
      left: 0, top: 0, width: 100, height: 60,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        { title: '实测', field: 'items[].finalVal', width: 50 },
      ],
      cells: [
        [{ text: '名称' }, { text: '实测' }],
        [{ field: 'name' }, { field: 'finalVal' }],
        [{ text: '本页合计' }, { text: '{{#pageCount}}' }],
      ],
      staticRows: 1,
      options: { pageRows: 2 } as TableControl['options'],
    }
    const ctx: EvalContext = {
      data: {
        items: Array.from({ length: 5 }, (_, i) => ({
          name: 'item' + i,
          finalVal: '合格',
        })),
      },
    }
    const model = buildModel(ctrl, ctx)
    const slices = sliceAll(model)
    // 5 行 / 2 行每页 → 3 页（前两页各 2 行，末页 1 行）
    expect(slices.length).toBe(3)
    slices.forEach((s, p) => {
      const sub = s.footerRows.find((r) => r.footerKind === 'pageSubtotal')
      expect(sub, `第 ${p + 1} 页应有本页合计`).toBeTruthy()
      // 第 1、2 页各 2 行；第 3 页 1 行
      const expected = p === 2 ? 1 : 2
      expect(sub!.cells[1]!.text).toBe(String(expected))
    })
  })

  it('回归保护：#totalSum 放在字符串列 → 仍按预期留空（非数值列不计算 sum）', () => {
    const ctrl: TableControl = {
      id: 't12',
      type: 'table',
      left: 0, top: 0, width: 100, height: 60,
      dataSource: 'items',
      columns: [
        { title: '名称', field: 'items[].name', width: 50 },
        { title: '实测', field: 'items[].finalVal', width: 50 },  // 字符串列
      ],
      cells: [
        [{ text: '名称' }, { text: '实测' }],
        [{ field: 'name' }, { field: 'finalVal' }],
        [{ text: '合计' }, { text: '{{#totalSum}}' }],
      ],
      staticRows: 1,
    }
    const ctx: EvalContext = {
      data: { items: [{ name: 'A', finalVal: '10' }, { name: 'B', finalVal: '20' }] },
    }
    const model = buildModel(ctrl, ctx)
    const last = sliceAll(model).at(-1)!
    const summary = last.footerRows.find((r) => r.footerKind === 'grandTotal')
    expect(summary).toBeTruthy()
    // sum 在非数值列不参与计算 → 留空（与原行为一致）
    expect(summary!.cells[1]!.text).toBe('')
  })
})
