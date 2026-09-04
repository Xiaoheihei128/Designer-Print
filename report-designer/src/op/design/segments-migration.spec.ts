import { describe, expect, it } from 'vitest'

import type { TableCell } from '@op/types/control'

import { ensureSegments, rebuildSegmentsFromCell } from '@op/design/segments-migration'

describe('ensureSegments lazy migration', () => {
  it('cell: text 含 {{...}} 混合内容 → segments 正确生成（保留前后缀）', () => {
    // 用户场景：先绑了 field='ReportItems[].TestStandard'，又在 cell 里输入 "kg" 后缀
    // 旧版 sameLegacy 把这次迁移吞掉（c.segments undefined + 老字段一致 → 判定"相同"）
    const cell: TableCell = {
      text: '{{ReportItems[].TestStandard}} kg',
      field: 'ReportItems[].TestStandard',
    }
    const next = ensureSegments(cell)
    expect(next.segments).toEqual([
      { kind: 'expr', src: 'ReportItems[].TestStandard' },
      { kind: 'text', value: ' kg' },
    ])
  })

  it('cell: 已是新模型（segments 存在）→ 原样返回', () => {
    const cell: TableCell = {
      text: 'irrelevant',
      segments: [{ kind: 'text', value: 'abc' }],
    }
    expect(ensureSegments(cell)).toBe(cell)
  })

  it('cell: agg-token {{#xxx}} → 永远不动', () => {
    const cell: TableCell = { text: '{{#pageSum}}' }
    expect(ensureSegments(cell)).toBe(cell)
  })

  it('cell: 完全空 → 原样返回', () => {
    expect(ensureSegments({} as TableCell)).toEqual({})
  })

  it('★ 回归：cell.text="" (fixed 模式已清空，无其他字段) → 不生成 [{text:""}]', () => {
    // 现实场景：用户在 segments UI 里清空 textarea，emit update:segments: [] + 同步清空 v1 字段，
    // 残留 cell.text=""（fixed 模式 textarea 内容）。再次打开 CellToolbar 时
    // ensureSegments 跑 legacyToSegments({type:'cell', contentType:'fixed', text:''})，
    // 旧版返回 [{text:''}] → store 被写脏：segments.length=1 但 segmentsToText=''，
    // "1 个片段"标签暴露脏数据。修复后 legacyToSegments 在空/纯空白时返回 null，
    // ensureSegments 直接返回原 cell（不添加 segments）。
    const cell: TableCell = { text: '', contentType: 'fixed' }
    const next = ensureSegments(cell)
    expect(next.segments).toBeUndefined()
    expect(next).toBe(cell)
  })

  it('★ 回归：cell.text="   \\n   " (纯空白) → 不生成 [{text:""}]', () => {
    const cell: TableCell = { text: '   \n   ', contentType: 'fixed' }
    const next = ensureSegments(cell)
    expect(next.segments).toBeUndefined()
    expect(next).toBe(cell)
  })

  it('★ 回归：c.segments undefined + 老字段一致 + next.segments 有值 → 必须判定"不同"', () => {
    // 这是 sameLegacy 的核心场景 —— 以前漏判导致迁移被吞、UI 永远切不到 segments 模式
    const cell: TableCell = {
      text: '外观：{{AnalysisItem}}',
      field: 'ReportItems[].AnalysisItem',
    }
    const next = ensureSegments(cell)
    // 老字段不变
    expect(next.text).toBe(cell.text)
    expect(next.field).toBe(cell.field)
    // 但 segments 必须被添加（这是迁移的产物）
    expect(next.segments).toBeDefined()
    expect(next.segments!.length).toBeGreaterThan(0)
    // 引用不同（迁移确实生效）
    expect(next).not.toBe(cell)
  })

  it('★ CellToolbar 老 schema 场景：cell 只写 field 不写 segments → ensureSegments 立即产出 field 段（避免 textarea 空白）', () => {
    // 用户场景：canvas 上表格 cell 走 cellFromColumn(c, 'data') 派生，只有 field 没 segments。
    // CellToolbar 打开时 effectiveCell 同步调 ensureSegments，textarea 应立刻能看到 {{field}}，
    // 不再依赖异步 watch migrate 写回 store。
    const cell: TableCell = { field: 'ReportItems[].ReportNo' }
    const next = ensureSegments(cell)
    expect(next.segments).toEqual([{ kind: 'field', path: 'ReportItems[].ReportNo' }])
    // 老 field 保留（与 segments 镜像共存；渲染层 segments 优先）
    expect(next.field).toBe('ReportItems[].ReportNo')
  })

  it('★ CellToolbar 老 schema 场景：cell 只写 expression → segments 产出 expr 段', () => {
    const cell: TableCell = { expression: 'rowIndex + 1' }
    const next = ensureSegments(cell)
    expect(next.segments).toEqual([{ kind: 'expr', src: 'rowIndex + 1' }])
  })

  it('CellToolbar 老 schema 场景：cell 空 → ensureSegments 原样返回（不产生幽灵空 segments）', () => {
    // 防止空 cell 被错误地写出 [{kind:'text', value:''}] 占位 segments，触发 UI 误切到 segments 模式
    const cell: TableCell = {}
    expect(ensureSegments(cell)).toBe(cell)
  })
})

