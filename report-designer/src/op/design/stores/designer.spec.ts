/**
 * designer store 单测：M1 P0-3 待绑态 / 字段绑定写入链路 + 字段拖到文本控件
 *
 * 覆盖：
 * - setPendingBind / closePendingBind 维护 pendingBindCell
 * - openCellEditor 与 pendingBindCell 互斥
 * - bindFieldToCell 写入链路（contentType/variable + field + 清 text/expression）并退出待绑态
 * - bindFieldToCell 越界 / 非表格控件 不写
 * - applyFieldBindingToTextControl 写入 segments=[{kind:'field', path}]（自动迁移态覆盖 / 多片段追加 / v1 文本切到 segments / 空白单 field 段）
 * - hitTestTextControl 命中 body / labelgrid 子组件 / zone 子组件
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDesignerStore } from './designer'
import type { TableControl, TableCell } from '@op/types/control'

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
  it('字段路径写入指定单元格：contentType=variable + field 路径 + 清 text/expression', () => {
    const store = useDesignerStore()
    store.controls.push(makeTable())
    store.bindFieldToCell('tbl-1', 1, 1, 'items[].qty')
    const tbl = store.controls.find((c) => c.id === 'tbl-1') as TableControl
    const cell = tbl.cells![1]![1] as TableCell
    expect(cell.contentType).toBe('variable')
    expect(cell.field).toBe('items[].qty')
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
    expect(cell.contentType).toBe('variable')
    expect(cell.field).toBe('items[].qty')
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

/**
 * 字段拖到画布文本控件（useDragAdd 路径 2 触发的 store 调用）
 *
 * 用户报修：拖动单值属性字段到画布文本控件上，画布只显示裸字段路径，
 * 没有 {{}} —— 是 fabric.Textbox contenteditable 原生接管了 text/plain mime 造成的。
 * 修复后 useDragAdd.onDrop 接 application/x-openprint-binding mime：
 *   - 命中已有文本控件 → applyFieldBindingToTextControl（segments 模式）
 *   - 未命中 → 在落点新建文本控件，预绑字段
 *
 * 语义必须与属性面板 [字段] 按钮（ContentValueEditor.onVarConfirm）对齐：
 *   - 自动迁移态（单 field 段 + binding 匹配 + 无手写文本） → 覆盖换绑
 *   - 已有 segments（多片段混合） → 追加 field 段（保留原文与原字段）
 *   - v1 schema 遗留文本（value/expression）→ 切成 segments=[text+field]
 *   - 空白 → 单 field 段
 * 这里锁定 store 层契约。
 */
describe('applyFieldBindingToTextControl 字段拖到已有文本控件', () => {
  it('空白文本控件：segments 写入单 field 段，兼容老 schema', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-1',
      type: 'text',
      left: 10,
      top: 10,
      width: 50,
      height: 8,
    })
    const ok = store.applyFieldBindingToTextControl('txt-1', 'Header.ReportNo')
    expect(ok).toBe(true)
    const t = store.controls.find((c) => c.id === 'txt-1') as {
      segments?: Array<{ kind: string; path?: string }>
      binding?: string
      contentType?: string
      value?: string
    }
    expect(t.segments).toEqual([{ kind: 'field', path: 'Header.ReportNo' }])
    // 兼容老 schema：contentType=variable, binding 同步
    expect(t.contentType).toBe('variable')
    expect(t.binding).toBe('Header.ReportNo')
    // 老字段清空，避免 resolveSegments fallback 分支触发
    expect(t.value).toBeUndefined()
    // 自动选中
    expect(store.selectedIds).toContain('txt-1')
  })

  it('已有 segments（多片段混合）→ 追加 field 段，保留原文与原字段', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-2',
      type: 'text',
      left: 0,
      top: 0,
      width: 50,
      height: 8,
      segments: [
        { kind: 'text', value: '合计：' },
        { kind: 'field', path: 'Header.Total' },
      ],
      contentType: 'variable',
    })
    store.applyFieldBindingToTextControl('txt-2', 'Header.ProductCode')
    const t = store.controls.find((c) => c.id === 'txt-2') as {
      segments?: Array<{ kind: string; path?: string; value?: string }>
      binding?: string
    }
    // 关键：原"合计："文字 + 原字段都保留，新字段追加在末尾
    expect(t.segments).toEqual([
      { kind: 'text', value: '合计：' },
      { kind: 'field', path: 'Header.Total' },
      { kind: 'field', path: 'Header.ProductCode' },
    ])
    // 多段时单 binding 语义失效，由 segments 接管
    expect(t.binding).toBeUndefined()
  })

  it('v1 schema 遗留 value（用户输入过文本）→ 切到 segments=[text+field]', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-3',
      type: 'text',
      left: 0,
      top: 0,
      width: 50,
      height: 8,
      contentType: 'fixed',
      value: '客户：',
    })
    store.applyFieldBindingToTextControl('txt-3', 'Header.CustomerName')
    const t = store.controls.find((c) => c.id === 'txt-3') as {
      segments?: Array<{ kind: string; path?: string; value?: string }>
      binding?: string
      contentType?: string
      value?: string
    }
    expect(t.segments).toEqual([
      { kind: 'text', value: '客户：' },
      { kind: 'field', path: 'Header.CustomerName' },
    ])
    expect(t.contentType).toBe('variable')
    expect(t.value).toBeUndefined()
    expect(t.binding).toBeUndefined()
  })

  it('自动迁移态（单 field 段 + binding 匹配 + 无文本）→ 覆盖换绑', () => {
    const store = useDesignerStore()
    // 模拟"打开老模板后字段被 ensureSegments 自动迁移到 segments"的中间态：
    // 用户还没编辑过 segments，意图是换绑字段
    store.controls.push({
      id: 'txt-4',
      type: 'text',
      left: 0,
      top: 0,
      width: 50,
      height: 8,
      segments: [{ kind: 'field', path: 'Header.OldField' }],
      contentType: 'variable',
      binding: 'Header.OldField',
    })
    store.applyFieldBindingToTextControl('txt-4', 'Header.NewField')
    const t = store.controls.find((c) => c.id === 'txt-4') as {
      segments?: Array<{ kind: string; path?: string }>
      binding?: string
    }
    expect(t.segments).toEqual([{ kind: 'field', path: 'Header.NewField' }])
    expect(t.binding).toBe('Header.NewField')
  })

  it('非文本控件：返回 false，不动', () => {
    const store = useDesignerStore()
    const table = makeTable()
    store.controls.push(table)
    const ok = store.applyFieldBindingToTextControl('tbl-1', 'Header.X')
    expect(ok).toBe(false)
    // 表格内容不动（Pinia reactive proxy 后引用不等，但内容应一致）
    expect(store.controls.find((c) => c.id === 'tbl-1')).toStrictEqual(table)
  })

  it('不存在的 id：返回 false，不抛', () => {
    const store = useDesignerStore()
    expect(() => store.applyFieldBindingToTextControl('nope', 'X')).not.toThrow()
    expect(store.applyFieldBindingToTextControl('nope', 'X')).toBe(false)
  })

  it('silent：不进 undo 栈（与属性面板 [字段] 按钮行为对齐）', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-5',
      type: 'text',
      left: 0,
      top: 0,
      width: 50,
      height: 8,
      contentType: 'fixed',
      value: '旧',
    })
    const historyLenBefore = store.dirty
    store.applyFieldBindingToTextControl('txt-5', 'Header.A')
    // dirty 标记不应被 silent 操作翻转
    expect(store.dirty).toBe(historyLenBefore)
  })
})

