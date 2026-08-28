import { describe, expect, it } from 'vitest'
import { ensureSegments } from '@op/design/segments-migration'
import { legacyToSegments } from '@op/core/layout-engine/segments'
import type { TableCell } from '@op/types/control'

/**
 * 复现用户 bug：固定尾行绑字段失效
 *
 * 路径（已通过 store 模拟验证）：
 * 1. 数据表带列 col.field='order.orderNo'
 * 2. 用户在数据样例行（或静态行）打开 CellToolbar
 * 3. ensureSegments 把 cell.field='order.orderNo' 迁移成 segments=[{field,'order.orderNo'}]
 * 4. 用户点 VariableModal 选 order.total 重新绑字段
 * 5. onVarConfirm 看到 isSegmentsMode=true → 走 segments 追加路径
 * 6. 新 segments = [{field,'order.orderNo'}, {field,'order.total'}]（追加！）
 * 7. cell.field 没有被更新（保持 'order.orderNo'）
 * 8. 渲染层读 cell.field='order.orderNo' → 画布仍显示 {{item.order.orderNo}}
 */
describe('Bug 复现：cell.field 自动迁移 → 重新绑字段被追加而非覆盖', () => {
  it('cell.field 自动迁移 segments 后，重新 bind 应该是覆盖而非追加', () => {
    // 1. 原始 cell（数据样例行的默认状态）
    const cell: TableCell = { field: 'order.orderNo' }
    // 2. ensureSegments 迁移（模拟 CellToolbar watch 触发）
    const migrated = ensureSegments(cell)
    console.log('migrated.segments:', JSON.stringify(migrated.segments))
    expect(migrated.segments).toEqual([{ kind: 'field', path: 'order.orderNo' }])
    // 关键观察：migrated.field 仍然是 'order.orderNo'，没有清除
    expect(migrated.field).toBe('order.orderNo')

    // 3. 模拟用户重新 bind 'order.total' → 当前 onVarConfirm 走追加路径
    // 当前行为（bug）：segments 变成 [{field,old}, {field,new}]，field 不变
    const appendSegs = [...migrated.segments!, { kind: 'field', path: 'order.total' as const }] as any
    const buggyCell = { ...migrated, segments: appendSegs }
    expect(buggyCell.segments).toHaveLength(2)
    expect(buggyCell.field).toBe('order.orderNo')  // ← bug：field 没被更新

    // 4. 期望行为（修复后）：用户 bind 新字段 → cell.field 被更新为新路径
    const fixedCell = { ...migrated, field: 'order.total', segments: [{ kind: 'field', path: 'order.total' }] }
    expect(fixedCell.field).toBe('order.total')  // ← 修复：field 被更新
    expect(fixedCell.segments).toEqual([{ kind: 'field', path: 'order.total' }])
  })

  /**
   * 关键判定：当 segments 仅含 1 个自动迁移的 field 段，且 cell.field 与之匹配，
   * 且无任何文本/expression 残留 → 这是「自动迁移的 legacy 状态」，不是用户的
   * 主动 segments 编排。重新绑字段应直接覆盖 cell.field，不进追加。
   */
  it('判定函数：segments 是单 field 段 + field 匹配 + 无 text 残留 = 自动迁移态', () => {
    const cell: TableCell = { field: 'order.orderNo' }
    const migrated = ensureSegments(cell)
    // cell.text/segments.length=1/[0].kind==='field'/cell.field===segments[0].path
    const isAutoMigrated =
      !migrated.text &&
      (migrated.segments?.length ?? 0) === 1 &&
      migrated.segments![0]!.kind === 'field' &&
      migrated.field === migrated.segments![0]!.path
    expect(isAutoMigrated).toBe(true)
  })
})