/**
 * designer store 单测：M1 P0-3 待绑态 / 字段绑定写入链路
 *
 * 覆盖：
 * - setPendingBind / closePendingBind 维护 pendingBindCell
 * - openCellEditor 与 pendingBindCell 互斥
 * - bindFieldToCell 写入链路（contentType/variable + field + 清 text/expression）并退出待绑态
 * - bindFieldToCell 越界 / 非表格控件 不写
 */
import { beforeEach, describe, expect, it, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDesignerStore } from './designer'
import type { TableControl, TableCell, LabelGridControl, ImageControl, TextControl } from '@op/types/control'

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

/* ============================================================
 *  findAncestorLabelGrid —— 用于 VariableModal 行上下文派生
 * ============================================================ */

function makeLabelGrid(over: Partial<LabelGridControl> = {}): LabelGridControl {
  return {
    id: 'grid-1',
    type: 'labelgrid',
    left: 0,
    top: 0,
    width: 180,
    height: 90,
    columns: 3,
    dataSource: 'ReportItems',
    children: [],
    printable: true,
    ...over,
  }
}

function makeImageChild(id: string, childOf: string): ImageControl {
  return {
    id,
    type: 'image',
    left: 0,
    top: 0,
    width: 50,
    height: 50,
    childOf,
  }
}

describe('findAncestorLabelGrid', () => {
  it('childOf 快路径：首卡 ImageControl.childOf 指向 LabelGrid → 命中', () => {
    const store = useDesignerStore()
    const grid = makeLabelGrid()
    const img = makeImageChild('img-1', grid.id)
    store.controls.push(grid, img)
    expect(store.findAncestorLabelGrid('img-1')?.id).toBe('grid-1')
  })

  it('childOf 不存在 → 回退遍历 children 数组也能命中', () => {
    const store = useDesignerStore()
    // 注意：故意没写 childOf（模拟老模板/直接编辑场景）
    const grid = makeLabelGrid({ children: [makeImageChild('img-2', '__missing__')] })
    const img: ImageControl = { id: 'img-2', type: 'image', left: 0, top: 0, width: 50, height: 50 }
    store.controls.push(grid, img)
    // 子控件自己 childOf 指向不存在的 __missing__ → 快路径失败
    // 回退遍历 grid.children 数组也能找到
    expect(store.findAncestorLabelGrid('img-2')?.id).toBe('grid-1')
  })

  it('空控件 ID → null（防御）', () => {
    const store = useDesignerStore()
    expect(store.findAncestorLabelGrid('')).toBeNull()
    expect(store.findAncestorLabelGrid(undefined as unknown as string)).toBeNull()
  })

  it('不属于任何 LabelGrid → null', () => {
    const store = useDesignerStore()
    store.controls.push({ id: 'txt-1', type: 'text', left: 0, top: 0, width: 50, height: 10, text: 'x' })
    expect(store.findAncestorLabelGrid('txt-1')).toBeNull()
  })

  it('childOf 指向非 labelgrid 控件（被污染）→ 回退遍历仍能命中 grid', () => {
    const store = useDesignerStore()
    // 假设 childOf 字段被错误写成另一个 text 控件 id（防御：快路径命中但非 labelgrid）
    const grid = makeLabelGrid({ children: [makeImageChild('img-3', 'txt-other')] })
    const img: ImageControl = { id: 'img-3', type: 'image', left: 0, top: 0, width: 50, height: 50, childOf: 'txt-other' }
    const other: { id: string; type: 'text' } = { id: 'txt-other', type: 'text' }
    store.controls.push(other as never, grid, img)
    // childOf 指向非 labelgrid → 快路径失败；回退遍历 grid.children 命中
    expect(store.findAncestorLabelGrid('img-3')?.id).toBe('grid-1')
  })
})

/* ============================================================
 *  createDefaultControl appendix 预设
 * ============================================================ */

