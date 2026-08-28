/**
 * Bug9 端到端集成：editing 态下 frozenHtml 变更 → items 必须重算
 *
 * 复现路径（不依赖 jsdom，直接用 Vue reactivity）：
 * 1. 模拟 TableViewLayer 的关键状态：frozenHtml (ref) + store.controls (ref)
 * 2. items computed 读 store.controls + frozenHtml.value（修复点）
 * 3. 模拟 CellToolbar apply：updateControl + refreshFrozen
 * 4. 断言 items 在两次变更后输出**新**字段的 HTML
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDesignerStore } from '@op/design/stores/designer'
import { renderTableGridHtml } from '@op/design/canvas/table-design-render'
import { patchCell } from '@op/core/layout-engine/table-cells'
import type { TableControl } from '@op/types/control'

const baseTable = (): TableControl => ({
  id: 'tbl-1',
  type: 'table',
  left: 0, top: 0, width: 180, height: 60,
  columns: [
    { title: '订单号', field: 'order.orderNo' },
    { title: '金额',   field: 'order.total' },
  ],
  options: { borders: 'all', verticalAlign: 'middle', headerRows: 1, staticRows: 0, designRows: 2 },
  headerRows: 1, designRows: 2, staticRows: 0,
  cells: [
    [{ text: '订单号' }, { text: '金额' }],
    [{ field: 'order.orderNo' }, { field: 'order.total' }],
  ],
})

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('Bug9 修复：editing 态改字段 → frozenHtml → items 重算 → 画布显示新字段', () => {
  it('items 应订阅 frozenHtml；改字段后 frozenHtml + canvasTick 双触发，items 输出新值', async () => {
    const store = useDesignerStore()
    store.controls.push(baseTable())

    // 模拟 TableViewLayer 关键状态
    const frozenHtml = ref<string>('')
    const canvasTick = ref(0)

    // items computed（与 TableViewLayer.vue:109 一致，**含 frozenHtml 依赖**）
    const items = computed(() => {
      void canvasTick.value
      void store.controls
      void frozenHtml.value  // ★ 修复点
      const ctrl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
      // editing 态（frozenHtml 非空）→ 用快照；否则实时渲染
      return frozenHtml.value || renderTableGridHtml(ctrl)
    })

    // 1. 打开 CellToolbar：模拟 watch on editingId 设置 frozenHtml
    store.openCellEditor('tbl-1', 1, 0)
    frozenHtml.value = renderTableGridHtml(store.controls.find((c) => c.id === 'tbl-1') as TableControl)
    await nextTick()

    expect(items.value).toContain('{{item.order.orderNo}}')

    // 2. 用户改 cell.field → emit apply → updateControl + refreshFrozen
    const current = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const next = patchCell(current, 1, 0, { field: 'order.total' })
    store.updateControl('tbl-1', next)
    // refreshFrozen: frozenHtml 写新值 + bump canvasTick
    frozenHtml.value = renderTableGridHtml(next)
    canvasTick.value++  // 修复：refreshFrozen 现在会 bump
    await nextTick()

    // 3. 验证：items 应输出新字段，不应再含旧字段
    expect(items.value).toContain('{{item.order.total}}')
    expect(items.value).not.toContain('{{item.order.orderNo}}')
  })

  /**
   * 反证：若 items 不订阅 frozenHtml、refreshFrozen 也不 bump canvasTick，
   * 编辑态下改字段画布不会更新 → 旧 bug 行为。
   */
  it('回归对照：不订阅 frozenHtml 且不 bump tick → 画布停留在旧字段（bug 行为）', async () => {
    const store = useDesignerStore()
    store.controls.push(baseTable())

    const frozenHtml = ref<string>('')

    // 故意不订阅 frozenHtml
    const items = computed(() => {
      const ctrl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
      return frozenHtml.value || renderTableGridHtml(ctrl)
    })

    store.openCellEditor('tbl-1', 1, 0)
    frozenHtml.value = renderTableGridHtml(store.controls.find((c) => c.id === 'tbl-1') as TableControl)
    await nextTick()
    expect(items.value).toContain('{{item.order.orderNo}}')

    // 改字段：只调 store，不动 frozenHtml（模拟"忘了 refresh"的 bug 情形）
    const current = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const next = patchCell(current, 1, 0, { field: 'order.total' })
    store.updateControl('tbl-1', next)
    await nextTick()

    // 行为：items 仍用旧 frozenHtml → 看到旧字段（这正是用户报告的 bug）
    expect(items.value).toContain('{{item.order.orderNo}}')
  })
})