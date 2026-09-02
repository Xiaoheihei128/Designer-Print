/**
 * collectLeafPaths —— 把业务 JSON 拍平为 leaf path 集合
 *
 * 与 introspectJson 的路径语义对齐（'.' 分隔 / '[]' 数组标记 / 8 层上限）。
 * 用于 fieldCatalog diffCoverage 与 DataSourceTree「数据中的新字段」分组。
 */
import { describe, expect, it } from 'vitest'
import { collectLeafPaths } from './collect-leaf-paths'

describe('collectLeafPaths', () => {
  it('顶层 object 字段', () => {
    const r = collectLeafPaths({ Header: { ReportNo: 'R1', SupplierName: 'X' } })
    expect([...r].sort()).toEqual(['Header.ReportNo', 'Header.SupplierName'])
  })

  it('嵌套 object 不在本层产生 path', () => {
    // introspectJson 语义：嵌套 object 是分组节点，不算 leaf
    const r = collectLeafPaths({ Header: { Inspector: { Name: '张三' } } })
    expect([...r]).toEqual(['Header.Inspector.Name'])
  })

  it('detail 数组：每行并集 + [] 标记', () => {
    const r = collectLeafPaths({
      Header: { ReportNo: 'R1' },
      ReportItems: [
        { TestStandard: 'A', Result: '合格' },
        { TestStandard: 'B', FinalVal: 1.5 }, // 并集
      ],
    })
    expect([...r].sort()).toEqual([
      'Header.ReportNo',
      'ReportItems[]',
      'ReportItems[].FinalVal',
      'ReportItems[].Result',
      'ReportItems[].TestStandard',
    ])
  })

  it('空数组保留 path（数组字段存在）', () => {
    const r = collectLeafPaths({ Items: [] })
    expect([...r]).toEqual(['Items[]'])
  })

  it('null / undefined 叶子保留 path', () => {
    const r = collectLeafPaths({ a: null, b: undefined, c: 'x' })
    expect([...r].sort()).toEqual(['a', 'b', 'c'])
  })

  it('标量数组：path + []（不再下钻）', () => {
    const r = collectLeafPaths({ Tags: ['a', 'b', 'c'] })
    expect([...r]).toEqual(['Tags[]'])
  })

  it('深度上限 8：超过则不再下钻', () => {
    // 8 层嵌套里有一个 { v: 'leaf' }：第 8 层 key 是 'k'，其子键 'v' 递归进入 depth=8 时标量分支，产出 leaf
    let deep: unknown = { v: 'leaf' }
    for (let i = 0; i < 7; i++) deep = { k: deep }
    const r = collectLeafPaths(deep)
    expect([...r]).toContain('k.k.k.k.k.k.k.v')
  })

  it('深度上限 8：嵌套过深（>8 层）不产出 leaf（防爆栈）', () => {
    let deep: unknown = { v: 'leaf' }
    for (let i = 0; i < 12; i++) deep = { k: deep }
    const r = collectLeafPaths(deep)
    expect([...r]).toEqual([])
  })

  it('空对象叶子保留 path', () => {
    const r = collectLeafPaths({ a: {} })
    expect([...r]).toEqual(['a'])
  })

  it('顶层纯标量', () => {
    const r = collectLeafPaths('hello')
    // 顶层无 prefix → 不记录（与 introspectJson 顶层标量落 __root__ 表的语义略不同；
    // 这里只关心 object 树下的 leaf path，顶层标量无 prefix 不产生业务路径）
    expect([...r]).toEqual([])
  })
})