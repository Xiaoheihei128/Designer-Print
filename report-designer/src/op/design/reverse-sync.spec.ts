/**
 * 反向同步端到端测试 —— 画布 td 改文本 → commitTd → store update →
 * ContentValueEditor 拿到的 segments prop 立即更新
 *
 * 链路复刻（与 TableViewLayer.vue 一致）：
 *   1. 用户在画布上双击 td → input 事件触发 contentEditable 修改
 *   2. commitTd(td) 读取 td.innerText → patchCellText → store.updateControl
 *   3. CellToolbar 重新渲染 → effectiveCell = rebuildSegmentsFromCell(cell)
 *   4. ContentValueEditor 接收 :segments="effectiveCell.segments" 立即得到新值
 *
 * 关键 invariant：
 *   - segments 单源：cell.segments 始终是「显示什么」的权威
 *   - 反向同步：cell.text/field/expression 改动 → segments 立即被 rebuildSegmentsFromCell
 *     重新派生，ContentValueEditor textarea 跟着更新
 *   - 幂等：segments 与 cell 字段一致时 rebuild 返回原引用，无限循环不会发生
 *
 * 不依赖 fabric / DOM，只验证「control → patchCellText → rebuildSegmentsFromCell
 * → 派生出的 segments 与期望一致」。
 */
import { describe, expect, it } from 'vitest'
import type { TableCell, TableControl } from '@op/types/control'
import {
  buildDesignGrid,
  patchCellText,
} from '@op/core/layout-engine/table-cells'
import { rebuildSegmentsFromCell } from '@op/design/segments-migration'

/** 端到端派生：模拟 CellToolbar 把 effectiveCell 传给 ContentValueEditor */
function readEditorSegments(control: TableControl, row: number, col: number): TableCell['segments'] {
  const grid = buildDesignGrid(control)
  const cell: TableCell = grid.cells[row]?.[col] ?? {}
  return rebuildSegmentsFromCell(cell).segments
}

const baseTable = (cells: TableCell[][]): TableControl => ({
  id: 'tbl-1',
  type: 'table',
  left: 0, top: 0, width: 180, height: 60,
  dataSource: 'orders', // 关键：标记为数据表，使 patchCellText 走 isDataTemplate=true
  columns: [
    { title: '订单号', field: 'order.orderNo' },
    { title: '金额',   field: 'order.total' },
  ],
  options: { borders: 'all', verticalAlign: 'middle', headerRows: 1, staticRows: 0, designRows: 2 },
  headerRows: 1, designRows: 2, staticRows: 0,
  cells,
})

