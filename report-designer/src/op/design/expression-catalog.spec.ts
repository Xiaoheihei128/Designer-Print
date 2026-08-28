/**
 * expression-catalog —— 表达式 / 聚合 token 目录单元测试
 *
 * 覆盖：分类完整性、聚合 token 必须带 # 前缀（与普通 sum() 函数明确区分）、
 * 8 个 token 名称对应 aggregate.ts 的 AggKind。
 */
import { describe, expect, it } from 'vitest'
import { EXPRESSION_CATALOG } from './expression-catalog'
import { isAggToken } from '@op/core/layout-engine/aggregate'

describe('expression-catalog', () => {
  it('包含分类：合计统计 + 聚合 token', () => {
    const keys = EXPRESSION_CATALOG.map((c) => c.key)
    expect(keys).toContain('aggregate')
    expect(keys).toContain('aggregate-token')
  })

  it('聚合 token 分类：8 项，全部带 # 前缀', () => {
    // 修复 Bug3：用户漏打 # 时聚合函数找不到 —— 目录条目必须明确用 # 开头
    const cat = EXPRESSION_CATALOG.find((c) => c.key === 'aggregate-token')
    expect(cat).toBeDefined()
    expect(cat!.items.length).toBe(8)
    for (const item of cat!.items) {
      expect(item.snippet.startsWith('{{#')).toBe(true)
      expect(isAggToken(item.snippet)).toBe(true)
    }
  })

  it('普通 sum/avg/count 函数不带 #（与聚合 token 区分）', () => {
    // 修复合计统计分类与聚合 token 分类不混用
    const agg = EXPRESSION_CATALOG.find((c) => c.key === 'aggregate')!
    for (const item of agg.items) {
      expect(isAggToken(item.snippet)).toBe(false)
    }
  })
})