import { describe, expect, it } from 'vitest'

import { computeVMergeSpans } from './vmerge'
import type { RenderRow } from './types'
import type { TableColumn } from '@op/types/control'
import type { RowPlan } from './group-engine'

/** 构造一组最小可用的 columns（含 id） */
function cols(spec: Array<{ id: string; title: string; width?: number }>): TableColumn[] {
  return spec.map((c) => ({ id: c.id, title: c.title, width: c.width ?? 10 }))
}

/** 构造一组最小可用的 plans + 已构建好的 rows（cell.text 即取值） */
function dataRows(values: Array<Record<string, string>>): {
  plans: RowPlan[]
  rows: RenderRow[]
} {
  const plans: RowPlan[] = values.map((_, i) => ({
    kind: 'data',
    dataIndex: i,
    row: values[i],
  }))
  const rows: RenderRow[] = values.map(() => ({
    kind: 'data',
    height: 8,
    cells: [],
  }))
  return { plans, rows }
}

/**
 * 把 values 按 columns 顺序映射到 cells。
 * 每个 cell 的 text = values[rowIndex][columnId]
 */
function fillRowCells(
  rows: RenderRow[],
  values: Array<Record<string, string>>,
  columns: TableColumn[],
): void {
  for (let r = 0; r < rows.length; r++) {
    rows[r].cells = columns.map((c) => ({ text: values[r][c.id] ?? '', align: 'left' }))
  }
}

