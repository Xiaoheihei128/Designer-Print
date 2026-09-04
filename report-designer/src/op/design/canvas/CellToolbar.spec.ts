/**
 * CellToolbar effectiveCell —— 反向同步单元测试
 *
 * 单元测试 CellToolbar 内部的核心派生逻辑（effectiveCell = rebuildSegmentsFromCell(cell)）。
 * 不挂载 .vue 组件（项目无 jsdom 配置），而是直接复刻 CellToolbar.vue:108 的派生链：
 *   control → buildDesignGrid → grid.cells[row][col] → rebuildSegmentsFromCell
 *
 * 这样验证：
 *   1. 老 schema cell（无 segments）打开 CellToolbar 时，effectiveCell 立即有 segments
 *   2. 用户在画布上改文本后，cell.text 变 → effectiveCell 跟着重新派生
 *   3. segments 已是 cell 字段的精确表达 → 幂等返回（不触发 migrate emit）
 *   4. 聚合 token 守门：cell.text 是 {{#xxx}} 时 segments 不动
 *
 * 端到端链路（画布编辑 → emit migrate → store 更新 → ContentValueEditor 重渲染）
 * 见 ./reverse-sync.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import type { TableCell, TableControl } from '@op/types/control'
import { buildDesignGrid } from '@op/core/layout-engine/table-cells'
import { rebuildSegmentsFromCell } from '@op/design/segments-migration'

/** 复刻 CellToolbar.vue:91-108 的核心派生：
 *    grid = buildDesignGrid(control)
 *    cell = grid.cells[row][col] ?? {}
 *    effectiveCell = rebuildSegmentsFromCell(cell)
 *
 * 这是 CellToolbar 内部传给 ContentValueEditor 的「权威 cell 视图」——
 * ContentValueEditor 拿到的 segments prop 就是 effectiveCell.segments。 */
function deriveEffectiveCell(control: TableControl, row: number, col: number): TableCell {
  const grid = buildDesignGrid(control)
  const cell: TableCell = grid.cells[row]?.[col] ?? {}
  return rebuildSegmentsFromCell(cell)
}

const baseTable = (cells: TableCell[][]): TableControl => ({
  id: 'tbl-1',
  type: 'table',
  left: 0, top: 0, width: 180, height: 60,
  columns: [
    { title: '订单号', field: 'order.orderNo' },
    { title: '金额',   field: 'order.total' },
  ],
  options: { borders: 'all', verticalAlign: 'middle', headerRows: 1, staticRows: 0, designRows: 2 },
  headerRows: 1, designRows: 2, staticRows: 0,
  cells,
})

