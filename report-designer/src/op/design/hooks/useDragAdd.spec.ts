/**
 * useDragAdd 单测：M1 控件拖拽 + 字段拖到编辑态文本框
 *
 * 覆盖：
 * - DRAG_TYPE_KEY / DRAG_BINDING_KEY 常量（前者 hook 内部用，后者供 DataSourceTree 引用）
 * - startControlDrag 写 application/x-openprint-control mime
 * - shouldAcceptBindingDrop：判定画布上是否在「编辑态文本控件」用于决定是否
 *   preventDefault 允许字段 drop（Bug：之前浏览器原生 drop 把裸路径插 hiddenTextarea，
 *   segments 模式没 {{}} 包裹 → 渲染层 resolveBinding 找不到 → 字段值丢）
 */
import { describe, expect, it } from 'vitest'
import {
  DRAG_BINDING_KEY,
  DRAG_TYPE_KEY,
  shouldAcceptBindingDrop,
  startControlDrag,
} from './useDragAdd'

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

describe('shouldAcceptBindingDrop', () => {
  it('编辑态 + 有 hiddenTextarea → 接受 drop', () => {
    expect(shouldAcceptBindingDrop({ isEditing: true, hiddenTextarea: {} })).toBe(true)
  })
  it('未在编辑态 → 拒绝（让浏览器原生处理，避免误吞 drop）', () => {
    expect(shouldAcceptBindingDrop({ isEditing: false, hiddenTextarea: {} })).toBe(false)
  })
  it('缺 hiddenTextarea → 拒绝（fabric 未进入编辑态，无输入桥）', () => {
    expect(shouldAcceptBindingDrop({ isEditing: true })).toBe(false)
  })
  it('null / undefined → 拒绝', () => {
    expect(shouldAcceptBindingDrop(null)).toBe(false)
    expect(shouldAcceptBindingDrop(undefined)).toBe(false)
  })
  it('非对象（数字/字符串）→ 拒绝', () => {
    expect(shouldAcceptBindingDrop(42)).toBe(false)
    expect(shouldAcceptBindingDrop('text')).toBe(false)
  })
})