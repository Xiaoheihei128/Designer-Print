/**
 * 一次性诊断 spec：复现 matcher 页面 handleUseTemplate 链路
 *
 * 背景：matcher 页点击"使用此模板"按钮没反应（用户报修）。
 * 怀疑路径上某个 store 调用静默抛错导致 router.push 之前就 return。
 *
 * 模拟：构造一个半成品/原料 JSON，走完 introspectJson → injectFromJson → 拿回 fields，
 * 比对期望值，看哪一步异常。
 */
import { describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { introspectJson } from '@op/repository/introspect-json'
import { useFieldCatalogStore } from './fieldCatalog'
import { useBusinessDataStore } from './businessData'

describe('matcher 链路一次性诊断', () => {
  it('半成品 JSON 走完 injectFromJson 不抛错', () => {
    setActivePinia(createPinia())

    // ★ 真实业务 JSON：用户在 matcher 页输入的"半成品检验"示例
    const parsed = {
      Header: {
        ReportNo: 'SF-2026-09-01',
        ReportType: 'SemiFinished',
        InspectionDate: '2026-08-30',
        Quantity: 200,
      },
      ReportItems: [
        { Item: '目检', Result: '合格', Val: 99.5 },
        { Item: '水分', Result: '合格', Val: 3.2, Unit: '%' },
      ],
    }

    const fc = useFieldCatalogStore()
    const bc = useBusinessDataStore()

    // 1) 业务数据 setFromMatcher
    expect(() => bc.setFromMatcher(parsed)).not.toThrow()
    expect(bc.data).toStrictEqual(parsed)

    // 2) 内省：单独调一下
    const r = introspectJson(parsed, { sourceId: 'matcher:SemiFinished', sourceName: '半成品（matcher）' })
    expect(r.fields.length).toBeGreaterThan(0)
    expect(r.meta.tables.map((t) => t.id).sort()).toEqual(['Header', 'ReportItems'])

    // 3) injectFromJson（matcher 页 handleUseTemplate 走的就是这条）
    let count = 0
    expect(() => {
      count = fc.injectFromJson(parsed, {
        sourceId: 'matcher:SemiFinished',
        sourceName: '半成品（matcher）',
      })
    }).not.toThrow()
    expect(count).toBeGreaterThan(0)
    expect(fc.hasInjection).toBe(true)

    // 4) activeFields / activeSource 应被注入覆盖
    expect(fc.activeSource?.id).toBe('matcher:SemiFinished')
    expect(fc.activeFields.length).toBe(count)
    const paths = fc.activeFields.map((f) => f.path)
    expect(paths).toContain('Header.ReportNo')
    expect(paths).toContain('ReportItems[].Item')
  })

  it('matcher 路径不存在的字段不应出现在目录里', () => {
    setActivePinia(createPinia())
    const parsed = {
      Header: { ReportNo: 'X', Foo: 1 },
      ReportItems: [{ Item: 'A' }],
    }
    const fc = useFieldCatalogStore()
    fc.injectFromJson(parsed, { sourceId: 'matcher:test' })
    const paths = fc.activeFields.map((f) => f.path)
    expect(paths.every((p) => !p.includes('SupplierName'))).toBe(true)
    expect(paths.every((p) => !p.includes('MaterialName'))).toBe(true)
  })

  it('DataSourceTree.onMounted → catalog.init() 不能覆盖 matcher 注入目录', async () => {
    // 复现用户报修路径：
    //   matcher.handleUseTemplate → injectFromJson('matcher:SemiFinished')
    //   → 跳设计器 → DataSourceTree.onMounted → catalog.init() → loadSources()
    //   旧实现会把 activeSourceId 改写回 mock[0]（'mockRawMaterial'），
    //   注入目录瞬间被覆盖，左栏看到的是 mock 原料字段而非用户那份 JSON。
    setActivePinia(createPinia())
    const parsed = {
      Header: { ReportNo: 'SF-1', Quantity: 50 },
      ReportItems: [{ Item: '目检', Result: '合格' }],
    }
    const fc = useFieldCatalogStore()

    // 1) matcher 路径：注入
    fc.injectFromJson(parsed, {
      sourceId: 'matcher:SemiFinished',
      sourceName: '半成品（matcher）',
    })
    expect(fc.activeSourceId).toBe('matcher:SemiFinished')
    expect(fc.activeFields.some((f) => f.path === 'Header.ReportNo')).toBe(true)

    // 2) DataSourceTree.onMounted 触发 init()
    await fc.init()

    // 3) activeSourceId / activeFields 不能被改写回 mock 原料目录
    expect(fc.activeSourceId).toBe('matcher:SemiFinished')
    expect(fc.activeFields.some((f) => f.path === 'Header.ReportNo')).toBe(true)
    expect(fc.activeFields.every((f) => !f.path.includes('SupplierName'))).toBe(true)
    expect(fc.activeFields.every((f) => !f.path.includes('MaterialName'))).toBe(true)
  })

  it('端到端：matcher → designer → DataSourceTree 看到的字段树只有注入目录的字段', async () => {
    // 整条链路模拟：mock 后端 catalog 提供"原料"所有字段（含 SupplierName/MaterialName），
    // matcher 注入半成品 JSON（无 SupplierName/MaterialName），验证 DataSourceTree
    // 实际消费到的 fieldTree 只包含注入的字段，不混入 mock catalog。
    setActivePinia(createPinia())

    // ★ 关键：先把 mock 后端的字段加载进 cache（模拟 designer.init() 跑完的场景）
    // —— 因为非 db 模式下，DataSourceTree 看到的就是 cache[sale_order] + sales_order sources。
    // 如果 cache 没填就 active，activeFields 会是 []，反而看不出 bug。
    const fc = useFieldCatalogStore()
    await fc.loadSources()
    await fc.loadFields(fc.activeSourceId) // 先加载一份 mock 字段到 cache

    // 验证 mock 后端 catalog 真的"含 SupplierName/MaterialName"（这是 bug 触发条件）
    const mockPaths = fc.activeFields.map((f) => f.path)
    // mock 后端是 sales_order，不是原料；只看是否含这两个有问题的字段
    // —— 这里不强求 mock 一定有 SupplierName，重点是确认缓存里有"目录里声称有的字段"

    // 模拟 matcher 注入：用户选半成品示例（不含 SupplierName/MaterialName）
    const parsed = {
      Header: {
        ReportNo: 'SF-2026-09-01-001',
        ReportType: 'SemiFinished',
        InspectionDate: '2026-08-30',
        Inspector: '刘洋',
        Quantity: 200,
      },
      ReportItems: [
        { Item: '目检', Result: '合格', Val: 99.5 },
        { Item: '水分', Result: '合格', Val: 3.2, Unit: '%' },
      ],
    }
    // matcher.handleUseTemplate 真实调用顺序
    const bc = useBusinessDataStore()
    bc.setFromMatcher(parsed)
    const fieldCount = fc.injectFromJson(parsed, {
      sourceId: 'matcher:SemiFinished',
      sourceName: '半成品检验报告（matcher 内省）',
    })
    expect(fieldCount).toBeGreaterThan(0)

    // 模拟 designer.onMounted 整页路径的 sessionStorage 兜底（幂等）
    // 新格式：复用同一个 sourceId，避免覆盖 matcher 已设的 ID
    fc.injectFromJson(parsed, { sourceId: 'matcher:SemiFinished' })

    // 模拟 DataSourceTree.onMounted → init()（**这是 bug 触发点**）
    await fc.init()

    // ★ DataSourceTree 实际消费 fieldTree，断言里面不含 mock 后端的"原料独有字段"
    const treePaths = fc.fieldTree
      .flatMap((g) => g.fields)
      .map((f) => f.path)
    // 注入的字段必须在
    expect(treePaths).toContain('Header.ReportNo')
    expect(treePaths).toContain('Header.Inspector')
    expect(treePaths).toContain('ReportItems[].Item')
    expect(treePaths).toContain('ReportItems[].Result')

    // ★ 关键断言：activeSourceId 是注入 ID，不是 mock 后端的 sales_order
    expect(fc.activeSourceId).toBe('matcher:SemiFinished')

    // ★ 即使 mock 后端有 SupplierName，注入后用户只能看到半成品 JSON 实际拥有的字段
    expect(treePaths.every((p) => !p.includes('SupplierName'))).toBe(true)
    expect(treePaths.every((p) => !p.includes('MaterialName'))).toBe(true)

    // ★ hasInjection 应为 true（UI 应显示"目录来源：JSON 内省"标记）
    expect(fc.hasInjection).toBe(true)
  })
})
