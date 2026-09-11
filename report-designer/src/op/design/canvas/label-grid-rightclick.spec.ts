/**
 * 标签网格右键触发链 —— childOf 找回宿主
 *
 * 历史坑：
 *   labelgrid 的首卡三件套（图/编号/标题）作为独立 Fabric 对象添加到画布（childOf=grid.id）。
 *   右键命中这些子对象时 opt.target 不是 PrintLabelGrid，原 handler 直接 return，
 *   导致"右键没反应"——大部分可见点击区都被子控件占据。
 *
 * 修复：在 handler 里沿 childOf 找回宿主 labelgrid。
 *
 * 测试策略：复刻 handler 的目标解析逻辑（target instanceof PrintLabelGrid → 否则查 childOf）。
 * 不挂载完整 CanvasDesigner（需要 fabric + canvas DOM，环境重），只验证解析合约。
 */
import { describe, expect, it } from 'vitest'

/** 复刻 CanvasDesigner labelGridMouseDownHandler 的目标解析逻辑（CanvasDesigner.ts:1083-1106） */
function resolveLabelGrid(
  target: unknown,
  isLabelGrid: (obj: unknown) => boolean,
  childOf: (obj: unknown) => string | undefined,
  findById: (id: string) => unknown,
): { controlId: string } | null {
  let grid: unknown = null
  if (isLabelGrid(target)) {
    grid = target
  } else {
    const hostId = childOf(target)
    if (hostId) {
      const hostObj = findById(hostId)
      if (isLabelGrid(hostObj)) grid = hostObj
    }
  }
  if (!grid) return null
  const controlId = (grid as { controlId?: string }).controlId
  return controlId ? { controlId } : null
}

describe('CanvasDesigner · labelgrid 右键触发链（childOf 找回宿主）', () => {
  // 简化 host pool:gridId → 宿主对象
  const makeHost = (id: string) => ({
    controlId: id,
    __isLabelGrid: true,
  })
  const isLabelGrid = (obj: unknown): boolean => {
    return !!obj && typeof obj === 'object' && (obj as { __isLabelGrid?: boolean }).__isLabelGrid === true
  }
  const childOf = (obj: unknown): string | undefined => {
    return obj && typeof obj === 'object' ? (obj as { childOf?: string }).childOf : undefined
  }
  const findById = (id: string) => hosts[id]

  let hosts: Record<string, ReturnType<typeof makeHost>>

  // ★ 主场景:opt.target 是子对象 (PrintImage/Text),靠着 childOf 找回 grid
  it('target 是子对象(图/编号/标题)→ 沿 childOf 找回 labelgrid', () => {
    hosts = { 'grid-1': makeHost('grid-1') }
    const child = { controlId: 'img-1', childOf: 'grid-1', __isLabelGrid: false }
    const r = resolveLabelGrid(child, isLabelGrid, childOf, findById)
    expect(r).toEqual({ controlId: 'grid-1' })
  })

  // 退化场景:target 直接是 grid 自身
  it('target 直接是 labelgrid → 自身命中', () => {
    hosts = { 'grid-1': makeHost('grid-1') }
    const r = resolveLabelGrid(hosts['grid-1'], isLabelGrid, childOf, findById)
    expect(r).toEqual({ controlId: 'grid-1' })
  })

  // 命中空白(target=null)→ 拒绝,不要误触
  it('target=null(命中空白) → 返回 null,不触发', () => {
    hosts = { 'grid-1': makeHost('grid-1') }
    expect(resolveLabelGrid(null, isLabelGrid, childOf, findById)).toBeNull()
  })

  // 命中非子对象(如独立图片)→ 拒绝
  it('target 是非子对象(childOf 缺失) → 返回 null', () => {
    hosts = { 'grid-1': makeHost('grid-1') }
    const orphan = { controlId: 'orphan-img', __isLabelGrid: false }
    expect(resolveLabelGrid(orphan, isLabelGrid, childOf, findById)).toBeNull()
  })

  // 命中其他控件(非 labelgrid 子)的子控件 → 拒绝
  it('target.childOf 指向的 host 不是 labelgrid → 返回 null', () => {
    hosts = { 'zone-1': { controlId: 'zone-1', __isLabelGrid: false } }
    const child = { controlId: 'header-txt', childOf: 'zone-1', __isLabelGrid: false }
    expect(resolveLabelGrid(child, isLabelGrid, childOf, findById)).toBeNull()
  })

  // 子控件的 childOf 指向不存在的 id → 拒绝
  it('target.childOf 指向的 id 不在画布 → 返回 null', () => {
    hosts = {}
    const orphan = { controlId: 'img-1', childOf: 'ghost-grid', __isLabelGrid: false }
    expect(resolveLabelGrid(orphan, isLabelGrid, childOf, findById)).toBeNull()
  })
})