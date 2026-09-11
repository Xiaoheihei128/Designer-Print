/**
 * 复现 "page 4 空白 / 只显示一个文本控件" 的现场 —— 多个 rows 数 + 多种 pageBreak 配置
 */
import { describe, it } from 'vitest'
import { layout } from '@op/core/layout-engine/pagination-engine'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'
import type { AnyControl, LabelGridControl } from '@op/types/control'
import type { TemplateData } from '@op/types/template'

const A4 = {
  width: 210,
  height: 297,
  unit: 'mm' as const,
  orientation: 'portrait' as const,
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
}

function makeReportItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    Item: `项目${i + 1}`,
    AnalysisItem: `分析项${i + 1}`,
    Method: `方法${i + 1}`,
    Result: `结果${i + 1}`,
    FinalVal: `结果值${i + 1}`,
    Photo: `/photo${i + 1}.jpg`,
  }))
}

/** 用户截图模板:合同场景,带 ReportItems 数据表 + appendix labelgrid + 文本控件 */
function buildContractTemplate(gridMode: 'auto' | 'always' | 'never' = 'auto'): TemplateData<AnyControl> {
  const t = (id: string, top: number, text: string, h = 6): AnyControl => ({
    id,
    type: 'text',
    left: 12,
    top,
    width: 186,
    height: h,
    value: text,
    style: { fontSize: 10 },
    printable: true,
  })

  const components: AnyControl[] = [
    // 设计 page 1 (y 0-160)
    {
      id: 'hdr-title',
      type: 'text',
      left: 12, top: 0, width: 186, height: 10,
      value: '检验报告(合同模板)',
      style: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
      printable: true,
    },
    {
      id: 'hdr-qr',
      type: 'qrcode',
      left: 180, top: 0, width: 18, height: 18,
      binding: 'ReportNo',
      printable: true,
    },
    // 6 条合同条款 (y 22-80,8mm each)
    t('cl-1', 22, '第一条:本合同为固定期限劳动合同...', 8),
    t('cl-2', 32, '第二条:乙方担任研发类岗位...', 8),
    t('cl-3', 42, '第三条:劳动报酬...', 8),
    t('cl-4', 52, '第四条:社会保险...', 8),
    t('cl-5', 62, '第五条:劳动保护...', 8),
    t('cl-6', 70, '第六条:合同解除...', 8),
    t('cl-total', 80, '总行数 / 结论:本批原料经检验合格', 8),

    // 数据表 ReportItems (y 90,userHeight=30)
    {
      id: 'report-items',
      type: 'table',
      left: 12, top: 90, width: 186, height: 30,
      dataSource: 'ReportItems',
      printable: true,
      columns: [
        { title: '项目', field: 'Item', width: 38, align: 'left', headerAlign: 'center' },
        { title: '分析项', field: 'AnalysisItem', width: 38, align: 'left', headerAlign: 'center' },
        { title: '方法', field: 'Method', width: 38, align: 'left', headerAlign: 'center' },
        { title: '结果', field: 'Result', width: 38, align: 'left', headerAlign: 'center' },
        { title: '结果值', field: 'FinalVal', width: 36, align: 'left', headerAlign: 'center' },
      ],
    } as AnyControl,

    // 附录 labelgrid (y 120,2 列 1 行,8 data → 真实 4 行)
    {
      id: 'appendix-grid',
      type: 'labelgrid',
      left: 12, top: 120, width: 186, height: 35,
      columns: 2,
      gapX: 3,
      gapY: 3,
      cardWidth: 91,
      cardHeight: 35,
      showLines: true,
      lineStyle: 'dashed',
      dataSource: 'ReportItems',
      mode: 'appendix',
      pageBreak: gridMode,
      printable: true,
      children: [
        {
          id: 'ag-img',
          type: 'image',
          left: 3, top: 3, width: 85, height: 22,
          value: { mode: 'binding', content: 'row.Photo' },
          fit: 'contain',
          printable: true,
        },
        {
          id: 'ag-title',
          type: 'text',
          left: 3, top: 26, width: 85, height: 6,
          contentType: 'variable',
          binding: 'row.AnalysisItem',
          style: { fontSize: 9 },
          printable: true,
        },
      ],
    } as LabelGridControl,

    // 设计 page 2 (y 165-260)
    // 5 个小文本 (y 165-200)
    t('txt-jiafang', 165, '甲方单位:某某科技有限公司', 7),
    t('txt-yifang', 175, '乙方单位:张三', 7),
    t('txt-addr', 185, '地址:北京市朝阳区', 7),
    t('txt-date', 195, '合同签订期:2026-08-08', 7),
    t('txt-label', 203, '签章栏:_______', 7),

    // 6 条 "第二条..." (y 213-263)
    t('cl2-1', 213, '第二条:服务期限...', 8),
    t('cl2-2', 223, '第三条:费用与支付...', 8),
    t('cl2-3', 233, '第四条:双方权利与义务...', 8),
    t('cl2-4', 243, '第五条:保密条款...', 8),
    t('cl2-5', 253, '第六条:违约责任...', 8),
    t('cl2-6', 263, '第七条:争议解决...', 8),
  ]

  return {
    version: '1.0',
    document: {
      type: 'report',
      page: A4,
      sections: [
        { type: 'header', components: [] },
        { type: 'body', components },
        { type: 'footer', components: [] },
      ],
    },
  }
}

