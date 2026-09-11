/**
 * PaginationEngine —— 分页算法主流程
 * 真理源：《OpenPrint-设计方案.md》§7.2（分页算法流程）、§7.4（难点清单）、§8.1（二维排版，非流式）
 *
 * ## 分页模型：绝对定位 + 单表流动
 *
 * OpenPrint 是**二维排版工具，不是网页编辑器**（§8.1）：正文控件都是相对区块左上角的
 * 绝对定位盒子，本身不参与文档流。真正会"长高"的只有绑定了数据源的表格。
 * 因此分页的语义是：
 *
 * ```
 *  ┌── 表格上方控件（单据头：单号/客户/日期）  → 仅第 1 页
 *  ├── 明细表格                              → 按行切片流过 N 页
 *  └── 表格下方控件（单据尾：合计/签章）        → 仅最后一页，随表格实际高度下移
 * ```
 *
 * 这正是 ERP 单据的真实结构，也是金蝶/帆软等报表工具的一致做法。
 * 每页重复的内容（公司抬头、页码）交给 header/footer 区块（§5.14），不在正文里解决。
 *
 * 无表格时退化为「按位置切页」：控件按 top 落在第几个 bodyHeight 区间就进第几页，
 * 保证超长静态模板也不会被截断。
 */
import type { AnyControl, LabelGridControl, TableControl } from '@op/types/control'
import type { PageSetup, Section, TemplateData } from '@op/types/template'
import { fromMm, toMm } from '@op/core/units'
import { isControlPrintable, resolveControlContent } from './data-binder'
import {
  buildSectionControls,
  computePageMetrics,
  shouldRenderSection,
} from './header-footer'
import { getSharedMeasurer, type TextMeasurer } from './measure'
import {
  buildTableModel,
  minStartHeight,
  sliceTable,
  totalTableHeight,
  type TableModel,
} from './table-engine'
import { isDataTable } from './table-cells'
import { precomputeCodeSvgsForCells } from './code-render'
import type { Segment } from '@op/types/control'
import {
  bodyStepMm,
  expandLabelGrids,
  measureAppendixTitleHeight,
  resolveGridGeometry,
  visibleCardRows,
  withRowCtx,
  type GridLinePlacement,
  type GridPlacementHint,
  type RowCtxMap,
} from './label-grid'
import {
  MAX_PAGES,
  type EvalContext,
  type LayoutPage,
  type LayoutResult,
  type PageMetrics,
  type PlacedControl,
  type PlacedNode,
  type PlacedTable,
  type RenderCell,
  type RenderRow,
  type RenderWarning,
} from './types'

/** 几何比较容差（mm），消除序列化四舍五入带来的边界抖动 */
const EPS = 0.5

/**
 * 取 labelgrid 的数据源数组（reserveBelow 估算专用，不发警告）。
 * 与 label-grid 内部 gridDataArray 同语义，但不需要 warning 副作用。
 */
function gridDataArrayForReserve(
  dataSource: string | undefined,
  ctx: EvalContext,
): Array<Record<string, unknown>> | null {
  if (!dataSource) return null
  const v = (ctx.data ?? {})[dataSource]
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : null
}

export interface LayoutOptions {
  /** 自定义文本测量器（默认用共享的 DOM 测量器） */
  measurer?: TextMeasurer
  /** 最大页数保护 */
  maxPages?: number
}

/* ------------------------------ 正文结构分析 ------------------------------ */

interface BodyPlan {
  /** 驱动分页的流式表格（绑定了数据源） */
  flowTable: TableControl | null
  /** 表格上方控件 → 第 1 页 */
  above: AnyControl[]
  /** 与表格垂直重叠的控件 → 第 1 页原位 */
  overlap: AnyControl[]
  /** 表格下方控件 → 末页，随表格高度下移 */
  below: AnyControl[]
}

/**
 * 在 components 中挑出**唯一**的数据驱动表格（同 analyzeBody 内部 filter 逻辑）。
 * 抽出来供 layout() 在 analyzeBody 之前**提前 buildTableModel**——为了拿到
 * 表格真实展开高(realTableHeight),而不是用 userHeight 做分类基准。
 *
 * 必须与 analyzeBody 内部的 tables filter 严格一致,保证 preFlowTable === plan.flowTable。
 */
function pickFlowTable(
  components: AnyControl[],
  generated?: { has(id: string): boolean },
): TableControl | null {
  const tables = components.filter(
    (c): c is TableControl =>
      c.type === 'table' && isDataTable(c) && !(generated?.has(c.id) ?? false),
  )
  return tables[0] ?? null
}

/**
 * 挑出 components 中所有数据驱动表格,按设计 top 升序排列。
 *
 * 多流式分页（multi-flow）的基础：每张数据表都参与分页、按 top 顺序依次流动，
 * 中间夹的控件按 top 顺序串入同一流。这是 pickFlowTable 的多表版本,
 * 单表场景下 pickFlowTables()[0] === pickFlowTable(...) 仍然成立,
 * 向后兼容。
 */
function pickFlowTables(
  components: AnyControl[],
  unit: PageSetup['unit'],
  generated?: { has(id: string): boolean },
): TableControl[] {
  return components
    .filter(
      (c): c is TableControl =>
        c.type === 'table' && isDataTable(c) && !(generated?.has(c.id) ?? false),
    )
    .sort((a, b) => toMm(a.top, unit) - toMm(b.top, unit))
}

function analyzeBody(
  components: AnyControl[],
  unit: PageSetup['unit'],
  /**
   * 表格的真实展开高（mm）—— layout() 在调用前用 buildTableModel + totalTableHeight 预算，
   * 不使用 userHeight（用户拖出的高度），因为数据行展开后 userHeight 往往远小于实际，
   * 用 userHeight 做基准会导致 above/overlap 误分类 + below 路径 delta 为负。
   *
   * **设计画布**：userHeight 仍是用户的设计意图，画布上看到的表格框就是 userHeight；
   * **预览/打印**：用真实展开高做几何事实基准——两者职责分离，画布完全不动。
   */
  realTableHeight: number,
  /** 标签网格展开出来的控件不参与「流式表格」候选（卡片内的表格只能整表渲染） */
  generated?: { has(id: string): boolean },
): {
  plan: BodyPlan
  warnings: RenderWarning[]
} {
  const warnings: RenderWarning[] = []
  const tables = components.filter(
    (c): c is TableControl =>
      c.type === 'table' && isDataTable(c) && !(generated?.has(c.id) ?? false),
  )

  if (tables.length > 1) {
    warnings.push({
      code: 'CONTENT_OVERFLOW',
      message: `正文存在 ${tables.length} 个数据表格，仅第一个（${tables[0]!.id}）参与分页流动，其余按静态控件渲染`,
      controlId: tables[1]!.id,
    })
  }

  const flowTable = tables[0] ?? null
  if (!flowTable) {
    return { plan: { flowTable: null, above: components, overlap: [], below: [] }, warnings }
  }

  const tTop = toMm(flowTable.top, unit)
  // ★ 分类基准:用 userHeight(用户拖出的设计底),不用真实展开高。
  //
  // 为什么不用 realTableHeight:
  //   realTableHeight 由 buildTableModel 计算,会显著大于 userHeight(8 行实测 ~62mm vs 拖出 30mm)。
  //   用 realTableHeight 做 tBottom 后,用户设计在「userHeight 底之外」的控件
  //   (例:表格 userHeight 拖到 30mm、控件 top=230)会被误判成 overlap,
  //   进而走 overlap 路径 → 与末片表格内重叠渲染(用户截图 bug:「列1」表格渲染到 page 0)。
  //
  // 用 userHeight 后:控件 top=230 > userTBottom=80 → 进 below 路径,
  //   末页 delta 起点仍用 userTBottom → 渲染时 textBaseTop=skeleton.lastBottom(real) + delta,
  //   既保住「控件在表格设计底之外」的几何语义,又自然吸收「userHeight < realHeight」的膨胀。
  const tBottom = tTop + toMm(flowTable.height, unit)

  const above: AnyControl[] = []
  const overlap: AnyControl[] = []
  const below: AnyControl[] = []

  for (const c of components) {
    if (c.id === flowTable.id) continue
    const top = toMm(c.top, unit)
    const bottom = top + toMm(c.height, unit)
    if (bottom <= tTop + EPS) above.push(c)
    else if (top >= tBottom - EPS) below.push(c)
    else overlap.push(c)
  }

  return { plan: { flowTable, above, overlap, below }, warnings }
}

/* ------------------------------- 控件定位 ------------------------------- */

async function placeControls(
  components: AnyControl[],
  ctx: EvalContext,
  unit: PageSetup['unit'],
  topShift = 0,
  rowCtx?: RowCtxMap,
): Promise<{ placed: PlacedControl[]; warnings: RenderWarning[] }> {
  const placed: PlacedControl[] = []
  const warnings: RenderWarning[] = []

  for (const control of components) {
    if (control.type === 'zone') continue
    // labelgrid 已在入口展开为普通控件，正常路径不会再遇到
    if (control.type === 'labelgrid') continue
    // 标签卡片内的控件按所属卡片的行上下文求值（items[].xxx → row.xxx）
    const cctx = withRowCtx(control.id, ctx, rowCtx)
    if (!isControlPrintable(control, cctx)) continue

    // 静态表格（布局网格 / 非流动表格）在这里整体渲染
    if (control.type === 'table') continue

    const { content, warnings: w } = await resolveControlContent(control, cctx)
    warnings.push(...w)
    placed.push({
      kind: 'control',
      id: control.id,
      left: toMm(control.left, unit),
      top: toMm(control.top, unit) + topShift,
      width: toMm(control.width, unit),
      height: toMm(control.height, unit),
      angle: control.angle,
      content,
      control,
    })
  }

  return { placed, warnings }
}

/** 静态表格（无数据源或非任何 flowTable）整表渲染，不参与分页 */
function placeStaticTables(
  components: AnyControl[],
  /** 所有 flow table 的 id 集合(多流式分页场景下≥1 个),这些表格不渲染为静态表 */
  flowTableIds: Iterable<string>,
  ctx: EvalContext,
  unit: PageSetup['unit'],
  measurer: TextMeasurer,
  topShift = 0,
  rowCtx?: RowCtxMap,
): { placed: PlacedTable[]; warnings: RenderWarning[] } {
  const placed: PlacedTable[] = []
  const warnings: RenderWarning[] = []
  // 避免每次循环查 Set 构造
  const flowIdSet = flowTableIds instanceof Set ? flowTableIds : new Set(flowTableIds)

  for (const control of components) {
    if (control.type !== 'table' || flowIdSet.has(control.id)) continue
    const cctx = withRowCtx(control.id, ctx, rowCtx)
    if (!isControlPrintable(control, cctx)) continue

    const widthMm = toMm(control.width, unit)
    const heightMm = toMm(control.height, unit)
    const model = buildTableModel({ control, ctx: cctx, measurer, widthMm, heightMm })
    warnings.push(...model.warnings)
    placed.push({
      kind: 'table',
      id: control.id,
      left: toMm(control.left, unit),
      top: toMm(control.top, unit) + topShift,
      width: widthMm,
      height: Math.max(heightMm, totalTableHeight(model)),
      control,
      columns: model.columns,
      columnWidths: model.columnWidths,
      headerRows: model.headerRows,
      rows: model.rows,
      footerRows: model.footerRows,
      isLastSlice: true,
    })
  }

  return { placed, warnings }
}

/* -------------------------------- 分页骨架 ------------------------------- */

/**
 * 构造一个 vmerge 续行 anchor 行,插入被分页切断的合并组在下一页的头部。
 *
 * 动机：vmerge(同值纵向合并)的 anchor 在 page 1 上 rowspan=N,
 * 其下被吞行不能跨 <table> 边界。若切片恰好把合并组拦腰切断,
 * page 2 的首行就是被吞行(consumed=true),rowspan 失去作用,
 * 视觉上 column 1 被 column 2 的内容覆盖(列链错位 bug)。
 *
 * 修法(Path B):在 page 2 slice 头插入一个 anchor 行:
 *   - vmerge 列：text 沿用被吞行(同值合并语义,值就是合并组的延续值),
 *     rowSpan = 本片连续被吞行数 + 1(覆盖 anchor + 本片被吞行)
 *   - 其他列：直接复制被吞行的数据(非 vmerge 列本来就正常显示)
 *   - 行高与被吞行相同
 *   - consumed 标志清除
 *
 * 与 keepTogether(Path A)的取舍：keepTogether 强制整组合并组在同一页,
 * 会导致"末片装不下整组 → 整组推到下一页",可能留白;Path B 允许跨页,
 * 视觉效果更接近 Excel/钉钉宜搭的行为,符合用户期望。
 */
