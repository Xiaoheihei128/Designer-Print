/**
 * uiStore · 标签网格快速面板单测
 *
 * 覆盖：
 * - open/close 状态机（与 rightPanelMode / tableQuickPanelOpen 平行轨道）
 * - targetId 显式记录：切换选中控件不关闭
 * - syncLabelGridQuickPanelTarget：控件被删 → 自动关闭
 * - 与 openTableQuickPanel / panMode 互不干扰（快速面板是独立轨道）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './ui'

describe('uiStore · 标签网格属性快速面板（底部弹出）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初值：面板关闭 + targetId 为空', () => {
    const ui = useUiStore()
    expect(ui.labelGridQuickPanelOpen).toBe(false)
    expect(ui.labelGridQuickPanelTargetId).toBeNull()
  })

  it('openLabelGridQuickPanel：写入 open=true + targetId', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    expect(ui.labelGridQuickPanelTargetId).toBe('grid-1')
  })

  it('openLabelGridQuickPanel(同 id)：幂等，不重置别的状态', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.openLabelGridQuickPanel('grid-1')
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    expect(ui.labelGridQuickPanelTargetId).toBe('grid-1')
  })

  it('openLabelGridQuickPanel(新 id)：覆盖 targetId，不关面板（语义：切控件不丢数据）', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.openLabelGridQuickPanel('grid-2')
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    expect(ui.labelGridQuickPanelTargetId).toBe('grid-2')
  })

  it('closeLabelGridQuickPanel：清 open + targetId', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.closeLabelGridQuickPanel()
    expect(ui.labelGridQuickPanelOpen).toBe(false)
    expect(ui.labelGridQuickPanelTargetId).toBeNull()
  })

  it('syncLabelGridQuickPanelTarget：targetId 仍在 → 保持开', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.syncLabelGridQuickPanelTarget(new Set(['grid-1', 'grid-2']))
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    expect(ui.labelGridQuickPanelTargetId).toBe('grid-1')
  })

  it('syncLabelGridQuickPanelTarget：targetId 已删 → 自动关', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.syncLabelGridQuickPanelTarget(new Set(['grid-2']))
    expect(ui.labelGridQuickPanelOpen).toBe(false)
    expect(ui.labelGridQuickPanelTargetId).toBeNull()
  })

  it('syncLabelGridQuickPanelTarget：面板本就关着 → 不动', () => {
    const ui = useUiStore()
    expect(ui.labelGridQuickPanelOpen).toBe(false)
    ui.syncLabelGridQuickPanelTarget(new Set(['grid-2']))
    expect(ui.labelGridQuickPanelOpen).toBe(false)
    expect(ui.labelGridQuickPanelTargetId).toBeNull()
  })

  it('与 rightPanelMode(tableQuick 通道) 互不干扰：两边可同时开', () => {
    const ui = useUiStore()
    ui.openTableQuickPanel()
    ui.openLabelGridQuickPanel('grid-1')
    expect(ui.rightPanelMode).toBe('tableQuick')
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    // 关闭一边不影响另一边
    ui.closeTableQuickPanel()
    expect(ui.rightPanelMode).toBe('normal')
    expect(ui.labelGridQuickPanelOpen).toBe(true)
  })

  it('与 panMode 互不干扰', () => {
    const ui = useUiStore()
    ui.openLabelGridQuickPanel('grid-1')
    ui.togglePanMode()
    expect(ui.labelGridQuickPanelOpen).toBe(true)
    expect(ui.labelGridQuickPanelTargetId).toBe('grid-1')
    expect(ui.panMode).toBe(true)
  })
})