describe('rebuildSegmentsFromCell —— 画布→三态输入框反向同步', () => {
  it('★ 反向同步：cell.text 改动 + segments 已存在且与派生值一致 → 幂等返回原引用', () => {
    // 用户在画布 contentEditable 把 'old' 改成 'new'：
    //   - patchCellText 写了 cell.text='new'，但 segments 还是旧的 [{text:'old'}]
    //   - rebuildSegmentsFromCell 按"最新 cell 字段"重新派生
    //   - 新派生 = legacyToSegments({text:'new'}) = [{text:'new'}]
    //   - 当前 segments = [{text:'old'}] → 序列化不一致 → 返回新 cell
    // 验证：派生值与新 text 一致，老字段被清空
    const cell: TableCell = { text: 'new', segments: [{ kind: 'text', value: 'old' }] }
    const next = rebuildSegmentsFromCell(cell)
    expect(next).not.toBe(cell)
    expect(next.segments).toEqual([{ kind: 'text', value: 'new' }])
    expect(next.text).toBeUndefined()
  })

  it('★ 反向同步：segments 与 cell 字段一致 → 幂等返回原引用（不 emit migrate）', () => {
    // 场景：用户画布改完文本后 watch migrate 已写回 segments，下次再触发时不应再 emit
    const cell: TableCell = { segments: [{ kind: 'text', value: 'hello' }] }
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
  })

  it('★ 反向同步：cell.field 改动 → 重建 segments 为 field 段并清空 cell.field', () => {
    // 用户从画布上把绑定的字段从 a 改到 b（path），segments 尚未更新
    const cell: TableCell = { field: 'b', segments: [{ kind: 'field', path: 'a' }] }
    const next = rebuildSegmentsFromCell(cell)
    expect(next.segments).toEqual([{ kind: 'field', path: 'b' }])
    expect(next.field).toBeUndefined()
  })

  it('★ 反向同步：cell 完全空 + segments 已有占位 → 派生失败 → 返回原引用', () => {
    // 防止清空文本后 rebuild 把 segments 也清空（segments 由 caller 通过 patchCell 控制）
    const cell: TableCell = { segments: [] }
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
  })

  it('★ 老 schema lazy migration：cell.text="hello" + segments undefined → 派生 + 清 text', () => {
    // 这条用例与 ensureSegments 行为对齐：rebuildSegmentsFromCell 也承担 lazy 迁移职责
    const cell: TableCell = { text: 'hello' }
    const next = rebuildSegmentsFromCell(cell)
    expect(next.segments).toEqual([{ kind: 'text', value: 'hello' }])
    expect(next.text).toBeUndefined()
  })

  it('★ 老 schema：cell.field="items[].name" + segments undefined → 派生为 field 段', () => {
    const cell: TableCell = { field: 'items[].name' }
    const next = rebuildSegmentsFromCell(cell)
    expect(next.segments).toEqual([{ kind: 'field', path: 'items[].name' }])
    expect(next.field).toBeUndefined()
  })

  it('★ 反向同步：聚合 token cell.text="{{#pageSum}}" → 永远不动', () => {
    // buildFooterRow 直接读 cell.text，移动 segments 会破坏聚合识别
    const cell: TableCell = { text: '{{#pageSum}}' }
    expect(rebuildSegmentsFromCell(cell)).toBe(cell)
  })

  it('★ 反向同步：混合内容 cell.text="{{x}} kg" + segments 漂移 → 重建为 [expr, text]', () => {
    // 用户在画布上把"a kg"改成 "{{x}}kg"这种混合内容，segments 应保持前缀/后缀切分
    const cell: TableCell = { text: '{{x}} kg', segments: [{ kind: 'text', value: 'old' }] }
    const next = rebuildSegmentsFromCell(cell)
    expect(next.segments).toEqual([
      { kind: 'expr', src: 'x' },
      { kind: 'text', value: ' kg' },
    ])
    expect(next.text).toBeUndefined()
  })

  it('★ 反向同步：cell.contentType=variable + cell.field 改路径 → 派生优先用 field（contentType 只是 UI 状态）', () => {
    const cell: TableCell = { contentType: 'variable', field: 'newPath', segments: [{ kind: 'field', path: 'oldPath' }] }
    const next = rebuildSegmentsFromCell(cell)
    expect(next.segments).toEqual([{ kind: 'field', path: 'newPath' }])
    expect(next.field).toBeUndefined()
  })
})