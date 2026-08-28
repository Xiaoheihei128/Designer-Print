/**
 * useDragAdd 单测：M1 控件拖拽
 *
 * 覆盖：
 * - DRAG_TYPE_KEY / DRAG_BINDING_KEY 常量（前者 hook 内部用，后者供 DataSourceTree 引用）
 * - startControlDrag 写 application/x-openprint-control mime
 *
 * 字段绑定改走"左键点单元格 + 点击左栏字段"路径（DataSourceTree.onFieldClick → store.bindFieldToCell），
 * 不再需要 binding drag detector。
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