describe('computeVMergeSpans —— M3 P0-1 同字段纵向合并', () => {
  it('1) 单列 vMerge：3 行同值 → 锚点 rowSpan=3，被吞 2 行进入 consumed', () => {
    const columns = cols([
      { id: 'a', title: '客户' },
      { id: 'b', title: '金额' },
    ])
    const { plans, rows } = dataRows([
      { a: '阿里', b: '100' },
      { a: '阿里', b: '200' },
      { a: '阿里', b: '300' },
    ])
    fillRowCells(rows, [{ a: '阿里', b: '100' }, { a: '阿里', b: '200' }, { a: '阿里', b: '300' }], columns)

    const out = computeVMergeSpans({ plans, rows, columns, options: { columns: ['a'] } })

    expect(out.spans[0]?.[0]).toBe(3) // 锚点 span=3
    expect(out.spans[1]?.[0]).toBeUndefined() // 被吞行不写
    expect(out.spans[2]?.[0]).toBeUndefined()
    // 金额列未启用 vMerge
    expect(out.spans[0]?.[1]).toBeUndefined()
    // consumed 含 1, 2（不含锚点 0）
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.has(2)).toBe(true)
    expect(out.consumed.size).toBe(2)
  })

  it('2) 值变化处断开：A/A/B/A → A span=2、B span=1、A span=1', () => {
    const columns = cols([{ id: 'a', title: '客户' }])
    const { plans, rows } = dataRows([
      { a: 'A' },
      { a: 'A' },
      { a: 'B' },
      { a: 'A' },
    ])
    fillRowCells(rows, [{ a: 'A' }, { a: 'A' }, { a: 'B' }, { a: 'A' }], columns)

    const out = computeVMergeSpans({ plans, rows, columns, options: { columns: ['a'] } })

    expect(out.spans[0]?.[0]).toBe(2) // 0-1 同值
    expect(out.spans[1]?.[0]).toBeUndefined() // 被吞
    expect(out.spans[2]?.[0]).toBe(1) // B 单独
    expect(out.spans[3]?.[0]).toBe(1) // A 单独
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.has(2)).toBe(false)
    expect(out.consumed.has(3)).toBe(false)
    expect(out.consumed.size).toBe(1)
  })

  it('3) 多列 vMerge：客户 + 订单号 都相同时一起合并', () => {
    const columns = cols([
      { id: 'cust', title: '客户' },
      { id: 'order', title: '订单号' },
      { id: 'amt', title: '金额' },
    ])
    const vals: Array<Record<string, string>> = [
      { cust: '阿里', order: '001', amt: '10' },
      { cust: '阿里', order: '001', amt: '20' },
      { cust: '阿里', order: '002', amt: '30' }, // 订单号变 → 只 cust 合并到 1 终止
      { cust: '阿里', order: '002', amt: '40' }, // 客户 + 订单号都同 → 都合并
    ]
    const { plans, rows } = dataRows(vals)
    fillRowCells(rows, vals, columns)

    const out = computeVMergeSpans({
      plans,
      rows,
      columns,
      options: { columns: ['cust', 'order'] },
    })

    // cust 列：第 0 行 span=2（第 0-1），第 2 行 span=2（第 2-3）
    expect(out.spans[0]?.[0]).toBe(2)
    expect(out.spans[2]?.[0]).toBe(2)
    expect(out.spans[1]?.[0]).toBeUndefined()
    expect(out.spans[3]?.[0]).toBeUndefined()
    // order 列：第 0 行 span=2（第 0-1），第 2 行 span=2（第 2-3）
    expect(out.spans[0]?.[1]).toBe(2)
    expect(out.spans[2]?.[1]).toBe(2)
    // amt 列未启用 → 全 undefined
    expect(out.spans[0]?.[2]).toBeUndefined()
    // 被吞：1, 3（=中间两行）
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.has(3)).toBe(true)
    expect(out.consumed.has(0)).toBe(false)
    expect(out.consumed.has(2)).toBe(false)
  })

  it('4) breakOnGroup=true：组头边界强制断开 vMerge', () => {
    const columns = cols([{ id: 'a', title: '客户' }])
    // plans: [data(A), data(A), group, data(A), data(A)]
    const plans: RowPlan[] = [
      { kind: 'data', dataIndex: 0 },
      { kind: 'data', dataIndex: 1 },
      { kind: 'group', label: '组B' },
      { kind: 'data', dataIndex: 3 },
      { kind: 'data', dataIndex: 4 },
    ]
    const rows: RenderRow[] = [
      { kind: 'data', height: 8, cells: [{ text: 'A', align: 'left' }] },
      { kind: 'data', height: 8, cells: [{ text: 'A', align: 'left' }] },
      { kind: 'group', height: 8, cells: [{ text: '组B', align: 'left', colSpan: 1 }] },
      { kind: 'data', height: 8, cells: [{ text: 'A', align: 'left' }] },
      { kind: 'data', height: 8, cells: [{ text: 'A', align: 'left' }] },
    ]

    const out = computeVMergeSpans({ plans, rows, columns, options: { columns: ['a'] } })

    // 第一段 data(A) data(A) → span=2
    expect(out.spans[0]?.[0]).toBe(2)
    // group 行（kind!=data）flush 上一段 run
    expect(out.spans[2]).toEqual([])
    // 第二段 data(A) data(A) → span=2
    expect(out.spans[3]?.[0]).toBe(2)
    // consumed = {1, 4}
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.has(4)).toBe(true)
    expect(out.consumed.size).toBe(2)
  })

  it('5) 小计 / 合计行也作为边界（breakOnGroup 默认 true）', () => {
    const columns = cols([{ id: 'a', title: '客户' }])
    const plans: RowPlan[] = [
      { kind: 'data', dataIndex: 0 },
      { kind: 'data', dataIndex: 1 },
      { kind: 'subtotal', label: '小计' },
      { kind: 'data', dataIndex: 3 },
    ]
    const rows: RenderRow[] = [
      { kind: 'data', height: 8, cells: [{ text: 'X', align: 'left' }] },
      { kind: 'data', height: 8, cells: [{ text: 'X', align: 'left' }] },
      { kind: 'subtotal', height: 8, cells: [{ text: '小计', align: 'left' }] },
      { kind: 'data', height: 8, cells: [{ text: 'X', align: 'left' }] },
    ]

    const out = computeVMergeSpans({ plans, rows, columns, options: { columns: ['a'] } })

    // 0-1 合并 span=2；subtotal flush；最后一 data 单独
    expect(out.spans[0]?.[0]).toBe(2)
    expect(out.spans[3]?.[0]).toBe(1)
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.has(3)).toBe(false)
  })

  it('6) 列下标变化（id 稳定）：移除中间列后 vMerge.columns 仍指向正确列', () => {
    // 移除前下标：[id1, id2, id3]，vMerge 配 id2；
    // 移除 id1 后下标变 [id2, id3]，但 vMerge 仍配 id2 → 命中新的 0 下标
    const columnsAfterRemove = cols([
      { id: 'id2', title: '客户' },
      { id: 'id3', title: '金额' },
    ])
    const vals = [
      { id2: '阿里', id3: '100' },
      { id2: '阿里', id3: '200' },
    ]
    const { plans, rows } = dataRows(vals)
    fillRowCells(rows, vals, columnsAfterRemove)

    const out = computeVMergeSpans({ plans, rows, columns: columnsAfterRemove, options: { columns: ['id2'] } })

    // id2 在新下标是 0，合并 span=2
    expect(out.spans[0]?.[0]).toBe(2)
    expect(out.spans[0]?.[1]).toBeUndefined()
    expect(out.consumed.has(1)).toBe(true)
  })

  it('7) 边界 cases：单行 data / 列下标错配 / columns 为空数组', () => {
    const columns = cols([
      { id: 'a', title: '客户' },
      { id: 'b', title: '金额' },
    ])
    // 7a) 单行 data
    const single = dataRows([{ a: 'A', b: '1' }])
    fillRowCells(single.rows, [{ a: 'A', b: '1' }], columns)
    const r7a = computeVMergeSpans({ ...single, columns, options: { columns: ['a'] } })
    expect(r7a.spans[0]?.[0]).toBe(1) // 单行不合并（count=1 → 不写入）
    expect(r7a.consumed.size).toBe(0)

    // 7b) 列 id 在 options 里但 columns 里不存在 → 静默忽略
    const { plans, rows } = dataRows([{ a: 'A', b: '1' }, { a: 'A', b: '2' }])
    fillRowCells(rows, [{ a: 'A', b: '1' }, { a: 'A', b: '2' }], columns)
    const r7b = computeVMergeSpans({
      plans,
      rows,
      columns,
      options: { columns: ['nonexistent'] },
    })
    expect(r7b.spans).toEqual([[], []])
    expect(r7b.consumed.size).toBe(0)

    // 7c) options.columns 空 → 任何列都不合并
    const r7c = computeVMergeSpans({ plans, rows, columns, options: { columns: [] } })
    expect(r7c.spans).toEqual([[], []])
    expect(r7c.consumed.size).toBe(0)
  })

  it('8) 非 data 行作 boundary 后，原 run 正确结算（flushAll 时机正确）', () => {
    const columns = cols([{ id: 'a', title: '客户' }])
    // 末段是 group 行 → 末段 data(A) data(A) 应仍能合并 span=2
    const plans: RowPlan[] = [
      { kind: 'data', dataIndex: 0 },
      { kind: 'data', dataIndex: 1 },
      { kind: 'group', label: '组尾' },
    ]
    const rows: RenderRow[] = [
      { kind: 'data', height: 8, cells: [{ text: 'Z', align: 'left' }] },
      { kind: 'data', height: 8, cells: [{ text: 'Z', align: 'left' }] },
      { kind: 'group', height: 8, cells: [{ text: '组尾', align: 'left' }] },
    ]

    const out = computeVMergeSpans({ plans, rows, columns, options: { columns: ['a'] } })

    expect(out.spans[0]?.[0]).toBe(2)
    expect(out.spans[2]).toEqual([])
    expect(out.consumed.has(1)).toBe(true)
    expect(out.consumed.size).toBe(1)
  })
})