function buildVMergeContinuationAnchor(
  firstRow: RenderRow,
  vmergeColIdx: number,
  continuationCount: number,
): RenderRow {
  const cells: RenderCell[] = firstRow.cells.map((cell, idx) => {
    if (idx === vmergeColIdx) {
      // vmerge 列：取消 consumed,设 rowSpan,文本沿用被吞行的值
      const { consumed: _consumed, rowSpan: _rowSpan, ...rest } = cell
      return { ...rest, rowSpan: continuationCount + 1 }
    }
    return { ...cell }
  })
  return {
    ...firstRow,
    cells,
  }
}

/** 表格切片在各页上的落位结果（尚未解析上下方控件） */
interface TableSkeleton {
  /** 每页一个切片；空数组表示表格无内容 */
  slices: Array<{ table: PlacedTable; pageIndex: number }>
  /** 表格实际占用的页数 */
  pageCount: number
  /** 末页上表格的实际底边（mm，相对正文区顶） */
  lastBottom: number
  warnings: RenderWarning[]
}

function paginateFlowTable(
  model: TableModel,
  tableLeft: number,
  tableWidth: number,
  tableTop: number,
  metrics: PageMetrics,
  reserveBelow: number,
  maxPages: number,
): TableSkeleton {
  const warnings: RenderWarning[] = []
  const slices: TableSkeleton['slices'] = []
  const keepTogether = model.control.options?.keepTogether ?? false

  // 页眉/页脚色带每页重复（repeat=true，默认）时占据页面顶部/底部（整页相对 top:0 / bottom:0）。
  // 流式表格自动切页不能落进色带区：
  // - 非首页切片从「页眉下方」（zoneTop = headerHeight）开始，避免覆盖每页重复的页眉；
  // - 每页可用高度 = 页高 - 页眉 - 页脚（色带存在时）；无色带时回退到 bodyHeight（历史语义，零回归）。
  const headerH = metrics.headerHeight
  const footerH = metrics.footerHeight
  const zoneTop = headerH > 0 ? headerH : 0
  const usablePerPage =
    headerH > 0 || footerH > 0
      ? Math.max(1, metrics.pageHeight - headerH - footerH)
      : metrics.bodyHeight

  // keepTogether：首页放不下"表头 + 1 行 + 表尾"就整体下移到第 2 页（§7.4）
  let firstPageIndex = 0
  let firstTop = tableTop
  if (keepTogether && usablePerPage - (tableTop - zoneTop) < minStartHeight(model)) {
    firstPageIndex = 1
    firstTop = zoneTop
  }

  let start = 0
  let pageIndex = firstPageIndex
  let lastBottom = firstTop
  let guard = 0

  for (;;) {
    if (++guard > maxPages) {
      warnings.push({
        code: 'PAGE_LIMIT_REACHED',
        message: `分页超过 ${maxPages} 页保护上限，已截断`,
        controlId: model.control.id,
      })
      break
    }

    const topOnPage = pageIndex === firstPageIndex ? firstTop : zoneTop
    // 首页：表格从用户放置位置排到页脚上沿（pageHeight - footerH）；
    // 非首页：从页眉下方排满「每页可用高」。无色带时退化为 bodyHeight - topOnPage（原逻辑）。
    const availFull = Math.max(0, usablePerPage - (topOnPage - zoneTop))

    // 先试"为下方控件预留空间"的窄预算；能一次放完，说明这就是末页
    let slice = null as ReturnType<typeof sliceTable> | null
    if (reserveBelow > 0 && availFull - reserveBelow > 0) {
      const trial = sliceTable(model, { avail: availFull - reserveBelow, start })
      if (trial.isLast) slice = trial
    }
    if (!slice) {
      slice = sliceTable(model, { avail: availFull, start })
      // 用满预算才放完 → 下方控件挤不下：削减"最后一行 + 仅末页表尾（总计/大写）"的空间
      // 重切，强制 sliceTable 让出最后一行并只挂本页合计，使表格在下一页真正收尾挂总计。
      // （sliceTable 的 isLast 分支保证：让行后 i < rows.length 时只挂本页合计、不挂总计/大写。）
      if (slice.isLast && reserveBelow > 0 && availFull - slice.height < reserveBelow) {
        const lastData = [...slice.rows].reverse().find((r) => r.kind === 'data')
        const lastRowH = lastData?.height ?? 0
        const lastOnlyFooterH = slice.footerRows
          .filter((f) => f.footerKind === 'grandTotal' || f.footerKind === 'capital')
          .reduce((s, f) => s + f.height, 0)
        // 削减"最后一行 + 仅末页表尾" + 足够 buffer，确保 sliceTable 走非 isLast 分支
        // 只放本页合计（buffer 必须 > 临界，否则 sliceTable 仍能放下 2 行进入 isLast 分支
        // 弹光所有行变 picked=0 走极端分支，依然不带总计/大写但本片无数据页坏掉）。
        const targetAvail = Math.max(
          1,
          availFull - lastRowH - lastOnlyFooterH - 2,
        )
        slice = sliceTable(model, { avail: targetAvail, start })
      }
    }

    warnings.push(...slice.warnings)

    // ★ vmerge 跨页修复（Path B — 续行锚点）：
    // 合并组被分页切断时,page 2 的首行原本是「被吞行」(vmerge 列 cell.consumed=true),
    // 视觉上等同于 page 1 末 anchor 行的延伸,但 rowspan 不能跨 <table> 边界,
    // 导致该格位的 colspan 错位(列 1 被列 2 覆盖)。
    // 修法：在本片头注入一个新 anchor 行,行高同首行,vmerge 列
    //   text = 首行 vmerge 列 text(被吞行的值就是合并组延续值,vmerge 按同值合并)
    //   rowSpan = 本片内连续被吞行数 + 1(覆盖 anchor + 本片被吞行)
    //   consumed 取消
    // 其他列直接复用首行(被吞行的非 vmerge 列本来就是正常显示的数据)
    if (slice.rows.length > 0) {
      const firstRow = slice.rows[0]!
      const vmergeColIdx = firstRow.cells.findIndex((c) => c.consumed === true)
      if (vmergeColIdx >= 0) {
        // 数本片开头连续被吞行数(只要 vmerge 列仍 consumed 即视为同组合并延续)
        let continuationCount = 0
        for (const r of slice.rows) {
          const c = r.cells[vmergeColIdx]
          if (c && c.consumed === true) continuationCount++
          else break
        }
        const anchorRow = buildVMergeContinuationAnchor(firstRow, vmergeColIdx, continuationCount)
        slice.rows = [anchorRow, ...slice.rows]
        slice.height += anchorRow.height
      }
    }

    // 跳过完全为空的尾片（上一页已放完全部数据行）：否则会渲染出一个空表 + 多余合计行
    const isEmptySlice =
      slice.rows.length === 0 && slice.headerRows.length === 0 && slice.footerRows.length === 0
    if (!isEmptySlice) {
      slices.push({
        table: {
          kind: 'table',
          id: model.control.id,
          left: tableLeft,
          top: topOnPage,
          width: tableWidth,
          height: slice.height,
          control: model.control,
          columns: model.columns,
          columnWidths: model.columnWidths,
          headerRows: slice.headerRows,
          rows: slice.rows,
          footerRows: slice.footerRows,
          isLastSlice: slice.isLast,
        },
        pageIndex,
      })
    }

    lastBottom = topOnPage + slice.height

    if (slice.isLast) break
    if (slice.nextStart === start && slice.rows.length === 0) {
      // 没有任何前进 → 防死循环
      warnings.push({
        code: 'CONTENT_OVERFLOW',
        message: '表格可用高度不足以容纳任何一行，已终止分页',
        controlId: model.control.id,
      })
      break
    }

    start = slice.nextStart
    pageIndex++
  }

  return {
    slices,
    pageCount: pageIndex + 1,
    lastBottom,
    warnings,
  }
}

/* ================================ 主入口 ================================ */

