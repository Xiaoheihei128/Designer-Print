/**
 * 设计期单元格网格模型单测（table-cells.ts）
 *
 * 覆盖：有/无 cells 的回落、buildDesignGrid 行语义、ensureCells 物化、
 * patchCellText（表头/静态/数据样例行语义）、patchCellStyle（合并/清除）、
 * setCellSpan（横向合并 + 吞格清空）、resolveCellStyle 优先级、normalizeCellRows、designRowInfo。
 */
import { describe, expect, it } from 'vitest'
import type { TableCell, TableControl } from '@op/types/control'
import {
  addTableColumn,
  buildDesignGrid,
  computeSpanLayout,
  designRowHeights,
  designRowInfo,
  ensureCells,
  ensureColumnIds,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  normalizeCellRows,
  patchCell,
  patchCellStyle,
  patchCellText,
  removeTableColumn,
  removeTableRow,
  resolveCellStyle,
  setCellRowSpan,
  setCellSpan,
  setGridRows,
  seedSummaryTail,
  syncDataTableHeight,
  syncTableHeight,
} from './table-cells'

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

describe('buildDesignGrid', () => {
  it('数据表无 cells：由列配置瞬时推导 表头+数据样例行+静态尾行', () => {
    const g = buildDesignGrid(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(g.isData).toBe(true)
    expect(g.headerRows).toBe(1)
    expect(g.rowCount).toBe(1 + 1 + 1) // header + data template + 1 static
    expect(g.colCount).toBe(3)
    // 表头第 1 行：文本=列标题、加粗、对齐跟随 headerAlign
    expect(g.cells[0]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    expect(g.cells[0]![0]!.style?.bold).toBe(true)
    expect(g.cells[0]![0]!.style?.align).toBe('center')
    // 数据样例行第 2 行：带 field 段（来自列配置的 field，Plan B 步骤 2/5）
    expect(g.cells[1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    expect(g.cells[1]![2]!.segments).toEqual([{ kind: 'field', path: 'qty' }])
    // 静态尾行：空
    expect(g.cells[2]![0]).toEqual({})
  })

  it('布局网格（无 dataSource）无 cells：行数取 designRows（含表头）', () => {
    const g = buildDesignGrid(baseTable({ designRows: 4 }))
    expect(g.isData).toBe(false)
    expect(g.headerRows).toBe(1) // 列有标题 → 自动补 1 行表头
    expect(g.rowCount).toBe(5) // 1 表头 + 4 正文
    expect(g.colCount).toBe(3)
    expect(g.cells.every((r) => r.length === 3)).toBe(true)
  })

  it('已有 cells：按语义行数归一化（列数补齐到当前列数）', () => {
    const cells = [
      [{ segments: [{ kind: 'text', value: 'A' }] }, { segments: [{ kind: 'text', value: 'B' }] }, { segments: [{ kind: 'text', value: 'C' }] }, { segments: [{ kind: 'text', value: '多余列应被丢弃' }] }],
      [{ segments: [{ kind: 'text', value: 'x' }] }, { segments: [{ kind: 'text', value: 'y' }] }, { segments: [{ kind: 'text', value: 'z' }] }],
    ]
    const g = buildDesignGrid(baseTable({ dataSource: 'items', cells, staticRows: 0 }))
    expect(g.rowCount).toBe(2) // header(1) + data(1) + 0
    expect(g.colCount).toBe(3)
    expect(g.cells[0]![3]).toBeUndefined()
    expect(g.cells[0]![0]!.segments).toEqual([{ kind: 'text', value: 'A' }])
  })

  it('列数为 0 时兜底为 1 列，不崩溃', () => {
    const g = buildDesignGrid(baseTable({ columns: [] }))
    expect(g.colCount).toBe(1)
    expect(g.rowCount).toBeGreaterThan(0)
  })
})

describe('ensureCells', () => {
  it('无 cells 时物化出完整网格并带上语义行数', () => {
    const next = ensureCells(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(next.cells).toBeDefined()
    expect(next.cells!.length).toBe(3)
    expect(next.headerRows).toBe(1)
    expect(next.staticRows).toBe(1)
    expect(next.designRows).toBe(0)
  })

  it('已存在且尺寸匹配则返回结构（不重建，保持既有内容）', () => {
    const cells = [
      [{ segments: [{ kind: 'text', value: 'H1' }] }, { segments: [{ kind: 'text', value: 'H2' }] }, { segments: [{ kind: 'text', value: 'H3' }] }],
      [{ segments: [{ kind: 'field', path: 'a' }] }, { segments: [{ kind: 'field', path: 'b' }] }, { segments: [{ kind: 'field', path: 'c' }] }],
    ]
    const orig = baseTable({ dataSource: 'items', cells, staticRows: 0 })
    const next = ensureCells(orig)
    expect(next.cells).toBe(cells)
    expect(next.headerRows).toBe(1)
  })
})

describe('patchCellText 行语义', () => {
  it('表头/静态行：写 segments 单 text 段', () => {
    const t = baseTable({ dataSource: 'items', staticRows: 1 })
    const next = patchCellText(t, 0, 0, '序号X') // 表头行
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '序号X' }])
    expect(next.cells![0]![0]!.text).toBeUndefined()
  })

  it('静态尾行：写 segments 单 text 段', () => {
    const t = baseTable({ dataSource: 'items', staticRows: 1 })
    const next = patchCellText(t, 2, 0, '合计') // 静态行
    expect(next.cells![2]![0]!.segments).toEqual([{ kind: 'text', value: '合计' }])
    expect(next.cells![2]![0]!.text).toBeUndefined()
  })

  it('数据样例行：与当前占位符一致 → 原样返回（不固化占位符）', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCellText(t, 1, 1, '{{item.name}}')
    expect(next).toBe(t)
  })

  it('数据样例行：纯字段引用回写为 field 段', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCellText(t, 1, 1, '{{item.amount}}')
    expect(next.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'amount' }])
    expect(next.cells![1]![1]!.text).toBeUndefined()
    expect(next.cells![1]![1]!.field).toBeUndefined()
    expect(next.cells![1]![1]!.expression).toBeUndefined()
  })

  it('数据样例行：含表达式 → 写 expr 段并清 field', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCellText(t, 1, 2, '{{row.price * row.qty}}')
    expect(next.cells![1]![2]!.segments).toEqual([{ kind: 'expr', src: 'row.price * row.qty' }])
    expect(next.cells![1]![2]!.text).toBeUndefined()
    expect(next.cells![1]![2]!.field).toBeUndefined()
    expect(next.cells![1]![2]!.expression).toBeUndefined()
  })

  it('数据样例行：清空 → 清 segments 与老字段', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCellText(t, 1, 1, '')
    expect(next.cells![1]![1]!.segments).toEqual([])
    expect(next.cells![1]![1]!.text).toBeUndefined()
    expect(next.cells![1]![1]!.field).toBeUndefined()
    expect(next.cells![1]![1]!.expression).toBeUndefined()
  })
})

