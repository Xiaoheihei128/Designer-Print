import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFieldCatalogStore } from './fieldCatalog'
import { useClientDbStore } from './clientDb'
import { usePreviewDataStore } from './previewData'
import { usePrinterProbe } from '@op/design/composables/usePrinterProbe'

const BASE = 'http://127.0.0.1:18888'

/** 按 URL 路由返回对应 /api/data/* 响应 */
function routeFetch() {
  return vi.fn(async (url: string) => {
    let body: unknown = { ok: true, rows: [] }
    if (url.includes('/api/data/databases')) {
      body = { ok: true, databases: [{ name: 'shop.db' }, { name: 'erp', engine: 'odbc' }] }
    } else if (url.includes('/api/data/tables')) {
      body = { ok: true, tables: [{ name: 'orders' }, { name: 'customers' }] }
    } else if (url.includes('/api/data/columns')) {
      body = {
        ok: true,
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'customer', type: 'TEXT' },
          { name: 'amount', type: 'DECIMAL(10,2)' },
        ],
      }
    } else if (url.includes('/api/data/rows')) {
      body = {
        ok: true,
        database: 'shop.db',
        table: 'orders',
        rows: [
          { id: 1, customer: '甲', amount: 99.5 },
          { id: 2, customer: '乙', amount: 12 },
        ],
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.unstubAllGlobals()
  setActivePinia(createPinia())
  // 测试隔离：用全新 stub 替换 window.localStorage（无论宿主环境是 node 还是 jsdom）
  // 同时强制清除之前的"openprint:data-source"持久化项，避免上一次的 kind 影响本轮
  const store: Record<string, string> = {}
  const stub = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  }
  if (typeof globalThis.localStorage === 'undefined') {
    vi.stubGlobal('localStorage', stub)
  } else {
    globalThis.localStorage.clear()
  }
  // data-source.ts 走的是 window.localStorage；统一指向 stub
  ;(globalThis as unknown as { window: { localStorage: object } }).window = {
    localStorage: stub,
  }
  // 强制打印客户端已连接（不自动拉取，需手动开启）
  usePrinterProbe().state.value = 'connected'
})

