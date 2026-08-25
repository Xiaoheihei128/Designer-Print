import { describe, it, expect, beforeEach } from 'vitest'

// import.meta.env 在测试环境无 VITE_OPENPRINT_API_BASE → isBackendConfigured=false
import {
  DATA_SOURCE_KIND_LABEL,
  defaultDataSourceKind,
  isErpConfigured,
  loadDataSourcePersisted,
  saveDataSourcePersisted,
  DATA_SOURCE_STORAGE_KEY,
  type DataSourceKind,
} from './data-source'

describe('data-source 配置层', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('未配置后端时 ERP 不可用，默认回落示例数据', () => {
    expect(isErpConfigured()).toBe(false)
    expect(defaultDataSourceKind()).toBe('sample')
  })

  it('标签齐备', () => {
    expect(DATA_SOURCE_KIND_LABEL.erp).toContain('ERP')
    expect(DATA_SOURCE_KIND_LABEL.database).toContain('数据库')
    expect(DATA_SOURCE_KIND_LABEL.sample).toContain('示例')
  })

  it('持久化：默认 dbEnabled=false', () => {
    expect(loadDataSourcePersisted()).toEqual({ kind: 'sample', dbEnabled: false })
  })

  it('保存后可读回，且 dbEnabled 持久化', () => {
    const value = { kind: 'database' as DataSourceKind, dbEnabled: true }
    saveDataSourcePersisted(value)
    expect(loadDataSourcePersisted()).toEqual(value)
  })

  it('持久化损坏时回落默认', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'not json')
    expect(loadDataSourcePersisted()).toEqual({ kind: 'sample', dbEnabled: false })
  })

  it('持久化 kind 非法时回落默认', () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, JSON.stringify({ kind: 'bogus', dbEnabled: true }))
    expect(loadDataSourcePersisted().kind).toBe('sample')
  })
})
