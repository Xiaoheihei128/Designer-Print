/**
 * appendix-demo —— 一次性 demo:用 LabelGrid 模拟「附录 n×m 图片墙」
 * 用 mockData.getRawMaterialData()(已含 ReportItems[].Photo),
 * 首卡放 ImageControl 绑 {{row.Photo}} + TextControl 绑 {{row.AnalysisItem}},
 * 跑 layout + renderHtml,把结果 console 出来,看实际输出。
 *
 * 注意:这文件只用于演示/冒烟,跑完即可删除。后续会替换为正式回归测试。
 */
import { describe, it } from 'vitest'
import type { AnyControl, LabelGridControl } from '@op/types/control'
import type { PageSetup, TemplateData } from '@op/types/template'
import { layout } from '@op/core/layout-engine/pagination-engine'
import { renderHtml, renderStyle } from '@op/core/renderer-html'
import { getMockData } from '@/services/mockData'
import { writeFileSync } from 'node:fs'

const A4: PageSetup = {
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  backgroundColor: '#ffffff',
}

/** 3 列 × 3 行(共 9 格,数据 7 条 = 7 张图 + 2 空) */
const GRID_W = 3 * 50 + 2 * 3 // 156 mm
const GRID_H = 3 * 35 + 2 * 3 // 111 mm

/** 标签网格 + 首卡内容(图片 + 标题 + 编号) */
const grid: LabelGridControl = {
  id: 'appendix',
  type: 'labelgrid',
  left: 15,
  top: 30,
  width: GRID_W,
  height: GRID_H,
  columns: 3,
  gapX: 3,
  gapY: 3,
  cardWidth: 50,
  cardHeight: 35,
  showLines: true,
  lineStyle: 'dashed',
  dataSource: 'ReportItems',
  printable: true,
  children: [
    // 子组件坐标 = 相对卡片左上角(0,0)
    {
      id: 'card-img',
      type: 'image',
      left: 3,
      top: 3,
      width: 44,
      height: 22,
      value: { mode: 'binding', content: 'row.Photo' },
      fit: 'contain',
      printable: true,
    },
    {
      id: 'card-no',
      type: 'text',
      left: 3,
      top: 26,
      width: 10,
      height: 6,
      contentType: 'expression',
      expression: '{{rowIndex + 1}}号',
      style: { fontSize: 9, bold: true },
      printable: true,
    },
    {
      id: 'card-title',
      type: 'text',
      left: 14,
      top: 26,
      width: 33,
      height: 6,
      contentType: 'variable',
      binding: 'row.AnalysisItem',
      style: { fontSize: 9 },
      printable: true,
    },
  ],
}

/** 附录页眉(显示「附录」字样) */
const headerTitle = {
  id: 'h-title',
  type: 'text' as const,
  left: 80,
  top: 10,
  width: 50,
  height: 10,
  contentType: 'fixed' as const,
  value: '附录:样本照片',
  style: { fontSize: 16, bold: true },
  printable: true,
}

/** 主报告标题(用于上下文) */
const mainTitle = {
  id: 'm-title',
  type: 'text' as const,
  left: 15,
  top: 10,
  width: 180,
  height: 10,
  contentType: 'variable' as const,
  binding: 'Header.MaterialName',
  style: { fontSize: 14, bold: true },
  printable: true,
}

const template: TemplateData<AnyControl> = {
  version: '1.0',
  document: {
    type: 'report',
    page: A4,
    sections: [
      { type: 'header', components: [mainTitle] },
      { type: 'body', components: [headerTitle, grid] },
      { type: 'footer', components: [] },
    ],
  },
}

describe('appendix-demo —— LabelGrid 图片墙渲染效果', () => {
  it('7 张样本图按 3 列铺开,每张配 row.Photo + row.AnalysisItem + 编号', async () => {
    const data = getMockData('rawMaterial')
    const result = await layout(template, data)

    console.log('===== 渲染页数 =====', result.pages.length)
    console.log('===== 警告条数 =====', result.warnings.length)
    if (result.warnings.length) {
      console.log('===== 警告详情 =====')
      for (const w of result.warnings) console.log('  -', w.code, ':', w.message)
    }

    const html = renderHtml(result)
    // 抓所有 .op-image 看 src 是否来自 row.Photo
    const imgMatches = [...html.matchAll(/<img[^>]*src="([^"]*)"/g)]
    console.log('===== 图片节点数 =====', imgMatches.length)
    imgMatches.forEach((m, i) => {
      const src = m[1]!
      const preview = src.startsWith('data:') ? src.slice(0, 80) + '...(data uri)' : src
      console.log(`  [${i + 1}]`, preview)
    })

    // 抓所有 .op-text 内容看 rowIndex + 1 和 AnalysisItem 是否代入
    const textMatches = [...html.matchAll(/<div class="op-text"[^>]*>([\s\S]*?)<\/div>/g)]
    console.log('===== 文本节点 =====')
    textMatches.forEach((m, i) => {
      const inner = m[1]!.replace(/<[^>]+>/g, '').trim()
      if (inner) console.log(`  [${i + 1}]`, JSON.stringify(inner))
    })

    writeFileSync('d:/工作目录/260817/report-designer/appendix-demo.html', html)
    console.log('===== HTML 写入 appendix-demo.html =====', html.length)
  }, 30_000)
})