export async function layout(
  template: TemplateData<AnyControl>,
  data: Record<string, unknown>,
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const measurer = options.measurer ?? getSharedMeasurer()
  const maxPages = options.maxPages ?? MAX_PAGES
  const warnings: RenderWarning[] = []

  const doc = template.document
  const unit = doc.page.unit
  const sections = doc.sections ?? []
  const headerSection = sections.find((s) => s.type === 'header') as Section<AnyControl> | undefined
  const footerSection = sections.find((s) => s.type === 'footer') as Section<AnyControl> | undefined
  const bodySection = sections.find((s) => s.type === 'body') as Section<AnyControl> | undefined

  const metrics = computePageMetrics(doc.page, headerSection, footerSection)
  const baseCtx: EvalContext = { data }

  /* ── 前置：标签网格展开为绝对定位的普通控件（卡片不跨页） ── */
  const expansion = expandLabelGrids(
    bodySection?.components ?? [],
    baseCtx,
    unit,
    bodyStepMm(metrics),
    maxPages,
    undefined,
    // ★ 与 pagination-engine 同口径:把页眉/页脚占用传给展开器,
    // grid 跨页时新页 originTop = zoneTop,不再覆盖页眉
    {
      zoneTop: metrics.headerHeight,
      usableBottom: bodyStepMm(metrics) - metrics.footerHeight,
    },
  )
  warnings.push(...expansion.warnings)
  const bodyComponents = expansion.components
  const rowCtx = expansion.rowCtx

  // ★ 过滤「空卡片」的 gridLine:grid 中的子控件若被 isControlPrintable 过滤掉
  // (例:图片 photoUrl 为空 / 文本字段为空),该卡片就不应画框线。
  // 解决问题:用户截图反馈「grid 顶部标题和边线在第 2/3 页都画了,但图片其实没渲染」。
  // - 卡片边框(gridLine.cardIndex !== undefined):该 cardIndex 没渲染 → 移除
  // - 容器边框:该 page 没渲染任何 cardIndex → 移除
  // placeAppendixGrid 内部对 re.gridLines 做同样的过滤(覆盖 appendix 模式 grid 重新展开的场景);
  // 这里对初始 expansion.gridLines 做一次过滤,覆盖:
  //   - 无 flowTable 时 layoutStaticOnly 路径直接 attach 这些 gridLines
  //   - standard 模式 grid(不进入 placeAppendixGrid)
  expansion.gridLines = filterEmptyCardGridLines(
    expansion.gridLines,
    bodyComponents,
    baseCtx,
    rowCtx,
    unit,
    bodyStepMm(metrics),
  )

  // ★ 重构: 把 SVG 预生成 + buildTableModel 整体上移到 analyzeBody 之前,
  // 让 analyzeBody 能用「真实展开高」(realTableHeight)做分类基准,而不是 userHeight。
  // 设计画布不动 userHeight(保持设计意图);预览/打印 pipeline 用真实高做几何事实。
  // 依赖关系无循环:buildTableModel 只需要 data + table.options + measurer,
  // 不依赖 reserveBelow / analyzeBody 的输出。
  //
  // ★ 多流式分页 (multi-flow): 多张数据表都参与分页,按 top 顺序流动。
  // 这里为每张 flow table 预生成 model + svg lookup,后续 phase 切换时直接复用。
  const flowTables = pickFlowTables(bodyComponents, unit, rowCtx)
  // Map<tableId, {model, svgLookup}>——供 phase 切换时按 id 取
  const prebuiltModels = new Map<
    string,
    {
      model: TableModel
      svgLookup: ((segIdx: number, path: string, value: string) => string | undefined) | null
      realTableHeight: number
    }
  >()
  for (const ft of flowTables) {
    // ★ Commit 6: 段级 svg 预生成 —— 形态段(qrcode/barcode)的 svg 异步生成,
    // 在 buildTableModel 之前一次性预生成,buildTableModel 通过 svgLookup 同步消费。
    const allValuesByPath = new Map<string, Set<string>>()
    const dataRoot = baseCtx.data as Record<string, unknown>
    collectRowPaths(dataRoot, '', allValuesByPath)
    const items = dataRoot[ft.dataSource]
    if (Array.isArray(items)) {
      for (const row of items) {
        if (!row || typeof row !== 'object') continue
        collectRowPaths(row as Record<string, unknown>, '', allValuesByPath)
      }
    }
    const cellSegmentsList = collectCellSegmentsForTable(ft)
    const svgCacheMap = await precomputeCodeSvgsForCells(cellSegmentsList, allValuesByPath)
    const svgLookup = (_segIdx: number, path: string, value: string) =>
      svgCacheMap.get(`${path}:${value}`)

    const model = buildTableModel({
      control: ft,
      ctx: baseCtx,
      measurer,
      widthMm: toMm(ft.width, unit),
      heightMm: toMm(ft.height, unit),
      svgLookup,
    })
    warnings.push(...model.warnings)
    prebuiltModels.set(ft.id, {
      model,
      svgLookup,
      realTableHeight: totalTableHeight(model),
    })
  }

  // 向后兼容:第一张 flow table 的 model/svgLookup/fullTableHeight 单值变量
  // —— 大量后续代码仍以单表形式读取,后续阶段统一用 prebuiltModels.get(table.id)。
  const firstFlowTable = flowTables[0] ?? null
  let prebuiltModel: TableModel | null = null
  let prebuiltSvgLookup: ((segIdx: number, path: string, value: string) => string | undefined) | null = null
  let fullTableHeight = 0
  if (firstFlowTable) {
    const pre = prebuiltModels.get(firstFlowTable.id)!
    prebuiltModel = pre.model
    prebuiltSvgLookup = pre.svgLookup
    fullTableHeight = pre.realTableHeight
  }

  const { plan, warnings: planWarnings } = analyzeBody(bodyComponents, unit, fullTableHeight, rowCtx)
  warnings.push(...planWarnings)

  // ★ 多流式分页:多张数据表全部参与分页,移除原「仅第一个参与」的 CONTENT_OVERFLOW 警告。
  // 用户的设计意图:只要本页无法将所有画布控件数据全部渲染完,就应该分页到下一页。
  // 单表场景下仍由 analyzeBody 的 flowTable 字段驱动,行为零回归;多表场景下
  // plan.below 里后续 flow table 会进入下面的「多阶段循环」独立分页。
  if (flowTables.length > 1) {
    const overflowWarnings = warnings.filter((w) => w.code === 'CONTENT_OVERFLOW' && w.message.includes('数据表格'))
    if (overflowWarnings.length > 0) {
      const idx = warnings.indexOf(overflowWarnings[0]!)
      warnings.splice(idx, 1)
    }
  }

  // ★ 不再发「labelgrid + flowTable 共存」警告:appendix 模式(labelgrid 在表格下方)
  // 的真实业务场景(单据正文 + 附录图片墙)是金蝶/帆软/用友的标准做法。below-flow
  // 已经在 re-expansion 阶段正确处理容器边框 + 卡片落点 + gridLines 去重。
  // 真正的诊断信号是「用户设的表格 userHeight 远小于实际渲染高度」——
  // 这会让本来重叠/在表格内部的控件被 analyzeBody 错分进 below,见 below-flow
  // 的 TABLE_USER_HEIGHT_MISMATCH 检测。

  /* ── 情况 A：无流式表格 → 按位置切页 ── */
  if (!plan.flowTable) {
    const staticPages = await layoutStaticOnly(
      plan.above,
      baseCtx,
      unit,
      metrics,
      measurer,
      maxPages,
      warnings,
      rowCtx,
    )
    const pages = await buildPages(
      staticPages.length,
      new Map(staticPages.map((p, i) => [i, p])),
      headerSection,
      footerSection,
      baseCtx,
      unit,
      warnings,
    )
    attachGridLines(pages, expansion.gridLines)
    return { pages, metrics, page: doc.page, warnings: dedupeWarnings(warnings) }
  }

  /* ── 情况 B：有流式表格 ── */
  const table = plan.flowTable
  const tableTop = toMm(table.top, unit)
  const tableLeft = toMm(table.left, unit)
  const tableWidth = toMm(table.width, unit)
  // ★ 双基准:
  //   - userTableBottom: 设计意图基准(用户拖出的 userHeight 底),
  //     决定「below 控件相对表格的偏移量」(保住用户在画布上拖出的 gap)
  //   - realTableBottom(= tableBottom): 渲染期几何事实(真实展开底),
  //     决定 skeleton.lastBottom / reserveBelow / pageIndex 计算
  //
  // 用户常把 userHeight 拖得比真实展开小(实测 8 行 ~62mm vs 拖出 30mm)→
  // 用 userTableBottom 做 delta 起点后,finalTop = skeleton.lastBottom + delta
  // 会自然落在「实际末片表格底 + 用户设计 gap」的位置,
  // 既不与数据行重叠、也不丢用户设计的相对距离。
  const userTableBottom = tableTop + toMm(table.height, unit)
  const tableBottom = tableTop + fullTableHeight

  // ★ 复用前置阶段构建的 model + svgLookup(避免重复 buildTableModel / SVG 预生成)
  const model = prebuiltModel!
  const svgLookup = prebuiltSvgLookup

  // ★ Fix #1+#2+分流: below 控件按 mode 分两批(本轮新增):
  //   - textFlowBelow: 普通 below 控件(文本/合计/签章),共享 belowOriginTop(tableBottom),紧跟末页表格
  //   - appendixBelow: mode='appendix' 的 labelgrid,根据自身 pageBreak 单独决定:
  //       'always' → 独占新页
  //       'auto'/'never' → 放得下就跟文本后面,放不下整组推新页
  // 之前共享 firstBelowTop 的逻辑会让「文本紧贴表格」与「附录独占新页」冲突(用户反馈)。
  // 分流后两者独立调度:reserveBelow 用 textFlow 的,grid 自己有 reserveBelowGrid。
  // 关键:grid 已被 expandLabelGrids 拆成子控件,plan.below 里只有子控件(子控件 type 是 'text'/'image' 等),
  // 看不到原始 grid 的 mode/pageBreak。appendixBelow 必须从 expansion.originalGrids 取。
  const appendixBelow: LabelGridControl[] = []
  for (const lc of expansion.originalGrids.values()) {
    if (lc.mode !== 'appendix') continue
    // 只保留实际在 below 范围内的(其子控件在 plan.below 中)
    // 简化:grid 自身的设计 top > userTableBottom → 整组进 below
    // 用 userTableBottom(userHeight 底)而不是 tableBottom(realTableHeight 底):
    // 当 userHeight < realTableHeight 时,grid 设计 top 可能落在 userTableBottom 之外、
    // realTableBottom 之内 → 此时按「用户设计意图」应当算 below。
    if (toMm(lc.top, unit) >= userTableBottom - EPS) {
      appendixBelow.push(lc)
    }
  }
  // textFlowBelow = plan.below 里去掉 grid 子控件的部分
  const gridChildIdsByOwner = new Map<string, Set<string>>()
  for (const c of plan.below) {
    const co = (c as { childOf?: string }).childOf
    if (co) {
      let s = gridChildIdsByOwner.get(co)
      if (!s) {
        s = new Set()
        gridChildIdsByOwner.set(co, s)
      }
      s.add(c.id)
    }
  }
  const appendixChildIds = new Set<string>()
  for (const lc of appendixBelow) {
    for (const id of gridChildIdsByOwner.get(lc.id) ?? []) {
      appendixChildIds.add(id)
    }
  }
  // ★ 修复 2:任何 grid 的子控件都不该进 textFlowBelow —— 否则 firstBelowTop
  // 会被 standard grid 的子节点 top 污染,导致 reserveBelow 误算、grid 落点偏移。
  // appendixChildIds 只覆盖 mode='appendix',这里补上 standard grid 子节点的剔除。
  const allGridChildIds = new Set<string>(appendixChildIds)
  for (const owner of gridChildIdsByOwner.keys()) {
    if (expansion.originalGrids.has(owner) && expansion.originalGrids.get(owner)!.mode !== 'appendix') {
      for (const id of gridChildIdsByOwner.get(owner) ?? []) allGridChildIds.add(id)
    }
  }
  const textFlowBelow: AnyControl[] = plan.below.filter((c) => !allGridChildIds.has(c.id))
  // ★ 修复 Case 1:delta 起点从「第一个 below 控件的 top」改为「表格设计底（tableBottom=userHeight 底）」
  //
  // 原算法 firstBelowTop = min(control.top) → 第一个 below 控件的 delta=0 → 渲染时死死贴末片底,
  // 用户设计的「在表格底下方 30mm」这种相对 gap 全部丢失。
  // 新算法把起点换成 tableBottom(userHeight 底,设计期几何),保住用户在画布上拖出的相对位置:
  //   渲染 top = skeleton.lastBottom + (control.top - tableBottom)
  //   → 第一个 below 控件 delta = control.top - tableBottom,自然保留 gap。
  const sortedTextFlow = [...textFlowBelow].sort(
    (a, b) => toMm(a.top, unit) - toMm(b.top, unit),
  )
  // belowOriginTop = 用户设计表格底(userTableBottom = userHeight 底),
  // 作为所有 below 控件的相对起点。delta = control.top - userTableBottom 自然保留
  // 用户在画布上拖出的相对 gap;渲染时 finalTop = textBaseTop + delta,textBaseTop
  // 是 skeleton.lastBottom(真实末片底),所以最终位置 = 真实末片底 + 用户设计 gap。
  const belowOriginTop = userTableBottom
  const belowOffsets = sortedTextFlow.map((c) => ({
    control: c,
    delta: toMm(c.top, unit) - belowOriginTop,
  }))
  // ★ reserveBelow 必须涵盖 below 列表里**所有**控件的占地,不能只看 textFlow:
  // - 第二个数据表(static table / 非 flowTable 的 table)的设计 top 通常 > textFlow,
  //   但它们也会进 below 列表(text/image/rect 都已经被过滤) → 占同样的末页空间。
  // - 原算法只算 textFlow,这些 below static tables 的占地被忽略 → textFitsOnTablePage
  //   误判为 true,把所有 below 控件(含 col1 静态表)挤到 page 0,与数据表重叠。
  //   ★ 修复:把 below 里 type==='table' && id!==flowTable 的也算进 reserveBelow
  //   (用 control.height 作保守占位估计;真实高度由 placeStaticTables 内部
  //    buildTableModel 算,这里只需要保证 textFits 判断不会把整个 below 流误塞当前页)。
  const belowStaticTableOffsets = plan.below
    .filter((c) => c.type === 'table' && c.id !== table.id)
    .map((c) => ({
      control: c,
      delta: toMm(c.top, unit) - belowOriginTop,
    }))
  const reserveBelow = Math.max(
    belowOffsets.reduce(
      (max, b) => Math.max(max, b.delta + toMm(b.control.height, unit)),
      0,
    ),
    belowStaticTableOffsets.reduce(
      (max, b) => Math.max(max, b.delta + toMm(b.control.height, unit)),
      0,
    ),
  )
  // appendix grid 的 reserveBelowGrid: 算 labelgrid 真实展开高度(按数据条数 + 列数)
  //
  // ★ 关键过滤:'always' grid 不参与 reserveBelow —— 它会由 decideGridTarget 推到
  // 下一页独占,不占 tableLastPage 的剩余空间。如果把它算进 reserveBelow,会导致
  // paginateFlowTable 提前预留 grid 整页高 → tableLastPage 偏后 1 页 → textFlow
  // 的 textPageIndex 也偏后 1 页 → 文本控件被推到 grid 之后才出现,而不是紧跟末片表格
  // (用户截图反馈:page 4 表格后大空白,page 5 grid 独占,page 6 才是文本)。
  //
  // 只有 'auto'/'never' 的 grid 才参与 reserveBelow:它们跟在 cursor 后面,会占
  // tableLastPage 的剩余空间,需要预留避免挤掉。
  const reserveBelowGrid = appendixBelow.reduce((max, lc) => {
    const epb = lc.pageBreak ?? (lc.forceNewPage ? 'always' : 'auto')
    if (epb === 'always') {
      return max  // 'always' grid 自己独占新页,不占 tableLastPage 空间
    }
    const gridChildren = lc.children ?? []
    const geo = resolveGridGeometry({ ...lc, children: gridChildren })
    const cardH = toMm(geo.cardHeight, unit)
    const gapY = toMm(geo.gapY, unit)
    const stepY = cardH + gapY
    const arr = gridDataArrayForReserve(lc.dataSource, baseCtx)
    const visibleRows = Math.max(1, visibleCardRows(toMm(lc.height ?? 0, unit), geo))
    const naturalTotal = arr !== null && arr.length > 0 ? arr.length : geo.columns * visibleRows
    // ★ maxItems 钳制与展开器一致
    const total = lc.maxItems && lc.maxItems > 0
      ? Math.min(naturalTotal, lc.maxItems)
      : naturalTotal
    const totalRows = Math.max(1, Math.ceil(total / geo.columns))
    const gridRealH = totalRows * stepY - gapY
    // ★ appendixTitle 占据 titleHeight mm,在 grid 之上,需累加到实际占高
    // 高度按 style 真实渲染口径算(不写死 6),保证大字号/加粗不与首行重叠
    const titleHeight = lc.appendixTitle?.text?.trim()
      ? measureAppendixTitleHeight(lc.appendixTitle?.style)
      : 0
    return Math.max(max, gridRealH + titleHeight)
  }, 0)
  // ★ 合并:reserveBelow 必须把「非 'always' grid 真实展开高」也算进去 —— 否则
  // paginateFlowTable 算 tableLastPage 时只预留 textFlow 的 delta,grid 占的真实高
  // (跨多页时)会挤掉下面文本控件的空间,导致 grid 后面的文本被推到很后面的页。
  // 注意:grid 自身会被 decideGridTarget 决定 pageIdx(通常独占一页或跟 cursor),
  // 不受 reserveBelow 影响 —— 这里只是让末片表格不要"贪"末行,把空间留给 grid + grid 后文本。
  const reserveBelowTotal = Math.max(reserveBelow, reserveBelowGrid)

  const skeleton = paginateFlowTable(
    model,
    tableLeft,
    tableWidth,
    tableTop,
    metrics,
    reserveBelowTotal,
    maxPages,
  )
  warnings.push(...skeleton.warnings)

  const tableLastPage = skeleton.slices.at(-1)?.pageIndex ?? 0
  // 色带占位（与 paginateFlowTable 内同口径）：非首页/独占新页时从页眉下方起
  const headerH = metrics.headerHeight
  const footerH = metrics.footerHeight
  const zoneTop = headerH > 0 ? headerH : 0
  // 下方控件放得下就跟在末片后面，否则独占新的一页（top 从页眉下方起，不覆盖色带）
  // 末页可用底部 = 页脚上沿（整页相对）；无色带时回退 bodyHeight（原逻辑）。
  // ★ 文本(textFlow)的 cursor 起点统一为「真实末片底」(绝对坐标),
  //  不再二态(fits 时跟末片,否则整组跳下一页页眉下方)。
  //  原 fits 判断会让「最末一个控件超容」时把整组 below 控件都推到下一页,
  //  把中间可放控件也殃及 —— 用户反馈的"取最后一个控件底端判断"bug。
  //  新算法:每个 below 控件独立做 per-control 末底溢出检测
  //  (见 line 1024+ / line 1296+),超容的单独跳下一页,前面的保留原页。
  const textBaseStartAbsTop =
    tableLastPage * bodyStepMm(metrics) + skeleton.lastBottom
  // appendix grid 的 pageIndex 现在由 placeAppendixGrid 在处理时实时计算
  // (decideGridTarget 根据 cursor + pageBreak 三态预算),
  // 不再需要预计算 gridDecisions 数组。totalPages 起始 = max(tableLastPage, textPageIndex) + 1,
  // 后续 grid / multi-flow 处理完会更新。

  // totalPages 初值:用 textBaseStartAbsTop 推断第一页 text/grid 的 pageIdx。
  // 旧 textPageIndex 已移除(text 控件由 cursor 公式独立决定 pageIdx)。
  const initialTextPageIdx = Math.max(
    0,
    Math.floor(textBaseStartAbsTop / bodyStepMm(metrics)),
  )
  let totalPages = Math.max(1, Math.max(tableLastPage, initialTextPageIdx) + 1)
  let lastPageNo = totalPages

  /* ── 组装每页正文 ── */
  const bodyByPage = new Map<number, PlacedNode[]>()
  // 跟踪"实际有内容的最末页 index"——只算 bodyByPage 的最大 key,
  // 不算 initialTextPageIdx/tableLastPage 的 +1(那两个只是"预期会用到",
  // 实际 cursor 公式让 candidateTop 跳过了中间某些 page)。
  let actualLastPageIdx = -1
  const pushNode = (pageIndex: number, node: PlacedNode): void => {
    const list = bodyByPage.get(pageIndex)
    if (list) list.push(node)
    else bodyByPage.set(pageIndex, [node])
    if (pageIndex > actualLastPageIdx) actualLastPageIdx = pageIndex
  }

  for (const { table: slice, pageIndex } of skeleton.slices) pushNode(pageIndex, slice)

  // 第 1 页：表格上方 + 重叠控件 + 静态表格
  const firstCtx: EvalContext = { ...baseCtx, page: 1, pages: totalPages }
  const firstControls = await placeControls(
    [...plan.above, ...plan.overlap],
    firstCtx,
    unit,
    0,
    rowCtx,
  )
  warnings.push(...firstControls.warnings)
  // ★ 修复 Case 2:analyzeBody 用 userHeight 划分 overlap,但 userHeight > 实际展开高时,
  // 原本被分进 overlap 的控件在 page 1 原位渲染 → 与数据行重叠。
  // 这里在拿到真实末片底后做一次 refine。
  // 关键:只对 plan.overlap 列表里的控件做检查——above 控件的 bottom 可能也落在
  // 末片表格可视范围内(表格 userHeight 小,实际底比用户预期大很多),但用户设计意图
  // 是表格上方,绝不能下移。
  const overlapIdSet = new Set(plan.overlap.map((c) => c.id))
  const absoluteLastBottom = tableLastPage * bodyStepMm(metrics) + skeleton.lastBottom
  const refinedPlaced: PlacedNode[] = []
  for (const c of firstControls.placed) {
    if (c.kind === 'control' && overlapIdSet.has(c.id)) {
      const ctrlTopAbs = c.top  // page 1 原位 → absolute top
      const ctrlBottom = ctrlTopAbs + c.height
      if (ctrlBottom > 50 + EPS && ctrlBottom < absoluteLastBottom - EPS) {
        // ★ 重叠检测:控件底部落在表格末片可视范围内 → 改判 below
        // 公式:renderedTop = absoluteLastBottom + max(0, control.top - designTableBottom)
        // - control.top ≥ designTableBottom:保住用户设计 gap
        // - control.top < designTableBottom:控件被表格"设计区"压住(实际被数据行覆盖)
        //   → 钳到 0,渲染到 actualLastBottom,避免重叠
        const designTableBottom = toMm(table.top, unit) + toMm(table.height, unit)
        const ctrlDesignTop = toMm(c.control.top, unit)
        const gap = Math.max(0, ctrlDesignTop - designTableBottom)
        const newTopAbs = Math.max(0, absoluteLastBottom + gap)
        const newPageIdx = Math.floor(newTopAbs / bodyStepMm(metrics))
        const newPageRelTop = newTopAbs - newPageIdx * bodyStepMm(metrics)
        warnings.push({
          code: 'TABLE_USER_HEIGHT_MISMATCH',
          message:
            `控件「${c.id}」设计 top=${ctrlDesignTop.toFixed(1)}mm,` +
            `落在 userHeight=${(toMm(table.height, unit)).toFixed(1)}mm 的设计区 ` +
            `但被实际渲染底=${absoluteLastBottom.toFixed(1)}mm 的表格覆盖,` +
            `已自动下移到 page ${newPageIdx + 1} top=${newPageRelTop.toFixed(1)}mm 避免与数据行重叠。` +
            `建议把表格设计高度调到 ≥ ${(absoluteLastBottom - toMm(table.top, unit)).toFixed(1)}mm。`,
          controlId: c.id,
        })
        if (newPageIdx > 0) {
          // 推到末页
          pushNode(newPageIdx, { ...c, top: newPageRelTop })
          continue
        } else {
          refinedPlaced.push({ ...c, top: newTopAbs })
          continue
        }
      }
    }
    refinedPlaced.push(c)
  }
  for (const c of refinedPlaced) pushNode(0, c)

  const staticTables = placeStaticTables(
    [...plan.above, ...plan.overlap],
    // 多流式分页:把所有 flow table id 一起跳过,
    // 避免 main1 的 above/overlap 静态表路径把 main2 当静态表渲染(导致重复)
    new Set(flowTables.map((ft) => ft.id)),
    firstCtx,
    unit,
    measurer,
    0,
    rowCtx,
  )
  warnings.push(...staticTables.warnings)
  for (const t of staticTables.placed) pushNode(0, t)

  // 末页：表格下方控件，按表格实际底边下移
  // ★ cursor-based 处理:appendix grid 现在用 placeAppendixGrid(lc, ctx, ..., cursorAbsTop)
  //   实时决定 pageIndex + originTop,grid 末底推进 cursor 供后续控件定位。
  //   text/image 也按 cursor 增量处理,确保 grid 后的文本跟 grid 末底(用户决策 3)。
  const belowGridIds = new Set<string>()
  if (plan.below.length > 0) {
    const belowCtx: EvalContext = { ...baseCtx, page: lastPageNo, pages: totalPages }

    // 收集在 below 区域出现的 labelgrid(appendix mode)id
    for (const c of plan.below) {
      const childOf = (c as { childOf?: string }).childOf
      if (childOf && expansion.originalGrids.has(childOf)) {
        belowGridIds.add(childOf)
      }
    }

    // 收集 grid 子控件 id(用于 text-flow 跳过它们,避免重复渲染)
    const gridChildIds = new Set<string>()
    for (const lc of appendixBelow) {
      for (const cid of gridChildIdsByOwner.get(lc.id) ?? []) {
        gridChildIds.add(cid)
      }
    }

    // ★ 合并 text/image + appendix grid 为 phaseStream,按设计 top 排序。
    //   整个流按 cursor 增量处理:
    //   - prevTop:上一个 item 的设计 top(初始 = belowOriginTop)
    //   - cursor:上一个 item 的绝对末底(初始 = textPageIndex*bodyStep + textBaseTop)
    //   - 当前 item 设计 delta = item.top - prevTop
    //   - 当前 item 渲染位置 = cursor + max(0, design delta)
    //     (负 delta 钳 0 保留「控件至少在表格底下方」的语义)
    //   - grid 用 placeAppendixGrid 实时决定 pageIndex,跨多页自然溢出,
    //     末底推进 cursor 供后续控件跟 grid 末底(用户决策 3)。
    //
    // 注意:expandLabelGrids 在 layout() 开头(line 460)把所有 labelgrid 替换为
    //   children,所以 plan.below 不会含 type='labelgrid' 控件(只有 grid 子控件)。
    //   appendix grid 控件需要从 expansion.originalGrids 取,用 appendixBelow 列表。
    type PhaseItem =
      | { kind: 'text'; control: AnyControl; designTop: number }
      | { kind: 'grid'; lc: LabelGridControl; designTop: number }
    const phaseStream: PhaseItem[] = []
    // 1) text/image 控件:从 plan.below 取,跳过 grid 子控件 + table(static table / 后续 flow table 不入流)
    for (const c of plan.below) {
      if (c.type === 'zone') continue
      if (gridChildIds.has(c.id)) continue  // grid 子控件由 placeAppendixGrid 重新展开
      if (c.type === 'labelgrid') continue  // 防御性:plan.below 里不会有,但跳过以防
      if (c.type === 'table') continue  // static table / 后续 flow table 由 belowStatic / multi-flow 处理
      phaseStream.push({ kind: 'text', control: c, designTop: toMm(c.top, unit) })
    }
    // 2) appendix grid:从 appendixBelow 取(已按 lc.top >= userTableBottom 过滤)
    for (const lc of appendixBelow) {
      phaseStream.push({ kind: 'grid', lc, designTop: toMm(lc.top, unit) })
    }
    phaseStream.sort((a, b) => a.designTop - b.designTop)

    // cursor 起点:用 textBaseStartAbsTop(由 textFitsOnTablePage 决定)
    //   - fits=true  → 绝对末片底,所有 text/grid 紧跟末片表格
    //   - fits=false → 下一页页眉下方,作为「不让 below 控件覆盖页眉」的下限
    //
    // 真实末片底 = tableLastPage * bodyStep + skeleton.lastBottom
    // below 控件设计 top 是绝对坐标(相对画布原点)。
    // 用户设计意图中的「表格底」= userTableBottom(belowOriginTop),
    // 而真实末片底 ≠ userTableBottom(realHeight > userHeight 是常见 case)。
    //
    // 设计 gap = control.top - belowOriginTop(用户在画布上拖出的相对表格底的距离)
    // 物理 top = absoluteLastBottom + 设计 gap(用真实末片底替换用户拖出的表格底)
    const absoluteLastBottom = tableLastPage * bodyStepMm(metrics) + skeleton.lastBottom
    // 物理 cursor:从 textBaseStartAbsTop 起(末片底 或 下一页页眉下方),作为重叠防护
    let cursorAbsBottom = textBaseStartAbsTop

    for (const item of phaseStream) {
      // ★ 关键修法:itemStartAbsTop = max(物理 cursor, 真实末片底 + 设计 gap)
      //
      // 设计意图:用户把控件 top 拖到「userTableBottom + 设计 gap」的位置
      //   (例:userTableBottom=80,控件 top=220 → 设计 gap=140)
      // 物理上:把 userTableBottom 替换为 absoluteLastBottom(真实末片底)
      //   → 控件渲染到「absoluteLastBottom + 140」的位置
      //
      // 历史问题 1:cursorAbsBottom + designDelta 公式把设计间距当物理偏移叠加,
      //   userHeight < 真实高时 cursor 落后于设计意图 → 后续控件继承偏差
      // 历史问题 2:用「绝对设计 top」直接渲染,在 page 跨越时会把 page 2 上的
      //   控件直接落到 page 2 顶部 + (top - bodyStep),而实际上 page 2 之前的
      //   正文末尾是 absoluteLastBottom,二者不连续 → page 1/2 之间出现大空白
      //
      // 新公式:
      //   - designGap = control.top - belowOriginTop(用户的相对设计 gap)
      //   - candidateTop = absoluteLastBottom + designGap(物理上:真实末片底 + 设计 gap)
      //   - itemStartAbsTop = max(cursorAbsBottom, candidateTop)
      //   → 跨越 page 1→page 2 时,控件自动落到 page 2 上「absoluteLastBottom
      //     + designGap - bodyStep」位置,与「上方真实正文末」连续
      //   → 连续的 below 控件严格按设计 gap 顺序排版,无累积偏差
      //
      // ★ 跨页钳制:candidateTop 不能跳过 cursor 所在页的「下一页顶」造成中间空白页。
      //   例:cursorAbsBottom=212(page 0 末),designGap=150 → candidateTop=336 → 跳过 page 1 落到 page 2 顶部
      //   会让 page 1 完全空白(没有任何 pushNode 落到 page 1,buildPages 收缩也救不了
      //   因为 effectiveTotalPages 仍含 page 1)。
      //   钳制下限 = max(cursorAbsBottom, nextPageTop):
      //     - 若 cursor 还在本页(cursorAbsBottom<nextPageTop),用 nextPageTop 防跳页
      //     - 若 cursor 已在新一页(cursorAbsBottom≥nextPageTop),允许继续在该页往下铺
      //   最终 itemStartAbsTop = max(cursorAbsBottom, clampedCandidateTop):
      //     - 「紧跟 cursor」优先(避免与已放置控件重叠)
      //     - 「不跳页」次之(避免中间空白页)
      //   用户反馈:旧逻辑用 textFitsOnTablePage 整组判断会让中间可放控件被殃及下移;
      //   新的 per-control 检测(line 1016+)接管「单控件末底溢出」,此处只防「跨页跳」。
      const designGap = item.designTop - belowOriginTop
      const candidateTop = absoluteLastBottom + designGap
      const cursorPageTop = Math.floor(cursorAbsBottom / bodyStepMm(metrics)) * bodyStepMm(metrics)
      const nextPageTop = cursorPageTop + bodyStepMm(metrics) + zoneTop
      const clampedCandidateTop = Math.min(candidateTop, Math.max(cursorAbsBottom, nextPageTop))
      const itemStartAbsTop = Math.max(cursorAbsBottom, clampedCandidateTop)

      if (item.kind === 'text') {
        const c = item.control
        const cctx = withRowCtx(c.id, belowCtx, rowCtx)
        if (!isControlPrintable(c, cctx)) continue
        const cHeight = toMm(c.height, unit)
        // ★ 误分类检测:用户设的 userHeight 太小时,该控件的「设计 top」可能落在
        // 表格「实际渲染底」之下 —— 末页 cursor 已 ≥ absoluteLastBottom,
        // 设计 delta 会让控件自然落在 cursor 之外,设计意图保留。
        const controlTopMm = toMm(c.top, unit)
        const absoluteLastBottom =
          tableLastPage * bodyStepMm(metrics) + skeleton.lastBottom
        if (controlTopMm < absoluteLastBottom - EPS) {
          const userBottom = tableTop + toMm(table.height, unit)
          const actualHeight = absoluteLastBottom - tableTop
          warnings.push({
            code: 'TABLE_USER_HEIGHT_MISMATCH',
            message:
              `控件「${c.id}」设计 top=${controlTopMm.toFixed(1)}mm,` +
              `但表格「${table.id}」实际渲染底=${absoluteLastBottom.toFixed(1)}mm ` +
              `(userHeight=${(userBottom - tableTop).toFixed(1)}mm 远小于实际 ${actualHeight.toFixed(1)}mm)。` +
              `建议把表格高度调到 ≥ ${actualHeight.toFixed(1)}mm,` +
              `或把控件上移以避免被表格覆盖。`,
            controlId: c.id,
          })
        }
        // ★ per-control 末底溢出检测(取代旧的整组 textFitsOnTablePage 判断):
        //   仅把超容的那个控件单独跳下一页;前面已经在末页放下的控件保留原位。
        //   旧的"按最后控件底端判断"会让中间可放控件也被一并推到下一页(用户反馈的 bug)。
        let cAbsTop = itemStartAbsTop
        const cStartPageIdx = Math.floor(cAbsTop / bodyStepMm(metrics))
        const cStartTopRel = cAbsTop - cStartPageIdx * bodyStepMm(metrics)
        // footerLimit = 当前 page 在 zoneTop 之下的可用底(无页脚时回退 bodyStep)
        const cFooterLimit = footerH > 0 ? bodyStepMm(metrics) - footerH : bodyStepMm(metrics)
        if (cStartTopRel + cHeight > cFooterLimit + EPS) {
          // 钳到下一页 zoneTop(避免覆盖页眉色带;无色带时 zoneTop=0)
          cAbsTop = (cStartPageIdx + 1) * bodyStepMm(metrics) + zoneTop
        }
        const cAbsBottom = cAbsTop + cHeight
        const cPageIdx = Math.max(0, Math.floor(cAbsTop / bodyStepMm(metrics)))
        const cTopRel = cAbsTop - cPageIdx * bodyStepMm(metrics)
        const { content, warnings: w } = await resolveControlContent(c, cctx)
        warnings.push(...w)
        pushNode(cPageIdx, {
          kind: 'control',
          id: c.id,
          left: toMm(c.left, unit),
          top: cTopRel,
          width: toMm(c.width, unit),
          height: cHeight,
          angle: c.angle,
          content,
          control: c,
        })
        // 推进 cursor:用控件真实渲染末底,作为「不让下一个 below 控件与此控件重叠」的下限
        cursorAbsBottom = Math.max(cursorAbsBottom, cAbsBottom)
      } else {
        // grid:基于 cursor 用 placeAppendixGrid 实时决定 pageIndex + originTop
        //   (decideGridTarget 按 pageBreak 三态:always 优先新页,auto 放得下就跟,
        //    never 强制不放新页)。
        //   剔除该 grid 的旧 gridLines(初始 expandLabelGrids 基于 design top 生成的)。
        const ogLeft = toMm(item.lc.left, unit)
        const ogTop = toMm(item.lc.top, unit)
        const ogBottom = ogTop + toMm(item.lc.height, unit)
        // ★ 移除「该 grid 的所有旧 gridLines」(初始 expandLabelGrids 基于 design top 展开,
        // 后续被 placeAppendixGrid 用 hint 重新展开;旧展开的 gridLines 全部废弃,不能按 ogTop..ogBottom 范围过滤——
        // 当 grid 真实展开高超出设计底时,初始展开可能落到下一页,absTop 已超出 ogBottom,原过滤漏掉导致重复)。
        // 通过 gridId 精确识别:同一 lc.id 的所有 gridLines 全部移除。
        expansion.gridLines = expansion.gridLines.filter((gl) => gl.gridId !== item.lc.id)
        const pl = await placeAppendixGrid(
          item.lc,
          belowCtx,
          unit,
          metrics,
          maxPages,
          itemStartAbsTop,
        )
        warnings.push(...pl.warnings)
        // children 的 top 是 absolute 跨页坐标 → 转 page-relative 后推入
        for (const [k, v] of pl.rowCtx) rowCtx.set(k, v)
        for (const child of pl.children) {
          const cctx = withRowCtx(child.id, belowCtx, rowCtx)
          if (!isControlPrintable(child, cctx)) continue
          const childAbsTop = toMm(child.top, unit)
          const childAbsHeight = toMm(child.height, unit)
          const childPageIdx = Math.max(0, Math.floor(childAbsTop / bodyStepMm(metrics)))
          const childTopRel = childAbsTop - childPageIdx * bodyStepMm(metrics)
          const { content, warnings: cw } = await resolveControlContent(child, cctx)
          warnings.push(...cw)
          pushNode(childPageIdx, {
            kind: 'control',
            id: child.id,
            left: toMm(child.left, unit),
            top: childTopRel,
            width: toMm(child.width, unit),
            height: childAbsHeight,
            angle: child.angle,
            content,
            control: child,
          })
        }
        // gridLines 已是 page-relative + 按 pageRanges 切分,直接收集
        for (const gl of pl.gridLines) {
          expansion.gridLines.push(gl)
        }
        // ★ 推进 cursor:用 Math.max 而非直接赋值,防止"空 grid"(子控件全被
        // isControlPrintable 过滤时 lastAbsBottom=0)把 cursor 回卷到文档顶部,
        // 导致后续 below 控件的 candidateTop 失去下限,page 序错乱。
        // 同时:若 grid 实际渲染为空(末底 ≤ cursorFloor),不推进 cursor,让
        // 后续 below 控件紧跟 cursorAbsBottom(避免空 grid 撑大 totalPages)。
        if (pl.lastAbsBottom > cursorAbsBottom) {
          cursorAbsBottom = pl.lastAbsBottom
        }
        // totalPages 更新
        if (pl.lastPageIdx + 1 > totalPages) {
          totalPages = pl.lastPageIdx + 1
          lastPageNo = totalPages
        }
      }
    }

    const belowStatic = placeStaticTables(
      plan.below,
      // 多流式分页:plan.below 可能包含后续 flow table,
      // 它们由多阶段循环独立分页,不在此渲染为静态表。
      new Set(flowTables.map((ft) => ft.id)),
      { ...baseCtx, page: lastPageNo, pages: totalPages },
      unit,
      measurer,
      // shift = textBaseStartAbsTop - tableLastPage*bodyStep - userTableBottom
      //   textBaseStartAbsTop 已是绝对坐标(末片底 或 下一页页眉下方)
      //   减去「tableLastPage*bodyStep + userTableBottom」回到 page-relative
      //     + tableTop 坐标系 → finalTop = control.top + shift
      //                       = control.top - userTableBottom + (absoluteLastBottom 或下一页页眉下方)
      //                       = 真实末片底/页眉下方 + (control.top - userTableBottom)
      //                       = 与 text 控件的 delta 公式一致
      textBaseStartAbsTop -
        tableLastPage * bodyStepMm(metrics) -
        userTableBottom,
      rowCtx,
    )
    warnings.push(...belowStatic.warnings)
    // 静态表跟随 text 流(用 cursorAbsBottom 推断 pageIdx,与 text 控件同算法)
    // 旧版用 textPageIndex 在 fits=false 时强制塞下一页,会导致静态表与 text 控件 page 不一致;
    // 这里改用 cursorAbsBottom 推断,与 text 控件同 page。
    // ★ per-control 末底溢出检测:静态表若超过当前 page 的 footerLimit,单独跳下一页。
    //   否则静态表会与页脚重叠(text 控件已享受此检测,静态表享受不对称)。
    const staticFooterLimit =
      footerH > 0 ? bodyStepMm(metrics) - footerH : bodyStepMm(metrics)
    let staticCursorAbsBottom = cursorAbsBottom
    for (const t of belowStatic.placed) {
      const tPageIdx = Math.max(0, Math.floor(staticCursorAbsBottom / bodyStepMm(metrics)))
      const tTopRel = staticCursorAbsBottom - tPageIdx * bodyStepMm(metrics)
      let tPushPageIdx = tPageIdx
      let tPushTopRel = tTopRel
      if (tTopRel + t.height > staticFooterLimit + EPS) {
        tPushPageIdx = tPageIdx + 1
        tPushTopRel = zoneTop
      }
      pushNode(tPushPageIdx, { ...t, top: tPushTopRel })
      staticCursorAbsBottom = Math.max(
        staticCursorAbsBottom,
        tPushPageIdx * bodyStepMm(metrics) + tPushTopRel + t.height,
      )
    }
  }

  /* ── 注入页眉页脚 ── */
  // 旧 gridLines 剔除已搬到 below-flow 内 placeAppendixGrid 调用前(按 ogLeft+ogTop..ogBottom 范围)
  // —— 这样只剔除「属于该 grid 的旧展开」,不会误删新 gridLines(它们在 cursor 真实落点,不在 ogTop 范围)。

  /* ── 多流式分页 (multi-flow):后续 flow tables 各自独立分页 ──
   *
   * 设计语义:
   *   第 1 张 flow table 的处理在上面已经完成(skeleton + below-stream)。
   *   从第 2 张开始,每张 flow table:
   *     1. 按"上一阶段末底 + 用户设计 gap"算出目标绝对坐标 (pageIdx, topRel)
   *     2. 在该坐标起 paginateFlowTable
   *     3. 处理它自己的 below-stream(到下一张 flow table 之前的所有 text/image)
   *        —— 按 top 顺序串入,delta 累加保留用户设计 gap。
   *
   * 单表场景 (flowTables.length === 1) 此循环不执行,行为零回归。
   */
  if (flowTables.length > 1) {
    // 收集 plan.below 里所有非流式表格(static table)—— 它们用原 belowStatic 逻辑已放好,
    // 这里要剔除避免与 multi-flow 重复处理。
    // 收集 plan.below 里的 text/image 控件 —— 它们已被第 1 张 ft 的 below-stream 处理。
    const processedBelowIds = new Set<string>()
    for (const { control } of belowOffsets) processedBelowIds.add(control.id)
    for (const t of plan.below) {
      if (t.type === 'table' && t.id !== table.id) {
        processedBelowIds.add(t.id)  // static tables 已通过 belowStatic 处理
      }
    }

    // 上一阶段末底(绝对坐标)
    let prevLastPageIdx = tableLastPage
    let prevLastBottomRel = skeleton.lastBottom

    // 第一阶段已处理的 appendixBelow 的 grid id 集合(避免 multi-flow 重复处理)
    const firstPhaseGridIds = new Set<string>()
    for (const lc of appendixBelow) firstPhaseGridIds.add(lc.id)

    for (let phaseIdx = 1; phaseIdx < flowTables.length; phaseIdx++) {
      const ft = flowTables[phaseIdx]!
      const prevFt = flowTables[phaseIdx - 1]!
      const pre = prebuiltModels.get(ft.id)!
      if (!pre) continue  // defensive

      const ftUserTop = toMm(ft.top, unit)
      const ftUserHeight = toMm(ft.height, unit)
      const ftUserBottom = ftUserTop + ftUserHeight
      const prevFtUserBottom = toMm(prevFt.top, unit) + toMm(prevFt.height, unit)

      // 设计 gap:第 i 张 ft 在画布上离第 i-1 张 ft 的 userBottom 的距离
      // —— 用户在画布上拖出的相对 gap,渲染时尽量保留。
      const designGap = ftUserTop - prevFtUserBottom

      // 上一阶段末底绝对坐标 + 设计 gap = 当前 ft 的目标绝对 top
      const cursorAbsTop = prevLastPageIdx * bodyStepMm(metrics) + prevLastBottomRel
      const targetAbsTop = cursorAbsTop + designGap
      const targetPageIdx = Math.max(0, Math.floor(targetAbsTop / bodyStepMm(metrics)))
      const targetTopRel = targetAbsTop - targetPageIdx * bodyStepMm(metrics)

      // ★ 末页底部安全:cap 到 maxPages - 1
      if (targetPageIdx >= maxPages) {
        warnings.push({
          code: 'PAGE_LIMIT_REACHED',
          message: `数据表「${ft.id}」超出 ${maxPages} 页保护上限，已截断`,
          controlId: ft.id,
        })
        break
      }

      // ★ 此 ft 的 below-stream:
      //   - text/image:plan.below 控件中,top ≥ ftUserBottom 且 < 下一张 ftUserTop 的部分
      //   - appendix grid:expansion.originalGrids 中 mode='appendix' 的 grid,
      //     top 在 ftUserBottom..nextFtUserTop 范围,且不在第一阶段处理过的
      const nextFt = flowTables[phaseIdx + 1]
      const nextFtUserTop = nextFt ? toMm(nextFt.top, unit) : Number.POSITIVE_INFINITY

      // phaseTextStream:phase 的 text/image 控件(按 top 排序)
      const phaseTextStream = bodyComponents
        .filter((c) => {
          if (processedBelowIds.has(c.id)) return false
          if (c.type === 'table') return false  // 后续 ft 由下一阶段处理,这里只放 text/image
          if (c.type === 'zone' || c.type === 'labelgrid') return false
          const top = toMm(c.top, unit)
          return top >= ftUserBottom - EPS && top < nextFtUserTop - EPS
        })
        .sort((a, b) => toMm(a.top, unit) - toMm(b.top, unit))

      // phaseGridStream:phase 的 appendix grid(从 expansion.originalGrids 收集)
      const phaseGridStream: LabelGridControl[] = []
      for (const lc of expansion.originalGrids.values()) {
        if (lc.mode !== 'appendix') continue
        if (firstPhaseGridIds.has(lc.id)) continue  // 第一阶段已处理
        const lcTop = toMm(lc.top, unit)
        if (lcTop < ftUserBottom - EPS) continue
        if (lcTop >= nextFtUserTop - EPS) continue
        phaseGridStream.push(lc)
      }

      // 合并 phaseStream 按 top 排序(text 在前,grid 在后,用 sort 统一处理)
      type PhaseItem =
        | { kind: 'text'; control: AnyControl }
        | { kind: 'grid'; lc: LabelGridControl }
      const phaseStream: PhaseItem[] = [
        ...phaseTextStream.map((c) => ({ kind: 'text' as const, control: c })),
        ...phaseGridStream.map((lc) => ({ kind: 'grid' as const, lc })),
      ].sort((a, b) => {
        const aTop = a.kind === 'text' ? toMm(a.control.top, unit) : toMm(a.lc.top, unit)
        const bTop = b.kind === 'text' ? toMm(b.control.top, unit) : toMm(b.lc.top, unit)
        return aTop - bTop
      })

      // ★ 此 ft 的 reserveBelow:phaseStream 中 text/image 控件 + 自身高度估算
      const phaseReserveBelow = phaseTextStream.reduce(
        (max, c) => {
          const cDelta = toMm(c.top, unit) - ftUserBottom
          return Math.max(max, cDelta + toMm(c.height, unit))
        },
        0,
      )

      // Paginate this flow table
      const subSkeleton = paginateFlowTable(
        pre.model,
        toMm(ft.left, unit),
        toMm(ft.width, unit),
        targetTopRel,
        metrics,
        phaseReserveBelow,
        maxPages - targetPageIdx,
      )
      warnings.push(...subSkeleton.warnings)

      // 调整 slice.pageIndex 到绝对页
      const absLastSlice = subSkeleton.slices.at(-1)
      const subLastPageIdx = (absLastSlice?.pageIndex ?? 0) + targetPageIdx
      const subLastBottomRel = absLastSlice
        ? (absLastSlice.table.top + absLastSlice.table.height)
        : targetTopRel

      // 推 slices 到 bodyByPage
      for (const { table: slice, pageIndex } of subSkeleton.slices) {
        const absPage = pageIndex + targetPageIdx
        pushNode(absPage, slice)
      }

      // ★ 推此 phase 的 below-stream(text/image + appendix grid 混合,cursor-based):
      //   - text/image:与第一阶段一致,起点 = max(phaseCursor, 真实子流末底 + 设计 gap)
      //   - grid:基于 cursor (子流 max abs bottom) 用 placeAppendixGrid 实时决定 pageIndex
      const subAbsoluteLastBottom =
        subLastPageIdx * bodyStepMm(metrics) + subLastBottomRel
      let phaseCursorAbsBottom = subAbsoluteLastBottom
      for (const item of phaseStream) {
        if (item.kind === 'text') {
          const c = item.control
          if (processedBelowIds.has(c.id)) continue
          processedBelowIds.add(c.id)
          const cHeight = toMm(c.height, unit)
          // ★ 修法:max(物理 cursor, 真实子流末底 + 设计 gap)
          // 与第一阶段公式一致,避免 cDelta = control.top - ftUserBottom 把用户
          // 设计间距累积成物理偏差,以及 page 跨越时控件与上方真实正文末不连续。
          const cDesignGap = toMm(c.top, unit) - ftUserBottom
          const cCandidateTop = subAbsoluteLastBottom + cDesignGap
          // ★ 跨页钳制(multi-flow 补齐,等价于第一阶段 line 994-996):
          //   防止 designGap 巨大时 itemStartAbsTop 跳到很远之后页,留下中间空白页。
          let cAbsTop = Math.max(phaseCursorAbsBottom, cCandidateTop)
          const cCursorPageTop =
            Math.floor(phaseCursorAbsBottom / bodyStepMm(metrics)) * bodyStepMm(metrics)
          const cNextPageTop = cCursorPageTop + bodyStepMm(metrics) + zoneTop
          cAbsTop = Math.min(cAbsTop, cNextPageTop)
          cAbsTop = Math.max(phaseCursorAbsBottom, cAbsTop)
          // ★ per-control 末底溢出检测(与第一阶段 line 1024+ 一致)
          const cStartPageIdx = Math.floor(cAbsTop / bodyStepMm(metrics))
          const cStartTopRel = cAbsTop - cStartPageIdx * bodyStepMm(metrics)
          const cFooterLimit =
            footerH > 0 ? bodyStepMm(metrics) - footerH : bodyStepMm(metrics)
          if (cStartTopRel + cHeight > cFooterLimit + EPS) {
            cAbsTop = (cStartPageIdx + 1) * bodyStepMm(metrics) + zoneTop
          }
          const cPageIdx = Math.max(0, Math.floor(cAbsTop / bodyStepMm(metrics)))
          const cTopRel = cAbsTop - cPageIdx * bodyStepMm(metrics)

          const cctx = withRowCtx(c.id, baseCtx, rowCtx)
          if (!isControlPrintable(c, cctx)) continue
          const { content, warnings: cw } = await resolveControlContent(c, cctx)
          warnings.push(...cw)
          pushNode(cPageIdx, {
            kind: 'control',
            id: c.id,
            left: toMm(c.left, unit),
            top: cTopRel,
            width: toMm(c.width, unit),
            height: cHeight,
            angle: c.angle,
            content,
            control: c,
          })
          // 推进 cursor:取 abs bottom
          phaseCursorAbsBottom = Math.max(phaseCursorAbsBottom, cAbsTop + cHeight)
        } else {
          // grid:基于 cursor 用 placeAppendixGrid 实时决定 pageIndex + originTop
          const pl = await placeAppendixGrid(
            item.lc,
            baseCtx,
            unit,
            metrics,
            maxPages,
            phaseCursorAbsBottom,
          )
          warnings.push(...pl.warnings)
          // ★ 移除「该 grid 的所有旧 gridLines」(初始 expandLabelGrids 基于 design top 展开,
          // 后续被 placeAppendixGrid 用 hint 重新展开;旧展开的 gridLines 全部废弃,不能按 ogTop..ogBottom 范围过滤——
          // 当 grid 真实展开高超出设计底时,初始展开可能落到下一页,absTop 已超出 ogBottom,原过滤漏掉导致重复)。
          expansion.gridLines = expansion.gridLines.filter((gl) => gl.gridId !== item.lc.id)
          // 推 children
          for (const [k, v] of pl.rowCtx) rowCtx.set(k, v)
          for (const child of pl.children) {
            const cctx = withRowCtx(child.id, baseCtx, rowCtx)
            if (!isControlPrintable(child, cctx)) continue
            const childAbsTop = toMm(child.top, unit)
            const childAbsHeight = toMm(child.height, unit)
            const childPageIdx = Math.max(0, Math.floor(childAbsTop / bodyStepMm(metrics)))
            const childTopRel = childAbsTop - childPageIdx * bodyStepMm(metrics)
            const { content, warnings: cw } = await resolveControlContent(child, cctx)
            warnings.push(...cw)
            pushNode(childPageIdx, {
              kind: 'control',
              id: child.id,
              left: toMm(child.left, unit),
              top: childTopRel,
              width: toMm(child.width, unit),
              height: childAbsHeight,
              angle: child.angle,
              content,
              control: child,
            })
          }
          // 推 gridLines
          for (const gl of pl.gridLines) {
            expansion.gridLines.push(gl)
          }
          // ★ 推进 cursor:用 Math.max 而非直接赋值,防止空 grid 把 cursor 回卷
          if (pl.lastAbsBottom > phaseCursorAbsBottom) {
            phaseCursorAbsBottom = pl.lastAbsBottom
          }
          firstPhaseGridIds.add(item.lc.id)  // 标记处理过
          // 更新 totalPages
          if (pl.lastPageIdx + 1 > totalPages) {
            totalPages = pl.lastPageIdx + 1
            lastPageNo = totalPages
          }
        }
      }

      // 更新 cursor 到此 phase 末底
      prevLastPageIdx = Math.max(subLastPageIdx, Math.floor(phaseCursorAbsBottom / bodyStepMm(metrics)))
      prevLastBottomRel = phaseCursorAbsBottom - prevLastPageIdx * bodyStepMm(metrics)

      // totalPages 取 max
      if (prevLastPageIdx + 1 > totalPages) {
        totalPages = prevLastPageIdx + 1
        lastPageNo = totalPages
      }
    }
  }

  // ★ 压缩空白页 + 重映射 pageIdx:totalPages 可能被 cursor 跳页 / grid 末底撑大,
  // 但中间某些 page 完全没有 body / gridLine(已被 filterEmptyCardGridLines 过滤)
  // → 实际是空白页。仅收缩 totalPages 不够 —— 例如 bodyByPage keys={0,2,3} 时
  // effectiveTotalPages=4,page idx 1 仍是空白,导致用户看到「第 2 页空白,grid 跳第 3 页」。
  //
  // 这里构建「oldIdx → newIdx」映射,把用到的 pageIdx 按升序重编号成连续 0..N-1:
  //   {0, 2, 3} → {0, 1, 2},bodyByPage 和 gridLines 同步 remap,
  //   pages 数组直接是 [page0, page1, page2] (page idx 1 原来空,现在填入原 idx 2 的内容)。
  const usedPageIdxs = new Set<number>()
  for (const p of bodyByPage.keys()) usedPageIdxs.add(p)
  for (const gl of expansion.gridLines) usedPageIdxs.add(gl.pageIndex)
  const sortedUsed = Array.from(usedPageIdxs).sort((a, b) => a - b)
  const pageIdxRemap = new Map<number, number>()
  sortedUsed.forEach((oldIdx, newIdx) => pageIdxRemap.set(oldIdx, newIdx))

  // 重建 bodyByPage(用 remap 后的 key)
  const remappedBodyByPage = new Map<number, PlacedNode[]>()
  for (const [oldIdx, list] of bodyByPage) {
    const newIdx = pageIdxRemap.get(oldIdx) ?? oldIdx
    remappedBodyByPage.set(newIdx, list)
  }
  // remap gridLines 的 pageIndex
  for (const gl of expansion.gridLines) {
    const remapped = pageIdxRemap.get(gl.pageIndex)
    if (remapped !== undefined) gl.pageIndex = remapped
  }
  // 用 placeholder 补齐可能缺失的中间 idx(实际不会发生,因为 sortedUsed 是连续的 0..N-1)
  const effectiveTotalPages = Math.max(1, sortedUsed.length)

  const pages = await buildPages(
    effectiveTotalPages,
    remappedBodyByPage,
    headerSection,
    footerSection,
    baseCtx,
    unit,
    warnings,
  )
  attachGridLines(pages, expansion.gridLines)

  return { pages, metrics, page: doc.page, warnings: dedupeWarnings(warnings) }
}

