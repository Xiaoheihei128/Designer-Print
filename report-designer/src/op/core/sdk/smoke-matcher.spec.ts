import { describe, expect, it } from 'vitest'

import { render } from '@op/core/sdk'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'

/**
 * 端到端冒烟：模拟 /matcher 注入的真实数据，验证原料检验报告模板的
 * 字段路径统一为 ReportItems[].xxx 后能否正常填充。
 *
 * 这是为了修这个 bug 而写的回归用例：
 * - 旧模板列里既写 ReportItems[].xxx 又写 items[].xxx，且预览数据来自
 *   buildPreviewData(activeFields) — 字段对不上就空。
 * - 修复后：模板列路径全部 ReportItems[].xxx，matcher 注入真实数据走
 *   dataSourceStore.setOverridePreviewData 进入 layout(template, data)。
 */
describe('smoke — matcher 注入数据 → 原料检验报告渲染', () => {
  const measurer = createCjkMeasurer()

  it('ReportItems[] 真实数据 → 表格 8 行 AnalysisItem/TestStandard/FinalVal 全部填充', async () => {
    // 1) 从后端取真实模板
    const resp = await fetch('http://localhost:5000/api/print/templates/tpl_2b71b69a942542d7a46bfb2038d9c45d')
    const record = await resp.json() as { content: string }
    const template = JSON.parse(record.content)

    // 2) 模拟 matcher 注入的真实业务数据
    const data = {
      Header: {
        ReportNo: 'RM-2026-00001',
        MaterialName: '香叶醇(天然)',
        BatchNo: 'B20260825',
        Result: '合格',
      },
      ReportItems: [
        { AnalysisItem: '外观',   TestStandard: '无色至淡黄色透明液体', FinalVal: '符合规定', InspectionResultName: '合格', amount: 12.5 },
        { AnalysisItem: '气味',   TestStandard: '具玫瑰样香气',         FinalVal: '符合规定', InspectionResultName: '合格', amount: 16 },
        { AnalysisItem: '折光指数', TestStandard: '1.456~1.466',        FinalVal: '1.461',     InspectionResultName: '合格', amount: 36 },
        { AnalysisItem: '含量',   TestStandard: '≥92.0%',               FinalVal: '94.6%',    InspectionResultName: '合格', amount: 110 },
        { AnalysisItem: '酸值',   TestStandard: '≤1.0',                 FinalVal: '0.3',      InspectionResultName: '合格', amount: 50 },
        { AnalysisItem: '重金属', TestStandard: '≤10 ppm',              FinalVal: '<10 ppm',  InspectionResultName: '合格', amount: 80 },
        { AnalysisItem: '砷',     TestStandard: '≤3 ppm',               FinalVal: '<3 ppm',   InspectionResultName: '合格', amount: 100 },
        { AnalysisItem: '水分',   TestStandard: '≤0.5%',                FinalVal: '0.2%',     InspectionResultName: '合格', amount: 30 },
      ],
    }

    const res = await render({ template, data, layout: { measurer } })

    // 3) 验证：cells[*].field 现在统一对齐 columns[*].field，全部命中后端 catalog 字段
    expect(res.html).toContain('外观')
    expect(res.html).toContain('气味')
    expect(res.html).toContain('折光指数')
    expect(res.html).toContain('含量')
    expect(res.html).toContain('酸值')
    expect(res.html).toContain('重金属')
    expect(res.html).toContain('砷')
    expect(res.html).toContain('水分')

    // 4) 数值列：实测值 / 金额 也正确
    expect(res.html).toContain('94.6%')
    expect(res.html).toContain('110')
    expect(res.html).toContain('434.50')
    expect(res.html).toContain('肆佰叁拾肆元伍角')

    // 调试：打印实际 HTML 的数据行
    const trs = res.html.match(/<tr class="is-data"[\s\S]*?<\/tr>/g) ?? []
    console.log('===== data rows (first 3):')
    trs.slice(0, 3).forEach((tr, i) => {
      const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '').trim())
      console.log(`row${i+1}:`, tds)
    })

    // 5) Header 字段也被填充
    expect(res.html).toContain('RM-2026-00001')
    expect(res.html).toContain('香叶醇(天然)')

    // 6) 没有数据源/绑定警告
    const dsWarn = res.warnings.find(w => w.code === 'DATASOURCE_EMPTY' || w.code === 'DATASOURCE_NOT_ARRAY' || w.code === 'BINDING_MISSING')
    expect(dsWarn, `意外警告: ${JSON.stringify(res.warnings)}`).toBeUndefined()
  })
})