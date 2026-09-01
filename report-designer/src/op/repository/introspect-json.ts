/**
 * introspect-json —— 从业务 JSON 反推字段目录
 *
 * 解决"目录说有这个字段，但数据里没有" / "数据有这个字段，但目录没说"的不一致问题。
 *
 * 调用场景：
 *   1. matcher 页匹配成功后、跳转设计器前，用输入的 JSON 推导目录并注入 fieldCatalog
 *   2. 客户端数据库 select * from tbl 后，对真实行做一次内省覆盖默认 schema
 *   3. 调试 / 测试场景，直接对任意 JSON 调用获取目录
 *
 * 设计原则（《OpenPrint-设计方案》§19.4.3a「内省优先 + 标注增强」的精神）：
 *   - 纯函数，无副作用，便于单测
 *   - 不覆盖现有 label（标注优先）：已有同名 FieldDef 时，沿用其 label/group/hidden 等
 *   - 顶层对象 → main 表（Header 类）；顶层数组 → detail 表（ReportItems 类）
 *   - 数组元素并集：多行时把所有行的键合并，避免只采第一行漏字段
 *   - 叶子类型从值推断（string/number/boolean/date/object/array/image）
 *
 * 边界：
 *   - 不递归进入非 plain object（Date / RegExp / Map 等保持原值当 string 处理）
 *   - 循环引用：JSON.parse 出来的对象天然没有循环引用；运行时直接传入的对象如出现循环引用，
 *     visited Set 守护栈限制深度（默认 8 层），防止爆栈
 *   - image 类型识别：URL 后缀（.png/.jpg/.jpeg/.gif/.webp/.bmp）或 data:image/ 前缀
 */
import type { DataSourceMeta, FieldDef, TableMeta } from '@op/types/datasource'

/** 内省结果：可直接喂给 fieldCatalog 替换 activeSource.tables + activeFields */
export interface IntrospectResult {
  meta: DataSourceMeta
  fields: FieldDef[]
}

/** 内省选项 */
export interface IntrospectOptions {
  /** 数据源 ID（默认 '__introspect__'，fieldCatalog 注入时通常重命名为具体业务 ID） */
  sourceId?: string
  /** 数据源名称（默认 'JSON 内省'） */
  sourceName?: string
  /** 已有字段定义（用于保留 label/group/hidden 等标注；path 相同的项沿用 label） */
  existingFields?: FieldDef[]
  /** 递归深度上限（防御性，默认 8） */
  maxDepth?: number
}

/** 推断叶子字段类型 */
function inferType(value: unknown): FieldDef['type'] {
  if (value === null || value === undefined) return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') {
    // ISO 8601 日期判定（YYYY-MM-DD 或带时间）：比 'YYYY-' 起始更准确
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
      return 'date'
    }
    // 图片 URL：扩展名 或 data URL
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(value) || /^data:image\//.test(value)) {
      return 'image'
    }
    return 'string'
  }
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (typeof value === 'object') return 'object'
  return 'string'
}

/** 取首例非空值作为 sample（避免渲染期 undefined 占位） */
function pickSample(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined) return pickSample(item)
    }
    return undefined
  }
  return value
}

/** 是否是 plain object（非数组/Date/Map/Set 等） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  if (v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * 递归内省单个 plain object → 该层及子层的 FieldDef[]。
 *
 * @param obj   当前层的 plain object
 * @param pathPrefix 路径前缀（含点号或 []，如 'Header.' / 'ReportItems[].'）
 * @param depth 当前递归深度
 * @param maxDepth 最大递归深度
 * @param existingByPath path → FieldDef 映射，用于 label 保留
 * @param tableId 表 ID（顶层入口传入，所有派生叶子都打这个标记，fieldTree 按它分组）
 * @returns 扁平 FieldDef[]（不含任何 TableMeta，由外层拼装）
 */
