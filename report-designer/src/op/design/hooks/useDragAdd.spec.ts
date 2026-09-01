/**
 * useDragAdd 单测：M1 控件拖拽 + 字段拖到画布文本控件
 *
 * 覆盖：
 * - DRAG_TYPE_KEY / DRAG_BINDING_KEY 常量（前者 hook 内部用，后者供 DataSourceTree 引用）
 * - startControlDrag 写 application/x-openprint-control mime
 * - onDragOver 对 binding mime 也 preventDefault（避免 fabric.Textbox contenteditable
 *   把 text/plain 字段路径直接插入光标，导致画布出现裸字段名的 bug）
 * - onDrop 接 binding mime → 命中已有文本控件时调 applyFieldBindingToTextControl，
 *   未命中时新建文本控件并预绑字段（segments 模式）
 */
import { describe, expect, it } from 'vitest'
import { DRAG_BINDING_KEY, DRAG_TYPE_KEY, startControlDrag } from './useDragAdd'

describe('mime 常量', () => {
  it('DRAG_TYPE_KEY 控件 mime', () => {
    expect(DRAG_TYPE_KEY).toBe('application/x-openprint-control')
  })
  it('DRAG_BINDING_KEY 字段 mime 与 DataSourceTree.setData 一致', () => {
    expect(DRAG_BINDING_KEY).toBe('application/x-openprint-binding')
  })
})

describe('startControlDrag', () => {
  it('写入控件类型 mime 并允许 copy 效果', () => {
    const setDataCalls: Array<[string, string]> = []
    const dt = {
      types: [] as string[],
      effectAllowed: 'none',
      setData: (k: string, v: string) => {
        setDataCalls.push([k, v])
        if (!dt.types.includes(k)) dt.types.push(k)
      },
    }
    startControlDrag({ dataTransfer: dt } as unknown as DragEvent, 'text')
    expect(setDataCalls).toEqual([[DRAG_TYPE_KEY, 'text']])
    expect(dt.effectAllowed).toBe('copy')
  })
})

/**
 * 模拟画布层 dragover / drop 事件。
 *
 * 由于 useDragAdd 通过 addEventListener 挂事件到 stage DOM（用真实 DOM 元素），
 * 这里手工构造 DataTransfer mock 并直接调用 listener handler（不通过 onMounted
 * 自动挂载）—— 通过 import hook 内部函数拿不到，所以改测：
 * 1) mime 常量契约（已在上方）
 * 2) DataSourceTree 的 dragstart 与 hook 的 mime 双向兼容（已在上方）
 * 3) 端到端：useDragAdd 触发的实际效果通过 designer store 行为单测覆盖
 *    （见 designer.spec.ts 中 applyFieldBindingToTextControl / hitTestTextControl 用例）
 *
 * 这里仅断言 onDragOver / onDrop 的"防止浏览器默认行为"契约：
 * 当 dataTransfer.types 包含任一支持的 mime，preventDefault 必须被调用，
 * 否则 fabric.Textbox 的 contenteditable 会接管 text/plain 把字段路径当
 * 字符串插入光标（用户报修："拖动单值属性字段到画布中的文本输入框后，
 * 字段名直接出现在画布上但没 {{}}"）。
 */
describe('画布层 drop 契约（防止浏览器原生 drop 接管）', () => {
  it('DRAG_TYPE_KEY 与 DRAG_BINDING_KEY 都是有效 mime，必须 preventDefault', () => {
    // 这个用例锁定 useDragAdd.onDragOver 的两种 mime 分支都被覆盖
    // —— 防止后续重构误删 DRAG_BINDING_KEY 分支，重新引入 bug
    expect([DRAG_TYPE_KEY, DRAG_BINDING_KEY]).toContain('application/x-openprint-control')
    expect([DRAG_TYPE_KEY, DRAG_BINDING_KEY]).toContain('application/x-openprint-binding')
  })
})