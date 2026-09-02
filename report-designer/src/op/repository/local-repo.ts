/**
 * createLocalRepository —— localStorage 模板仓库
 *
 * 未配置后端接口时的默认持久化实现（2026-08-08 主任定：无后端全链路可用）。
 * 与未来 http-repo 同一 TemplateRepository 接口，可无缝替换。
 *
 * 存储结构：
 * - `openprint:templates`        → TemplateSummary[]（列表索引）
 * - `openprint:template:{id}`    → TemplateRecord（完整数据）
 */
import type { TemplateRecord, TemplateRepository, TemplateSummary } from './types'
import { genId } from '@op/utils/id'

const INDEX_KEY = 'openprint:templates'
const RECORD_PREFIX = 'openprint:template:'

function readIndex(): TemplateSummary[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as TemplateSummary[]
  } catch {
    return []
  }
}

function writeIndex(list: TemplateSummary[]): void {
  safeSetItem(INDEX_KEY, JSON.stringify(list))
}

/**
 * localStorage 写入防护：浏览器默认配额 5MB（部分环境 10MB），大模板 content
 * 序列化后可能超限，裸 setItem 会抛 QuotaExceededError 整调用栈炸掉。
 * 错误封装到统一错误类型，让上层（saveTemplate 的 catch）能识别并提示用户清理。
 */
export class LocalStorageQuotaError extends Error {
  constructor(public readonly key: string, public readonly bytes: number) {
    super(`localStorage 配额不足：${key}（${bytes} bytes）。请删除大模板后重试。`)
    this.name = 'LocalStorageQuotaError'
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
      throw new LocalStorageQuotaError(key, value.length)
    }
    throw e
  }
}

export function createLocalRepository(): TemplateRepository {
  return {
    async list() {
      return readIndex()
    },

    async get(id) {
      try {
        const raw = localStorage.getItem(RECORD_PREFIX + id)
        return raw ? (JSON.parse(raw) as TemplateRecord) : null
      } catch {
        return null
      }
    },

    async create(record) {
      const full: TemplateRecord = {
        ...record,
        id: genId('tpl'),
        editable: true,
        deletable: true,
        updatedAt: new Date().toISOString(),
      }
      safeSetItem(RECORD_PREFIX + full.id, JSON.stringify(full))
      const index = readIndex()
      index.push({
        id: full.id,
        name: full.name,
        editable: true,
        deletable: true,
        updatedAt: full.updatedAt,
      })
      writeIndex(index)
      return full
    },

    async update(id, record) {
      const existing = await this.get(id)
      if (!existing) throw new Error(`模板不存在：${id}`)
      const merged: TemplateRecord = {
        ...existing,
        ...record,
        id,
        updatedAt: new Date().toISOString(),
      }
      safeSetItem(RECORD_PREFIX + id, JSON.stringify(merged))
      const index = readIndex().map((t) =>
        t.id === id ? { ...t, name: merged.name, updatedAt: merged.updatedAt } : t,
      )
      writeIndex(index)
      return merged
    },

    async remove(id) {
      localStorage.removeItem(RECORD_PREFIX + id)
      writeIndex(readIndex().filter((t) => t.id !== id))
    },
  }
}
