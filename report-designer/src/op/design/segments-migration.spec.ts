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
})