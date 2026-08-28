/**
 * Bug8 端到端集成测试 ——「固定尾行绑字段画布只显示旧字段」修复
 *
 * 场景链路：
 *   1. 数据表有 col.field='order.orderNo'
 *   2. CellToolbar 打开 → ensureSegments 触发自动迁移 → segments=[{field,'order.orderNo'}]
 *   3. 用户在 VariableModal 选新字段 'order.total'
 *   4. onVarConfirm 调用 isAutoMigratedFieldOnly 判定 → 走覆盖路径
 *   5. cell.field 被更新为 'order.total'（修复前：保持 'order.orderNo'）
 *   6. 渲染层读 cell.field='order.total' → 画布显示 {{item.order.total}}
 */
import { describe, expect, it } from 'vitest'
import { isAutoMigratedFieldOnly } from './content-value-helpers'
import { ensureSegments } from '@op/design/segments-migration'
import type { TableCell } from '@op/types/control'

/** 模拟 onVarConfirm 关键决策（与 ContentValueEditor.vue:236-265 等价） */
function simulateOnVarConfirm(opts: {
  segments?: any[]
  binding?: string
  value?: string
  expression?: string
  newPath: string
}): { mode: string; binding: string; segments: any[] } {
  if (
    isAutoMigratedFieldOnly({
      segments: opts.segments,
      field: opts.binding,
      value: opts.value,
      expression: opts.expression,
    })
  ) {
    return {
      mode: 'variable',
      binding: opts.newPath,
      segments: [{ kind: 'field', path: opts.newPath }],
    }
  }
  // 追加路径（用户已手写文本时的正常行为）
  return {
    mode: 'variable',
    binding: opts.binding,
    segments: [...(opts.segments ?? []), { kind: 'field', path: opts.newPath }],
  }
}

describe('Bug8 端到端集成 —— 固定尾行重绑字段', () => {
  /**
   * 关键修复路径：自动迁移态下重绑 → cell.field 被覆盖。
   * 修复前：返回的 binding 是旧值 'order.orderNo'（bug）
   * 修复后：返回的 binding 是新值 'order.total'
   */
  it('Bug8 修复：自动迁移的单 field 段 + 重绑 → cell.field 被覆盖为新路径', () => {
    // 1. 初始 cell（来自数据表列默认 field='order.orderNo'）
    const cellBefore: TableCell = { field: 'order.orderNo' }
    // 2. CellToolbar 触发 ensureSegments
    const migrated = ensureSegments(cellBefore)
    // 验证迁移态
    expect(migrated.segments).toEqual([{ kind: 'field', path: 'order.orderNo' }])
    expect(migrated.field).toBe('order.orderNo')

    // 3. 用户在 VariableModal 选 order.total
    const result = simulateOnVarConfirm({
      segments: migrated.segments,
      binding: migrated.field,
      value: '',
      expression: '',
      newPath: 'order.total',
    })

    // 4. 验证修复：cell.field 是新路径
    expect(result.binding).toBe('order.total')  // ← 修复点
    expect(result.segments).toEqual([{ kind: 'field', path: 'order.total' }])
    expect(result.segments).toHaveLength(1)  // 覆盖而非追加
  })

  /**
   * 回归保护：用户已手写文本时（不再是纯自动迁移态），保持追加语义。
   * 例：用户在 'sum: ' 后再追加字段得到 'sum: {{order.total}}'。
   */
  it('回归保护：用户已手写文本（text 残留）→ 重绑走追加路径', () => {
    const migrated = ensureSegments({
      field: 'order.orderNo',
      text: '前置：',
    } as TableCell)
    // 跳过详细检查：focus 在判定上
    const result = simulateOnVarConfirm({
      segments: migrated.segments,
      binding: migrated.field,
      value: migrated.text,
      expression: '',
      newPath: 'order.total',
    })

    // 追加路径：segments 应含原 + 新；binding 保持原
    expect(result.segments.length).toBeGreaterThanOrEqual(2)
    expect(result.binding).toBe('order.orderNo')
  })

  /**
   * 边界：用户先切换到 expression 模式，再重绑字段。
   * 此时 cell.expression 非空 → 不是自动迁移态 → 走追加路径。
   * （此场景不属 Bug8，仅做 smoke 验证不会误判。）
   */
  it('边界：用户写了 expression 后再绑字段 → 不算自动迁移态', () => {
    const result = simulateOnVarConfirm({
      segments: [{ kind: 'field', path: 'order.orderNo' }],
      binding: 'order.orderNo',
      value: '',
      expression: 'order.total.toFixed(2)',  // 非空
      newPath: 'order.total',
    })
    // 应走追加路径（segments 变为 2 个段）
    expect(result.segments.length).toBe(2)
  })
})