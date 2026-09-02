/**
 * collectLeafPaths —— 把业务 JSON 拍平为 leaf path 集合
 *
 * 与 introspectJson 的路径语义对齐：
 * - 嵌套 object：key 之间用 '.' 连接（Header.SupplierName）
 * - 数组：标 '[]' 后缀（ReportItems[].TestStandard）
 * - 标量叶子：终止递归，输出路径
 * - 标量数组（叶子即数组）：路径按 detail 数组语义（pathPrefix + '[]'），不再下钻
 *
 * 用途：
 * - fieldCatalog 的 diffCoverage 计算「目录有 / 数据无」（missingFromData）
 * - DataSourceTree 的「数据中的新字段」分组（数据有 / 目录无）
 *
 * 防御：
 * - 深度上限 8，与 introspectJson 默认 maxDepth 对齐，防止循环引用或病态数据爆栈
 * - 数组元素并集：多行时合并所有键
 * - null / undefined 视作 string 叶子（与 introspectJson 一致）
 */
const DEFAULT_MAX_DEPTH = 8

export interface CollectOptions {
  prefix?: string
  maxDepth?: number
  /** 已收集的 path 集合（递归复用，外部无需关心） */
  out?: Set<string>
}

/**
 * 收集 JSON 树里所有 leaf path。
 * @returns Set<path>
 */
export function collectLeafPaths(json: unknown, options: CollectOptions = {}): Set<string> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const out = options.out ?? new Set<string>()
  walk(json, options.prefix ?? '', 0, maxDepth, out)
  return out
}

function walk(value: unknown, prefix: string, depth: number, maxDepth: number, out: Set<string>): void {
  if (value === null || value === undefined) {
    // 空叶子仍然记录 path —— 这是 schema 信号（字段存在但值空），不应当作缺失
    if (prefix) out.add(prefix)
    return
  }
  if (Array.isArray(value)) {
    // 数组分支：父级加 '[]' 后缀
    const arrayPath = prefix + '[]'
    if (value.length === 0) {
      // 空数组 —— 没有元素可推 keys，但保留 path（数组字段存在）
      out.add(arrayPath)
      return
    }
    out.add(arrayPath)
    // 元素并集：把所有元素的 keys 合并到下一层
    const merged: Record<string, unknown> = {}
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        Object.assign(merged, item as Record<string, unknown>)
      }
    }
    if (depth >= maxDepth) return
    for (const [k, v] of Object.entries(merged)) {
      walk(v, arrayPath + '.' + k, depth + 1, maxDepth, out)
    }
    return
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) {
      // 空对象叶子
      if (prefix) out.add(prefix)
      return
    }
    if (!prefix) {
      // 顶层 object：每个 key 就是一个 path
      if (depth >= maxDepth) return
      for (const [k, v] of Object.entries(obj)) {
        walk(v, k, depth + 1, maxDepth, out)
      }
      return
    }
    // 嵌套 object：作为分组，不在本层产生 leaf（与 introspectJson 语义一致）
    if (depth >= maxDepth) return
    for (const [k, v] of Object.entries(obj)) {
      walk(v, prefix + '.' + k, depth + 1, maxDepth, out)
    }
    return
  }
  // 标量叶子 —— 永远产出（深度上限已在 object/array 分支提前 return 拦截）
  if (prefix) out.add(prefix)
}