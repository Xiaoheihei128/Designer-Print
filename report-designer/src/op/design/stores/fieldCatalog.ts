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

  /* ------------------------------ provider 三选一 ------------------------------ */
  const persisted = loadDataSourcePersisted()
  const kind = ref<DataSourceKind>(persisted.kind)
  const erpAvailable = computed(() => isErpConfigured())

  /* ------------------------------ 计算属性 ------------------------------ */
  const activeSource = computed(
    () => sources.value.find((s) => s.id === activeSourceId.value) ?? null,
  )
  const activeFields = computed(
    () => cache.value.get(activeSourceId.value)?.fields ?? [],
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
  }

  async function loadSources(): Promise<void> {
    sources.value = await _repo.value.listSources()
    if (!sources.value.find((s) => s.id === activeSourceId.value)) {
      activeSourceId.value = sources.value[0]?.id ?? ''
    }
  }

  async function loadFields(sourceId: string, force = false): Promise<void> {
    if (!sourceId) return
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
    setRepository,
    loadSources,
    loadFields,
    selectSource,
    refreshFields,
    selectProvider,
    init,
  }
})