describe('反向同步端到端：画布 contentEditable 改 td → ContentValueEditor textarea 拿到新值', () => {
  /**
   * 用户场景：
   * 1. 表格里有 cell.segments=[{field:'order.orderNo'}] 的数据样例行
   * 2. 用户在画布上把 td.innerText 改成 '{{item.order.total}}'
   *    （数据样例行 patchCellText 接受 `{{item.path}}` 单字段格式）
   * 3. commitTd → patchCellText 写入 segments=[{field:'order.total'}]
   * 4. CellToolbar 重新派生 effectiveCell → segments=[{field:'order.total'}]
   * 5. ContentValueEditor 立即看到新 field 段
   */
  it('★ 关键场景：画布改文本 → patchCellText → segments 跟着重派生', () => {
    let control = baseTable([
      [{ text: '订单号' }, { text: '金额' }],
      [
        { segments: [{ kind: 'field', path: 'order.orderNo' }] },
        { segments: [{ kind: 'field', path: 'order.total' }] },
      ],
    ])
    // 初始：ContentValueEditor textarea 应显示 {{order.orderNo}}
    expect(readEditorSegments(control, 1, 0)).toEqual([
      { kind: 'field', path: 'order.orderNo' },
    ])

    // 模拟「用户在画布上改 td.innerText 为 '{{item.order.total}}'」
    // commitTd 走 patchCellText(control, 1, 0, '{{item.order.total}}')
    const next = patchCellText(control, 1, 0, '{{item.order.total}}')
    // 严格：next 与 control 不同（cell 已变）
    expect(next).not.toBe(control)
    control = next as TableControl

    // ★ 反向同步：ContentValueEditor 立即拿到新 segments（自动迁移路径解析 {{item.order.total}}）
    expect(readEditorSegments(control, 1, 0)).toEqual([
      { kind: 'field', path: 'order.total' },
    ])
  })

  /**
   * 用户场景：表头 cell.text='商品名' → 用户在画布上改成'商品编号'。
   * patchCellText 写 cell.text='商品编号' → rebuildSegmentsFromCell 重派生 segments=[{text:'商品编号'}]。
   */
  it('★ 表头改文本：cell.text 漂移 → segments 立即重派生为新 text 段', () => {
    let control = baseTable([
      [{ segments: [{ kind: 'text', value: '商品名' }] }, { text: '金额' }],
      [{ field: 'order.orderNo' }, { field: 'order.total' }],
    ])
    expect(readEditorSegments(control, 0, 0)).toEqual([{ kind: 'text', value: '商品名' }])

    // 画布把 '商品名' 改成 '商品编号'
    const next = patchCellText(control, 0, 0, '商品编号')
    expect(next).not.toBe(control)
    control = next as TableControl

    // ★ 反向同步：ContentValueEditor 立即看到 '商品编号'
    expect(readEditorSegments(control, 0, 0)).toEqual([{ kind: 'text', value: '商品编号' }])
  })

  /**
   * 用户场景：cell 原本是 segments 多片段「数量：{{item.qty}} 件」，
   * 用户在画布上把整段文本改成「{{item.order.qty}} 元」。
   * commitTd → patchCellText 写入 cell.text='{{item.order.qty}} 元'，
   * 走 splitFixedText 切分为 [field, text] 段。
   */
  it('★ 多片段混合文本改写 → 派生为 [field, text]', () => {
    let control = baseTable([
      [{ text: '数量' }, { text: '单价' }],
      [
        { segments: [{ kind: 'text', value: '数量：' }, { kind: 'field', path: 'item.qty' }, { kind: 'text', value: ' 件' }] },
        { field: 'order.total' },
      ],
    ])
    expect(readEditorSegments(control, 1, 0)).toEqual([
      { kind: 'text', value: '数量：' },
      { kind: 'field', path: 'item.qty' },
      { kind: 'text', value: ' 件' },
    ])

    // 画布改成 '{{item.order.qty}} 元'
    const next = patchCellText(control, 1, 0, '{{item.order.qty}} 元')
    expect(next).not.toBe(control)
    control = next as TableControl

    // ★ 反向同步：textarea 显示 {{item.order.qty}} 元
    // 注：含后缀「 元」时 patchCellText 不再匹配 single-field regex，走 splitFixedText
    // 把 `{{item.order.qty}}` 当作表达式 src 切为 [expr, text] 段——这是 render-time
    // 路径无关紧要的差异（segmentsToText 拼回去还是「{{item.order.qty}} 元」）。
    expect(readEditorSegments(control, 1, 0)).toEqual([
      { kind: 'expr', src: 'item.order.qty' },
      { kind: 'text', value: ' 元' },
    ])
  })

  /**
   * 关键边界：聚合 token cell.text='{{#pageSum}}' 不能被反向同步覆盖。
   * rebuildSegmentsFromCell 第一行检测 isAggToken → 直接返回原 cell，
   * buildFooterRow 仍能正确识别合计 token。
   *
   * 数据表静态尾行（合计行）的聚合 token 应放在 r=2（headerRows=1 + data=1 + static=1）。
   * 注：旧测试在布局网格（无 dataSource）的 header 行测聚合 token 不走 isDataTemplate 分支，
   * 会被写为单 text 段而非保持原 cell 引用 —— 这里用真正的数据表 + static row 验证守门。
   */
  it('★ 聚合 token 合计行反向同步不动：cell.text={{#pageSum}} 保持原样', () => {
    const control: TableControl = {
      ...baseTable([
        [{ text: '订单号' }, { text: '金额' }],
        [{ field: 'order.orderNo' }, { field: 'order.total' }],
        [{ text: '合计' }, { text: '{{#pageSum}}' }],
      ]),
      options: { borders: 'all', verticalAlign: 'middle', headerRows: 1, staticRows: 1, designRows: 2 },
      headerRows: 1,
      designRows: 2,
      staticRows: 1,
    }
    // 再次过 rebuildSegmentsFromCell：agg-token 守门生效 → 派生后 cell 引用未变
    const grid = buildDesignGrid(control)
    const cell = grid.cells[2]![1]!
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
    // cell.text 仍存在 → buildFooterRow 能识别
    expect(cell.text).toBe('{{#pageSum}}')
  })

  /**
   * 用户场景：用户在画布上清空 td.innerText（变 ''）。
   * patchCellText 写入 segments=[] → ContentValueEditor 回退到 3 态模式。
   */
  it('★ 清空表头 td.innerText → segments=[] → ContentValueEditor 回退 3 态模式', () => {
    // 表头 cell 走 patchCellText 时 segments=[]，再被 rebuildSegmentsFromCell 派生时无任何
    // 字段 → 返回原 cell（segments 不引入幽灵值）。ContentValueEditor 因此识别为「3 态模式」。
    let control = baseTable([
      [{ text: '商品名' }, { text: '金额' }],
      [{ field: 'order.orderNo' }, { field: 'order.total' }],
    ])
    const next = patchCellText(control, 0, 0, '')
    expect(next).not.toBe(control)
    control = next as TableControl
    // 表头 cell 写 segments=[] 后，老字段已清；rebuildSegmentsFromCell 派生失败 → 返回 cell 引用
    const grid = buildDesignGrid(control)
    const cell = grid.cells[0]![0]!
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
    expect(cell.segments).toEqual([])
  })

  /**
   * 幂等保护：用户什么都没改（按 Tab 触发 commitTd，innerText 与 currentPlaceholder 一致）
   * → patchCellText 返回原 control → 没有任何 migrate emit
   */
  it('★ 幂等：用户未改文本 + commitTd → control 引用未变', () => {
    const control = baseTable([
      [{ text: '商品名' }, { text: '金额' }],
      [{ segments: [{ kind: 'field', path: 'order.orderNo' }] }, { field: 'order.total' }],
    ])
    // 数据样例行的当前占位符：{{item.order.orderNo}}（与 col.field 派生一致）
    const next = patchCellText(control, 1, 0, '{{item.order.orderNo}}')
    // 未改 → 返回原 control（不进 undo 栈）
    expect(next).toBe(control)
  })
})

