/**
 * fieldCatalog store —— 字段目录从哪来
 *
 * 单一职责：
 * - 管理当前激活的数据源（mock / ERP / 客户端 db）
 * - 拉取并缓存字段定义（10 分钟 TTL）
 * - 提供 activeFields / flatFields / fieldTree 给 UI 消费
 *
 * 与 businessData 的边界：
 * - 本 store **只管字段定义**（FieldDef / DataSourceMeta），不持有真实业务数据
 * - 真实数据走 useBusinessDataStore，由 clientDb / matcher / sample 合成各自注入
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { DataSourceRepository, DataSourceMeta, FieldDef } from '@op/types/datasource'
import { createMockDataSource } from '@op/repository/mock/mock-datasource'
import { createDataSourceHttp } from '@op/repository/http-datasource'
import { getBackendConfig, isBackendConfigured } from '@op/config/backend'
import { isErpConfigured, loadDataSourcePersisted, saveDataSourcePersisted, type DataSourceKind } from '@op/config/data-source'
import { introspectJson, type IntrospectOptions } from '@op/repository/introspect-json'

const CACHE_TTL = 10 * 60 * 1000 // 10 分钟

interface CacheEntry {
  fields: FieldDef[]
  fetchedAt: number
}

export const useFieldCatalogStore = defineStore('fieldCatalog', () => {
  /* ------------------------------ 仓库与状态 ------------------------------ */
  const _repo = shallowRef<DataSourceRepository>(createMockDataSource())
  const sources = ref<DataSourceMeta[]>([])
  const activeSourceId = ref<string>('')
  const cache = ref<Map<string, CacheEntry>>(new Map())
  const loading = ref(false)

  /**
   * ★ 注入覆盖层：从运行时 JSON 反推的字段目录。
   *   优先级高于仓库返回的 sources / cache —— 设计期"目录说有这个字段、数据没有"
   *   不一致问题（§matcher 页 → 设计器路径）的兜底：
   *   matcher 匹配成功后用用户输入的 JSON 调用 injectFromJson 覆盖目录，
   *   进了设计器字段树就是"这份数据真实拥有的字段"，拖什么有什么。
   *   切换 provider / 显式调用 clearInjection 时清掉。
   */
  const _injectedMeta = ref<Map<string, DataSourceMeta>>(new Map())
  const _injectedFields = ref<Map<string, FieldDef[]>>(new Map())

  /* ------------------------------ provider 三选一 ------------------------------ */
  const persisted = loadDataSourcePersisted()
  const kind = ref<DataSourceKind>(persisted.kind)
  const erpAvailable = computed(() => isErpConfigured())

  /* ------------------------------ 计算属性 ------------------------------ */
  const activeSource = computed(
    () =>
      _injectedMeta.value.get(activeSourceId.value) ??
      sources.value.find((s) => s.id === activeSourceId.value) ??
      null,
  )
  const activeFields = computed(
    () =>
      _injectedFields.value.get(activeSourceId.value) ??
      cache.value.get(activeSourceId.value)?.fields ??
      [],
  )
  /** 按 tableId+sort 分组后的树形字段（DataSourceTree 渲染用） */
  const fieldTree = computed(() => {
    const fields = activeFields.value.filter((f) => !f.hidden)
    const tables = activeSource.value?.tables ?? []
    const byTable: Record<string, FieldDef[]> = {}
    for (const t of tables) byTable[t.id] = []
    for (const f of fields) {
      const tid = f.tableId ?? ''
      ;(byTable[tid] ??= []).push(f)
    }
    return tables.map((t) => ({
      table: t,
      fields: (byTable[t.id] ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    }))
  })
  /** 扁平字段列表（供 BindingEditor 下拉） */
  const flatFields = computed(() =>
    activeFields.value
      .filter((f) => !f.hidden)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
  )

  /* ------------------------------ 操作 ------------------------------ */

  /** 持久化 */
  function persist(): void {
    saveDataSourcePersisted({ kind: kind.value, dbEnabled: persisted.dbEnabled })
  }

  /** 注入底层仓库（clientDb 选中表后由它 setRepository）。 */
  function setRepository(repo: DataSourceRepository): void {
    _repo.value = repo
    cache.value.clear()
    // 切换仓库 = 数据源语义变更，旧注入目录不再可靠
    _injectedMeta.value.clear()
    _injectedFields.value.clear()
  }

  /**
   * 从运行时 JSON 推导字段目录并注入当前激活数据源。
   *
   * 触发时机：matcher 页 handleUseTemplate 跳转到设计器前；或 clientDb 选中表后。
   * 不会修改 sources 列表本身，只在覆盖层注入；切 provider / 重选仓库时自动清掉。
   *
   * ★ 关键副作用：当调用方显式传入 sourceId（matcher 路径），把 activeSourceId 也
   *   切到 targetId。这样 activeSource / activeFields / hasInjection 都立刻指向
   *   注入的目录，避免"已注入但 activeSourceId 还是空字符串 → LeftPanel 看不到
   *   数据源 / BindingEditor 下拉为空"的链路断裂。
   *
   * @param json  业务 JSON 顶层对象
   * @param options 透传给 introspect-json（sourceId/soureName/existingFields/maxDepth）
   * @returns 推导出的字段数（用于日志/提示）
   */
  function injectFromJson(
    json: Record<string, unknown>,
    options: IntrospectOptions = {},
  ): number {
    const explicitId = options.sourceId != null
    const targetId = explicitId ? options.sourceId! : activeSourceId.value
    const existing = activeFields.value
    const { meta, fields } = introspectJson(json, {
      ...options,
      sourceId: targetId,
      existingFields: existing.length > 0 ? existing : options.existingFields,
    })
    _injectedMeta.value.set(targetId, meta)
    _injectedFields.value.set(targetId, fields)
    // 触发响应式（Vue 对 Map.set 不自动追踪，浅拷贝触发依赖）
    _injectedMeta.value = new Map(_injectedMeta.value)
    _injectedFields.value = new Map(_injectedFields.value)
    // 显式 sourceId → 顺带把 activeSourceId 也切过来，让 LeftPanel / BindingEditor
    // 立刻拿到这份注入目录。否则 matcher 跳过来后 activeSourceId 还是空字符串，
    // activeSource=null / activeFields=[]，看上去"目录没数据"。
    if (explicitId) {
      activeSourceId.value = targetId
    }
    return fields.length
  }

  /** 清除指定 sourceId（默认当前激活）的注入覆盖；用户主动"还原目录"时调用 */
  function clearInjection(sourceId?: string): void {
    const targetId = sourceId ?? activeSourceId.value
    if (!targetId) return
    _injectedMeta.value.delete(targetId)
    _injectedFields.value.delete(targetId)
    _injectedMeta.value = new Map(_injectedMeta.value)
    _injectedFields.value = new Map(_injectedFields.value)
  }

  /** 当前是否有注入覆盖（用于 UI 显示"目录来源：JSON 内省"标记） */
  const hasInjection = computed(
    () => _injectedMeta.value.has(activeSourceId.value),
  )

  async function loadSources(): Promise<void> {
    sources.value = await _repo.value.listSources()
    // ★ 注入覆盖保护：如果当前 activeSourceId 已经映射到一份注入目录（matcher 路径），
    //   不要因为 loadSources 把它"不在 mock sources 列表里"就改写回 mock[0]。
    //   否则 matcher 注入完跳到设计器，DataSourceTree.onMounted 一调 init() →
    //   loadSources() 就把 activeSourceId 改写为 'mockRawMaterial'，注入目录瞬间被
    //   覆盖掉，左栏看到的是 mock 原料字段而非用户那份 JSON 真实字段。
    if (_injectedMeta.value.has(activeSourceId.value)) return
    if (!sources.value.find((s) => s.id === activeSourceId.value)) {
      activeSourceId.value = sources.value[0]?.id ?? ''
    }
  }

  async function loadFields(sourceId: string, force = false): Promise<void> {
    if (!sourceId) return
    // 注入目录不走仓库缓存（仓库里压根没这个 sourceId），直接 return
    if (_injectedFields.value.has(sourceId)) return
    const cached = cache.value.get(sourceId)
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL
    if (fresh && !force) return
    loading.value = true
    try {
      const fields = await _repo.value.getFields(sourceId)
      cache.value.set(sourceId, { fields, fetchedAt: Date.now() })
    } finally {
      loading.value = false
    }
  }

  function selectSource(id: string): void {
    activeSourceId.value = id
    void loadFields(id)
  }

  /** 用户手动刷新：强制重新拉取当前激活数据源的字段 */
  async function refreshFields(): Promise<void> {
    await loadFields(activeSourceId.value, true)
  }

  /** 选择 provider（非 db 模式）：切换底层仓库 */
  async function selectProvider(next: DataSourceKind): Promise<void> {
    kind.value = next
    persist()
    // 切 provider = 数据源语义变更，旧的 JSON 内省目录不再可靠
    _injectedMeta.value.clear()
    _injectedFields.value.clear()
    if (next === 'database') return // db 模式由 clientDb 处理
    _repo.value =
      next === 'erp' && isBackendConfigured
        ? createDataSourceHttp(getBackendConfig()!.options)
        : createMockDataSource()
    cache.value.clear()
    await loadSources()
    if (activeSourceId.value) await loadFields(activeSourceId.value)
  }

  /** 初始化：按当前仓库载入 sources + fields（canvas 挂载时调用） */
  async function init(): Promise<void> {
    await loadSources()
    if (activeSourceId.value) await loadFields(activeSourceId.value)
  }

  return {
    sources,
    activeSourceId,
    activeSource,
    activeFields,
    fieldTree,
    flatFields,
    loading,
    kind,
    erpAvailable,
    hasInjection,
    setRepository,
    loadSources,
    loadFields,
    selectSource,
    refreshFields,
    selectProvider,
    injectFromJson,
    clearInjection,
    init,
  }
})