/* --------------------- 空卡片 gridLine 过滤 --------------------- */

/**
 * 过滤 gridLines 中「空卡片」的边框。
 *
 * 背景:grid 中的子控件若被 isControlPrintable 过滤掉(例:image 的 src 为空 /
 * text 的 content 为空字符串),该卡片的实际渲染位置没有内容,但展开器仍画出
 * 卡片边框 + 容器边框 → 用户看到「框线画在不渲染内容的位置」。
 *
 * 策略:
 * - 扫描 controls 中所有 childOf 控件,经 isControlPrintable 后保留的视为「实际渲染」
 * - 构建 byGridPage:gridId → pageIndex → Set<cardIndex>
 * - 过滤 gridLines:
 *     - 卡片边框(gridLine.cardIndex !== undefined):该 page 的 rendered set 不含此 cardIndex → 移除
 *     - 容器边框:该 page 没有 rendered cardIndex → 移除
 *
 * 适用场景:
 *   - layout() 入口的初始 expansion.gridLines(no flowTable 时直接用;standard grid 一直用)
 *   - placeAppendixGrid 内部 re.gridLines(appendix grid 重新展开后)
 */
function filterEmptyCardGridLines(
  gridLines: GridLinePlacement[],
  controls: AnyControl[],
  ctx: EvalContext,
  rowCtx: RowCtxMap | undefined,
  unit: PageSetup['unit'],
  bodyStep: number,
): GridLinePlacement[] {
  // 构建 byGridPage:gridId → pageIndex → Set<cardIndex>
  const byGridPage = new Map<string, Map<number, Set<number>>>()
  for (const c of controls) {
    const owner = (c as { childOf?: string }).childOf
    if (!owner) continue
    const cctx = withRowCtx(c.id, ctx, rowCtx)
    if (!isControlPrintable(c, cctx)) continue
    const parts = c.id.split('~')
    if (parts.length < 2 || parts[0] !== owner) continue
    const ci = Number.parseInt(parts[1]!, 10)
    if (!Number.isFinite(ci)) continue
    const absTop = toMm(c.top, unit)
    const pIdx = Math.max(0, Math.floor(absTop / bodyStep))
    let byPage = byGridPage.get(owner)
    if (!byPage) {
      byPage = new Map()
      byGridPage.set(owner, byPage)
    }
    let pageSet = byPage.get(pIdx)
    if (!pageSet) {
      pageSet = new Set()
      byPage.set(pIdx, pageSet)
    }
    pageSet.add(ci)
  }
  return gridLines.filter((gl) => {
    if (!gl.gridId) return true
    const byPage = byGridPage.get(gl.gridId)
    // 无渲染卡片(空 grid / 完全过滤):移除该 grid 的所有 gridLine。
    // 边界 case:grid 整组 visibleIf 过滤,gridLine 全废。
    if (!byPage) return false
    if (gl.cardIndex !== undefined) {
      const pageSet = byPage.get(gl.pageIndex)
      return pageSet !== undefined && pageSet.has(gl.cardIndex)
    }
    // 容器边框:page 没有任何 rendered card → 移除
    const pageSet = byPage.get(gl.pageIndex)
    return pageSet !== undefined && pageSet.size > 0
  })
}

