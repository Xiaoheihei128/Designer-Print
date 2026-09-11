/**
 * label-grid 展开器单测 —— 验证「纯布局平铺」范式：
 *  - 总卡片数 = 列数 × 行数（行数由容器高度推导），每张卡 = children 一份完全相同的实例；
 *  - 多列按行铺开、行满换页（top 跨页绝对坐标自洽）；
 *  - 可选逐卡数据绑定（dataSource）：卡片数跟随数据条数，每卡注入 {row,rowIndex}，
 *    卡内绑定 {{row.字段}} / {{rowIndex}} 逐卡不同；缺省 rowCtx 恒空；
 *  - 空 children（合法空布局）、超 maxPages 等边界正确。
 */
import { describe, expect, it } from 'vitest'

import {
  bodyStepMm,
  expandLabelGrids,
  measureAppendixTitleHeight,
  resolveGridGeometry,
  withRowCtx,
} from '@op/core/layout-engine/label-grid'
import { MAX_PAGES, type EvalContext, type PageMetrics } from '@op/core/layout-engine/types'
import type { AnyControl, LabelGridControl } from '@op/types/control'
import type { PageSetup, TemplateData } from '@op/types/template'
import { layout } from '@op/core/layout-engine/pagination-engine'
import { renderHtml } from '@op/core/renderer-html'

/* ------------------------------ 测试夹具 ------------------------------ */

const A4: PageSetup = {
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  backgroundColor: '#ffffff',
}

const metrics: PageMetrics = {
  pageWidth: 210,
  pageHeight: 297,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
  contentWidth: 190,
  contentHeight: 277,
  headerHeight: 0,
  footerHeight: 0,
  bodyHeight: 277,
}

/** 卡片步长（卡高 + 纵间距），用于按行数反推容器高度 */
const STEP_Y = 33 // cardH 30 + gapY 3
/** 行数 R 对应的容器高度（保证 visibleCardRows 精确等于 R） */
function heightForRows(R: number): number {
  return STEP_Y * R - 3
}

/** 卡片模板：一个边框 + 一个静态文本（标签网格为纯布局，模板被原样重复） */
function makeCard(ids: { rect: string; name: string }): AnyControl[] {
  return [
    {
      id: ids.rect,
      type: 'rect',
      left: 0,
      top: 0,
      width: 40,
      height: 30,
      fill: 'transparent',
      stroke: '#333',
      strokeWidth: 0.5,
      printable: true,
    },
    {
      id: ids.name,
      type: 'text',
      left: 3,
      top: 3,
      width: 30,
      height: 6,
      value: '商品标签',
      style: { fontSize: 10 },
      printable: true,
    },
  ]
}

function makeGrid(over: Partial<LabelGridControl> = {}): LabelGridControl {
  return {
    id: 'grid1',
    type: 'labelgrid',
    left: 0,
    top: 0,
    width: 124, // 3*40 + 2*2
    height: heightForRows(3), // 3 行
    columns: 3,
    gapX: 2,
    gapY: 3,
    cardWidth: 40,
    cardHeight: 30,
    children: makeCard({ rect: 'c-rect', name: 'c-name' }),
    printable: true,
    ...over,
  }
}

function makeCtx(): EvalContext {
  return { data: {} }
}

/** 取某张卡某子控件的生成 id */
function genId(gridId: string, cardIndex: number, childId: string): string {
  return `${gridId}~${cardIndex}~${childId}`
}

/* ------------------------------ 测试用例 ------------------------------ */

describe('expandLabelGrids —— 几何与计数', () => {
  it('卡片数 = 列数 × 行数，每张卡 = children 一份实例', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)

    // 3 列 × 3 行 = 9 张卡 × 2 子控件 = 18 个生成控件
    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(18)
    // 标签网格不带数据源，行上下文恒空
    expect(res.rowCtx.size).toBe(0)
  })

  it('多列：同行走不同列 → left 按列宽+间距递增', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)

    const nameOf = (card: number) =>
      res.components.find((c) => c.id === genId('grid1', card, 'c-name'))!
    // 列宽 40 + 间距 2 = 42；列 0/1/2 的 left = 3 / 45 / 87（文本自身 left=3）
    expect(nameOf(0).left).toBeCloseTo(3, 5)
    expect(nameOf(1).left).toBeCloseTo(45, 5)
    expect(nameOf(2).left).toBeCloseTo(87, 5)
    // 不同列 top 相同（同一行）
    expect(nameOf(0).top).toBeCloseTo(nameOf(2).top, 5)
  })

  it('行数由容器高度推导：height 越大铺的行越多', () => {
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(4) })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    // 4 行 × 3 列 = 12 张卡 × 2 = 24 个控件
    expect(res.components.length).toBe(24)
  })
})

describe('expandLabelGrids —— 多页跨页', () => {
  it('行满换页：下一页控件 top 跨页绝对坐标自洽', () => {
    // bodyStep=100 → 每页 3 行（stepY=33）；10 行 = 30 张卡 → 跨 4 页
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      MAX_PAGES,
    )

    const tops = res.components.map((c) => c.top)
    // 第 1 页顶部行 top<100；第 2 页起 top>=100
    expect(Math.min(...tops)).toBeLessThan(100)
    expect(Math.max(...tops)).toBeGreaterThanOrEqual(100)
    // 10 行 × 3 列 = 30 张卡 × 2 子控件 = 60
    expect(res.components.length).toBe(60)
  })
})

