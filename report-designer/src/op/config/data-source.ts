/**
 * 数据源 provider 配置 —— 三选一（ERP 接口 / 数据库 / 示例数据）
 *
 * 选择规则（主任 2026-08-15 定）：
 * - ERP 接口：代码层配置（环境变量 VITE_OPENPRINT_API_BASE），**优先级最高**。
 *   未配置则不可用（UI 禁用）。
 * - 数据库：连接本机/局域网打印客户端的数据库接口（/api/data/*），
 *   **连上客户端不会默认请求**，必须用户手动开启（dbEnabled）才去拉取。
 * - 示例数据：内置 Mock，零后端随时可用（开箱即用底气）。
 *
 * 三种只能选其一（state.kind）。选择持久化到 localStorage，使刷新后保持用户意图，
 * 但数据库开关默认 false（必须手动开启，符合"不用默认请求"）。
 */
import { isBackendConfigured } from './backend'

/** 数据源种类（三选一） */
export type DataSourceKind = 'erp' | 'database' | 'sample'

/** 各类型显示名 */
export const DATA_SOURCE_KIND_LABEL: Record<DataSourceKind, string> = {
  erp: 'ERP 接口',
  database: '数据库（本地客户端）',
  sample: '示例数据',
}

/** 各类型一句话说明 */
export const DATA_SOURCE_KIND_DESC: Record<DataSourceKind, string> = {
  erp: '代码层环境变量配置，优先级最高',
  database: '连接本机/局域网客户端数据库，需手动开启',
  sample: '内置示例数据，零后端随时可用',
}

/** localStorage 持久化键 */
export const DATA_SOURCE_STORAGE_KEY = 'openprint:data-source'

/** ERP 是否可用（取决于是否配置了后端 API Base，即代码层配置） */
export function isErpConfigured(): boolean {
  return isBackendConfigured
}

/** 默认 provider：ERP 已配 → ERP；否则示例数据 */
export function defaultDataSourceKind(): DataSourceKind {
  return isBackendConfigured ? 'erp' : 'sample'
}

/** 持久化的选择结构 */
export interface DataSourcePersisted {
  kind: DataSourceKind
  /** 数据库是否手动开启（默认 false，必须手动开启） */
  dbEnabled: boolean
}

/** 读取持久化选择；无效/缺失回落到默认值 */
export function loadDataSourcePersisted(): DataSourcePersisted {
  if (typeof window === 'undefined') {
    return { kind: defaultDataSourceKind(), dbEnabled: false }
  }
  try {
    const raw = window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY)
    if (!raw) return { kind: defaultDataSourceKind(), dbEnabled: false }
    const p = JSON.parse(raw) as Partial<DataSourcePersisted>
    const kind: DataSourceKind =
      p.kind === 'erp' || p.kind === 'database' || p.kind === 'sample'
        ? p.kind
        : defaultDataSourceKind()
    // ERP 持久化但后端已移除配置 → 回落示例数据
    if (kind === 'erp' && !isErpConfigured()) return { kind: 'sample', dbEnabled: false }
    return { kind, dbEnabled: p.dbEnabled === true }
  } catch {
    return { kind: defaultDataSourceKind(), dbEnabled: false }
  }
}

/** 写入持久化选择 */
export function saveDataSourcePersisted(value: DataSourcePersisted): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}