/* --------------------- Appendix labelgrid cursor 放置 --------------------- */

/** 多流式 / 第一阶段共用:appendix labelgrid 的实际落点 + 子控件 + 容器边框 */
export interface AppendixGridPlacement {
  gridId: string
  /** grid 起始页 (0-based) */
  startPageIdx: number
  /** grid 起始 top (mm, page-relative) */
  startTopRel: number
  /** grid 末片所在页 (0-based) */
  lastPageIdx: number
  /** grid 末片底边 (mm, page-relative) */
  lastBottomRel: number
  /** 重新展开出的子控件(每张卡片一份),top 是 absolute 跨页坐标 */
  children: AnyControl[]
  /** 容器边框 + 卡片边框(已按 pageRanges 切分,top 是 page-relative) */
  gridLines: GridLinePlacement[]
  /** grid 末底 absolute 坐标,供后续控件 delta 计算 */
  lastAbsBottom: number
  /** 重新展开产生的行上下文(逐卡 row/rowIndex),需 merge 到全局 rowCtx */
  rowCtx: RowCtxMap
  /**
   * 实际渲染的 cardIndex 集合(至少一个 child 通过 isControlPrintable 过滤)。
   * 用于 post-process 清理空卡片的 gridLine(卡片框 + 容器边框覆盖空卡片部分)。
   * 不在集合里的 cardIndex:该卡片所有 child 都被过滤掉,gridLine 不画。
   */
  renderedCardIndices: Set<number>
}

