/**
 * Bug9 复现：右键 CellToolbar 改字段 → 画布 cell.field 仍显示旧值
 *
 * 假设：renderTableGridHtml 本身正确（基于 model 重新生成 HTML）。
 * 真正问题在 TableViewLayer 的 frozenHtml 缓存逻辑：
 *   当 CellToolbar 打开（editingId 激活），items 用 frozenHtml 显示，
 *   onToolbarApply 走 updateControl + refreshFrozen，后者更新 frozenHtml
 *   → 但 Vue 调度顺序里有竞态可能让 items 用到旧 frozenHtml。
 *
 * 这个测试验证 renderTableGridHtml 行为正确，把 frozenHtml 问题留给 UI 修复。
 */
import { describe, expect, it } from 'vitest'
import type { TableControl } from '@op/types/control'
import { renderTableGridHtml } from '@op/design/canvas/table-design-render'

const baseTable: TableControl = {
  id: 'tbl-test',
  type: 'table',
  x: 0, y: 0, width: 100, height: 30,
  dataSource: 'orders',
  options: { headerRows: 1, staticRows: 1, designRows: 2 },
  columns: [
    { id: 'c1', title: '订单号', field: 'order.orderNo' },
    { id: 'c2', title: '金额',   field: 'order.total' },
  ],
  cells: [
    // header
    [{ text: '订单号' }, { text: '金额' }],
    // data template (designRow)
    [{ field: 'order.orderNo' }, { field: 'order.total' }],
    // static row
    [{ text: '合计' }, { text: '{{#totalSum}}' }],
  ],
}

describe('Bug9 复现：renderTableGridHtml 在 cell.field 变更后输出新字段占位符', () => {
  it('初始：cell.field=order.orderNo → HTML 包含 {{order.orderNo}}', () => {
    const html = renderTableGridHtml(baseTable)
    // Plan B 步骤 3/5：placeholder 走 segments 单源 → {{order.orderNo}}（去掉老模板 item. 前缀）
    expect(html).toContain('{{order.orderNo}}')
    expect(html).toContain('{{order.total}}')
  })

  it('Bug9 假设：cell.field 改为 order.total → HTML 应包含 {{order.total}}', () => {
    const updated: TableControl = {
      ...baseTable,
      cells: baseTable.cells.map((row, ri) =>
        ri === 1
          ? row.map((cell) => ({ ...cell, field: 'order.total' }))
          : row,
      ) as TableControl['cells'],
    }
    const html = renderTableGridHtml(updated)
    expect(html).toContain('{{order.total}}')
    // 数据样例行第 1 列原本是 order.orderNo，改后应该不再出现
    expect(html).not.toContain('{{order.orderNo}}')
  })
})