describe('patchCellStyle / resolveCellStyle', () => {
  it('resolveCellStyle 优先级：单元格 > 列 > 表格默认', () => {
    const t = baseTable({
      options: { defaultCellStyle: { align: 'left', color: '#000' } },
      columns: [{ title: 'A', width: 10, style: { align: 'center', color: '#f00' } }],
    })
    const resolved = resolveCellStyle(t, t.columns[0], { style: { align: 'right', bold: true } })
    expect(resolved.align).toBe('right') // 单元格覆盖
    expect(resolved.color).toBe('#f00') // 列兜底
    expect(resolved.bold).toBe(true)
  })

  it('patchCellStyle 合并并覆盖传入键；undefined 表示清除', () => {
    let t = baseTable({ dataSource: 'items' })
    t = patchCellStyle(t, 0, 0, { bold: true, color: '#ff0000' })
    expect(t.cells![0]![0]!.style?.bold).toBe(true)
    expect(t.cells![0]![0]!.style?.color).toBe('#ff0000')
    t = patchCellStyle(t, 0, 0, { color: undefined })
    expect(t.cells![0]![0]!.style?.bold).toBe(true)
    expect(t.cells![0]![0]!.style?.color).toBeUndefined()
  })
})

describe('setCellSpan 横向合并', () => {
  it('本格 colSpan=n，被吞格清空（保留矩阵规整）', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = setCellSpan(t, 1, 0, 2) // 数据样例行第0列合并2列
    expect(next.cells![1]![0]!.colSpan).toBe(2)
    expect(next.cells![1]![1]!.text).toBeUndefined()
    expect(next.cells![1]![1]!.field).toBeUndefined()
    expect(next.cells![1]![1]!.colSpan).toBeUndefined()
  })

  it('合并数越界自动夹紧到剩余列数', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = setCellSpan(t, 1, 1, 99) // 剩 2 列（c=1,2）
    expect(next.cells![1]![1]!.colSpan).toBe(2)
  })
})

describe('designRowInfo', () => {
  it('数据表行语义正确', () => {
    const g = buildDesignGrid(baseTable({ dataSource: 'items', staticRows: 1 }))
    expect(designRowInfo(g, 0).kind).toBe('header')
    expect(designRowInfo(g, 1).kind).toBe('data')
    expect(designRowInfo(g, 1).isDataTemplate).toBe(true)
    expect(designRowInfo(g, 2).kind).toBe('static')
  })

  it('布局网格：第 0 行为表头，其余为 static', () => {
    const g = buildDesignGrid(baseTable({ designRows: 3 }))
    expect(designRowInfo(g, 0).kind).toBe('header')
    expect(designRowInfo(g, 1).kind).toBe('static')
    expect(designRowInfo(g, 2).kind).toBe('static')
  })
})

describe('normalizeCellRows', () => {
  it('行/列不足补空、超出截断', () => {
    const out = normalizeCellRows([[{ segments: [{ kind: 'text', value: 'a' }] }], [{ segments: [{ kind: 'text', value: 'b' }] }, { segments: [{ kind: 'text', value: 'c' }] }]], 3, 2)
    expect(out.length).toBe(3)
    expect(out[0]!.length).toBe(2)
    expect(out[0]![0]!.segments).toEqual([{ kind: 'text', value: 'a' }])
    expect(out[0]![1]).toEqual({})
    expect(out[1]![1]!.segments).toEqual([{ kind: 'text', value: 'c' }])
  })
})