/**
 * 按 pageBreak 三态 + 当前 cursor,决定 grid 的目标页 + 起点 top。
 *
 * 新语义(用户决策 1 + 测试约束):
 *   - 'always' 「优先新页」:倾向于推新页。只要当前页能放下至少一行卡片,就推新页
 *     让 grid 独占新页(不与上面的 text 挤在一起)。仅当当前页连一行都放不下时
 *     (stepY > remaining) 才例外跟当前页(因为推了新页也放不下任何东西)。
 *   - 'auto': 能放下就跟当前 cursor,放不下整组才推新页。grid 与 text 共享页面。
 *   - 'never': 强制不放新页,放不下也不推(由 maxPages 截断保护)。
 *
 * 返回的 pageIdx/originTop 直接作为 placementHint 传给 expandLabelGrids。
 */
function decideGridTarget(
  lc: LabelGridControl,
  cursorAbsTop: number,
  pageBreak: 'always' | 'auto' | 'never',
  bodyStep: number,
  ctx: EvalContext,
  unit: PageSetup['unit'],
  metrics: PageMetrics,
): { pageIdx: number; originTop: number } {
  // 预算 grid 真实所需高(数据条数 × stepY,与展开器内 pageRanges 算法一致)
  const children = lc.children ?? []
  const geo = resolveGridGeometry({ ...lc, children })
  const cardH = toMm(geo.cardHeight, unit)
  const gapY = toMm(geo.gapY, unit)
  const stepY = cardH + gapY
  const arr = gridDataArrayForReserve(lc.dataSource, ctx)
  const visibleRows = Math.max(1, visibleCardRows(toMm(lc.height ?? 0, unit), geo))
  const naturalTotal = arr !== null && arr.length > 0 ? arr.length : geo.columns * visibleRows
  // ★ maxItems 钳制与展开器一致
  const total = lc.maxItems && lc.maxItems > 0
    ? Math.min(naturalTotal, lc.maxItems)
    : naturalTotal
  const totalRows = Math.max(1, Math.ceil(total / geo.columns))
  // ★ appendixTitle 占据 titleHeight mm,需累加到 fits 判断的总高
  // 高度按 style 真实渲染口径算(不写死 6),保证大字号/加粗不与首行重叠
  const titleHeight = lc.appendixTitle?.text?.trim()
    ? measureAppendixTitleHeight(lc.appendixTitle?.style)
    : 0
  const requiredHeight = totalRows * stepY - gapY + titleHeight

  // ★ 与表格切片一致:新页起点 = zoneTop(headerHeight,页眉下方),避免 grid 覆盖页眉;
  // 「还剩多少空间」也要扣除 headerHeight/footerHeight,不能算入页眉/页脚区。
  const zoneTop = metrics.headerHeight > 0 ? metrics.headerHeight : 0
  const footerH = metrics.footerHeight
  const usablePerPage = Math.max(0, bodyStep - zoneTop - footerH)

  const cursorPageIdx = Math.floor(cursorAbsTop / bodyStep)
  const cursorTopRel = cursorAbsTop - cursorPageIdx * bodyStep
  // 当前页可用空间:从 cursor 到页脚上沿
  const remainingOnPage = Math.max(0, bodyStep - footerH - cursorTopRel)

  let pageIdx = cursorPageIdx
  let originTop = cursorTopRel

  if (pageBreak === 'always') {
    // 「优先新页」:倾向于推新页 → 当前页能放下 ≥ 1 行卡片就推,让 grid 独占新页
    if (remainingOnPage >= stepY) {
      // ★ 关键修复:cursorAbsTop 已经在 page 顶部(≤ zoneTop)时,说明 caller
      // (phaseStream 的跨页钳制)已经把 grid 推到这个新空 page 的起点。
      // 此时不要再二次推新页,直接在该 page 起铺,避免「cursor 在 page N 顶部
      // + zoneTop 又被推到 page N+1」导致中间 page 完全空白(用户截图:
      // page 1 空白,grid 跑到 page 2)。
      if (cursorTopRel <= zoneTop + EPS) {
        pageIdx = cursorPageIdx
        originTop = cursorTopRel
      } else {
        pageIdx = cursorPageIdx + 1
        originTop = zoneTop  // ★ 新页起点 = 页眉下方,不覆盖页眉
      }
    }
    // 否则:连一行都放不下 → 例外跟当前页(maxPages 兜底)
  } else if (pageBreak === 'auto') {
    // 能放下整组就跟,放不下整组才推新页(放得下判断用 usablePerPage 即可)
    if (requiredHeight > remainingOnPage + 0.5) {
      pageIdx = cursorPageIdx + 1
      originTop = zoneTop  // ★ 新页起点 = 页眉下方
    }
  }
  // 'never': 强制不放新页(maxPages 截断兜底)
  return { pageIdx, originTop }
}