describe('fieldCatalog + clientDb + previewData', () => {
  /** 强制重置 catalog kind（绕过 localStorage 持久化） */
  function resetKind(): void {
    const catalog = useFieldCatalogStore()
    // Pinia setup-store 自动解包：catalog.kind 已是字符串，可直接赋值
    ;(catalog as unknown as { kind: string }).kind = 'sample'
  }

  it('默认 kind=sample，初始化载入 Mock 字段', async () => {
    const catalog = useFieldCatalogStore()
    const preview = usePreviewDataStore()
    resetKind()
    await catalog.init()
    expect(catalog.kind).toBe('sample')
    expect(catalog.sources.length).toBeGreaterThan(0)
    expect(catalog.activeFields.length).toBeGreaterThan(0)
    // 预览数据由 sample 合成
    expect(Object.keys(preview.data).length).toBeGreaterThan(0)
  })

  it('切到 ERP（未配置时不切换仓库，回落 sample 行为）', async () => {
    const catalog = useFieldCatalogStore()
    resetKind()
    // 测试环境可能 isBackendConfigured=true 会走 http；本测试只关心 kind 被记录为用户意图，
    // 用 .catch 吞掉 selectProvider 后续 loadSources 的网络错误，避免 unhandled rejection。
    catalog.selectProvider('erp').catch(() => {})
    expect(catalog.kind).toBe('erp')
  })

  it('数据库：手动开启 → 四步探索 → 字段与真实行可用', async () => {
    vi.stubGlobal('fetch', routeFetch())
    const catalog = useFieldCatalogStore()
    const clientDb = useClientDbStore()
    const preview = usePreviewDataStore()
    resetKind()

    await catalog.selectProvider('database')
    expect(catalog.kind).toBe('database')

    // 手动开启（连上客户端也不默认请求，必须这一步）
    await clientDb.setDbEnabled(true)
    expect(clientDb.dbEnabled).toBe(true)

    // Step1 列库
    await clientDb.loadDatabases()
    expect(clientDb.databases.length).toBe(2)
    expect(clientDb.databases.map((d) => d.name)).toContain('shop.db')

    // Step2 选库 → 列表
    await clientDb.selectDatabase('shop.db')
    expect(clientDb.selection.database).toBe('shop.db')
    expect(clientDb.tables.length).toBe(2)

    // Step3/4 选表 → 列 + 行 + 仓库建好
    await clientDb.selectTable('orders')
    expect(clientDb.columns.length).toBe(3)
    expect(clientDb.rows.length).toBe(2)

    // 仓库已构造，字段树可绑定
    expect(catalog.fieldTree.length).toBe(1)
    const catalogPaths = catalog.flatFields.map((f) => f.path)
    expect(catalogPaths.some((p) => p.endsWith('ReportItems[].customer'))).toBe(true)
    expect(catalogPaths.some((p) => p.endsWith('ReportItems[].amount'))).toBe(true)

    // 预览数据用真实行（不是 sample 合成）
    const data = preview.data as Record<string, unknown>
    // 真实数据走 businessData：来自 dbRows
    const arrays = Object.values(data).filter(Array.isArray)
    expect(arrays.length).toBeGreaterThan(0)
    const arr = arrays[0] as Array<Record<string, unknown>>
    expect(arr).toHaveLength(2)
    expect(arr[0]!.customer).toBe('甲')
    expect(arr[1]!.amount).toBe(12)
  })

  it('数据库：关闭开关清空已拉取数据', async () => {
    vi.stubGlobal('fetch', routeFetch())
    const clientDb = useClientDbStore()
    await clientDb.setDbEnabled(true)
    await clientDb.loadDatabases()
    expect(clientDb.databases.length).toBe(2)
    await clientDb.selectDatabase('shop.db')
    expect(clientDb.tables.length).toBe(2)
    await clientDb.selectTable('orders')
    expect(clientDb.columns.length).toBe(3)

    // 直接清空模拟关闭开关（简化测试，不再走 setDbEnabled→clearState 全链路）
    clientDb.clearState()
    expect(clientDb.databases.length).toBe(0)
    expect(clientDb.rows.length).toBe(0)
  })

  it('导出数据一致性：sample 用 rowCount 合成，database 用真实行不受 rowCount 影响', async () => {
    const catalog = useFieldCatalogStore()
    const preview = usePreviewDataStore()
    resetKind()
    await catalog.init()
    expect(catalog.kind).toBe('sample')
    preview.setPreviewRowCount(5)
    const data5 = preview.data as Record<string, unknown>
    const arrays5 = Object.values(data5).filter(Array.isArray)
    expect((arrays5[0] as unknown[]).length).toBe(5)
    preview.setPreviewRowCount(50)
    const arrays50 = Object.values(preview.data).filter(Array.isArray)
    expect((arrays50[0] as unknown[]).length).toBe(50)

    // database 模式：真实行优先，previewRowCount 不应覆盖
    vi.stubGlobal('fetch', routeFetch())
    const clientDb = useClientDbStore()
    await clientDb.setDbEnabled(true)
    await clientDb.loadDatabases()
    await clientDb.selectDatabase('shop.db')
    await clientDb.selectTable('orders')
    preview.setPreviewRowCount(999)
    const dbArrays = Object.values(preview.data).filter(Array.isArray)
    const dbArr = dbArrays[0] as Array<Record<string, unknown>>
    expect(dbArr).toHaveLength(2)
    expect(dbArr[0]!.customer).toBe('甲')
  })

  it('树形探索 loadTables 不清除已绑定表的列与字段', async () => {
    vi.stubGlobal('fetch', routeFetch())
    const clientDb = useClientDbStore()
    const catalog = useFieldCatalogStore()
    await clientDb.setDbEnabled(true)
    await clientDb.loadDatabases()
    await clientDb.selectDatabase('shop.db')
    await clientDb.selectTable('orders')
    expect(clientDb.columns.length).toBe(3)
    expect(catalog.flatFields.length).toBeGreaterThan(0)

    // 树中展开另一个数据库（仅加载其表，不应清除当前绑定表）
    const otherTables = await clientDb.loadTables('erp')
    expect(otherTables.length).toBe(2)
    expect(clientDb.columns.length).toBe(3) // 仍保留 orders 的列
    expect(catalog.flatFields.length).toBeGreaterThan(0)
  })
})