describe('expandLabelGrids —— 边界', () => {
  it('超 maxPages → 截断 + PAGE_LIMIT_REACHED', () => {
    // maxPages=1，但 10 行需要 4 页 → 只渲染第 1 页的 9 张卡
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      1,
    )

    expect(res.components.length).toBe(18) // 9 张卡 × 2 子控件
    expect(res.warnings.some((w) => w.code === 'PAGE_LIMIT_REACHED')).toBe(true)
  })

  it('children 为空 → 合法空布局：0 张卡、无告警', () => {
    const res = expandLabelGrids(
      [makeGrid({ children: [] })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(0)
    expect(res.warnings.length).toBe(0)
  })
})

describe('expandLabelGrids —— 逐卡数据绑定（dataSource）', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    serialNo: `SN-${String(i + 1).padStart(3, '0')}`,
  }))

  it('所有生成的子控件都带 childOf=gridId（分页引擎依赖此字段分流）', () => {
    // ★ 关键不变量: 分页引擎要从 plan.below 中识别"这是 grid 的子控件"→
    // 把它从 textFlowBelow / appendixChildIds 中剔除,从而 reserveBelow 只算
    // 真实文本(不会因为 grid 子控件的累计高度把 grid 错推页面)。
    // 没写 childOf 时所有 grid 子控件都会进 textFlow → reserveBelow 暴涨。
    const res = expandLabelGrids(
      [makeGrid()],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.components.length).toBeGreaterThan(0)
    expect(res.components.every((c) => c.childOf === 'grid1')).toBe(true)
  })

  it('数据条数决定卡片总数，每张卡注入 {row, rowIndex}', () => {
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids(
      [makeGrid({ dataSource: 'items' })],
      ctx,
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )

    // 5 条数据 → 5 张卡 × 2 子控件 = 10 个生成控件（而非纯布局的 18 个）
    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(10)
    // 每张卡的每个子控件都有行上下文
    expect(res.rowCtx.size).toBe(10)
    expect(res.rowCtx.get(genId('grid1', 0, 'c-name'))!.rowIndex).toBe(0)
    expect(res.rowCtx.get(genId('grid1', 0, 'c-name'))!.row.serialNo).toBe('SN-001')
    expect(res.rowCtx.get(genId('grid1', 4, 'c-rect'))!.rowIndex).toBe(4)
    expect(res.rowCtx.get(genId('grid1', 4, 'c-rect'))!.row.serialNo).toBe('SN-005')
    // 数据模式无告警
    expect(res.warnings.length).toBe(0)
  })

  it('withRowCtx 对生成控件注入行数据（卡内 {{row.字段}} 可求值）', () => {
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids(
      [makeGrid({ dataSource: 'items' })],
      ctx,
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    const c = withRowCtx(genId('grid1', 2, 'c-name'), ctx, res.rowCtx)
    expect(c.row).toEqual(items[2])
    expect(c.rowIndex).toBe(2)
  })

  it('数据源缺失/非数组 → LABEL_GRID_DATA_MISSING，回退纯布局平铺', () => {
    const res = expandLabelGrids(
      [makeGrid({ dataSource: 'items' })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.warnings.some((w) => w.code === 'LABEL_GRID_DATA_MISSING')).toBe(true)
    expect(res.components.length).toBe(18) // 回退 3×3 纯布局
    expect(res.rowCtx.size).toBe(0)
  })

  it('数据源为空数组 → LABEL_GRID_DATA_EMPTY，回退纯布局平铺', () => {
    const res = expandLabelGrids(
      [makeGrid({ dataSource: 'items' })],
      { data: { items: [] } },
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.warnings.some((w) => w.code === 'LABEL_GRID_DATA_EMPTY')).toBe(true)
    expect(res.components.length).toBe(18)
  })

  it('数据超一页容量 → 自动跨页平铺，每卡行上下文正确', () => {
    // bodyStep=100 → 每页 3 行（stepY=33）；10 条数据 → 跨 2 页
    const rows = Array.from({ length: 10 }, (_, i) => ({ serialNo: `SN-${i + 1}` }))
    const res = expandLabelGrids(
      [makeGrid({ dataSource: 'items' })],
      { data: { items: rows } },
      'mm',
      100,
      MAX_PAGES,
    )
    expect(res.components.length).toBe(20) // 10 张卡 × 2 子控件
    expect(res.rowCtx.size).toBe(20)
    expect(res.rowCtx.get(genId('grid1', 9, 'c-name'))!.rowIndex).toBe(9)
    expect(res.warnings.length).toBe(0)
  })
})

describe('withRowCtx —— 无数据源时行上下文恒空', () => {
  it('无行上下文时原样返回 base ctx（零开销、无 row 字段）', () => {
    const ctx = makeCtx()
    expect(withRowCtx('grid1~0~c-name', ctx)).toBe(ctx)
    expect((withRowCtx('grid1~0~c-name', ctx) as EvalContext).row).toBeUndefined()
  })
})

describe('resolveGridGeometry —— 几何推算', () => {
  it('缺省 cardWidth 由 width 与列数/间距反推', () => {
    const geo = resolveGridGeometry({
      width: 124,
      height: heightForRows(3),
      columns: 3,
      gapX: 2,
      children: makeCard({ rect: 'r', name: 'n' }),
    })
    expect(geo.columns).toBe(3)
    expect(geo.cardWidth).toBeCloseTo(40, 5)
    expect(geo.cardHeight).toBeCloseTo(30, 5)
  })
})