describe('patchCell 不可变更新', () => {
  it('返回新控件且只改目标格', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCell(t, 0, 0, { segments: [{ kind: 'text', value: '改' }] })
    expect(next).not.toBe(t)
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '改' }])
    expect(t.cells).toBeUndefined()
  })

  it('P0-3 字段绑定写回：segments 单 field 段 + 清老字段', () => {
    const t = baseTable({ dataSource: 'items' })
    // 目标格原本是 col.field 派生的 field 段 → 改写为新路径
    const next = patchCell(t, 1, 1, {
      segments: [{ kind: 'field', path: 'items[].qty' }],
      text: undefined,
      field: undefined,
      expression: undefined,
    })
    const cell = next.cells![1]![1]!
    expect(cell.segments).toEqual([{ kind: 'field', path: 'items[].qty' }])
    expect(cell.text).toBeUndefined()
    expect(cell.field).toBeUndefined()
    expect(cell.expression).toBeUndefined()
    // 不可变：原控件未受影响
    expect(t.cells).toBeUndefined()
  })

  it('P0-3 覆盖 expression 单元格：旧 expr 段被新 field 段覆盖', () => {
    const t = baseTable({ dataSource: 'items' })
    // 旧表达式
    const withExpr = patchCell(t, 1, 1, { segments: [{ kind: 'expr', src: '{{row.qty*2}}' }] })
    expect(withExpr.cells![1]![1]!.segments).toEqual([{ kind: 'expr', src: '{{row.qty*2}}' }])
    // 改绑字段
    const next = patchCell(withExpr, 1, 1, {
      segments: [{ kind: 'field', path: 'items[].qty' }],
      text: undefined,
      field: undefined,
      expression: undefined,
    })
    const cell = next.cells![1]![1]!
    expect(cell.segments).toEqual([{ kind: 'field', path: 'items[].qty' }])
    expect(cell.segments).toEqual([{ kind: 'field', path: 'items[].qty' }])
    expect(cell.expression).toBeUndefined()
  })

  it('P0-3 写回仅改目标格，其他单元格保留原值', () => {
    const t = baseTable({ dataSource: 'items' })
    const next = patchCell(t, 1, 1, {
      segments: [{ kind: 'field', path: 'items[].qty' }],
      text: undefined,
      field: undefined,
      expression: undefined,
    })
    // 第 0 列（序号）不应受影响
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'expr', src: 'rowIndex + 1' }])
    // 表头不受影响
    expect(next.cells![0]![1]!.segments).toEqual([{ kind: 'text', value: '名称' }])
  })
})