/**
 * 在当前 cursor 处放置一个 appendix labelgrid:
 *   1. decideGridTarget 决定目标页 + originTop
 *   2. 用 placementHint 调用 expandLabelGrids 重新展开(带数据绑定)
 *   3. 从展开出的 children 推断 grid 末底(供下游 cursor 推进)
 *
 * 第一阶段 / 多流式循环共用此 helper,消除重复。
 */
async function placeAppendixGrid(
  lc: LabelGridControl,
  ctx: EvalContext,
  unit: PageSetup['unit'],
  metrics: PageMetrics,
  maxPages: number,
  cursorAbsTop: number,
): Promise<AppendixGridPlacement & { warnings: RenderWarning[] }> {
  const bodyStep = bodyStepMm(metrics)
  const epb = lc.pageBreak ?? (lc.forceNewPage ? 'always' : 'auto')
  const { pageIdx, originTop } = decideGridTarget(
    lc,
    cursorAbsTop,
    epb,
    bodyStep,
    ctx,
    unit,
    metrics,
  )

  // placementHints: 展开器完全信任 caller 算出的 pageIdx + originTop
  // (label-grid.ts:258 已移除 'always' 强制 originTop=0 的分支)
  const hints = new Map<string, GridPlacementHint>()
  hints.set(lc.id, { pageIndex: pageIdx, originTop })

  // 给 grid 一个合法的 top,让展开器 capacity 不出 NaN(实际走 hint 路径)
  const adjustedGridTopAbs = pageIdx * bodyStep + originTop
  const repositioned: LabelGridControl = {
    ...lc,
    top: fromMm(adjustedGridTopAbs, unit),
  }
  const re = expandLabelGrids(
    [repositioned],
    ctx,
    unit,
    bodyStep,
    maxPages,
    hints,
    // ★ 传 pageCapacity 让展开器在 grid 跨页时从 zoneTop(页眉下方)起铺
    {
      zoneTop: metrics.headerHeight,
      usableBottom: bodyStep - metrics.footerHeight,
    },
  )

  // 从 children 推断末底:grid 真实占高 = max(printable child.top + child.height)
  // ★ 必须过滤 isControlPrintable:数据为空的卡片(图片字段未传等)子控件会被
  // 过滤掉,但卡片底依然存在 → 不应让"看不见"的卡片把 cursor 推过页边界,
  // 导致后续 text 控件被顶到下一页(用户截图反馈:page5 只画了 grid、
  // page6 才出现文本,但其实 grid 末行是空卡片)。
  let lastAbsTop = 0
  let lastHeight = 0
  for (const c of re.components) {
    const cctx = withRowCtx(c.id, ctx, re.rowCtx)
    if (!isControlPrintable(c, cctx)) continue
    const t = toMm(c.top, unit)
    const h = toMm(c.height, unit)
    if (t + h > lastAbsTop + lastHeight) {
      lastAbsTop = t
      lastHeight = h
    }
  }
  const lastAbsBottom = lastAbsTop + lastHeight
  const lastPageIdx = Math.floor(lastAbsBottom / bodyStep)
  const lastBottomRel = lastAbsBottom - lastPageIdx * bodyStep

  // 收集「实际渲染的 cardIndex」:经 isControlPrintable 过滤后,通过过滤的卡片才算渲染。
  // 用于过滤 re.gridLines:某 cardIndex 全空 → 卡片边框不画;某 page 全空 → 容器边框不画。
  // 解决问题:grid 中的图片字段为空时(如 photoUrl 未传),该卡片的 image child 被
  // isControlPrintable 过滤掉,但展开器仍画了卡片边框 + 容器边框,用户截图反馈
  // 「grid 顶部标题和边线在第 2/3 页都画了,但图片其实没渲染」——空卡片不应画框。
  const filteredGridLines = filterEmptyCardGridLines(
    re.gridLines,
    re.components,
    ctx,
    re.rowCtx,
    unit,
    bodyStep,
  )
  // 同时聚合 renderedCardIndices(扁平集合),供 API 消费者感知「实际渲染了哪些卡片」。
  const renderedCardIndices = new Set<number>()
  for (const c of re.components) {
    const cctx = withRowCtx(c.id, ctx, re.rowCtx)
    if (!isControlPrintable(c, cctx)) continue
    const parts = c.id.split('~')
    if (parts.length < 2 || parts[0] !== lc.id) continue
    const ci = Number.parseInt(parts[1]!, 10)
    if (Number.isFinite(ci)) renderedCardIndices.add(ci)
  }

  return {
    gridId: lc.id,
    startPageIdx: pageIdx,
    startTopRel: originTop,
    lastPageIdx,
    lastBottomRel,
    children: re.components,
    gridLines: filteredGridLines,
    lastAbsBottom,
    rowCtx: re.rowCtx,
    renderedCardIndices,
    warnings: re.warnings,
  }
}

