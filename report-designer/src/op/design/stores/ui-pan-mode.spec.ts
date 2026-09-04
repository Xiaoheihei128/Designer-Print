/**
 * uiStore 平移模式单测
 *
 * 覆盖：
 * - panMode 初始值
 * - togglePanMode 翻转
 * - setPanMode 设值 + 幂等
 * - 与 showMarginGuides / rightPanelMode 等其它 uiStore 状态互不干扰
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './ui'

describe('uiStore · 平移模式（panMode）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初值: panMode = false', () => {
    const ui = useUiStore()
    expect(ui.panMode).toBe(false)
  })

  it('togglePanMode: 翻转 + 维持', () => {
    const ui = useUiStore()
    ui.togglePanMode()
    expect(ui.panMode).toBe(true)
    ui.togglePanMode()
    expect(ui.panMode).toBe(false)
  })

  it('setPanMode: 设值 + 幂等', () => {
    const ui = useUiStore()
    ui.setPanMode(true)
    expect(ui.panMode).toBe(true)
    ui.setPanMode(true) // 同值不再触发 watch（store 内部仍写 ref，但下游 watch 跳过）
    expect(ui.panMode).toBe(true)
    ui.setPanMode(false)
    expect(ui.panMode).toBe(false)
  })

  it('panMode 与 showMarginGuides 互不干扰', () => {
    const ui = useUiStore()
    expect(ui.showMarginGuides).toBe(true)
    ui.togglePanMode()
    expect(ui.showMarginGuides).toBe(true) // 不被平移模式改动
    ui.toggleMarginGuides()
    expect(ui.panMode).toBe(true) // 不被参考线开关改动
  })

  it('panMode 与 rightPanelMode 互不干扰', () => {
    const ui = useUiStore()
    expect(ui.rightPanelMode).toBe('normal')
    ui.setPanMode(true)
    expect(ui.rightPanelMode).toBe('normal')
    ui.openTableQuickPanel()
    expect(ui.panMode).toBe(true) // 平移模式不因切右面板被重置
  })
})