describe('网格结构变更（#100）', () => {
  it('setGridRows 布局网格增正文行：保留已有内容并按目标维度补空', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    t.cells![0]![0] = { segments: [{ kind: 'text', value: 'H' }] }
    t.cells![1]![1] = { segments: [{ kind: 'text', value: 'B' }] }
    const next = setGridRows(t, { designRows: 4 })
    expect(next.headerRows).toBe(1)
    expect(next.designRows).toBe(4)
    expect(next.cells!.length).toBe(5) // 1 表头 + 4 正文
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: 'H' }]) // 表头保留
    expect(next.cells![1]![1]!.segments).toEqual([{ kind: 'text', value: 'B' }]) // 正文保留
    expect(next.cells![4]![0]).toEqual({}) // 新补空行
  })

  it('setGridRows 数据表增静态尾行', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', staticRows: 0 }))
    const next = setGridRows(t, { staticRows: 2 })
    expect(next.staticRows).toBe(2)
    expect(next.cells!.length).toBe(4) // 1 表头 + 1 数据样例 + 2 尾
    expect(Boolean(next.dataSource?.trim())).toBe(true)
  })

  it('setGridRows 改表头行数：新增表头行用列标题兜底', () => {
    const t = baseTable({ designRows: 2 })
    const next = setGridRows(t, { headerRows: 2 })
    expect(next.headerRows).toBe(2)
    expect(next.cells!.length).toBe(4) // 2 表头 + 2 正文
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }]) // 新表头行取列标题
  })

  it('setGridRows 减行数：截断尾部（保留前面内容）', () => {
    const t = ensureCells(baseTable({ designRows: 5 }))
    t.cells![0]![0] = { segments: [{ kind: 'text', value: 'H' }] }
    const next = setGridRows(t, { designRows: 2 })
    expect(next.cells!.length).toBe(3) // 1 表头 + 2 正文
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: 'H' }])
  })

  // ─── Bug 回归：点表头行数 +1 后数据表"变文本表"──
  // 历史 bug：setGridRows 用 normalizeCellRows 按位置补齐，
  // 数据样例行被新表头行挤走，引擎把空白行当成模板克隆出全空数据行。
  // 修复后：按 OLD 语义切片、按 NEW 目标重组，数据样例行恒在 cells[headerRows]。

  it('setGridRows 数据表 +表头行数：数据样例行仍在 cells[headerRows]，字段绑定不丢', () => {
    const t = ensureCells(baseTable({ dataSource: 'items' }))
    // t.headerRows=1, t.cells=[H0, DT1]，DT1 由 buildDesignGrid 物化（每格含 field）
    expect(t.cells!.length).toBe(2)
    expect(t.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }]) // 修复前基线：DT1 字段确实存在

    const next = setGridRows(t, { headerRows: 2 })
    expect(next.headerRows).toBe(2)
    expect(next.cells!.length).toBe(3) // 2 表头 + 1 数据样例（行数正确，非末尾追加）
    // 数据样例行仍在 cells[headerRows=2]，原字段绑定保留——明细数据恢复
    expect(next.cells![2]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    expect(next.cells![2]![2]!.segments).toEqual([{ kind: 'field', path: 'qty' }])
    // 新表头行用列标题兜底（位于表头区，不是末尾）
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    // 原表头行保留
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
  })

  it('setGridRows 数据表 -表头行数：数据样例行跟随 headerRows 位置', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', headerRows: 2 }))
    // cells=[H0, H1, DT1]，DT1 含 field
    expect(t.cells!.length).toBe(3)
    const next = setGridRows(t, { headerRows: 1 })
    expect(next.headerRows).toBe(1)
    expect(next.cells!.length).toBe(2) // 1 表头 + 1 数据样例
    // 数据样例行仍是原 DT1
    expect(next.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    // 原第一个表头行保留
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
  })

  it('setGridRows 数据表同时改表头与静态尾行：两段独立 splice，数据样例行不串位', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', staticRows: 1 }))
    // cells=[H0, DT1, S0]
    expect(t.cells!.length).toBe(3)
    const next = setGridRows(t, { headerRows: 2, staticRows: 2 })
    expect(next.headerRows).toBe(2)
    expect(next.staticRows).toBe(2)
    expect(next.cells!.length).toBe(5) // 2 表头 + 1 数据样例 + 2 静态尾
    // DT1 仍在 cells[2]，字段保留
    expect(next.cells![2]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    // 新表头行 cells[1] 用列标题兜底
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    // 原静态尾行 cells[3]、新静态尾行 cells[4] 都是空对象
    expect(next.cells![3]![0]).toEqual({})
    expect(next.cells![4]![0]).toEqual({})
  })

  it('setGridRows 布局网格 +正文行数：原正文保留在头部，新正文追加在主体末尾', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    t.cells![0]![0] = { segments: [{ kind: 'text', value: 'H0' }] }
    t.cells![1]![0] = { segments: [{ kind: 'text', value: 'B0' }] }
    t.cells![2]![0] = { segments: [{ kind: 'text', value: 'B1' }] }
    const next = setGridRows(t, { designRows: 4 })
    expect(next.cells!.length).toBe(5) // 1 表头 + 4 正文
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: 'H0' }])
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: 'B0' }])
    expect(next.cells![2]![0]!.segments).toEqual([{ kind: 'text', value: 'B1' }])
    expect(next.cells![3]![0]).toEqual({}) // 新正文行（追加在主体末尾）
    expect(next.cells![4]![0]).toEqual({})
  })

  it('setGridRows 布局网格 +表头行数：保留正文，新增表头行用列标题兜底', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    // headerRows=1（默认）, cells=[H0, B0, B1]
    t.cells![1]![0] = { segments: [{ kind: 'text', value: 'CUSTOM-B0' }] }
    const next = setGridRows(t, { headerRows: 3 })
    expect(next.headerRows).toBe(3)
    expect(next.cells!.length).toBe(5) // 3 表头 + 2 正文
    // 新增的两个表头行用列标题兜底
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    expect(next.cells![2]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    // 原正文保留（位置不变，只是下移）
    expect(next.cells![3]![0]!.segments).toEqual([{ kind: 'text', value: 'CUSTOM-B0' }])
  })

  it('addTableColumn：列与每行单元格同步增加，新列表头默认填标题', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    const next = addTableColumn(t, { title: '新列', width: 20 })
    expect(next.columns.length).toBe(4)
    expect(next.cells!.every((r) => r.length === 4)).toBe(true)
    expect(next.cells![0]![3]!.segments).toEqual([{ kind: 'text', value: '新列' }]) // 表头新列取标题
  })

  it('addTableColumn：新列自动生成稳定 id（vMerge / 列配置靠 id 引用）', () => {
    const t = ensureCells(baseTable({ designRows: 1 }))
    const next = addTableColumn(t, { title: '新列', width: 20 })
    expect(next.columns[next.columns.length - 1]!.id).toMatch(/^col_/)
  })

  it('removeTableColumn：删除指定列（含对应单元格），至少留 1 列', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    t.cells![0]![1] = { segments: [{ kind: 'text', value: 'B-col1' }] }
    const next = removeTableColumn(t, 1)
    expect(next.columns.length).toBe(2)
    expect(next.cells!.every((r) => r.length === 2)).toBe(true)
    expect(next.columns[0]!.title).toBe('序号')
    expect(next.columns[1]!.title).toBe('数量') // 原第 2 列（数量）左移
    expect(next.cells![0]![1]!.segments).toEqual([{ kind: 'text', value: '数量' }]) // 单元格同步左移
  })

  it('removeTableColumn：被删列若在 vMerge.columns 里 → 自动剔除（不留 stale id）', () => {
    const t = ensureCells(baseTable({ designRows: 1 }))
    // 显式给两列加 id + 启用 vMerge
    t.columns![0]!.id = 'col_a'
    t.columns![1]!.id = 'col_b'
    t.options = { ...t.options, vMerge: { columns: ['col_a', 'col_b'] } }
    // 删第 1 列（col_b）→ vMerge 应只保留 col_a
    const next = removeTableColumn(t, 1)
    expect(next.options?.vMerge?.columns).toEqual(['col_a'])
    // 不存在的列不在 vMerge 里
    expect(next.options?.vMerge?.columns).not.toContain('col_b')
  })

  it('removeTableColumn：最后一列不可删', () => {
    const t = baseTable({ columns: [{ title: 'only', width: 10 }] })
    const next = removeTableColumn(t, 0)
    expect(next.columns.length).toBe(1)
  })

  it('removeTableRow：删除指定行（含对应单元格），至少留 1 行', () => {
    const t = ensureCells(baseTable({ designRows: 3 }))
    t.cells![2]![0] = { segments: [{ kind: 'text', value: '第三行' }] }
    const next = removeTableRow(t, 2)
    const grid = buildDesignGrid(next)
    expect(grid.rowCount).toBe(3) // 4 行 - 1
    expect(grid.designRows).toBe(2)
    expect(grid.cells.some((r) => r[0]?.text === '第三行')).toBe(false)
    expect(grid.cells[1]![0]?.text).toBeUndefined() // 第 2 行未受影响
  })

  it('removeTableRow：删表头行时 headerRows 减一', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    const next = removeTableRow(t, 0)
    expect(buildDesignGrid(next).headerRows).toBe(0)
    expect(buildDesignGrid(next).rowCount).toBe(2)
  })

  it('removeTableRow：数据表的数据样例行（唯一 body 行）不可删', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', staticRows: 1 }))
    const next = removeTableRow(t, 1) // 第 1 行是数据样例行（headerRows=1）
    expect(next).toBe(t) // 不变
  })

  it('removeTableRow：单行表格不可删', () => {
    // 单行表格：1 行布局网格正文。删该行后只剩表头（headerRows=1）/或空（headerRows=0），
    // removeTableRow 应不动。Bug12 后 layoutBodyRows 不再强制 ≥1（designRows 显式 0 可生效），
    // 故用 designRows=1 显式构造单行场景。
    const t = ensureCells(baseTable({ height: 8, headerRows: 0, designRows: 1, columns: [{ title: '', width: 10 }] }))
    expect(buildDesignGrid(t).rowCount).toBe(1)
    const next = removeTableRow(t, 0)
    expect(next).toBe(t)
  })

  it('moveTableColumn：左右搬动列与单元格', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    const next = moveTableColumn(t, 0, 2)
    expect(next.columns[2]!.title).toBe('序号')
    expect(next.cells![0]![2]!.segments).toEqual([{ kind: 'text', value: '序号' }]) // 单元格同列位置搬动
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '名称' }])
  })

  /* ============= insertTableRow 三段语义：表头 / 数据样例 / 静态尾 ============= */
  // 历史上数据表下 insertTableRow 粗暴地把 atRow 夹到 headerRows+1 之后——
  // 用户右键表头行调用"上下插入行"也被夹到数据样例行下面，违反直觉。
  // 修复后按 OLD 语义分三段：表头区插入 → headerRows+1；数据样例行 → 夹到静态尾行；
  // 静态尾行区插入 → staticRows+1。

  it('insertTableRow 数据表 +表头行下方插入：新行变表头，headerRows+1，dataSample 字段不丢', () => {
    const t = ensureCells(baseTable({ dataSource: 'items' }))
    // t.headerRows=1, t.cells=[H0, DT1]
    expect(t.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }]) // 修复前基线：DT1 字段确实存在

    // 选中表头第 1 行（row=0），下方插入 → atRow=1，落在表头区
    const next = insertTableRow(t, 1)
    expect(next.headerRows).toBe(2)
    expect(next.staticRows).toBe(0)
    expect(next.cells!.length).toBe(3) // 2 表头 + 1 数据样例
    // cells[2] 仍是原 DT1，字段绑定保留
    expect(next.cells![2]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    expect(next.cells![2]![2]!.segments).toEqual([{ kind: 'field', path: 'qty' }])
    // 新表头行 cells[1] 用列标题兜底
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    // 原表头行保留为 cells[0]
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
  })

  it('insertTableRow 数据表 +表头行上方插入：新行变表头，headerRows+1', () => {
    const t = ensureCells(baseTable({ dataSource: 'items' }))
    // 选中表头第 1 行（row=0），上方插入 → atRow=0，落在表头区
    const next = insertTableRow(t, 0)
    expect(next.headerRows).toBe(2)
    expect(next.cells!.length).toBe(3)
    // 新表头行 cells[0]（用列标题兜底），原 H0 下移到 cells[1]
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
    // dataSample 仍在 cells[2]，字段保留
    expect(next.cells![2]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
  })

  it('insertTableRow 数据表 +atRow===headerRows（下方插入最后一行表头）：新行变表头，headerRows+1', () => {
    const t = ensureCells(baseTable({ dataSource: 'items' }))
    // 选中"下方插入" 表头最后一行（atRow=1 === headerRows）
    // 按统一规则 atRow<=headerRows → 新行变表头，避免用户视觉上"插到数据行下面"
    const next = insertTableRow(t, 1)
    expect(next.headerRows).toBe(2)
    expect(next.staticRows).toBe(0) // 不动
    expect(next.cells!.length).toBe(3) // 2 表头 + 1 dataSample
    // dataSample 仍在 cells[2]，字段未丢（关键回归）
    expect(next.cells![2]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    // 新表头行 cells[1] 用列标题兜底
    expect(next.cells![1]![0]!.segments).toEqual([{ kind: 'text', value: '序号' }])
  })

  it('insertTableRow 数据表 +数据样例行下方插入（atRow===headerRows+1）：落入静态尾行区', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', staticRows: 1 }))
    // cells=[H0, DT1, S0]，选中数据样例行下方 → atRow=2
    const next = insertTableRow(t, 2)
    expect(next.headerRows).toBe(1)
    expect(next.staticRows).toBe(2)
    expect(next.cells!.length).toBe(4) // 1 表头 + 1 dataSample + 2 静态尾
    // dataSample 仍在 cells[1]，字段保留
    expect(next.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    // 原静态尾行 S0 下移到 cells[2]，新空白行 cells[3]
    expect(next.cells![3]![0]).toEqual({})
  })

  it('insertTableRow 数据表 +静态尾行上方插入：staticRows+1，原内容保留', () => {
    const t = ensureCells(baseTable({ dataSource: 'items', staticRows: 1 }))
    // cells=[H0, DT1, S0]，选中静态尾行（row=2）上方插入 → atRow=2
    const next = insertTableRow(t, 2)
    expect(next.headerRows).toBe(1)
    expect(next.staticRows).toBe(2)
    expect(next.cells!.length).toBe(4)
    // dataSample 仍在 cells[1]，字段保留
    expect(next.cells![1]![1]!.segments).toEqual([{ kind: 'field', path: 'name' }])
    // 原静态尾行 S0 下移到 cells[2]
    expect(next.cells![3]![0]).toEqual({}) // 新空白行（插入位置 = atRow）
  })

  it('insertTableRow 布局网格：直接插入正文区，designRows+1', () => {
    const t = ensureCells(baseTable({ designRows: 2 }))
    t.cells![0]![0] = { segments: [{ kind: 'text', value: 'H0' }] }
    t.cells![1]![0] = { segments: [{ kind: 'text', value: 'B0' }] }
    const next = insertTableRow(t, 1) // 选中 H0，下方插入
    expect(next.designRows).toBe(3)
    expect(next.cells!.length).toBe(4) // 1 表头 + 3 正文
    expect(next.cells![0]![0]!.segments).toEqual([{ kind: 'text', value: 'H0' }]) // 表头保留
    expect(next.cells![1]![0]).toEqual({}) // 新正文行（默认空）
    expect(next.cells![2]![0]!.segments).toEqual([{ kind: 'text', value: 'B0' }]) // 原 B0 下移
  })

  /* ============= Bug12 修复：布局网格 designRows 显式设为 0 时实际渲染 0 行正文 ============= */
  it('Bug12：布局网格 designRows=0 → 画布无正文行（修复前因 Math.max(1,...) 多出 1 行空白）', () => {
    // 1) 起手：1 表头 + 6 正文的布局网格（用户已填大量内容）
    const t = ensureCells(baseTable({ designRows: 6 }))
    t.cells![0]![0] = { segments: [{ kind: 'text', value: 'H0' }] }
    t.cells![1]![0] = { segments: [{ kind: 'text', value: 'B0' }] }
    t.cells![2]![0] = { segments: [{ kind: 'text', value: 'B1' }] }
    expect(t.cells!.length).toBe(7) // 1 表头 + 6 正文

    // 2) 用户把 designRows 显式设为 0
    const next = setGridRows(t, { designRows: 0 })
    expect(next.designRows).toBe(0)
    expect(next.cells!.length).toBe(1) // 仅保留表头

    // 3) 渲染层 buildDesignGrid 应承认 designRows=0，不再回填空行
    const grid = buildDesignGrid(next)
    expect(grid.designRows).toBe(0)
    expect(grid.rowCount).toBe(grid.headerRows + 0 + grid.staticRows)
    // 用户填的表头内容仍在；正文 6 行全部消失
    expect(grid.cells[0]![0]!.segments).toEqual([{ kind: 'text', value: 'H0' }])
    expect(grid.cells.length).toBe(grid.headerRows)
  })

  it('Bug12 回归保护：designRows 显式为正数时仍按显式值（不走 cells 推断）', () => {
    // cells 已物化为 7 行，但 designRows 显式设为 2 → 应保留 2 正文行（截断第 3-6 行）
    const t = ensureCells(baseTable({ designRows: 6 }))
    const next = setGridRows(t, { designRows: 2 })
    expect(next.designRows).toBe(2)
    const grid = buildDesignGrid(next)
    expect(grid.designRows).toBe(2)
    expect(grid.rowCount).toBe(grid.headerRows + 2 + grid.staticRows)
  })

  it('Bug12 回归保护：designRows 未定义时，cells 行数仍是真理源', () => {
    // 模拟老模板：cells 已物化 5 行（1 表头 + 4 正文），但 designRows 未显式设置
    const t = ensureCells(baseTable({ designRows: 4 }))
    // 显式置 undefined（模拟从来没设过）
    const next: TableControl = { ...t, designRows: undefined as unknown as number }
    const grid = buildDesignGrid(next)
    // 旧行为：cells.length - headerRows = 4
    expect(grid.designRows).toBe(4)
  })

  /* ============= Bug12 修复（canvas 高度同步）：designRows=0 时画布框也要收紧到自然行高 ============= */
  it('Bug12 follow-up：designRows=0 → designRowHeights 返回自然行高而非把整段 control.height 硬塞给表头', () => {
    // 修复前：bodyCount=0 时把整段 60mm 塞给表头 → 画布下方空出 50mm 假正文
    // 修复后：按 naturalRowH（默认 8mm）输出 → syncTableHeight 可把 control.height 收紧到真实占位
    const t = ensureCells(baseTable({ designRows: 6, height: 60 }))
    const next = setGridRows(t, { designRows: 0 })
    const heights = designRowHeights(next)
    expect(heights).toHaveLength(1) // 仅表头
    // 表头按自然行高（8mm）输出，不再等于 control.height 60
    expect(heights[0]).toBeLessThan(60)
    expect(heights[0]).toBeGreaterThan(0)
  })

  it('Bug12 follow-up：syncTableHeight 在 designRows=0 时把 control.height 收紧到自然占位高度', () => {
    // 修复前：control.height 永远 = 原值 → 画布框 = 60mm 但表格只占 8mm，画布/预览位置错位
    // 修复后：control.height 收紧到 = Σ heights，让画布框 = 真实渲染尺寸（WYSIWYG）
    const t = ensureCells(baseTable({ designRows: 6, height: 60 }))
    const next = setGridRows(t, { designRows: 0 })
    expect(next.height).toBe(60) // setGridRows 自身不动 height
    const synced = syncTableHeight(next)
    expect(synced.height).toBeLessThan(60) // 收紧到自然占位
    expect(synced.height).toBeGreaterThan(0)
    expect(synced.designRows).toBe(0) // 关键：designRows 仍是 0，没被改回去
    // 再次 sync 是 no-op（已对齐）
    const synced2 = syncTableHeight(synced)
    expect(synced2).toBe(synced) // 同一引用，避免 reactivity 抖动
  })

  it('Bug12 follow-up：syncTableHeight 在 designRows 保持正数时是 no-op（不破坏用户拖出的高度）', () => {
    // 回归保护：用户拖表格改高度时不能被 syncTableHeight 反向覆盖
    const t = ensureCells(baseTable({ designRows: 6, height: 60 }))
    // 模拟用户拖到 80mm
    const resized: TableControl = { ...t, height: 80 }
    const synced = syncTableHeight(resized)
    // 1 表头 + 6 正文的布局网格，自然行高之和 ≈ control.height（均分）→ no-op
    expect(synced.height).toBe(80)
    expect(synced).toBe(resized)
  })

  it('Bug12 follow-up：syncTableHeight 在 designRows 从 6 改到 0 后画布/预览一致', () => {
    // 端到端：设 0 后画布应只占 ~8mm，与实际渲染 1 行表头一致
    const t = ensureCells(baseTable({ designRows: 6, height: 60 }))
    const after = syncTableHeight(setGridRows(t, { designRows: 0 }))
    // buildDesignGrid 与 designRowHeights 一致 → sum(heights) === control.height
    const heights = designRowHeights(after)
    expect(after.height).toBeCloseTo(heights.reduce((s, h) => s + h, 0), 6)
    // 渲染层也承认只有 1 行
    const grid = buildDesignGrid(after)
    expect(grid.rowCount).toBe(1)
  })
})