describe('CellToolbar effectiveCell —— 反向同步核心链路', () => {
  it('★ 老 schema cell（只有 field）→ effectiveCell 立即产出 field 段（避免 textarea 空白）', () => {
    const control = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [{ field: 'order.orderNo' }, { field: 'order.total' }],
    ])
    const eff = deriveEffectiveCell(control, 1, 0)
    expect(eff.segments).toEqual([{ kind: 'field', path: 'order.orderNo' }])
  })

  it('★ 已是 v2 segments → 幂等（不触发 migrate emit）', () => {
    const control = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [{ segments: [{ kind: 'field', path: 'order.total' }] }, { field: 'order.total' }],
    ])
    // 模拟 CellToolbar.vue:285-286 内部判定：
    //   const rebuilt = rebuildSegmentsFromCell(c)
    //   if (rebuilt === c) return // 幂等
    // 即"派生前后 cell 引用相等"，watch(migrate) 不 emit。
    // 由于 buildDesignGrid 已对 cell 做浅拷贝，本测试直接验证 segments 一致性即可。
    const eff = deriveEffectiveCell(control, 1, 0)
    expect(eff.segments).toEqual([{ kind: 'field', path: 'order.total' }])
    // 派生后未引入老字段
    expect(eff.text).toBeUndefined()
    expect(eff.field).toBeUndefined()
  })

  it('★ 反向同步：cell.text 漂移 → 重建 segments 为新 text 段 + 清 text', () => {
    // 用户在画布 contentEditable 把 'old' 改成 'new'：
    //   patchCellText 写了 cell.text='new'，但 segments 还是 [{text:'old'}]
    const cell: TableCell = {
      text: 'new',
      segments: [{ kind: 'text', value: 'old' }],
    }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'text', value: 'new' }])
    expect(eff.text).toBeUndefined()
  })

  it('★ 反向同步：cell.field 漂移 → 重建为新 field 段', () => {
    // 用户从画布上把字段从 a 改到 b，segments 尚未更新
    const cell: TableCell = { field: 'b', segments: [{ kind: 'field', path: 'a' }] }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'field', path: 'b' }])
    expect(eff.field).toBeUndefined()
  })

  it('★ 聚合 token {{#pageSum}} 守门：cell.text 是 token 时永远不动', () => {
    const cell: TableCell = { text: '{{#pageSum}}' }
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
  })

  it('★ 反向同步：混合内容 cell.text="{{x}} kg" + 漂移 → 重建为 [expr, text]', () => {
    const cell: TableCell = { text: '{{x}} kg', segments: [{ kind: 'text', value: 'old' }] }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([
      { kind: 'expr', src: 'x' },
      { kind: 'text', value: ' kg' },
    ])
    expect(eff.text).toBeUndefined()
  })

  it('★ segments=[] 视为「已退出 segments 模式」：不再派生幽灵 segments', () => {
    // 用户清空 textarea 后 cell.segments=[]，此时不应再走 segments 模式
    const cell: TableCell = { segments: [] }
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
  })

  it('★ 内容类型仅 cell.text → 老 schema lazy migration 一致', () => {
    // 与 ensureSegments 同款行为：cell.text='hello' + segments undefined → 派生单 text 段
    const cell: TableCell = { text: 'hello' }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'text', value: 'hello' }])
    expect(eff.text).toBeUndefined()
  })

  it('★ 内容类型仅 cell.field → 老 schema lazy migration 一致', () => {
    const cell: TableCell = { field: 'items[].name' }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'field', path: 'items[].name' }])
    expect(eff.field).toBeUndefined()
  })

  it('★ 内容类型仅 cell.expression → 老 schema lazy migration 一致', () => {
    const cell: TableCell = { expression: 'rowIndex + 1' }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'expr', src: 'rowIndex + 1' }])
    expect(eff.expression).toBeUndefined()
  })

  it('★ contentType 只是 UI 状态：cell.field 是新路径 + contentType=variable + 老 segments 漂移 → 重建为新 field 段', () => {
    const cell: TableCell = {
      contentType: 'variable',
      field: 'newPath',
      segments: [{ kind: 'field', path: 'oldPath' }],
    }
    const eff = rebuildSegmentsFromCell(cell)
    expect(eff.segments).toEqual([{ kind: 'field', path: 'newPath' }])
    expect(eff.field).toBeUndefined()
    // contentType 不被改写（仍是 UI 状态）
    expect(eff.contentType).toBe('variable')
  })
})

describe('CellToolbar 派生链路集成 —— control 改动 → effectiveCell 跟改', () => {
  it('★ control.cells[row][col] 内容更新后，deriveEffectiveCell 立即反映新值（无需等 watch）', () => {
    // 模拟 CellToolbar.vue:91-108 的整个派生链：control 引用变 → grid 重算 → cell 重算 → effectiveCell 重算
    let control = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [{ segments: [{ kind: 'text', value: 'old' }] }, { segments: [{ kind: 'text', value: 'amount' }] }],
    ])
    // 1. 初始派生：segments 与 cell 字段一致（cell 无 text/field）→ 幂等
    let eff = deriveEffectiveCell(control, 1, 0)
    expect(eff.segments).toEqual([{ kind: 'text', value: 'old' }])

    // 2. 模拟「用户在画布上改文本为 new」：control.cells[1][0].text = 'new'
    //    这正是 patchCellText 写回的副作用：cell.text 已变，但 segments 还是 old
    const newCells = control.cells.map((row, ri) =>
      ri === 1 ? row.map((c, ci) => (ci === 0 ? { ...c, text: 'new' } : c)) : row,
    ) as TableCell[][]
    control = { ...control, cells: newCells }

    // 3. 派生链立即反映漂移
    eff = deriveEffectiveCell(control, 1, 0)
    expect(eff.segments).toEqual([{ kind: 'text', value: 'new' }])
    expect(eff.text).toBeUndefined()
  })
})