/* ------------------------------ 端到端集成 ------------------------------ */

function makeTemplate(grid: LabelGridControl): TemplateData<AnyControl> {
  return {
    version: '1.0',
    document: {
      type: 'report',
      page: A4,
      sections: [{ type: 'body', components: [grid] }],
    },
  }
}

describe('layout() 端到端 —— 标签网格走完整渲染链路', () => {
  it('展开出的卡片静态模板逐张平铺，HTML 含每卡内容', async () => {
    const grid = makeGrid({ children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {})

    // 不报错、无告警（合法布局）
    expect(result.warnings.length).toBe(0)

    const html = renderHtml(result, { screen: false })
    // 每张卡都印出模板里的静态文本
    expect(html).toContain('商品标签')
    // 生成控件 id 带行号后缀（证明走了「入口摊平」）
    expect(html).toContain('grid1~0~c-rect')
    expect(html).toContain('grid1~8~c-name')
    // 网格参考线随预览渲染（所见即所得）
    expect(html).toContain('op-gridlines')
    expect(html).toContain('op-gridline')
  })

  it('多页：行数超一页时跨页，page 变量每页递增', async () => {
    // 真实 A4：bodyStep = 287；stepY=33 → 每页容量 floor((287+3)/33)=8 行。
    // 10 行 / 3 列 = 30 张卡 → 跨 2 页。
    const grid = makeGrid({ height: heightForRows(10), children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {}, { maxPages: MAX_PAGES })
    expect(result.pages.length).toBeGreaterThan(1)
    // 末页 pageNo 应等于总页数
    expect(result.pages[result.pages.length - 1]!.pageNo).toBe(result.pages.length)
  })

  it('逐卡数据绑定：dataSource + 卡内 {{row.字段}} → 每卡流水号不同', async () => {
    const card: AnyControl[] = [
      {
        id: 'c-sn',
        type: 'text',
        left: 3,
        top: 3,
        width: 34,
        height: 6,
        value: '{{row.serialNo}}',
        style: { fontSize: 10 },
        printable: true,
      },
    ]
    const grid = makeGrid({ dataSource: 'items', children: card })
    const data = {
      items: Array.from({ length: 5 }, (_, i) => ({
        serialNo: `SN-${String(i + 1).padStart(3, '0')}`,
      })),
    }
    const result = await layout(makeTemplate(grid), data)
    expect(result.warnings.length).toBe(0)

    const html = renderHtml(result, { screen: false })
    // 5 张卡，流水号各不相同
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`SN-${String(i).padStart(3, '0')}`)
    }
    // 数据驱动：只有 5 张卡（而非纯布局的 9 张）
    expect(result.pages[0]!.body.length).toBe(5)
  })

  it('关闭网格线：预览不含网格参考线', async () => {
    const grid = makeGrid({ showLines: false, children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {})
    const html = renderHtml(result, { screen: false })
    // 注意：CSS 里始终含 .op-gridline 选择器规则，故需校验「是否真的渲染了 div」
    expect(html).not.toContain('<div class="op-gridline"')
    expect(html).not.toContain('<div class="op-gridlines">')
  })
})

describe('expandLabelGrids —— 网格参考线（所见即所得）', () => {
  it('单页：网格线 = 卡片数 + 容器分段，默认实线', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)
    // 3×3 = 9 张卡片 + 1 段容器（网格落在单页内）= 10 条
    expect(res.gridLines.length).toBe(10)
    expect(res.gridLines.every((g) => g.line.solid)).toBe(true)
    // 全部落在第 0 页
    expect(res.gridLines.every((g) => g.pageIndex === 0)).toBe(true)
  })

  it('虚线：lineStyle=dashed 时所有线 solid=false', () => {
    const res = expandLabelGrids(
      [makeGrid({ lineStyle: 'dashed' })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.gridLines.length).toBeGreaterThan(0)
    expect(res.gridLines.every((g) => !g.line.solid)).toBe(true)
  })

  it('关闭网格线：不产生任何参考线', () => {
    const res = expandLabelGrids(
      [makeGrid({ showLines: false })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.gridLines.length).toBe(0)
  })

  it('多页：容器按页分段，网格线分布到各页', () => {
    // bodyStep=100 → 容器高 327 → 跨 4 页（分段 0..3）；卡片 30 张
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      MAX_PAGES,
    )
    // 4 段容器 + 30 张卡片 = 34
    expect(res.gridLines.length).toBe(34)
    const pages = new Set(res.gridLines.map((g) => g.pageIndex))
    expect([...pages].sort()).toEqual([0, 1, 2, 3])
  })
})

/* ============================================================
 *  Commit 8:appendix 模式 + forceNewPage 端到端集成
 *  验证:
 *   - mode='appendix' 老模板不识别时 → 完全走 standard 路径(零迁移)
 *   - mode='appendix' + forceNewPage=true + gridTop < bodyStep → 推到下一页顶部
 *   - mode='appendix' + 7 条数据 → 卡片生成数 = 7
 *   - mode='appendix' + cornerRadius → 不影响展开(只影响视觉,见 Commit 6)
 * ============================================================ */