describe('designRowHeights —— 画布行高与渲染一致（所见即所得）', () => {
  it('数据表 auto：每行 = 单行文本估算 ≈ 6.69mm（9pt×1.35 + 上下 padding 各 1.2mm）', () => {
    const rows = designRowHeights(baseTable({ dataSource: 'items', staticRows: 2, height: 999 }))
    const grid = buildDesignGrid(baseTable({ dataSource: 'items', staticRows: 2 }))
    expect(rows.length).toBe(grid.rowCount) // 表头 + 数据样例 + 2 静态
    const expected = (9 * (25.4 / 72)) * 1.35 + 2 * 1.2
    for (const h of rows) {
      expect(h).toBeCloseTo(expected, 3)
    }
    expect(expected).toBeCloseTo(6.686, 2) // 远小于旧算法的 12mm，与渲染端单行一致
  })

  it('数据表 fixed：每行 = 指定行高', () => {
    const rows = designRowHeights(
      baseTable({ dataSource: 'items', staticRows: 1, options: { rowHeightMode: 'fixed', rowHeight: 10 } }),
    )
    expect(rows.every((h) => h === 10)).toBe(true)
  })

  it('数据表 fixed：缺省回退 8mm，且不低于 6mm 下限（与渲染端 MIN_ROW_HEIGHT 一致）', () => {
    const rows = designRowHeights(baseTable({ dataSource: 'items', options: { rowHeightMode: 'fixed' } }))
    expect(rows.every((h) => h === 8)).toBe(true)
  })

  it('布局网格：各行高度之和恰等于控件高度（画布 = 打印）', () => {
    const t = baseTable({ designRows: 3, height: 50 })
    const rows = designRowHeights(t, t.height)
    const sum = rows.reduce((s, h) => s + h, 0)
    expect(sum).toBeCloseTo(50, 6)
  })

  it('syncDataTableHeight：数据表控件高度 = 所有行高之和', () => {
    const t = baseTable({ dataSource: 'items', staticRows: 2, height: 999 })
    const synced = syncDataTableHeight(t)
    const rows = designRowHeights(t)
    expect(synced.height).toBeCloseTo(rows.reduce((s, h) => s + h, 0), 6)
    expect(synced.height).toBeLessThan(50) // 不再虚高
  })

  it('syncDataTableHeight：行数变化后高度跟随（增静态尾行）', () => {
    const before = syncDataTableHeight(baseTable({ dataSource: 'items', staticRows: 0, height: 999 }))
    const after = syncDataTableHeight(
      setGridRows(ensureCells(baseTable({ dataSource: 'items', staticRows: 0 })), { staticRows: 3 }),
    )
    expect(after.height).toBeGreaterThan(before.height)
  })
})