describe('page 4 空白 / 只显示一个文本控件', () => {
  const measurer = createCjkMeasurer()

  it('模板结构概览', () => {
    const template = buildContractTemplate()
    const body = (template.document.sections.find((s) => s.type === 'body') as { components: AnyControl[] }).components
    console.log('\n===== 模板 body 控件位置概览 =====')
    for (const c of body) {
      console.log(`  ${c.id} (${c.type}) top=${c.top} height=${c.height}${c.type === 'table' ? ` dataSource=${c.dataSource}` : ''}${c.type === 'labelgrid' ? ` mode=${c.mode} pageBreak=${c.pageBreak} dataSource=${c.dataSource}` : ''}`)
    }
  })

  // pageBreak='auto': grid 放得下就跟当前页,放不下推新页
  for (const rows of [2, 5, 8, 15, 20]) {
    it(`pageBreak=auto, ReportItems=${rows}`, async () => {
      const template = buildContractTemplate('auto')
      const data = { Header: { ReportNo: 'RM-2026-001' }, ReportItems: makeReportItems(rows) }
      const result = await layout(template, data, { measurer })

      console.log(`\n===== pageBreak=auto, ReportItems=${rows} 渲染总览 =====`)
      console.log(`  totalPages: ${result.pages.length}`)
      console.log(`  warnings: ${result.warnings.length}`)
      for (const w of result.warnings) console.log(`    - ${w.code}: ${w.message}`)

      for (let p = 0; p < result.pages.length; p++) {
        const page = result.pages[p]!
        console.log(`\n----- Page ${p + 1} -----  body=${page.body.length} gridLines=${(page.gridLines ?? []).length}`)
        for (const n of page.body) {
          const summary = n.kind === 'table'
            ? `[table] rows=${n.rows.length} h=${n.height.toFixed(1)}`
            : `[control]`
          console.log(`    ${n.id} top=${n.top.toFixed(2)} h=${n.height.toFixed(2)} ${summary}`)
        }
        const gl = page.gridLines ?? []
        if (gl.length > 0) {
          for (const line of gl) {
            console.log(`    [gridLine] left=${line.left.toFixed(1)} top=${line.top.toFixed(1)} w=${line.width.toFixed(1)} h=${line.height.toFixed(1)} ${line.solid ? 'solid' : 'dashed'}`)
          }
        }
      }
    }, 30_000)
  }

  // pageBreak='always': grid 永远独占新页
  for (const rows of [2, 5, 8]) {
    it(`pageBreak=always, ReportItems=${rows}`, async () => {
      const template = buildContractTemplate('always')
      const data = { Header: { ReportNo: 'RM-2026-001' }, ReportItems: makeReportItems(rows) }
      const result = await layout(template, data, { measurer })

      console.log(`\n===== pageBreak=always, ReportItems=${rows} 渲染总览 =====`)
      console.log(`  totalPages: ${result.pages.length}`)
      console.log(`  warnings: ${result.warnings.length}`)
      for (const w of result.warnings) console.log(`    - ${w.code}: ${w.message}`)

      for (let p = 0; p < result.pages.length; p++) {
        const page = result.pages[p]!
        console.log(`\n----- Page ${p + 1} -----  body=${page.body.length} gridLines=${(page.gridLines ?? []).length}`)
        for (const n of page.body) {
          const summary = n.kind === 'table'
            ? `[table] rows=${n.rows.length} h=${n.height.toFixed(1)}`
            : `[control]`
          console.log(`    ${n.id} top=${n.top.toFixed(2)} h=${n.height.toFixed(2)} ${summary}`)
        }
      }
    }, 30_000)
  }
})
