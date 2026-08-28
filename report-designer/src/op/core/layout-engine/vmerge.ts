/**
 * vMerge（同字段纵向合并）算法 —— M3 P0-1
 *
 * 动机：ERP 报表里"客户名/订单号/物料名"相邻同值只显示一次，是 FineReport /
 * 钉钉宜搭 / 简道云标配。当前 groupBy 已能产出横向组头，但**没有组内同值纵向合并**。
 *
 * 设计要点：
 * 1. 复用现有 `RenderCell.rowSpan` + 渲染端 `rowspan="N"` HTML 属性，
 *    引擎只算「相邻 data 行的同值合并」，零改动渲染层。
 * 2. 列以 `TableColumn.id` 稳定标识（不是下标）—— 用户增删列后仍能正确合并。
 * 3. 算法纯函数：输入 plans / rows / columns / options，输出 spans + consumed。
 *    buildTableModel 用 consumed 从 model.rows 移除被吞行；被吞行的 dataIndex
 *    让位给锚点 → sliceTable 后续 dataRows 切片仍正确。
 *
 * 边界（强制断开）：
 * - 非 data 行（group/subtotal/summary/static/blank）天然断开
 * - breakOnGroup=true（默认）：组头/小计/合计边界断开
 *
 * 跨页（breakOnPage）：v1 限定为"vMerge 组必须完整落在同一页"——本函数不处理，
 * 由 sliceTable 在切片时按页预算判定：若合并组末页剩余空间不够装整组，
 * 则把整个组推到下一页（不拆开）。
 */
import type { RenderRow } from './types'
import type { TableColumn } from '@op/types/control'
import type { RowPlan } from './group-engine'

export interface VMergeOptions {
  /** 启用的列 id 集合（不是下标） */
  columns: string[]
  /** 组头/小计边界断开（默认 true） */
  breakOnGroup?: boolean
}

export interface VMergeInput {
  /** 行计划（与 rows 一一对应） */
  plans: RowPlan[]
  /** 已构建的渲染行（cells[i].text 即各列实际取值） */
  rows: RenderRow[]
  /** 列定义（含稳定 id） */
  columns: TableColumn[]
  /** 选项 */
  options: VMergeOptions
}

export interface VMergeOutput {
  /** spans[planIndex][colIndex] = rowSpan（1 = 不合并；未出现的列下标位置 undefined） */
  spans: number[][]
  /** 被吞行的 planIndex 集合 —— buildTableModel 据此从 model.rows 移除 */
  consumed: Set<number>
}

/**
 * 计算每行每列的 rowspan，并标记需要从结果中删除的被吞行。
 *
 * 时间复杂度：O(plans × enabledColCount)，单次遍历。
 * 空间复杂度：O(plans × enabledColCount)（spans 矩阵；被吞集合 O(consumed)）。
 */
export function computeVMergeSpans(input: VMergeInput): VMergeOutput {
  const { plans, rows, columns, options } = input
  const breakOnGroup = options.breakOnGroup ?? true

  // 列 id → 列下标（options.columns 里的 id 必须命中真实列；命不中的静默忽略）
  const idSet = new Set(options.columns ?? [])
  const colIndexes: number[] = []
  columns.forEach((c, i) => {
    if (c.id && idSet.has(c.id)) colIndexes.push(i)
  })

  const N = plans.length
  const spans: number[][] = Array.from({ length: N }, () => [])
  const consumed = new Set<number>()

  // 每列的当前 run：{ anchor, value, count }
  interface Run {
    anchor: number
    value: string
    count: number
  }
  const activeRuns = new Map<number, Run>()

  /**
   * 结算单个列 run。
   * - count=1 → 锚点 rowSpan=1（始终写入，便于渲染端 / 测试断言）
   * - count>1 → 锚点 rowSpan=count；中间行记入 consumed
   */
  function flushRun(colIdx: number): void {
    const run = activeRuns.get(colIdx)
    if (!run) return
    spans[run.anchor]![colIdx] = run.count
    if (run.count > 1) {
      for (let i = 1; i < run.count; i++) {
        consumed.add(run.anchor + i)
      }
    }
    activeRuns.delete(colIdx)
  }

  function flushAll(): void {
    for (const colIdx of Array.from(activeRuns.keys())) {
      flushRun(colIdx)
    }
  }

  // 上一行 data 的 vMerge 列取值（按 colIndexes 顺序），用于判断"行身份是否延续"。
  // vMerge 列共同定义 row 身份：任意一列变化 → 整组 run 重新结算。
  let prevValues: string[] | null = null

  function tupleEquals(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  for (let p = 0; p < N; p++) {
    const plan = plans[p]!
    const row = rows[p]
    if (!row) continue

    // 边界：非 data 行天然断开（group/subtotal/summary/static/blank）
    if (plan.kind !== 'data') {
      flushAll()
      prevValues = null
      continue
    }

    // breakOnGroup=true：显式标注组头/小计/合计为边界（实际上 non-data 已覆盖，
    // 保留 flag 是为语义完整 + 后续扩展预留；这里判断在 kind === 'data' 之后，
    // 类型已收窄为 'data'，分支不可达，TS 静态分析会报 no overlap——
    // 用 typeof === 字符串绕过类型守卫）
    if (
      breakOnGroup &&
      (plan.kind === ('group' as typeof plan.kind) ||
        plan.kind === ('subtotal' as typeof plan.kind) ||
        plan.kind === ('summary' as typeof plan.kind))
    ) {
      flushAll()
      prevValues = null
      continue
    }

    // data 行：按 (colIndexes × cellText) 元组与上一行比较
    const currentValues = colIndexes.map((ci) => row.cells[ci]?.text ?? '')

    if (prevValues !== null && tupleEquals(prevValues, currentValues)) {
      // 整组延续 → 每列 run.count++
      for (const colIdx of colIndexes) {
        const run = activeRuns.get(colIdx)
        if (run) run.count++
      }
    } else {
      // 元组变化（含首行）→ 结算所有旧 run，开新 run
      flushAll()
      for (let k = 0; k < colIndexes.length; k++) {
        const colIdx = colIndexes[k]!
        activeRuns.set(colIdx, { anchor: p, value: currentValues[k]!, count: 1 })
      }
    }

    prevValues = currentValues
  }

  // 末尾 flush
  flushAll()

  return { spans, consumed }
}