describe('seedSummaryTail —— 默认尾行居中', () => {
  it('植入的本页合计 / 总计 / 大写金额 尾行（有文本的单元格）全部居中对齐', () => {
    const t = baseTable({ dataSource: 'items', staticRows: 0 })
    const seeded = seedSummaryTail(t, { numericColumns: [1, 2], moneyColumn: 2, capital: true })
    const grid = buildDesignGrid(seeded)
    const tail = grid.cells.slice(grid.headerRows + 1) // 跳过表头 + 数据样例行
    expect(tail.length).toBe(3) // 本页合计 + 总计 + 大写金额
    for (const row of tail) {
      for (const cell of row) {
        if (cell.text) expect(cell.style?.align).toBe('center')
      }
    }
  })
})

describe('computeSpanLayout 合并布局', () => {
  // 构造 cells 矩阵的便捷函数：rows 是「每行每列的对象字面量」二维数组
  const mk = (rows: Array<Array<Partial<{ colSpan: number; rowSpan: number }>>>): TableCell[][] =>
    rows.map((r) => r.map((c) => ({ ...c })))

  it('无合并：全部 skip=false、跨度=1', () => {
    const cells = mk([
      [{}, {}],
      [{}, {}],
    ])
    const layout = computeSpanLayout(cells, 2, 2)
    expect(layout.every((r) => r.every((s) => !s.skip && s.colSpan === 1 && s.rowSpan === 1))).toBe(true)
  })

  it('横向合并：锚点 colSpan=2，右侧被吞', () => {
    const cells = mk([
      [{ colSpan: 2 }, {}],
      [{}, {}],
    ])
    const layout = computeSpanLayout(cells, 2, 2)
    expect(layout[0]![0]!.colSpan).toBe(2)
    expect(layout[0]![0]!.skip).toBe(false)
    expect(layout[0]![1]!.skip).toBe(true) // 被横向吞掉
    expect(layout[1]![1]!.skip).toBe(false) // 下一行不受同行跨列影响
  })

  it('纵向合并：锚点 rowSpan=2，下方同列被吞', () => {
    const cells = mk([
      [{ rowSpan: 2 }, {}],
      [{}, {}],
    ])
    const layout = computeSpanLayout(cells, 2, 2)
    expect(layout[0]![0]!.rowSpan).toBe(2)
    expect(layout[1]![0]!.skip).toBe(true) // 被纵向吞掉
    expect(layout[0]![1]!.skip).toBe(false)
    expect(layout[1]![1]!.skip).toBe(false)
  })

  it('跨列 + 跨行组合：2×2 块，其余三格均被吞', () => {
    const cells = mk([
      [{ colSpan: 2, rowSpan: 2 }, {}],
      [{}, {}],
    ])
    const layout = computeSpanLayout(cells, 2, 2)
    expect(layout[0]![0]!.colSpan).toBe(2)
    expect(layout[0]![0]!.rowSpan).toBe(2)
    expect(layout[0]![1]!.skip).toBe(true)
    expect(layout[1]![0]!.skip).toBe(true)
    expect(layout[1]![1]!.skip).toBe(true)
  })

  it('越界收敛：rowSpan 超出网格底边被截断', () => {
    const cells = mk([
      [{ rowSpan: 9 }, {}],
      [{}, {}],
    ])
    const layout = computeSpanLayout(cells, 2, 2)
    expect(layout[0]![0]!.rowSpan).toBe(2) // 只剩 2 行，截断为 2
    expect(layout[1]![0]!.skip).toBe(true)
  })
})

