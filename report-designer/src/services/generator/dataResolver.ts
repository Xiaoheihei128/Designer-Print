// 数据绑定解析器
// 将模板中的 {Header.MaterialName} 等绑定表达式解析为实际值

import type { ResolvedValue } from './types'

/**
 * 解析绑定路径
 * 例如: "Header.MaterialName" → { root: "Header", segments: ["MaterialName"] }
 */
export function parseBindingPath(path: string): { root: string; segments: string[] } {
  if (!path) return { root: '', segments: [] }
  
  const segments = path.split('.').filter(s => s.length > 0)
  return {
    root: segments[0] || '',
    segments: segments.slice(1)
  }
}

/**
 * 根据路径从数据对象中取值
 */
export function getValueByPath(data: any, path: string): any {
  if (!path) return undefined
  
  const { root, segments } = parseBindingPath(path)
  
  // 先尝试直接在顶层查找
  let current = data
  if (root && typeof current === 'object' && root in current) {
    current = current[root]
  }
  
  // 逐层访问
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  
  return current
}

/**
 * 格式化数值
 */
export function formatNumber(value: number | string, format?: string): string {
  if (value === null || value === undefined || value === '') return ''
  
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return String(value)
  
  if (!format) return String(num)
  
  // 简单格式化支持 {0:N2} 格式
  const match = format.match(/\{(\d+):(\w)(\d)\}/)
  if (match) {
    const [, , type, decimals] = match
    const dec = parseInt(decimals)
    if (type === 'N') {
      return num.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec })
    }
    if (type === 'F') {
      return num.toFixed(dec)
    }
  }
  
  return String(num)
}

/**
 * 格式化日期
 */
export function formatDate(value: string | Date, format?: string): string {
  if (!value) return ''
  
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return String(value)
  
  if (!format) {
    return date.toLocaleString('zh-CN')
  }
  
  // 简单日期格式化
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  
  return format
    .replace('yyyy', String(year))
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

/**
 * 解析并格式化绑定值
 */
export function resolveBindingValue(
  binding: string | undefined,
  data: any,
  format?: string,
  nullValue: string = ''
): ResolvedValue {
  if (!binding) {
    return { value: undefined, formatted: '', isNull: true }
  }
  
  const value = getValueByPath(data, binding)
  
  if (value === null || value === undefined || value === '') {
    return { value, formatted: nullValue, isNull: true }
  }
  
  // 判断类型并格式化
  let formatted: string
  
  if (typeof value === 'number' && format) {
    formatted = formatNumber(value, format)
  } else if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
    formatted = formatDate(value as string | Date, format)
  } else {
    formatted = String(value)
  }
  
  return { value, formatted, isNull: false }
}

/**
 * 批量解析表格数据
 */
export function resolveTableData(data: any, binding: string): any[] {
  if (!binding) return []
  
  const value = getValueByPath(data, binding)
  
  if (!value) return []
  if (!Array.isArray(value)) return [value]
  
  return value
}