describe('createDefaultControl —— LabelGrid appendix 预设', () => {
  it('无 init：仍是空 children 的标准 LabelGrid（向后兼容）', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl('labelgrid', { leftMm: 0, topMm: 0 })
    expect(c?.type).toBe('labelgrid')
    expect((c as LabelGridControl).children).toEqual([])
    // 无 init 时不进 appendix 模式
    expect((c as LabelGridControl).mode).toBeUndefined()
    expect((c as LabelGridControl).dataSource).toBeUndefined()
  })

  it('init.mode="appendix"：自动塞入三件套 children + dataSource + mode', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl('labelgrid', { leftMm: 10, topMm: 10 }, { mode: 'appendix' })
    expect(c?.type).toBe('labelgrid')
    const grid = c as LabelGridControl
    expect(grid.mode).toBe('appendix')
    expect(grid.dataSource).toBe('ReportItems')
    expect(grid.cardBorder).toBe(true)
    expect(grid.name).toBe('附录图片墙')

    // 三件套:image + 编号 + 标题
    expect(grid.children).toHaveLength(3)
    const [img, no, title] = grid.children
    expect(img.type).toBe('image')
    expect((img as { childOf?: string }).childOf).toBe(grid.id)
    expect((img as { value?: { mode: string; content: string } }).value).toEqual({
      mode: 'binding',
      content: 'row.Photo',
    })
    expect(no.type).toBe('text')
    expect((no as { contentType?: string; expression?: string }).contentType).toBe('expression')
    expect((no as { expression?: string }).expression).toBe('{{rowIndex + 1}}号')
    expect((no as { childOf?: string }).childOf).toBe(grid.id)
    expect(title.type).toBe('text')
    expect((title as { binding?: string }).binding).toBe('row.AnalysisItem')
    expect((title as { childOf?: string }).childOf).toBe(grid.id)
  })

  it('init.photoField / titleField 可覆盖默认 row.* 字段路径', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl(
      'labelgrid',
      { leftMm: 0, topMm: 0 },
      { mode: 'appendix', photoField: 'SamplePic', titleField: 'ItemName' },
    )
    const grid = c as LabelGridControl
    const img = grid.children[0] as { value?: { mode: string; content: string } }
    const title = grid.children[2] as { binding?: string }
    expect(img.value?.content).toBe('row.SamplePic')
    expect(title.binding).toBe('row.ItemName')
  })

  it('init.appendixHeader 非空：写入附录标题字段', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl(
      'labelgrid',
      { leftMm: 0, topMm: 0 },
      { mode: 'appendix', appendixHeader: '附录:样本照片' },
    )
    expect((c as LabelGridControl).appendixHeader).toBe('附录:样本照片')
  })

  it('init.mode="standard"：等价无 init，不进 appendix 分支', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl(
      'labelgrid',
      { leftMm: 0, topMm: 0 },
      { mode: 'standard' },
    )
    expect((c as LabelGridControl).mode).toBe('standard')
    expect((c as LabelGridControl).children).toEqual([])
    expect((c as LabelGridControl).dataSource).toBeUndefined()
  })

  it('appendix 三件套坐标不超出卡片尺寸（cardW=58, cardH=30）', async () => {
    const { createDefaultControl } = await import('./designer')
    const c = createDefaultControl('labelgrid', { leftMm: 0, topMm: 0 }, { mode: 'appendix' })
    const grid = c as LabelGridControl
    expect(grid.cardWidth).toBe(58)
    expect(grid.cardHeight).toBe(30)
    const [img, no, title] = grid.children
    expect((img as { left: number; top: number; width: number; height: number }).left + (img as { width: number }).width).toBeLessThanOrEqual(58 + 0.01)
    expect((img as { top: number; height: number }).top + (img as { height: number }).height).toBeLessThanOrEqual(30 + 0.01)
    // 编号 + 标题在同一行,左对齐
    expect((no as { top: number }).top).toBeCloseTo(30 * 0.7, 5)
    expect((title as { top: number }).top).toBeCloseTo(30 * 0.7, 5)
  })
})

/* ============================================================
 *  Commit 6:appendix 模式锁首卡 children actions
 * ============================================================ */