describe('setCellRowSpan 纵向合并', () => {
  it('rowSpan=2：本格写 rowSpan，下方同列清空', () => {
    const t = ensureCells(baseTable({ designRows: 3 }))
    const next = setCellRowSpan(t, 0, 0, 2)
    expect(next.cells![0]![0]!.rowSpan).toBe(2)
    expect(next.cells![1]![0]!.text).toBeUndefined()
    expect(next.cells![1]![0]!.field).toBeUndefined()
    expect(next.cells![2]![0]!.rowSpan).toBeUndefined() // 只吞 2 行
  })

  it('rowSpan=1：清除合并', () => {
    const t = ensureCells(baseTable({ designRows: 3 }))
    const merged = setCellRowSpan(t, 0, 0, 2)
    const cleared = setCellRowSpan(merged, 0, 0, 1)
    expect(cleared.cells![0]![0]!.rowSpan).toBeUndefined()
  })

  it('越界 rowSpan 收敛到网格底边', () => {
    const t = ensureCells(baseTable({ designRows: 2 })) // 共 1 表头 + 2 正文 = 3 行
    const next = setCellRowSpan(t, 0, 0, 99)
    expect(next.cells![0]![0]!.rowSpan).toBe(3) // 从第 0 行到底边共 3 行
    expect(next.cells![2]![0]!.rowSpan).toBeUndefined()
  })
})

