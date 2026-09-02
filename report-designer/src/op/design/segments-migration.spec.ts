import { describe, expect, it } from 'vitest'

import type { TableCell } from '@op/types/control'

import { ensureSegments } from '@op/design/segments-migration'

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