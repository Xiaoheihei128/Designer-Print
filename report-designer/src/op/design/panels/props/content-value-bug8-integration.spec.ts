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
 *
 * ★ Plan B 补充：保留 Bug8 全部用例（ensureSegments 仍是 lazy migration 入口），
 *   并新增「画布反向同步」端到端用例：
 *     commitTd → patchCellText → store update → rebuildSegmentsFromCell 派生新 segments
 *     → ContentValueEditor textarea 立即拿到新值
 */
import { describe, expect, it } from 'vitest'
import { isAutoMigratedFieldOnly } from './content-value-helpers'
import { ensureSegments, rebuildSegmentsFromCell } from '@op/design/segments-migration'
import { buildDesignGrid, patchCellText } from '@op/core/layout-engine/table-cells'
import type { TableCell, TableControl } from '@op/types/control'

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

/**
 * Plan B 反向同步端到端集成 —— 画布 contentEditable 改 td → ContentValueEditor textarea
 * 立即看到新 segments。这是用户特别强调的核心需求。
 *
 * 链路复刻（与 TableViewLayer.vue + CellToolbar.vue 一致）：
 *   1. commitTd(td) → patchCellText(control, row, col, td.innerText) → next control
 *   2. store.updateControl(id, next) → grid 重算
 *   3. CellToolbar 派生 effectiveCell = rebuildSegmentsFromCell(cell)
 *   4. ContentValueEditor :segments="effectiveCell.segments" 立即拿到新值
 */
describe('Plan B 反向同步：commitTd → ContentValueEditor 立即同步 segments', () => {
  /** 复刻 CellToolbar.vue:91-108 的派生链 */
  function editorSegmentsAfter(control: TableControl, row: number, col: number): TableCell['segments'] {
    const grid = buildDesignGrid(control)
    const cell: TableCell = grid.cells[row]?.[col] ?? {}
    return rebuildSegmentsFromCell(cell).segments
  }

  const baseTable = (cells: TableCell[][]): TableControl => ({
    id: 'tbl-bug8',
    type: 'table',
    left: 0, top: 0, width: 180, height: 60,
    dataSource: 'orders', // 数据表：r=1 是数据样例行（patchCellText 走 isDataTemplate 分支）
    columns: [
      { title: '订单号', field: 'order.orderNo' },
      { title: '金额',   field: 'order.total' },
    ],
    options: { borders: 'all', verticalAlign: 'middle', headerRows: 1, staticRows: 0, designRows: 2 },
    headerRows: 1, designRows: 2, staticRows: 0,
    cells,
  })

  /**
   * 关键场景：原本绑了 'order.orderNo' 的 cell，用户在画布上把 td.innerText
   * 改成 '{{item.order.total}}' → patchCellText 写入 segments=[{field:'order.total'}]
   * → ContentValueEditor 立即拿到新 segments。
   */
  it('★ Plan B 关键场景：画布改 td → ContentValueEditor 立即看到新 field 段', () => {
    // 1. 初始 cell：Bug8 修复路径走完，cell.field='order.orderNo' + segments=[{field,..}]
    const initial: TableControl = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [
        { field: 'order.orderNo', segments: [{ kind: 'field', path: 'order.orderNo' }] },
        { field: 'order.total',   segments: [{ kind: 'field', path: 'order.total' }] },
      ],
    ])
    expect(editorSegmentsAfter(initial, 1, 0)).toEqual([{ kind: 'field', path: 'order.orderNo' }])

    // 2. 用户在画布上改 td.innerText 为 '{{item.order.total}}'
    const next = patchCellText(initial, 1, 0, '{{item.order.total}}')
    expect(next).not.toBe(initial)

    // 3. ★ 反向同步：ContentValueEditor 立即拿到新 segments
    expect(editorSegmentsAfter(next, 1, 0)).toEqual([{ kind: 'field', path: 'order.total' }])
  })

  /**
   * 反向同步的多片段链路：用户在画布上把 cell 改成 '数量：{{item.qty}} 件' →
   * patchCellText 走 splitFixedText 切为 [text, field, text] → ContentValueEditor 立即拿到。
   */
  it('★ Plan B 多片段反向同步：画布改混合内容 → ContentValueEditor 立即看到多片段', () => {
    const initial: TableControl = baseTable([
      [{ text: '数量' }, { text: '单价' }],
      [{ field: 'qty' }, { field: 'order.total' }],
    ])
    const next = patchCellText(initial, 1, 0, '数量：{{item.qty}} 件')
    expect(next).not.toBe(initial)
    expect(editorSegmentsAfter(next, 1, 0)).toEqual([
      { kind: 'text', value: '数量：' },
      { kind: 'expr', src: 'item.qty' },
      { kind: 'text', value: ' 件' },
    ])
  })

  /**
   * 幂等回归：用户在画布上不改任何东西 + commitTd → patchCellText 返回原 control
   * → rebuildSegmentsFromCell 派生仍得到原 segments（不引入幽灵段）。
   */
  it('★ Plan B 幂等：未改文本 → patchCellText 引用未变 + 派生 segments 一致', () => {
    const initial: TableControl = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [
        { segments: [{ kind: 'field', path: 'order.orderNo' }] },
        { field: 'order.total' },
      ],
    ])
    // 用户「按 Tab 离开」触发 commitTd，td.innerText 仍是当前占位符 {{item.order.orderNo}}
    const next = patchCellText(initial, 1, 0, '{{item.order.orderNo}}')
    // 1. patchCellText 引用未变（未改文本不进 undo 栈）
    expect(next).toBe(initial)
    // 2. 派生链仍能正确解析 segments（不引入幽灵段）
    expect(editorSegmentsAfter(next, 1, 0)).toEqual([{ kind: 'field', path: 'order.orderNo' }])
  })
})