describe('ensureColumnIds —— 老模板兼容（M3 P0-1）', () => {
  it('列无 id 时一次性补齐', () => {
    const t = baseTable({ columns: [{ title: 'A', width: 10 }, { title: 'B', width: 20 }] })
    const next = ensureColumnIds(t)
    expect(next.columns![0]!.id).toMatch(/^col_/)
    expect(next.columns![1]!.id).toMatch(/^col_/)
    expect(next.columns![0]!.id).not.toBe(next.columns![1]!.id)
  })

  it('列已有 id 时不动（保证幂等）', () => {
    const t = baseTable({ columns: [{ id: 'cust', title: 'A', width: 10 }, { id: 'amt', title: 'B', width: 20 }] })
    const next = ensureColumnIds(t)
    expect(next.columns![0]!.id).toBe('cust')
    expect(next.columns![1]!.id).toBe('amt')
  })

  it('vMerge.columns 命中不存在的 id 时静默剔除（脏配置清理）', () => {
    const t = baseTable({ columns: [{ id: 'cust', title: 'A', width: 10 }] })
    t.options = { ...t.options, vMerge: { columns: ['cust', 'ghost_id'] } }
    const next = ensureColumnIds(t)
    expect(next.options?.vMerge?.columns).toEqual(['cust'])
  })
})
