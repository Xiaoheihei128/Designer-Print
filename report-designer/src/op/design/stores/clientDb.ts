/**
 * clientDb store —— 本地打印客户端数据库的「库 → 表 → 列 → 行」探索器
 *
 * 单一职责：
 * - 持有数据库探索器状态（databases / tables / columns / rows / selection）
 * - 调用打印客户端 HTTP 接口拉取数据
 * - 状态变化时联动 fieldCatalog（重新加载字段定义 + 业务数据走 db 真实行）
 *
 * 与 fieldCatalog / businessData 的边界：
 * - fieldCatalog 只管字段目录从哪来，clientDb 选好表后由它构造字段目录
 * - businessData 接受 dbRows 注入，clientDb 拉到的真实行直接喂给 businessData
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  describePrintError,
  fetchClientRows,
  listClientColumns,
  listClientDatabases,
  listClientTables,
  ROWS_DEFAULT_LIMIT,
  type ClientColumn,
  type ClientDatabase,
  type ClientTable,
} from '@op/core/print-client'
import { resolvePrinterBaseUrl } from '@op/config/printer'
import { usePrinterProbe } from '@op/design/composables/usePrinterProbe'
import { useFieldCatalogStore } from './fieldCatalog'
import { useBusinessDataStore } from './businessData'
import { createClientDatabaseSource } from '@op/repository/client-database-source'

const probe = usePrinterProbe()

export const useClientDbStore = defineStore('clientDb', () => {
  /* ------------------------------ 状态 ------------------------------ */
  const databases = ref<ClientDatabase[]>([])
  const tables = ref<ClientTable[]>([])
  const columns = ref<ClientColumn[]>([])
  const rows = ref<Array<Record<string, unknown>>>([])
  const selection = ref<{ database?: string; table?: string }>({})
  const loading = ref(false)
  const error = ref('')
  /** 客户端探测是否已开启（默认 false：连上客户端也不默认请求） */
  const dbEnabled = ref(false)
  /** 客户端是否已连接（由 probe.state 推导） */
  const dbAvailable = computed(() => probe.state.value === 'connected')
  /** 当前 provider 是否可用 = 已连接 + 用户手动开启 */
  const databaseAvailable = computed(() => dbAvailable.value && dbEnabled.value)

  /* ------------------------------ 操作 ------------------------------ */

  async function loadDatabases(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const base = resolvePrinterBaseUrl()
      databases.value = await listClientDatabases(base)
    } catch (e) {
      error.value = describePrintError(e)
    } finally {
      loading.value = false
    }
  }

  async function selectDatabase(name: string): Promise<void> {
    selection.value = { database: name, table: undefined }
    tables.value = []
    columns.value = []
    rows.value = []
    error.value = ''
    await loadTables(name)
  }

  async function loadTables(dbName?: string): Promise<ClientTable[]> {
    const database = dbName ?? selection.value.database
    if (!database) return []
    loading.value = true
    error.value = ''
    try {
      const base = resolvePrinterBaseUrl()
      const res = await listClientTables(base, { database })
      tables.value = res
      return res
    } catch (e) {
      error.value = describePrintError(e)
      return []
    } finally {
      loading.value = false
    }
  }

  async function selectTable(name: string, dbName?: string): Promise<void> {
    selection.value = {
      database: dbName ?? selection.value.database,
      table: name,
    }
    await loadColumnsAndRows()
  }

  /** 选表后并行拉列 + 行，构造字段目录 + 注入业务数据 */
  async function loadColumnsAndRows(): Promise<void> {
    const { database, table } = selection.value
    if (!database || !table) return
    loading.value = true
    error.value = ''
    try {
      const base = resolvePrinterBaseUrl()
      const [cols, rowsRes] = await Promise.all([
        listClientColumns(base, { database, table }),
        fetchClientRows(base, { database, table, limit: ROWS_DEFAULT_LIMIT }),
      ])
      columns.value = cols
      rows.value = rowsRes.rows

      // 构造 db 仓库 → 喂给 fieldCatalog
      const catalog = useFieldCatalogStore()
      catalog.setRepository(
        createClientDatabaseSource({
          database,
          table,
          columns: cols,
          sampleRow: rowsRes.rows[0],
        }),
      )
      await catalog.loadSources()
      const sid = catalog.activeSourceId
      if (sid) await catalog.loadFields(sid, true)

      // 真实行 → 喂给 businessData
      const biz = useBusinessDataStore()
      biz.setFromDbRows(rowsRes.rows, catalog.activeFields)
    } catch (e) {
      error.value = describePrintError(e)
    } finally {
      loading.value = false
    }
  }

  async function reloadRows(): Promise<void> {
    const { database, table } = selection.value
    if (!database || !table) return
    loading.value = true
    error.value = ''
    try {
      const base = resolvePrinterBaseUrl()
      const res = await fetchClientRows(base, { database, table, limit: ROWS_DEFAULT_LIMIT })
      rows.value = res.rows
      const biz = useBusinessDataStore()
      const catalog = useFieldCatalogStore()
      biz.setFromDbRows(res.rows, catalog.activeFields)
    } catch (e) {
      error.value = describePrintError(e)
    } finally {
      loading.value = false
    }
  }

  function clearState(): void {
    databases.value = []
    tables.value = []
    columns.value = []
    rows.value = []
    selection.value = {}
    error.value = ''
  }

  function setDbEnabled(enabled: boolean): void {
    dbEnabled.value = enabled
  }

  /* ------------------------------ 客户端连接联动 ------------------------------ */
  watch(
    () => probe.state.value,
    (s) => {
      if (s !== 'connected') {
        // 客户端断开：清空已拉取数据，避免预览展示过期行
        clearState()
      }
    },
  )

  return {
    databases, tables, columns, rows, selection, loading, error,
    dbEnabled, dbAvailable, databaseAvailable,
    loadDatabases, selectDatabase, loadTables, selectTable, loadColumnsAndRows,
    reloadRows, clearState, setDbEnabled,
  }
})