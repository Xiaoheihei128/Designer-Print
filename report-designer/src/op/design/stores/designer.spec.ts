/**
 * designer store 单测：M1 P0-3 待绑态 / 字段绑定写入链路
 *
 * 覆盖：
 * - setPendingBind / closePendingBind 维护 pendingBindCell
 * - openCellEditor 与 pendingBindCell 互斥
 * - bindFieldToCell 写入链路（contentType/variable + field + 清 text/expression）并退出待绑态
 * - bindFieldToCell 越界 / 非表格控件 不写
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDesignerStore } from './designer'
import type { TableControl, TableCell } from '@op/types/control'

function makeTable(over: Partial<TableControl> = {}): TableControl {
  return {
    id: 'tbl-1',
    type: 'table',
    left: 0,
    top: 0,
    width: 180,
    height: 60,
    columns: [
      { title: '名称', field: 'name', width: 80 },
      { title: '数量', field: 'qty', width: 40 },
    ],
    options: { borders: 'all', verticalAlign: 'middle' },
    headerRows: 1,
    designRows: 2,
    staticRows: 0,
    cells: [
      [
        { text: '名称', contentType: 'fixed', style: { bold: true } },
        { text: '数量', contentType: 'fixed', style: { bold: true } },
      ],
      [
        { text: '默认', contentType: 'fixed' },
        { text: '1', contentType: 'fixed' },
      ],
    ],
    ...over,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('pendingBindCell 维护', () => {
  it('setPendingBind 写入并覆盖 editingCell（互斥）', () => {
    const store = useDesignerStore()
    store.openCellEditor('tbl-1', 0, 0)
    expect(store.editingCell).toEqual({ controlId: 'tbl-1', row: 0, col: 0 })
    store.setPendingBind('tbl-1', 1, 1)
    expect(store.pendingBindCell).toEqual({ controlId: 'tbl-1', row: 1, col: 1 })
    // setPendingBind 进入待绑态 → editingCell 应清空
    expect(store.editingCell).toBeNull()
  })

  it('openCellEditor 进入编辑态会清空 pendingBindCell（互斥）', () => {
    const store = useDesignerStore()
    store.setPendingBind('tbl-1', 0, 0)
    expect(store.pendingBindCell).not.toBeNull()
    store.openCellEditor('tbl-1', 0, 0)
    expect(store.pendingBindCell).toBeNull()
    expect(store.editingCell).toEqual({ controlId: 'tbl-1', row: 0, col: 0 })
  })

  it('closePendingBind 清空待绑态', () => {
    const store = useDesignerStore()
    store.setPendingBind('tbl-1', 0, 0)
    store.closePendingBind()
    expect(store.pendingBindCell).toBeNull()
  })
})

describe('bindFieldToCell 写入链路', () => {
  it('字段路径写入指定单元格：segments 单 field 段 + 清老字段', () => {
    const store = useDesignerStore()
    store.controls.push(makeTable())
    store.bindFieldToCell('tbl-1', 1, 1, 'items[].qty')
    const tbl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const cell = tbl.cells![1]![1] as TableCell
    // Plan B 步骤 2/5：bindFieldToCell 单源 segments；老字段（field/expression/text）被清
    expect(cell.segments).toEqual([{ kind: 'field', path: 'items[].qty' }])
    expect(cell.field).toBeUndefined()
    expect(cell.text).toBeUndefined()
    expect(cell.expression).toBeUndefined()
    // 绑完即退出待绑态
    expect(store.pendingBindCell).toBeNull()
  })

  it('cells 含旧 expression 时也清空，不残留', () => {
    const store = useDesignerStore()
    const table = makeTable({
      cells: [
        [
          { text: '名称', contentType: 'fixed', style: { bold: true } },
          { text: '数量', contentType: 'fixed', style: { bold: true } },
        ],
        [
          { text: '默认', contentType: 'fixed' },
          { contentType: 'expression', expression: '{{row.qty * 2}}' },
        ],
      ],
    })
    store.controls.push(table)
    store.bindFieldToCell('tbl-1', 1, 1, 'items[].qty')
    const tbl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const cell = tbl.cells![1]![1] as TableCell
    // 旧 expression / contentType 全部清空；segments 是唯一新源
    expect(cell.segments).toEqual([{ kind: 'field', path: 'items[].qty' }])
    expect(cell.expression).toBeUndefined()
  })

  it('行/列越界时不写、不抛', () => {
    const store = useDesignerStore()
    store.controls.push(makeTable())
    // 行 5 不存在（cells 只有 2 行）
    store.bindFieldToCell('tbl-1', 5, 0, 'items[].qty')
    const tbl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const cell = tbl.cells![1]![0] as TableCell
    // 原内容不动
    expect(cell.text).toBe('默认')
    expect(cell.field).toBeUndefined()
  })

  it('非表格控件 / 不存在控件：不写', () => {
    const store = useDesignerStore()
    store.controls.push({ id: 'txt-1', type: 'text', left: 0, top: 0, width: 50, height: 10, text: 'x' })
    store.bindFieldToCell('txt-1', 0, 0, 'items[].qty')
    // 不抛、控件内容不变
    expect((store.controls[0] as { text?: string }).text).toBe('x')
    store.bindFieldToCell('nope', 0, 0, 'items[].qty')
    // 不存在控件 → 无副作用
    expect(store.controls.length).toBe(1)
  })
})