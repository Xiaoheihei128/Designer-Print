import { describe, it } from 'vitest'
import { layout } from './pagination-engine'
import { renderPage } from '../renderer-html/html-renderer'
import { generateCss } from '../renderer-html/css-generator'
import { createMeasurer } from './measure'
import type { AnyControl, TableControl, TemplateData } from '@op/types/template'

describe('blank bug inspect', () => {
  const measurer = createMeasurer()

  it('打印含 blank 行的表格 PlacedTable 行结构', async () => {
    const template: TemplateData<AnyControl> = {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 0, right: 10, bottom: 0, left: 10 },
        },
        sections: [
          {
            type: 'body',
            components: [
              {
                id: 'fb',
                type: 'table',
                left: 10,
                top: 0,
                width: 190,
                height: 40,
                dataSource: 'items',
                columns: [
                  { title: '名称', field: 'items[].name', width: 38, headerAlign: 'center' },
                  { title: '金额', field: 'items[].amount', width: 38, headerAlign: 'center' },
                  { title: '类别', field: 'items[].cat', width: 38, headerAlign: 'center' },
                  { title: '单位', field: 'items[].unit', width: 38, headerAlign: 'center' },
                  { title: '备注', field: 'items[].remark', width: 38, headerAlign: 'center' },
                ],
                data: Array.from({ length: 20 }, (_, i) => ({
                  name: `n${i}`,
                  amount: i + 1,
                  cat: `c${i}`,
                  unit: `u${i}`,
                  remark: `r${i}`,
                })),
                options: {
                  repeatHeader: true,
                  repeatFooter: false,
                  borders: 'all',
                  fixBottomRows: 'fill',
                },
              } as unknown as TableControl,
            ],
          },
        ],
      },
    }

    const data = {
      items: Array.from({ length: 100 }, (_, i) => ({
        name: `n${i}`,
        amount: i + 1,
        cat: `c${i}`,
        unit: `u${i}`,
        remark: `r${i}`,
      })),
    }

    const result = await layout(template, data, { measurer })

    // 抓出最后一页最后三张表的第 3 个(末页) 的 HTML,看看渲染出的最后一页最后一段的表格
    const lastPage = result.pages[result.pages.length - 1]!
    const html = renderPage(lastPage)
    console.log('=== LAST PAGE HTML (table fragment) ===')
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/)
    if (tableMatch) {
      // 取最后 3 行(2 个 blank + 1 个 data 行)
      const allRows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/g) || []
      console.log(`total rows in table: ${allRows.length}`)
      console.log('--- Last 5 rows ---')
      for (const row of allRows.slice(-5)) {
        console.log(row)
      }
    }

    // CSS
    console.log('=== Generated CSS (table rules) ===')
    const css = generateCss(result.metrics, { screen: true })
    const cssRules = css.split('\n').filter((l: string) =>
      l.includes('border') || l.includes('blank') || l.includes('last-child') || l.includes('op-table')
    )
    console.log(cssRules.join('\n'))

    console.log(`=== Total pages: ${result.pages.length} ===`)
    result.pages.forEach((page, p) => {
      console.log(`\n--- Page ${p + 1} ---`)
      page.body.forEach((node, ni) => {
        if (node.kind !== 'table') return
        console.log(`  Table #${ni}: rows=${node.rows.length}, footerRows=${node.footerRows.length}`)
        node.rows.forEach((row, ri) => {
          const cellsDesc = row.cells
            .map(
              (c, ci) =>
                `[${ci}]"${c.text}"${c.colSpan ? ` colspan=${c.colSpan}` : ''}${c.rowSpan ? ` rowspan=${c.rowSpan}` : ''}${c.consumed ? ' consumed' : ''}`,
            )
            .join(' ')
          console.log(`    Row ${ri}: kind=${row.kind} h=${row.height.toFixed(2)}mm cells=${row.cells.length} :: ${cellsDesc}`)
        })
        node.footerRows.forEach((row, ri) => {
          const cellsDesc = row.cells
            .map(
              (c, ci) =>
                `[${ci}]"${c.text}"${c.colSpan ? ` colspan=${c.colSpan}` : ''}${c.rowSpan ? ` rowspan=${c.rowSpan}` : ''}${c.consumed ? ' consumed' : ''}`,
            )
            .join(' ')
          console.log(`    Footer ${ri}: kind=${row.kind} h=${row.height.toFixed(2)}mm cells=${row.cells.length} :: ${cellsDesc}`)
        })
      })
    })
  })
})