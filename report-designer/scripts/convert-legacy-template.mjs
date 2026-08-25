// 旧版模板 JSON → OpenPrint TemplateData 转换器
// 用法: node scripts/convert-legacy-template.mjs <旧模板.json> [输出.json]
// 输入: report-designer 旧 ReportTemplate 结构 { paper, controls, matchRules, ... }
// 输出: { template: OpenPrint TemplateData, matchRules } 可写入后端 /api/print/templates
import { readFileSync, writeFileSync } from 'node:fs'

const inputFile = process.argv[2]
if (!inputFile) {
  console.error('用法: node scripts/convert-legacy-template.mjs <旧模板.json> [输出.json]')
  process.exit(1)
}
const outputFile = process.argv[3] || inputFile.replace(/\.json$/, '.openprint.json')

const legacy = JSON.parse(readFileSync(inputFile, 'utf8'))

// ---- 控件映射: 旧类型 → OpenPrint 类型 ----
function convertControl(c) {
  const p = c.properties || {}
  const base = {
    id: c.id,
    left: c.x,
    top: c.y,
    width: c.width,
    height: c.height,
    locked: c.locked || undefined,
    printable: c.visible === false ? false : undefined,
  }

  switch (c.type) {
    case 'Label':
      return { ...base, type: 'text', value: p.text || '' }
    case 'TextField':
      return {
        ...base,
        type: 'text',
        contentType: p.dataBinding ? 'variable' : 'fixed',
        binding: p.dataBinding || undefined,
        value: !p.dataBinding && p.nullValue ? p.nullValue : undefined,
      }
    case 'TextArea':
      return { ...base, type: 'text', value: p.dataBinding || p.placeholder || '' }
    case 'Image':
      return {
        ...base,
        type: 'image',
        value: p.dataBinding
          ? { mode: 'binding', content: p.dataBinding }
          : p.src
            ? { mode: 'url', content: p.src }
            : undefined,
        fit: p.fit || 'contain',
      }
    case 'Line':
      return { ...base, type: 'line', stroke: p.color || '#000000', strokeWidth: p.strokeWidth || 1 }
    case 'Rectangle':
      return {
        ...base,
        type: 'rect',
        fill: p.fillColor && p.fillColor !== 'transparent' ? p.fillColor : undefined,
        stroke: p.borderColor || '#000000',
        strokeWidth: p.borderStyle === 'none' ? 0 : p.borderStyle === 'thin' ? 1 : p.borderStyle === 'medium' ? 2 : 3,
        cornerRadius: p.cornerRadius || undefined,
      }
    case 'Barcode':
      return {
        ...base,
        type: 'barcode',
        contentType: p.dataBinding ? 'variable' : 'fixed',
        binding: p.dataBinding || undefined,
        value: !p.dataBinding ? p.value || undefined : undefined,
        format: p.barcodeType || 'CODE128',
      }
    case 'QRCode':
      return {
        ...base,
        type: 'qrcode',
        contentType: p.dataBinding ? 'variable' : 'fixed',
        binding: p.dataBinding || undefined,
        value: !p.dataBinding ? p.value || undefined : undefined,
      }
    case 'Table':
      return {
        ...base,
        type: 'table',
        dataSource: p.dataBinding || undefined,
        columns: (p.columns || []).map(col => ({
          id: col.id,
          title: col.title || '',
          field: col.field || '',
          width: col.width || 100,
          align: col.align || 'left',
        })),
      }
    case 'StaticTable':
      // 简化: 静态表格转为空白 table 网格(单元格合并等细节不保留, 需手工重排)
      return {
        ...base,
        type: 'table',
        dataSource: p.repeatBinding || undefined,
        columns: Array.from({ length: p.cols || 4 }, (_, i) => ({
          id: `col_${i + 1}`,
          title: `列${i + 1}`,
          field: `Field${i + 1}`,
          width: p.defaultColWidth || 100,
        })),
      }
    case 'PageNumber':
      return { ...base, type: 'text', value: '第 {{pageNo}} 页 / 共 {{pageTotal}} 页' }
    case 'ReportTitle':
      return { ...base, type: 'text', value: '报表标题' }
    case 'DateTime':
      return { ...base, type: 'text', value: '{{now()}}' }
    case 'PageBreak':
    default:
      // 分页符等无法直接映射, 返回 null 由调用方跳过
      return null
  }
}

// ---- 组装 OpenPrint TemplateData ----
const controls = (legacy.controls || [])
  .map(convertControl)
  .filter(Boolean)

const template = {
  version: '2.0.0',
  document: {
    type: 'report',
    page: {
      width: legacy.paper?.width ?? 210,
      height: legacy.paper?.height ?? 297,
      unit: 'mm',
      orientation: legacy.paper?.orientation || 'portrait',
      margin: {
        top: legacy.paper?.margins?.top ?? 20,
        bottom: legacy.paper?.margins?.bottom ?? 20,
        left: legacy.paper?.margins?.left ?? 20,
        right: legacy.paper?.margins?.right ?? 20,
      },
      backgroundColor: '#ffffff',
    },
    sections: [{ type: 'body', components: controls }],
  },
}

const result = {
  template,
  matchRules: legacy.matchRules || [],
  name: legacy.name || '转换模板',
  code: legacy.code || legacy.name || '',
  category: legacy.category || null,
  _warnings: [
    ...(legacy.controls || []).filter(c => !convertControl(c)).map(c => `控件 ${c.type}(${c.name}) 无法映射, 已跳过`),
    ...(legacy.controls || []).filter(c => c.type === 'StaticTable').map(c => `静态表格 ${c.name} 简化为空白表格, 合并/绑定需手工重排`),
  ],
}

writeFileSync(outputFile, JSON.stringify(result, null, 2))
console.log(`✅ 转换完成 → ${outputFile}`)
console.log(`   控件 ${controls.length}/${(legacy.controls || []).length} 个已映射`)
if (result._warnings.length) {
  console.log('   警告:')
  result._warnings.forEach(w => console.log(`     - ${w}`))
}
