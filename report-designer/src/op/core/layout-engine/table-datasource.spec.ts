/**
 * Table dataSource 误用回归测试
 *
 * 触发背景：TableProps 错误地把 <BindingEditor>（字段路径编辑器）当 Table 的
 * dataSource 下拉用，导致用户能选到 "Header.ReportNo" 这类字段路径——运行时
 * resolveRows() 拿到一个字符串（不是数组），触发 DATASOURCE_NOT_ARRAY 告警、
 * 表格一行不渲染。
 *
 * 本测试不依赖后端/网络，纯走 render() 全链路，覆盖三类易错场景：
 * 1. dataSource 写成字段路径（Header.ReportNo / ReportItems[].AnalysisItem）→ 必告警
 * 2. dataSource 写成正确的数组路径（ReportItems）→ 不告警，按数据展开行
 * 3. dataSource 路径在 data 中不存在 → 告警 DATASOURCE_EMPTY（而不是静默丢行）
 *
 * 后续若改 UI 让 BindingEditor 出现在 Table 之外其他地方，本测试会先红——防止回归。
 */
import { describe, expect, it } from 'vitest'

import { render } from '@op/core/sdk'
import type { AnyControl, TableControl } from '@op/types/control'
import type { TemplateData } from '@op/types/template'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'

/** 最小化 Table 控件模板：1 表头 + 2 列 + 5 个设计行 */
function makeTableTemplate(dataSource: string): TemplateData<AnyControl> {
  const table: TableControl = {
    id: 'tbl',
    type: 'table',
    left: 10,
    top: 10,
    width: 100,
    height: 40,
    dataSource,
    columns: [
      { field: 'AnalysisItem', title: '项目', width: 50, align: 'left' },
      { field: 'FinalVal',     title: '值',   width: 50, align: 'right' },
    ],
    options: { repeatHeader: true, pageRows: 'auto' },
    printable: true,
  }
  return {
    version: '1.0',
    document: {
      type: 'report',
      page: {
        width: 210,
        height: 297,
        unit: 'mm',
        orientation: 'portrait',
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      sections: [
        { type: 'body', components: [table] },
      ],
    },
  }
}

/** 标准检验报告业务数据（沿用后端 catalog 契约） */
function makeReportData(rows = 3): Record<string, unknown> {
  return {
    Header: {
      ReportNo: 'RM-2026-00123',
      ReportDate: '2026-08-12',
      Inspector: '张伟',
    },
    ReportItems: Array.from({ length: rows }, (_, i) => ({
      AnalysisItem: ['外观', '香气', '含量'][i % 3] ?? `项目${i + 1}`,
      TestStandard: '符合规定',
      FinalVal: ['符合规定', '99.5%', '0.872'][i % 3] ?? `val${i + 1}`,
      InspectionResultName: '合格',
    })),
  }
}

describe('Table dataSource 误用回归', () => {
  const measurer = createCjkMeasurer()

  it('dataSource 写成字段路径（Header.ReportNo）→ 触发 DATASOURCE_NOT_ARRAY，0 行', async () => {
    const res = await render({
      template: makeTableTemplate('Header.ReportNo'),
      data: makeReportData(),
      layout: { measurer },
    })

    const warn = res.warnings.find((w) => w.code === 'DATASOURCE_NOT_ARRAY')
    expect(warn, `应触发 DATASOURCE_NOT_ARRAY，实际: ${JSON.stringify(res.warnings)}`).toBeDefined()
    expect(warn?.message).toContain('Header.ReportNo')
    expect(warn?.message).toMatch(/string|number|boolean|object/)
    // 没有数据行（is-data class 的 <tr>）
    const dataRows = res.html.match(/<tr class="is-data"/g) ?? []
    expect(dataRows.length).toBe(0)
  })

  it('dataSource 写成 number 字段路径（Header 不存在 → 取到对象/字符串）→ 触发 DATASOURCE_NOT_ARRAY', async () => {
    // 再压一个「数字字段」场景，验证 typeof 在 number 时也能正确告警
    const data = makeReportData()
    ;(data.Header as Record<string, unknown>).Quantity = 50
    const res = await render({
      template: makeTableTemplate('Header.Quantity'),
      data,
      layout: { measurer },
    })

    const warn = res.warnings.find((w) => w.code === 'DATASOURCE_NOT_ARRAY')
    expect(warn, `应触发 DATASOURCE_NOT_ARRAY，实际: ${JSON.stringify(res.warnings)}`).toBeDefined()
    expect(warn?.message).toContain('number')
  })

  it('dataSource = 正确数组路径（ReportItems）→ 不告警，按 data 长度展开行', async () => {
    const res = await render({
      template: makeTableTemplate('ReportItems'),
      data: makeReportData(5),
      layout: { measurer },
    })

    expect(res.warnings.filter((w) =>
      w.code === 'DATASOURCE_NOT_ARRAY' || w.code === 'DATASOURCE_EMPTY'
    )).toEqual([])
    const dataRows = res.html.match(/<tr class="is-data"/g) ?? []
    expect(dataRows.length).toBe(5)
  })

  it('dataSource 路径在 data 中不存在 → 触发 DATASOURCE_EMPTY（而非静默）', async () => {
    const res = await render({
      template: makeTableTemplate('NonExistentArray'),
      data: makeReportData(),
      layout: { measurer },
    })

    expect(res.warnings.some((w) => w.code === 'DATASOURCE_EMPTY')).toBe(true)
  })

  it('dataSource 留空 → 退化为布局网格（不告警）', async () => {
    const res = await render({
      template: makeTableTemplate(''),
      data: makeReportData(),
      layout: { measurer },
    })

    expect(res.warnings.filter((w) =>
      w.code === 'DATASOURCE_NOT_ARRAY' || w.code === 'DATASOURCE_EMPTY'
    )).toEqual([])
  })
})