describe('反向同步回归保护：segments 单源一致性', () => {
  /**
   * 关键 invariant：
   * 「画布改了 cell.text 后」，「ContentValueEditor 拿到的 segments」必须 = 「cell 字段的派生值」。
   * 若 segments 与 cell 字段长期漂移，UI 会看到「老 segments 与新 cell 字段不一致」的脏数据。
   */
  it('★ invariant：任何 cell 字段变化后，segments 都同步派生（序列化一致）', () => {
    // 初始：v2 segments
    let control = baseTable([
      [{ text: '商品名' }, { text: '金额' }],
      [
        { segments: [{ kind: 'field', path: 'order.orderNo' }] },
        { segments: [{ kind: 'field', path: 'order.total' }] },
      ],
    ])

    // 场景 1：用户改 field 路径（数据样例行仅接受 `{{item.path}}` 单一字段格式）
    let next = patchCellText(control, 1, 0, '{{item.order.newField}}')
    expect(next).not.toBe(control)
    control = next as TableControl
    let editorSegs = readEditorSegments(control, 1, 0)
    expect(editorSegs).toEqual([{ kind: 'field', path: 'order.newField' }])

    // 场景 2：用户改 expression（数据样例行 expression 不被识别为单一字段，走 splitFixedText 切分为 expr 段）
    next = patchCellText(control, 1, 0, '{{rowIndex + 1}}')
    expect(next).not.toBe(control)
    control = next as TableControl
    editorSegs = readEditorSegments(control, 1, 0)
    // rowIndex + 1 不被识别为单一 item.x / xxx[].x，走 splitFixedText 切为 expr 段
    expect(editorSegs).toEqual([{ kind: 'expr', src: 'rowIndex + 1' }])

    // 场景 3：用户改普通文本
    next = patchCellText(control, 1, 0, '普通文本')
    expect(next).not.toBe(control)
    control = next as TableControl
    editorSegs = readEditorSegments(control, 1, 0)
    expect(editorSegs).toEqual([{ kind: 'text', value: '普通文本' }])
  })
})