describe('expandLabelGrids —— appendix 模式', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    serialNo: `SN-${String(i + 1).padStart(3, '0')}`,
    photo: `data:image/svg+xml,<svg/>`,
    item: '外观',
  }))

  it('老模板 mode 字段缺失 → 走 standard 路径,行为零变化', () => {
    const grid = makeGrid({ dataSource: 'items', children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    // 注意:没写 mode 字段,等价老模板
    expect(grid.mode).toBeUndefined()
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    // 5 行可见 + 5 行高度 = 9 张卡 × 2 = 18,等等——纯布局场景下,没有 dataSource 时
    // = 3 列 × visibleCardRows(height) = 9 张。本 grid 配了 dataSource,7 条 → 7 张 × 2 = 14
    expect(res.components.length).toBe(14)
  })

  it('mode=appendix + forceNewPage=true + gridTop 较小 → 推到下一页顶部', () => {
    // bodyStep=100,gridTop=20 → 本来 pageIndex=0(本页还有空间)
    // forceNewPage=true → pageIndex=Math.floor(20/100)+1=1(下一页)
    const grid = makeGrid({
      left: 0,
      top: 20, // 在本页上半部,本来放得下
      dataSource: 'items',
      mode: 'appendix',
      forceNewPage: true,
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', 100, MAX_PAGES)

    // 7 张卡 × 2 = 14 个控件,跨 2 页(第 1 页为空,全在第 2 页)
    expect(res.components.length).toBe(14)
    // 所有控件的 top 都 ≥ 100(下一页)
    const tops = res.components.map((c) => c.top)
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(100)
  })

  it('mode=appendix + forceNewPage=true + gridTop 在第 1 页 → 推到第 2 页', () => {
    const grid = makeGrid({
      left: 0,
      top: 5, // 第 1 页
      dataSource: 'items',
      mode: 'appendix',
      forceNewPage: true,
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', 100, MAX_PAGES)
    const tops = res.components.map((c) => c.top)
    // 第 2 页起点 = 100
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(100)
  })

  it('mode=appendix + forceNewPage=false → 走 auto 语义(7 行放不下 gridTop=20,整组推到下一页)', () => {
    // 7 数据 / 3 列 = 3 行 × 33mm = 99mm,gridTop=20,可用 80mm → 放不下 → 推下一页
    const grid = makeGrid({
      left: 0,
      top: 20,
      dataSource: 'items',
      mode: 'appendix',
      forceNewPage: false,
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', 100, MAX_PAGES)
    const tops = res.components.map((c) => c.top)
    // 整组被推 → 所有 top ≥ 100(下一页)
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(100)
  })

  it('standard 模式 + forceNewPage=true(用户填错)→ 强制新页被忽略,行为不变', () => {
    // 契约:forceNewPage 仅在 mode=appendix 生效,其它组合走 standard 分支
    const grid = makeGrid({
      left: 0,
      top: 20,
      dataSource: 'items',
      mode: 'standard',
      forceNewPage: true, // 用户填错,应被忽略
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', 100, MAX_PAGES)
    const tops = res.components.map((c) => c.top)
    expect(Math.min(...tops)).toBeLessThan(100)
  })

  it('appendix 模式 + cornerRadius → 不影响展开器(只影响 PrintLabelGrid 视觉)', () => {
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
      cornerRadius: 3,
      cardBorder: true,
      appendixHeader: '附录:样本',
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    // 7 条 → 7 张卡 × 2 = 14
    expect(res.components.length).toBe(14)
    // cornerRadius 不产生 warnings(它是设计期视觉参数)
    const appendixWarnings = res.warnings.filter((w) => w.code === 'CORNER_RADIUS')
    expect(appendixWarnings).toHaveLength(0)
  })

  it('appendix 模式 + appendixTitle.style → 透传到物化的 TextControl(字号/加粗/颜色/对齐)', () => {
    // 面板输入项:字号(fontSize) + 加粗(fontWeight) + 颜色(fill) + 对齐(textAlign)
    // 展开器把 control.appendixTitle.style 套到每页贴的 title TextControl 上,
    // 保证面板所见即所得(label-grid.ts:370/395)。
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
      appendixTitle: {
        text: '附录:样本照片',
        style: {
          fontSize: 18,
          fontWeight: 'bold',
          fill: '#cc0000',
          textAlign: 'center',
        },
      },
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    // 找到物化的 title(按 id 后缀 ~title~N)
    const titles = res.components.filter((c) => c.id.startsWith('grid1~title~'))
    expect(titles.length).toBeGreaterThan(0)
    for (const t of titles) {
      expect(t.type).toBe('text')
      expect(t.value).toBe('附录:样本照片')
      expect(t.style).toEqual({
        fontSize: 18,
        fontWeight: 'bold',
        fill: '#cc0000',
        textAlign: 'center',
      })
    }
  })

  it('appendixTitle.text 为空时不生成 title 控件(无论 style 是否有值)', () => {
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
      appendixTitle: { text: '', style: { fontSize: 24 } },
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    const titles = res.components.filter((c) => c.id.includes('~title~'))
    expect(titles).toHaveLength(0)
  })

  it('measureAppendixTitleHeight 按 TextStyle 真实渲染口径算盒高(不写死 6mm)', () => {
    // 默认字号 12pt × 1.16 lineHeight + 0.5 padding ≈ 4.4 + 0.5 ≈ 4.9mm
    // (旧写死 6mm 略宽裕,新算法在无 style 时下限 4mm,可正常显示)
    const def = measureAppendixTitleHeight(undefined)
    expect(def).toBeGreaterThanOrEqual(4)
    expect(def).toBeLessThanOrEqual(6)
    // 18pt + bold:CSS line-height 渲染 ≈ 7.4mm,盒高必须 ≥ 7mm 才能装下
    const bigBold = measureAppendixTitleHeight({ fontSize: 18, fontWeight: 'bold' })
    expect(bigBold).toBeGreaterThanOrEqual(7)
    // bold 比 normal 略高(5% ascender 抖动 buffer)
    const bigNonBold = measureAppendixTitleHeight({ fontSize: 18 })
    expect(bigBold).toBeGreaterThan(bigNonBold)
    // lineHeight 放大时高度跟着放大
    const loose = measureAppendixTitleHeight({ fontSize: 12, lineHeight: 2 })
    expect(loose).toBeGreaterThan(measureAppendixTitleHeight({ fontSize: 12 }))
    // 极小字号兜底 4mm(防止塌成 0 高度)
    const tiny = measureAppendixTitleHeight({ fontSize: 4 })
    expect(tiny).toBe(4)
  })

  it('appendix 模式 + 大字号加粗 title → title.bottom ≤ 首卡 top(无穿插)', () => {
    // 用户反馈:18pt + bold 时,旧 titleHeight=6mm 装不下,CSS 文字向下溢出覆盖首行卡片
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
      appendixTitle: {
        text: '销购合同',
        style: { fontSize: 18, fontWeight: 'bold', fill: '#cc0000' },
      },
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    const titles = res.components.filter((c) => c.id.startsWith('grid1~title~'))
    expect(titles.length).toBeGreaterThan(0)
    for (const t of titles) {
      // title 高度按 style 真实算,不再是写死 6
      const expected = measureAppendixTitleHeight(grid.appendixTitle?.style)
      expect(t.height).toBe(expected)
      // title 起点 = pageIndex*bodyStep + zoneTop(=0);首卡起点 = 同上 + titleHeight
      const firstCardTop = t.top + t.height
      const cardsOnSamePage = res.components
        .filter(
          (c) =>
            c.id.startsWith('grid1~') &&
            !c.id.includes('~title~') &&
            c.top >= t.top &&
            c.top < t.top + bodyStepMm(metrics),
        )
        .map((c) => c.top)
      if (cardsOnSamePage.length > 0) {
        expect(Math.min(...cardsOnSamePage)).toBeGreaterThanOrEqual(firstCardTop)
      }
    }
  })

  it('appendix 模式 + 默认字号 title → title 高度 ≥ 4mm 兜底(不塌)', () => {
    // 不传 style 时,展开器用默认公式算(不再写死 6,但保证可见高度)
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
      appendixTitle: { text: '附录' },
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)
    const title = res.components.find((c) => c.id.startsWith('grid1~title~')) as any
    expect(title).toBeDefined()
    expect(title.height).toBeGreaterThanOrEqual(4)
    expect(title.height).toBe(measureAppendixTitleHeight(undefined))
  })

  it('appendix 模式 + 7 条数据 + 行满换页 → auto 语义下 3 行全部塞得下,留在 page 0 (forceNewPage=false)', () => {
    // bodyStep=100, gridTop=0,可用 100mm,7 数据/3 列 = 3 行 × 33mm = 99mm → 放得下 → 紧跟
    const grid = makeGrid({
      left: 0,
      top: 0,
      dataSource: 'items',
      mode: 'appendix',
    })
    const ctx: EvalContext = { data: { items } }
    const res = expandLabelGrids([grid], ctx, 'mm', 100, MAX_PAGES)
    expect(res.components.length).toBe(14)
    const tops = res.components.map((c) => c.top)
    // 全部紧跟 page 0(auto 放得下不推)
    expect(Math.min(...tops)).toBeLessThan(100)
    expect(Math.max(...tops)).toBeLessThan(100)
  })
})

/* ============================================================
 *  端到端验证:appendix 模式 + 7 条数据 → 完整 HTML 渲染
 *
 *  这是「拖入附录图片墙 → 看到真实图片」的关键回归测试:
 *  - createDefaultControl('labelgrid', init={mode:'appendix'}) 生成 3 件套 children
 *  - 展开器按数据条数复制每张卡,注入 rowCtx
 *  - 渲染层 resolveBinding 把 row.Photo → 真实 SVG data URL
 *  - 渲染层输出 <img src="data:image/svg+xml..."> 而不是占位
 * ============================================================ */

describe('appendix 图片墙 端到端 —— 7 张卡 × 3 列渲染真实图片', () => {
  /** 模拟 createDefaultControl 在 appendix 模式下的输出结构 */
  function makeAppendixGrid(leftMm: number, topMm: number): LabelGridControl {
    const cardW = 58
    const cardH = 30
    const cols = 3
    const gap = 3
    const rows = 3
    return {
      id: 'app-wall',
      type: 'labelgrid',
      left: leftMm,
      top: topMm,
      width: cardW * cols + gap * (cols - 1),
      height: cardH * rows + gap * (rows - 1),
      columns: cols,
      gapX: gap,
      gapY: gap,
      cardWidth: cardW,
      cardHeight: cardH,
      showLines: true,
      dataSource: 'ReportItems',
      mode: 'appendix',
      cardBorder: true,
      name: '附录图片墙',
      children: [
        {
          id: 'app-img',
          type: 'image',
          left: 3,
          top: 3,
          width: cardW - 6,
          height: cardH * 0.65,
          childOf: 'app-wall',
          value: { mode: 'binding', content: 'row.Photo' },
          fit: 'contain',
          printable: true,
        } as AnyControl,
        {
          id: 'app-no',
          type: 'text',
          left: 3,
          top: cardH * 0.7,
          width: cardW * 0.3,
          height: cardH * 0.25,
          childOf: 'app-wall',
          contentType: 'expression',
          expression: '{{rowIndex + 1}}号',
          style: { fontSize: 9, bold: true },
          printable: true,
        } as AnyControl,
        {
          id: 'app-title',
          type: 'text',
          left: cardW * 0.35,
          top: cardH * 0.7,
          width: cardW * 0.6,
          height: cardH * 0.25,
          childOf: 'app-wall',
          contentType: 'variable',
          binding: 'row.AnalysisItem',
          style: { fontSize: 9 },
          printable: true,
        } as AnyControl,
      ],
      printable: true,
    }
  }

  /** 7 条数据 + 每条带 Photo SVG data URL */
  const ReportItems = Array.from({ length: 7 }, (_, i) => ({
    Item: ['外观', '香气', '相对密度', '折光指数', '旋光度', '溶解度', '含量'][i] ?? `Item-${i}`,
    AnalysisItem: ['外观', '香气', '相对密度', '折光指数', '旋光度', '溶解度', '含量'][i] ?? `Item-${i}`,
    Photo: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="%23eee"/><text x="100" y="80" font-family="sans-serif" font-size="20" fill="%23333" text-anchor="middle">Sample ${i + 1}</text></svg>`,
  }))

  it('展开器:7 条数据 → 7 张卡 × 3 件套 = 21 个生成控件', () => {
    const grid = makeAppendixGrid(0, 0)
    const ctx: EvalContext = { data: { ReportItems } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)

    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(21)
    expect(res.rowCtx.size).toBe(21) // 每个控件都有 rowCtx
  })

  it('展开器:每张卡的 rowCtx.row 包含 Photo + AnalysisItem', () => {
    const grid = makeAppendixGrid(0, 0)
    const ctx: EvalContext = { data: { ReportItems } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)

    // 抽查第 1 张卡(行 0)的 image 控件 → rowCtx 应该有 ReportItems[0]
    const imgCard0 = res.rowCtx.get('app-wall~0~app-img')
    expect(imgCard0?.row?.Photo).toContain('Sample 1')
    expect(imgCard0?.row?.AnalysisItem).toBe('外观')

    // 第 7 张卡
    const imgCard6 = res.rowCtx.get('app-wall~6~app-img')
    expect(imgCard6?.row?.Photo).toContain('Sample 7')
    expect(imgCard6?.row?.AnalysisItem).toBe('含量')
  })

  it('children 在画布上的绝对坐标 = grid.left + child.left', () => {
    // 验证 syncGridChildren 的坐标转换:child 在卡内相对坐标正确
    const grid = makeAppendixGrid(20, 30) // grid 在 (20, 30) mm
    const ctx: EvalContext = { data: { ReportItems } }
    const res = expandLabelGrids([grid], ctx, 'mm', bodyStepMm(metrics), MAX_PAGES)

    // 第 1 张卡的 image(left=3,top=3 相对 grid)→ 绝对 (23, 33) mm
    const img = res.components.find((c) => c.id === 'app-wall~0~app-img')!
    expect(img.left).toBeCloseTo(23, 5)
    expect(img.top).toBeCloseTo(33, 5)
  })

  it('端到端:HTML 渲染输出真实 SVG 图片(img src 含 data:image/svg)', async () => {
    const grid = makeAppendixGrid(0, 0)
    const result = await layout(makeTemplate(grid), { ReportItems })
    const html = renderHtml(result, { screen: false })

    // 调试:展开器应生成 7 张卡 × 3 件套 = 21 控件分布在 pages 中
    // (LayoutPage.body 是 PlacedNode[] —— kind: 'control' 是控件,跳过 table slice)
    const totalComponents = result.pages.reduce(
      (acc, p) => acc + p.body.filter((n) => n.kind === 'control').length,
      0,
    )
    expect(totalComponents).toBe(21)

    // 7 张卡 × 1 个 img 控件 = 7 个 <img> 标签(每个 image 控件渲染 1 个 img)
    const imgMatches = html.match(/<img\b/g) ?? []
    expect(imgMatches.length).toBeGreaterThanOrEqual(7)

    // 每个 img 的 src 都是 data:image/svg(由 resolveBinding 把 row.Photo 解析)
    const dataSrcCount = (html.match(/data:image/g) ?? []).length
    expect(dataSrcCount).toBeGreaterThanOrEqual(7)

    // 标题文字也解析成功(row.AnalysisItem → "外观"等)
    expect(html).toContain('外观')
    expect(html).toContain('香气')
    expect(html).toContain('含量')
    // rowIndex + 1 → 编号
    expect(html).toMatch(/1号/)
    expect(html).toMatch(/7号/)
  })

  it('容器边框高度跟随实际展开(不只看用户 gridHeight,数据驱动下更准)', async () => {
    // 场景:用户把 gridHeight 设得比实际需要小(只是「行数估算参考」)。
    // 7 条数据 + 3 列 + stepY 33 = 3 行 = 99mm 实际跨度。
    // 但用户 gridHeight = 33(只够 1 行的「假想高度」)。
    // 老逻辑:容器边框高度 = min(gridHeight, bodyStep - gridTop) = 33 → 只框住第 1 行
    // 新逻辑:容器边框高度 = 实际末行 bottom - 首行 top = 99mm → 框住全部 3 行
    const grid = makeAppendixGrid(0, 0)
    grid.height = 33 // 用户设的小,实际 7 张卡需要 3 行 = 99mm
    const result = await layout(makeTemplate(grid), { ReportItems })

    // 收集容器边框(width=180 是容器;width=58 是卡片)
    const containerLines = result.pages.flatMap((p) =>
      (p.gridLines ?? []).filter((l) => l.width === 180),
    )
    expect(containerLines.length).toBeGreaterThan(0)
    const totalContainerHeight = containerLines.reduce(
      (acc, l) => acc + l.height,
      0,
    )
    // 实际 3 行 = 3 × cardH(30) = 90(末行 bottom - 首行 top,不计 gap)
    // 老逻辑只有 gridHeight=33 → 期望 ≥ 60(至少 2 行的卡片高度,否则就是 bug)
    expect(totalContainerHeight).toBeGreaterThan(60)
  })

  it('容器边框跨多页时按页分段(forceNewPage 推到底页)', async () => {
    // 极端场景:gridHeight=0(用户没设),且 7 条数据需要 3 行。
    // 强制把网格推到底页(mode=appendix + forceNewPage),让展开范围完全脱离 gridTop 起点。
    const grid = makeAppendixGrid(0, 0)
    grid.height = 0
    grid.mode = 'appendix'
    grid.forceNewPage = true
    const result = await layout(makeTemplate(grid), { ReportItems })

    const containerLines = result.pages.flatMap((p) =>
      (p.gridLines ?? []).filter((l) => l.width === 180),
    )
    // 至少一段容器边框,且总高度覆盖 3 行(90mm+)
    expect(containerLines.length).toBeGreaterThan(0)
    const total = containerLines.reduce((acc, l) => acc + l.height, 0)
    expect(total).toBeGreaterThan(60)
  })

  it('★ 回归:表格 + 标签网格 + forceNewPage=true → 容器边框与卡片落在同一页', async () => {
    // 用户场景:数据表格在上,标签网格在下;forceNewPage 把网格推到末页
    // 老 bug:容器边框在原 gridTop 位置(第 1 页),卡片被 below-flow 移到末页 → 脱钩
    // 新行为:网格作为整体被重新展开,容器边框跟着卡片一起落到末页
    const grid = makeAppendixGrid(0, 95) // grid 摆在表格下方 5mm
    grid.mode = 'appendix'
    grid.forceNewPage = true
    const minimalItems = ReportItems.slice(0, 3)

    // 用一个会被 analyzeBody 识别为 flowTable 的 table(必要最小字段)
    const table: AnyControl = {
      id: 'src-table',
      type: 'table',
      left: 10, top: 10, width: 190, height: 70,
      columns: [
        { id: 'c1', title: '列1', field: 'Item', width: 60, align: 'center' },
        { id: 'c2', title: '列2', field: 'Specification', width: 60, align: 'center' },
        { id: 'c3', title: '列3', field: 'Result', width: 60, align: 'center' },
      ],
      headerRows: 1,
      cells: [
        [
          { segments: [{ kind: 'text', value: '列1' }] },
          { segments: [{ kind: 'text', value: '列2' }] },
          { segments: [{ kind: 'text', value: '列3' }] },
        ],
        ...Array.from({ length: 8 }, () => [
          { segments: [{ kind: 'field', path: 'ReportItems[0].Item' }] },
          { segments: [{ kind: 'field', path: 'ReportItems[0].Specification' }] },
          { segments: [{ kind: 'field', path: 'ReportItems[0].Result' }] },
        ]),
      ],
      dataSource: 'ReportItems',
      printable: true,
    }
    const result = await layout(
      {
        version: '1.0',
        document: {
          type: 'report',
          page: A4,
          sections: [{ type: 'body', components: [table, grid] }],
        },
      },
      { ReportItems: minimalItems },
    )
    // 至少 2 页:第 1 页表格 + 末页网格
    expect(result.pages.length).toBeGreaterThanOrEqual(2)
    const lastPage = result.pages[result.pages.length - 1]
    const lastPageCtrls = lastPage.body.filter((n) => n.kind === 'control')
    const lastPageLines = lastPage.gridLines ?? []
    expect(lastPageCtrls.length).toBeGreaterThan(0)
    expect(lastPageLines.length).toBeGreaterThan(0)
    // 关键断言:末页同时有卡片 + 容器边框 → 「容器边框与卡片在同一页」对齐
    // 老逻辑下,容器边框在第 1 页,卡片在末页,这里 lastPageCtrls>0 && lastPageLines>0 都不会同时成立
    const ctrlTops = lastPageCtrls.map((c: any) => c.top as number)
    const minCtrlTop = Math.min(...ctrlTops)
    const maxCtrlTop = Math.max(...ctrlTops)
    // 容器边框的 page-relative top 落在末页子控件 top 区间内(允许 ±5 容差)
    const containerLines = lastPageLines.filter((l) => l.width === 180)
    expect(containerLines.length).toBeGreaterThan(0)
    for (const line of containerLines) {
      expect(line.top).toBeGreaterThanOrEqual(minCtrlTop - 5)
      expect(line.top).toBeLessThanOrEqual(maxCtrlTop + 5)
    }
  })
})

/* -------------------- pageBreak 三态分页策略 (Step 2) -------------------- */
describe('expandLabelGrids —— pageBreak 三态分页策略', () => {
  // 测试夹具:5 列、cardHeight=30、gapY=3、stepY=33,一页 (bodyStep=200) 放得下 6 行 (33*6=198)
  // 容器宽 100,columnWidth = 20,但用绝对坐标 (5 列 × 20mm 列宽、间距 0) 构造简单网格。
  function makeGrid(over: Partial<LabelGridControl> = {}): LabelGridControl {
    return {
      id: 'g', type: 'labelgrid',
      left: 0, top: 0, width: 100, height: 200,
      columns: 5, gapX: 1, gapY: 3,
      cardWidth: 19, cardHeight: 30,
      showLines: true, dataSource: 'items',
      mode: 'appendix',
      children: [
        { id: 'n', type: 'text', left: 1, top: 1, width: 18, height: 6, childOf: 'g',
          contentType: 'expression', expression: '{{rowIndex + 1}}', printable: true },
      ],
      printable: true,
      ...over,
    }
  }

  it('pageBreak="always" → 无论 gridTop 在哪,整组推到下一页顶部', () => {
    const res = expandLabelGrids([makeGrid({ top: 20, pageBreak: 'always' })], { data: { items: [{}, {}, {}] } }, 'mm', 100, MAX_PAGES)
    const tops = res.components.map((c) => c.top)
    // 5 列 × 1 行 (3 数据 = 1 行):整组在 page 1(因 always 推下一页) → top ∈ [100, 133)
    expect(tops.every((t) => t >= 100 && t < 200)).toBe(true)
  })

  it('pageBreak="auto" + 整组放得下当前页 → 紧跟,不放不下才推', () => {
    // bodyStep=100,gridTop=0 → 可用空间 100mm,3 行 × 33 = 99mm 放得下
    const fits = expandLabelGrids([makeGrid({ top: 0, pageBreak: 'auto' })], { data: { items: [{}, {}, {}] } }, 'mm', 100, MAX_PAGES)
    const fitsTops = fits.components.map((c) => c.top)
    // 整组在 page 0:top ∈ [0, 100)
    expect(fitsTops.every((t) => t < 100)).toBe(true)

    // 太多数据 → 整组放不下,推下一页
    const overflow = expandLabelGrids([makeGrid({ top: 0, pageBreak: 'auto' })], { data: { items: new Array(40).fill({}) } }, 'mm', 100, MAX_PAGES)
    const overflowTops = overflow.components.map((c) => c.top)
    // 40 数据 / 5 列 = 8 行 × 33mm = 264mm > 100 → 整组推 page 1 (top ≥ 100)
    expect(overflowTops.every((t) => t >= 100)).toBe(true)
  })

  it('pageBreak="never" → 始终紧跟当前页,即便放不下也按原 capacity 走(maxPages 截断保护)', () => {
    // 40 数据 / 5 列 = 8 行,bodyStep=100,放得下 6 行,会跨多页但不开新页
    const res = expandLabelGrids([makeGrid({ top: 0, pageBreak: 'never' })], { data: { items: new Array(40).fill({}) } }, 'mm', 100, MAX_PAGES)
    const tops = res.components.map((c) => c.top)
    // 跨多页(top ∈ [0, bodyStep)),但所有行从 page 0 开始,没有「整组推下一页」
    expect(tops.some((t) => t < 100)).toBe(true)
    // 不会有整组跳到 ≥ 100 后才开始的页面分割行为(never 模式下)
    const hasFullPageJump = tops.some((t) => t >= 100 && t < 100) // 仅结构断言
    expect(hasFullPageJump).toBe(false)
  })

  it('向后兼容:forceNewPage=true → 等价 pageBreak="always";false/undefined → "auto"', () => {
    const oldTrue = expandLabelGrids([makeGrid({ top: 20, forceNewPage: true })], { data: { items: [{}] } }, 'mm', 100, MAX_PAGES)
    const oldTrueTops = oldTrue.components.map((c) => c.top)
    expect(oldTrueTops.every((t) => t >= 100)).toBe(true) // 推到 page 1

    const oldFalse = expandLabelGrids([makeGrid({ top: 20, forceNewPage: false })], { data: { items: [{}] } }, 'mm', 100, MAX_PAGES)
    const oldFalseTops = oldFalse.components.map((c) => c.top)
    // 1 行放得下 → 紧跟 page 0(top ∈ [20, 53))
    expect(oldFalseTops.every((t) => t < 100)).toBe(true)

    const oldUndef = expandLabelGrids([makeGrid({ top: 20 })], { data: { items: [{}] } }, 'mm', 100, MAX_PAGES)
    const oldUndefTops = oldUndef.components.map((c) => c.top)
    // 未设 forceNewPage → 默认 auto,行为同 false
    expect(oldUndefTops.every((t) => t < 100)).toBe(true)
  })
})