function introspectObject(
  obj: Record<string, unknown>,
  pathPrefix: string,
  depth: number,
  maxDepth: number,
  existingByPath: Map<string, FieldDef>,
  tableId: string,
): FieldDef[] {
  if (depth >= maxDepth) return []
  const out: FieldDef[] = []
  // 用 Object.keys 保序；ES2015+ 字符串键顺序：整数索引升序 + 创建顺序
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const fullPath = pathPrefix + key
    if (isPlainObject(value)) {
      // 嵌套对象 → 递归展开，**不在本层产生 FieldDef**（与后端 catalog 行为一致：
      // 只暴露叶子字段，避免 DataSourceTree 出现重复的"分组"节点）
      out.push(
        ...introspectObject(value, fullPath + '.', depth + 1, maxDepth, existingByPath, tableId),
      )
      continue
    }
    if (Array.isArray(value)) {
      // 顶层数组元素通常是明细对象；非对象元素（如 string[]）按叶子处理
      const firstObj = value.find(isPlainObject)
      if (firstObj) {
        // 多行并集：所有 plain object 元素的键合并，避免漏字段
        const merged: Record<string, unknown> = {}
        for (const item of value) {
          if (isPlainObject(item)) Object.assign(merged, item)
        }
        // 数组的子字段路径前缀用 '[].'，与现有 catalog 契约一致
        out.push(
          ...introspectObject(
            merged,
            fullPath + '[].',
            depth + 1,
            maxDepth,
            existingByPath,
            tableId,
          ),
        )
      } else {
        // 标量数组（少见）→ 当作单个叶子
        const existing = existingByPath.get(fullPath)
        out.push({
          path: fullPath,
          tableId,
          label: existing?.label ?? key,
          type: 'array',
          sample: pickSample(value),
          sort: existing?.sort,
          group: existing?.group,
          hidden: existing?.hidden,
        })
      }
      continue
    }
    // 叶子：string/number/boolean/date/object/array/image
    const existing = existingByPath.get(fullPath)
    out.push({
      path: fullPath,
      tableId, // ★ 关键：fieldTree 按 tableId 分组；不写就被分到 '' 表下渲染不出来
      label: existing?.label ?? key, // 标注优先：已有 label 沿用
      type: inferType(value),
      sample: pickSample(value),
      sort: existing?.sort,
      group: existing?.group,
      hidden: existing?.hidden,
    })
  }
  return out
}

/**
 * 内省业务 JSON → DataSourceMeta + FieldDef[]。
 *
 * 顶层每个键视作一个表：
 *   - 值是 plain object → relation='main', isArray=false, pathPrefix='<key>.'
 *   - 值是 array of object → relation='detail', isArray=true, pathPrefix='<key>[].'
 *   - 值是其它叶子（字符串/数字）→ 不当表，归入默认 __root__ 主表
 *   - 值是 array of scalar → 当作单值，归入默认 __root__ 主表
 *
 * @example
 *   introspectJson({
 *     Header: { ReportNo: 'RM-001', ReportDate: '2026-08-12' },
 *     ReportItems: [{ AnalysisItem: '外观', FinalVal: '符合规定' }],
 *   }, { sourceId: 'inspection', existingFields: catalogFields })
 *   // → { meta: { id: 'inspection', tables: [Header, ReportItems] }, fields: [3 个叶子] }
 */
export function introspectJson(
  json: Record<string, unknown>,
  options: IntrospectOptions = {},
): IntrospectResult {
  const {
    sourceId = '__introspect__',
    sourceName = 'JSON 内省',
    existingFields = [],
    maxDepth = 8,
  } = options

  const existingByPath = new Map<string, FieldDef>()
  for (const f of existingFields) existingByPath.set(f.path, f)

  const tables: TableMeta[] = []
  const fields: FieldDef[] = []

  for (const topKey of Object.keys(json)) {
    const topVal = json[topKey]
    if (isPlainObject(topVal)) {
      tables.push({
        id: topKey,
        name: topKey,
        relation: 'main',
        pathPrefix: `${topKey}.`,
        isArray: false,
      })
      fields.push(...introspectObject(topVal, `${topKey}.`, 1, maxDepth, existingByPath, topKey))
    } else if (Array.isArray(topVal) && topVal.some(isPlainObject)) {
      tables.push({
        id: topKey,
        name: topKey,
        relation: 'detail',
        pathPrefix: `${topKey}[].`,
        isArray: true,
      })
      // 并集
      const merged: Record<string, unknown> = {}
      for (const item of topVal) {
        if (isPlainObject(item)) Object.assign(merged, item)
      }
      fields.push(
        ...introspectObject(merged, `${topKey}[].`, 1, maxDepth, existingByPath, topKey),
      )
    } else {
      // 顶层叶子 → 归入 __root__ 主表（一次只会有一个 root，多个走合并）
      const rootIdx = tables.findIndex((t) => t.id === '__root__')
      if (rootIdx < 0) {
        tables.unshift({
          id: '__root__',
          name: '根对象',
          relation: 'main',
          pathPrefix: '',
          isArray: false,
        })
      }
      const existing = existingByPath.get(topKey)
      fields.push({
        path: topKey,
        tableId: '__root__',
        label: existing?.label ?? topKey,
        type: inferType(topVal),
        sample: pickSample(topVal),
        sort: existing?.sort,
        group: existing?.group,
        hidden: existing?.hidden,
      })
    }
  }

  return {
    meta: {
      id: sourceId,
      name: sourceName,
      description: `从内省生成（${fields.length} 字段 / ${tables.length} 表）`,
      tables,
    },
    fields,
  }
}