describe('hitTestTextControl 命中检测', () => {
  /** 构造一个最小舞台对象（不依赖 DOM），hitTest 只需要 getBoundingClientRect */
  function makeStage(): HTMLElement {
    const rect = {
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
      toJSON() {
        return {}
      },
    }
    return {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLElement
  }

  it('命中 body 上的文本控件', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-body',
      type: 'text',
      left: 10, // mm
      top: 20,
      width: 50,
      height: 10,
    })
    // 默认 viewport: zoom=1, offsetX=0, offsetY=0
    // clientX = rect.left + vp.offsetX + leftMm * MM_TO_PX * zoom
    // MM_TO_PX = 96/25.4 ≈ 3.7795
    const MM_TO_PX = 96 / 25.4
    const clientX = 0 + 0 + 10 * MM_TO_PX * 1 + 1  // 落在框内
    const clientY = 0 + 0 + 20 * MM_TO_PX * 1 + 1
    const hit = store.hitTestTextControl(clientX, clientY, makeStage())
    expect(hit).toBe('txt-body')
  })

  it('未命中：坐标在控件外', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'txt-body',
      type: 'text',
      left: 10,
      top: 20,
      width: 50,
      height: 10,
    })
    const MM_TO_PX = 96 / 25.4
    // 落在控件右侧外
    const clientX = 0 + 0 + (10 + 50 + 5) * MM_TO_PX * 1
    const clientY = 0 + 0 + 20 * MM_TO_PX * 1
    const hit = store.hitTestTextControl(clientX, clientY, makeStage())
    expect(hit).toBeNull()
  })

  it('非文本控件（图片）不参与命中', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'img-1',
      type: 'image',
      left: 10,
      top: 20,
      width: 50,
      height: 10,
    })
    const MM_TO_PX = 96 / 25.4
    const clientX = 0 + 0 + 30 * MM_TO_PX * 1
    const clientY = 0 + 0 + 25 * MM_TO_PX * 1
    expect(store.hitTestTextControl(clientX, clientY, makeStage())).toBeNull()
  })

  it('labelgrid 子组件里的文本控件也能命中', () => {
    const store = useDesignerStore()
    store.controls.push({
      id: 'grid-1',
      type: 'labelgrid',
      left: 0,
      top: 0,
      width: 100,
      height: 30,
      children: [
        { id: 'card-txt', type: 'text', left: 5, top: 5, width: 20, height: 8 },
      ],
    } as unknown as { id: string; type: string; left: number; top: number; width: number; height: number; children?: unknown[] })
    const MM_TO_PX = 96 / 25.4
    // 落在 card-txt 内
    const clientX = 0 + 0 + 10 * MM_TO_PX * 1
    const clientY = 0 + 0 + 7 * MM_TO_PX * 1
    expect(store.hitTestTextControl(clientX, clientY, makeStage())).toBe('card-txt')
  })

  it('zone（页眉/页脚）内的文本控件也能命中', () => {
    const store = useDesignerStore()
    store.zones.push({
      id: 'zone-header',
      type: 'zone',
      zone: 'header',
      left: 0,
      top: 0,
      width: 210,
      height: 20,
      children: [
        { id: 'header-txt', type: 'text', left: 5, top: 5, width: 30, height: 8 },
      ],
    } as unknown as { id: string; type: string; zone: string; left: number; top: number; width: number; height: number; children: unknown[] })
    const MM_TO_PX = 96 / 25.4
    const clientX = 0 + 0 + 10 * MM_TO_PX * 1
    const clientY = 0 + 0 + 7 * MM_TO_PX * 1
    expect(store.hitTestTextControl(clientX, clientY, makeStage())).toBe('header-txt')
  })
})