/* ---------------------------- 无表格：按位置切页 ---------------------------- */

/**
 * 无流式表格时的退化策略：控件按 top 落在第几个 bodyHeight 区间就进第几页。
 * 返回「每页的正文节点数组」，页眉页脚由调用方统一注入。
 */
async function layoutStaticOnly(
  components: AnyControl[],
  baseCtx: EvalContext,
  unit: PageSetup['unit'],
  metrics: PageMetrics,
  measurer: TextMeasurer,
  maxPages: number,
  warnings: RenderWarning[],
  rowCtx?: RowCtxMap,
): Promise<PlacedNode[][]> {
  const bodyH = bodyStepMm(metrics)

  // 控件按 top 落在第几个 bodyHeight 区间就进第几页。
  // 整页相对模型：分页步长 = 物理页高（边距仅作可视化参考线，不再参与分页），
  // top ∈ [0, 页高) 均属当前页，控件可落在整页任意位置（含原边距带）。
  let maxPageIndex = 0
  const buckets = new Map<number, AnyControl[]>()
  for (const c of components) {
    const idx = Math.max(0, Math.min(maxPages - 1, Math.floor(toMm(c.top, unit) / bodyH)))
    maxPageIndex = Math.max(maxPageIndex, idx)
    const list = buckets.get(idx)
    if (list) list.push(c)
    else buckets.set(idx, [c])
  }

  const totalPages = maxPageIndex + 1
  const bodyByPage = new Map<number, PlacedNode[]>()

  for (const [idx, list] of buckets) {
    const ctx: EvalContext = { ...baseCtx, page: idx + 1, pages: totalPages }
    const shift = -idx * bodyH
    const { placed, warnings: w } = await placeControls(list, ctx, unit, shift, rowCtx)
    warnings.push(...w)
    const tables = placeStaticTables(list, [], ctx, unit, measurer, shift, rowCtx)
    warnings.push(...tables.warnings)
    bodyByPage.set(idx, [...placed, ...tables.placed])
  }

  return Array.from({ length: totalPages }, (_, i) => bodyByPage.get(i) ?? [])
}

/* ------------------------------ 页眉页脚注入 ------------------------------ */

/** 把标签网格参考线按页索引贴回 LayoutPage.gridLines（坐标已是 page-relative） */
function attachGridLines(pages: LayoutPage[], lines: GridLinePlacement[]): void {
  for (const { pageIndex, line } of lines) {
    const page = pages[pageIndex]
    if (page) (page.gridLines ??= []).push(line)
  }
}

async function buildPages(
  totalPages: number,
  bodyByPage: Map<number, PlacedNode[]>,
  headerSection: Section<AnyControl> | undefined,
  footerSection: Section<AnyControl> | undefined,
  baseCtx: EvalContext,
  unit: PageSetup['unit'],
  warnings: RenderWarning[],
): Promise<LayoutPage[]> {
  const pages: LayoutPage[] = []

  for (let i = 0; i < totalPages; i++) {
    // 页码变量按页求值 —— "第 X 页 / 共 Y 页" 正确的前提
    const pageCtx: EvalContext = { ...baseCtx, page: i + 1, pages: totalPages }

    let header: PlacedControl[] = []
    if (shouldRenderSection(headerSection, 'header', i, totalPages)) {
      const r = await buildSectionControls(headerSection?.components, pageCtx, unit)
      warnings.push(...r.warnings)
      header = r.controls
    }

    let footer: PlacedControl[] = []
    if (shouldRenderSection(footerSection, 'footer', i, totalPages)) {
      const r = await buildSectionControls(footerSection?.components, pageCtx, unit)
      warnings.push(...r.warnings)
      footer = r.controls
    }

    pages.push({ index: i, pageNo: i + 1, header, body: bodyByPage.get(i) ?? [], footer })
  }

  return pages
}

/* -------------------------------- 工具 -------------------------------- */

/** 同一条告警可能在多页重复产生（页眉每页解析一次），这里按 code+message+controlId 去重 */
function dedupeWarnings(list: RenderWarning[]): RenderWarning[] {
  const seen = new Set<string>()
  const out: RenderWarning[] = []
  for (const w of list) {
    const key = `${w.code}|${w.controlId ?? ''}|${w.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

/**
 * 把 table 所有 cell 的 segments 收集为二维数组(每行一个 cell segments 数组)。
 * 缺 segments 的 cell → [];空 segments → []。
 * 仅扫描 table.cells(顶层控件 BarcodeControl/QrcodeControl 不在 cells 里,走 resolveControlContent 老路径)。
 */
function collectCellSegmentsForTable(table: TableControl): Segment[][] {
  const out: Segment[][] = []
  const cells = table.cells ?? []
  for (const row of cells) {
    for (const cell of row ?? []) {
      out.push(cell.segments ?? [])
    }
  }
  return out
}

/**
 * 简易遍历 row 对象,把所有 path→string-value 收集到 valuesByPath。
 * 支持 `items[].name` 这种数组路径 —— 把每个数组元素都遍历。
 * 不走完整 resolveBinding,只做扁平遍历 —— 足够覆盖 cell 段引用字段场景。
 */
function collectRowPaths(
  obj: Record<string, unknown>,
  prefix: string,
  out: Map<string, Set<string>>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v === null || v === undefined) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      let bucket = out.get(path)
      if (!bucket) {
        bucket = new Set<string>()
        out.set(path, bucket)
      }
      bucket.add(String(v))
    } else if (Array.isArray(v)) {
      // 数组路径:同时输出 `items[].xxx` 形态(prefix + k + '[]') 供老 binding 匹配
      const arrPath = `${k}[]`
      const fullArrPath = prefix ? `${prefix}.${arrPath}` : arrPath
      let bucket = out.get(fullArrPath)
      if (!bucket) {
        bucket = new Set<string>()
        out.set(fullArrPath, bucket)
      }
      for (const item of v) {
        if (item && typeof item === 'object') {
          collectRowPaths(item as Record<string, unknown>, fullArrPath, out)
        }
      }
    } else if (typeof v === 'object') {
      collectRowPaths(v as Record<string, unknown>, path, out)
    }
  }
}