describe('appendix 模式 —— 首卡 children 锁', () => {
  // 局部警告抑制（action 内 console.warn 会刷屏）
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('addControlIntoLabelGrid 在 appendix 模式下被拒(不增 children)', () => {
    const store = useDesignerStore()
    // 准备一个 appendix 模式 LabelGrid(2 children)
    const grid: LabelGridControl = {
      id: 'grid-app',
      type: 'labelgrid',
      left: 0,
      top: 0,
      width: 180,
      height: 90,
      columns: 3,
      dataSource: 'ReportItems',
      mode: 'appendix',
      children: [
        { id: 'img-app', type: 'image', left: 3, top: 3, width: 50, height: 20, childOf: 'grid-app', value: { mode: 'binding', content: 'row.Photo' }, fit: 'contain' } as ImageControl,
        { id: 'txt-app', type: 'text', left: 3, top: 25, width: 50, height: 5, childOf: 'grid-app', contentType: 'fixed', value: 'x' } as TextControl,
      ],
    }
    store.controls.push(grid)
    // 尝试往首卡里加一个 text 控件 → 应被拒
    store.addControlIntoLabelGrid('grid-app', 'text', { leftMm: 10, topMm: 10 })
    const after = store.controls.find((c) => c.id === 'grid-app') as LabelGridControl
    expect(after.children).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('removeLabelGridChild 在 appendix 模式下被拒(不删 children)', () => {
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-app2',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3, dataSource: 'ReportItems',
      mode: 'appendix',
      children: [
        { id: 'img-app2', type: 'image', left: 3, top: 3, width: 50, height: 20, childOf: 'grid-app2', value: { mode: 'binding', content: 'row.Photo' }, fit: 'contain' } as ImageControl,
      ],
    }
    store.controls.push(grid)
    store.removeLabelGridChild('grid-app2', 'img-app2')
    const after = store.controls.find((c) => c.id === 'grid-app2') as LabelGridControl
    expect(after.children).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('clearLabelGridChildren 在 appendix 模式下被拒', () => {
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-app3',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3, dataSource: 'ReportItems',
      mode: 'appendix',
      children: [
        { id: 'img-app3', type: 'image', left: 3, top: 3, width: 50, height: 20, childOf: 'grid-app3', value: { mode: 'binding', content: 'row.Photo' }, fit: 'contain' } as ImageControl,
      ],
    }
    store.controls.push(grid)
    store.clearLabelGridChildren('grid-app3')
    const after = store.controls.find((c) => c.id === 'grid-app3') as LabelGridControl
    expect(after.children).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('standard 模式(无 mode 字段)→ 所有动作照常工作(向后兼容)', () => {
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-std',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3,
      children: [],
    }
    store.controls.push(grid)
    // 添加 children
    store.addControlIntoLabelGrid('grid-std', 'text', { leftMm: 5, topMm: 5 })
    const after1 = store.controls.find((c) => c.id === 'grid-std') as LabelGridControl
    expect(after1.children).toHaveLength(1)
    // 删除 children
    const childId = after1.children[0]!.id
    store.removeLabelGridChild('grid-std', childId)
    const after2 = store.controls.find((c) => c.id === 'grid-std') as LabelGridControl
    expect(after2.children).toHaveLength(0)
    // 标准模式不应触发 warn
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('mode="standard"(显式)→ 同上,锁分支不触发', () => {
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-std2',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3,
      mode: 'standard',
      children: [],
    }
    store.controls.push(grid)
    store.addControlIntoLabelGrid('grid-std2', 'text', { leftMm: 5, topMm: 5 })
    const after = store.controls.find((c) => c.id === 'grid-std2') as LabelGridControl
    expect(after.children).toHaveLength(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

/* ============================================================
 *  Commit 7:LabelGridProps 模式切换(setMode)
 *  直接通过 store.updateControl 模拟 UI 的 setMode 行为(避免 Vue mount)
 * ============================================================ */

describe('LabelGridProps 模式切换(setMode 等价路径)', () => {
  it('standard → appendix:用 createDefaultControl 拿三件套 + 替换 children + 写 mode', async () => {
    const { createDefaultControl } = await import('./designer')
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-toggle',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3,
      children: [{ id: 'old-text', type: 'text', left: 5, top: 5, width: 30, height: 10, contentType: 'fixed', value: 'old' } as TextControl],
    }
    store.controls.push(grid)
    // 模拟 LabelGridProps.setMode('appendix') 的逻辑
    const fresh = createDefaultControl('labelgrid', { leftMm: 0, topMm: 0 }, { mode: 'appendix' })
    expect(fresh?.type).toBe('labelgrid')
    store.updateControl('grid-toggle', {
      mode: 'appendix',
      dataSource: (fresh as LabelGridControl).dataSource,
      children: (fresh as LabelGridControl).children,
    })
    const after = store.controls.find((c) => c.id === 'grid-toggle') as LabelGridControl
    expect(after.mode).toBe('appendix')
    expect(after.children).toHaveLength(3) // 三件套
    expect(after.dataSource).toBe('ReportItems')
    // 老 children 应被替换
    expect(after.children.find((c) => c.id === 'old-text')).toBeUndefined()
  })

  it('appendix → standard:只清 mode 字段,保留 children', async () => {
    const store = useDesignerStore()
    const grid: LabelGridControl = {
      id: 'grid-toggle2',
      type: 'labelgrid',
      left: 0, top: 0, width: 180, height: 90, columns: 3,
      mode: 'appendix',
      dataSource: 'ReportItems',
      children: [{ id: 'img-x', type: 'image', left: 3, top: 3, width: 50, height: 20, childOf: 'grid-toggle2', value: { mode: 'binding', content: 'row.Photo' }, fit: 'contain' } as ImageControl],
    }
    store.controls.push(grid)
    // 模拟 LabelGridProps.setMode('standard') 的逻辑
    store.updateControl('grid-toggle2', { mode: 'standard' })
    const after = store.controls.find((c) => c.id === 'grid-toggle2') as LabelGridControl
    expect(after.mode).toBe('standard')
    // 保留 children(用户后续可自由编辑)
    expect(after.children).toHaveLength(1)
    expect(after.children[0]!.id).toBe('img-x')
  })

  it('currentMode computed 等价语义:老模板 mode 缺失视为 standard', () => {
    // 这是 LabelGridProps.currentMode computed 的行为契约
    function currentMode(c: LabelGridControl | null): 'standard' | 'appendix' {
      return c?.mode ?? 'standard'
    }
    expect(currentMode(null)).toBe('standard')
    expect(currentMode({ id: 'a', type: 'labelgrid', left: 0, top: 0, width: 1, height: 1, columns: 1, children: [] } as LabelGridControl)).toBe('standard')
    expect(currentMode({ id: 'b', type: 'labelgrid', left: 0, top: 0, width: 1, height: 1, columns: 1, mode: 'appendix', children: [] } as LabelGridControl)).toBe('appendix')
  })
})