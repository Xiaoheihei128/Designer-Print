// 报表生成器核心
// 将模板 + 数据渲染为 HTML

import type { ReportTemplate, PaperConfig } from '@/types/template'
import type { AnyControl, TableControl, StaticTableControl, TextFieldControl, LabelControl } from '@/types/control'
import type { ExportOptions, PageRenderResult } from './types'
import { resolveBindingValue, getValueByPath, resolveTableData } from './dataResolver'
import { paginateTable, shouldRepeatHeader, shouldShowFooter } from './tablePagination'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

// mm 转 px (96 DPI)
const MM_TO_PX = 96 / 25.4

/**
 * 将 mm 转换为 px
 */
export function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

/**
 * 生成控件 HTML
 */
function renderControl(control: AnyControl, data: any, pageIndex: number, pageCount: number): string {
  const props = control.properties || {}
  const style = buildControlStyle(control)

  switch (control.type) {
    case 'Label':
      return renderLabel(control as LabelControl, style)

    case 'TextField':
      return renderTextField(control as TextFieldControl, data, style)

    case 'Rectangle':
      return renderRectangle(control, style)

    case 'Line':
      return renderLine(control, style)

    case 'Table':
      return renderTable(control as TableControl, data, pageIndex, pageCount, style)

    case 'StaticTable':
      return renderStaticTable(control as StaticTableControl, data, style)

    case 'Barcode':
      return renderBarcode(control, data, style)

    case 'QRCode':
      return renderQRCode(control, data, style)

    case 'Image':
      return renderImage(control, style)

    case 'PageNumber':
      return renderPageNumber(control, pageIndex, pageCount, style)

    case 'ReportTitle':
      return renderReportTitle(control, style)

    case 'DateTime':
      return renderDateTime(control, style)

    case 'PageBreak':
      return `<div style="${style} position: absolute; left: ${control.x}mm; top: ${control.y}mm; width: ${control.width}mm; height: ${control.height}mm; page-break-after: always;"></div>`

    default:
      return `<div style="${style} position: absolute; left: ${control.x}mm; top: ${control.y}mm; width: ${control.width}mm; height: ${control.height}mm;">[${control.type}]</div>`
  }
}

/**
 * 构建控件样式
 */
function buildControlStyle(control: AnyControl): string {
  const props = control.properties || {}
  let style = `position: absolute; left: ${control.x}mm; top: ${control.y}mm; width: ${control.width}mm; height: ${control.height}mm;`

  if (!control.visible) {
    style += ' visibility: hidden;'
  }

  if (control.locked) {
    style += ' pointer-events: none;'
  }

  // 通用字体样式
  if (props.fontFamily) {
    style += ` font-family: ${props.fontFamily};`
  }
  if (props.fontSize) {
    style += ` font-size: ${props.fontSize}pt;`
  }
  if (props.fontWeight) {
    style += ` font-weight: ${props.fontWeight};`
  }
  if (props.color) {
    style += ` color: ${props.color};`
  }
  if (props.textAlign) {
    style += ` text-align: ${props.textAlign};`
  }

  // 背景色
  if (props.backgroundColor) {
    style += ` background-color: ${props.backgroundColor};`
  }

  return style
}

// 渲染 Label
function renderLabel(control: LabelControl, baseStyle: string): string {
  const props = control.properties
  return `<div style="${baseStyle} display: flex; align-items: center; overflow: hidden;">${props.text || ''}</div>`
}

// 渲染文本框
function renderTextField(control: TextFieldControl, data: any, baseStyle: string): string {
  const props = control.properties
  const resolved = resolveBindingValue(props.dataBinding, data, props.format, props.nullValue)

  const borderStyle = props.borderStyle !== 'none' ? `border: 1px solid ${props.borderColor || '#000'};` : ''

  return `<div style="${baseStyle} display: flex; align-items: center; overflow: hidden; ${borderStyle} padding: 1mm;">${resolved.formatted}</div>`
}

// 渲染矩形
function renderRectangle(control: AnyControl, baseStyle: string): string {
  const props = control.properties || {}
  let extra = ''

  if (props.borderStyle && props.borderStyle !== 'none') {
    const width = props.borderStyle === 'thin' ? 0.5 : props.borderStyle === 'medium' ? 1 : 2
    extra += ` border: ${width}mm solid ${props.borderColor || '#000'};`
  }

  if (props.fillColor) {
    extra += ` background-color: ${props.fillColor};`
  }

  if (props.cornerRadius) {
    extra += ` border-radius: ${props.cornerRadius}mm;`
  }

  return `<div style="${baseStyle}${extra}"></div>`
}

// 渲染线条
function renderLine(control: AnyControl, baseStyle: string): string {
  const props = control.properties || {}
  const isHorizontal = props.direction === 'horizontal'

  let lineStyle = isHorizontal
    ? `border-top: ${props.strokeWidth || 1}px ${props.strokeStyle || 'solid'} ${props.color || '#000'};`
    : `border-left: ${props.strokeWidth || 1}px ${props.strokeStyle || 'solid'} ${props.color || '#000'};`

  return `<div style="${baseStyle} ${lineStyle}"></div>`
}

// 渲染表格占位符(实际内容在分页处理中生成)
function renderTable(
  control: TableControl,
  data: any,
  pageIndex: number,
  pageCount: number,
  baseStyle: string
): string {
  const props = control.properties
  const tableData = resolveTableData(data, props.dataBinding || '')
  const columns = props.columns || []

  // 边框样式
  let borderCss = ''
  if (props.border?.style && props.border.style !== 'none') {
    const width = (props.border?.width || 1) * 0.3
    borderCss = `border: ${width.toFixed(2)}mm ${props.border.style} ${props.border?.color || '#000'}; border-collapse: collapse;`
  }

  // 计算列宽总和
  const totalWidth = columns.reduce((sum, col) => sum + (col.width || 30), 0) || 100

  // 单元格基础样式
  const cellBaseStyle = `${borderCss} padding: 2mm; word-wrap: break-word; overflow: hidden;`

  // 构建列富格式辅助函数
  const colExtraStyle = (col: any) => {
    const parts: string[] = []
    if (col.fontSize) parts.push(`font-size: ${col.fontSize}pt`)
    if (col.fontWeight === 'bold') parts.push('font-weight: bold')
    if (col.textColor) parts.push(`color: ${col.textColor}`)
    if (col.backgroundColor) parts.push(`background: ${col.backgroundColor}`)
    return parts.length ? ' ' + parts.join('; ') : ''
  }

  // 渲染表头
  let headerHtml = ''
  if (props.headerRow?.enabled) {
    const headerBg = props.headerRow.backgroundColor || '#f0f0f0'
    let headerCells = ''
    for (const col of columns) {
      const widthPct = ((col.width || 30) / totalWidth * 100).toFixed(2)
      const align = col.align || 'left'
      headerCells += `<th style="${cellBaseStyle} background: ${headerBg}; font-weight: bold; text-align: ${align}; width: ${widthPct}%;${colExtraStyle(col)}">${escapeHtml(col.title || '')}</th>`
    }
    headerHtml = `<thead style="background: ${headerBg};"><tr>${headerCells}</tr></thead>`
  }

  // 渲染表尾
  let footerHtml = ''
  if (props.footerRow?.enabled) {
    const footerBg = props.footerRow.backgroundColor || '#f0f0f0'
    let footerCells = ''
    for (const col of columns) {
      const widthPct = ((col.width || 30) / totalWidth * 100).toFixed(2)
      const align = col.align || 'left'
      footerCells += `<td style="${cellBaseStyle} background: ${footerBg}; text-align: ${align}; width: ${widthPct}%;${colExtraStyle(col)}">${escapeHtml(col.title || '')}</td>`
    }
    footerHtml = `<tfoot style="background: ${footerBg};"><tr>${footerCells}</tr></tfoot>`
  }

  // 数据行
  let bodyHtml = '<tbody>'
  const totalRows = tableData.length

  if (totalRows === 0) {
    let emptyCells = ''
    for (const col of columns) {
      const widthPct = ((col.width || 30) / totalWidth * 100).toFixed(2)
      emptyCells += `<td style="${cellBaseStyle} width: ${widthPct}%;">&nbsp;</td>`
    }
    bodyHtml += `<tr style="min-height: 8mm;">${emptyCells}</tr>`
  } else {
    for (const row of tableData) {
      let cells = ''
      for (const col of columns) {
        const widthPct = ((col.width || 30) / totalWidth * 100).toFixed(2)
        const align = col.align || 'left'
        const value = row?.[col.field] !== undefined ? String(row[col.field]) : ''
        cells += `<td style="${cellBaseStyle} text-align: ${align}; width: ${widthPct}%;${colExtraStyle(col)}">${escapeHtml(value)}</td>`
      }
      bodyHtml += `<tr style="min-height: 6mm;">${cells}</tr>`
    }
  }

  // 空白行填充
  if (props.fillEmptyRows?.enabled) {
    const minEmpty = props.fillEmptyRows.minEmptyRows || 0
    const currentRows = Math.max(totalRows, 1)
    const emptyToAdd = Math.max(0, minEmpty - currentRows)
    for (let i = 0; i < emptyToAdd; i++) {
      let emptyCells = ''
      for (const col of columns) {
        const widthPct = ((col.width || 30) / totalWidth * 100).toFixed(2)
        emptyCells += `<td style="${cellBaseStyle} width: ${widthPct}%;">&nbsp;</td>`
      }
      bodyHtml += `<tr style="min-height: 6mm;">${emptyCells}</tr>`
    }
  }

  bodyHtml += '</tbody>'

  return `<table style="${baseStyle} ${borderCss} width: 100%; table-layout: fixed; font-size: 9pt;">${headerHtml}${bodyHtml}${footerHtml}</table>`
}

// HTML转义函数
function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 渲染静态表格(每格独立绑定字段)
function renderStaticTable(control: StaticTableControl, data: any, baseStyle: string): string {
  const props = control.properties
  const cells = props.cells || []
  const rows = props.rows || 0
  const cols = props.cols || 0
  const defaultRowHeight = props.defaultRowHeight || 10
  const defaultColWidth = props.defaultColWidth || 30
  const defaultBorderWidth = (props.defaultBorderWidth || 1) * 0.3
  const defaultBorderStyle = props.defaultBorderStyle || 'solid'
  const defaultBorderColor = props.defaultBorderColor || '#000000'

  const defaultBorderCss = `${defaultBorderWidth.toFixed(2)}mm ${defaultBorderStyle} ${defaultBorderColor}`

  // 标记被跨过的位置
  const occupied: Set<string> = new Set()
  for (const cell of cells) {
    const rs = cell.rowspan || 1
    const cs = cell.colspan || 1
    for (let r = cell.row; r < cell.row + rs; r++) {
      for (let c = cell.col; c < cell.col + cs; c++) {
        if (r === cell.row && c === cell.col) continue
        occupied.add(`${r}_${c}`)
      }
    }
  }

  // 计算总宽度
  const colWidths: number[] = []
  let totalColWidth = 0
  for (let c = 0; c < cols; c++) {
    let colW = props.colWidths?.[c] ?? defaultColWidth
    for (const cell of cells) {
      if (cell.col === c && cell.width && cell.width > colW) {
        colW = cell.width
      }
    }
    colWidths.push(colW)
    totalColWidth += colW
  }
  if (totalColWidth === 0) totalColWidth = cols * defaultColWidth

  // 行高数组
  const rowHeights: number[] = []
  for (let r = 0; r < rows; r++) {
    rowHeights.push(props.rowHeights?.[r] ?? defaultRowHeight)
  }

  // === 重复行处理 ===
  const repeatBinding = props.repeatBinding
  const repeatRowStart = props.repeatRowStart ?? 1   // 默认从第2行开始(假设第1行是表头)
  const repeatRowEnd = props.repeatRowEnd ?? (rows - 2)  // 默认到倒数第2行(假设最后1行是表尾)

  // 解析重复数据数组
  const hasRepeat = Boolean(repeatBinding)
  const repeatData = hasRepeat ? resolveTableData(data, repeatBinding) : []
  // 未配置重复绑定时，中间行也要渲染一次（否则只有表头/表尾行出现在预览中）
  const itemCount = hasRepeat ? (repeatData.length || props.repeatCount || 0) : 1

  // 头部行(0 ~ repeatRowStart-1)
  const headerRows = Array.from({ length: repeatRowStart }, (_, r) => r)
  // 尾部行(repeatRowEnd+1 ~ rows-1)
  const footerRows = Array.from({ length: rows - repeatRowEnd - 1 }, (_, i) => repeatRowEnd + 1 + i)
  // 重复行模板(repeatRowStart ~ repeatRowEnd)
  const templateRows = Array.from({ length: repeatRowEnd - repeatRowStart + 1 }, (_, i) => repeatRowStart + i)

  // 斑马线背景色(当有交替行设置时使用)
  function getAlternatingBg(rowIndex: number): string | null {
    if (!props.alternatingRows || !props.alternatingRowColor) return null
    return rowIndex % 2 === 0 ? props.alternatingRowColor : null
  }

  // 渲染单个单元格内容(带数据上下文)
  function renderCellContent(cell: any, itemData: any) {
    if (!cell.content || cell.content.type === 'text') {
      let value = ''
      if (cell.content?.field) {
        const resolved = resolveBindingValue(cell.content.field, itemData)
        value = resolved.formatted || ''
      } else if (cell.content?.value) {
        value = cell.content.value
      }
      return escapeHtml(value)
    } else if (cell.content.type === 'image') {
      if (cell.content.src) return `<img src="${escapeHtml(cell.content.src)}" style="max-width: 100%; max-height: 100%; object-fit: ${cell.content.fit || 'contain'};" />`
      if (cell.content.field) {
        const resolved = resolveBindingValue(cell.content.field, itemData)
        return `[图]{${escapeHtml(resolved.formatted || cell.content.field)}}`
      }
      return '图片'
    } else if (cell.content.type === 'qrcode') {
      const val = cell.content.field ? resolveBindingValue(cell.content.field, itemData).formatted : (cell.content.value || '')
      return `<svg class="qrcode" data-value="${escapeHtml(val)}" data-size="${cell.content.size || 60}"></svg>`
    } else if (cell.content.type === 'barcode') {
      const val = cell.content.field ? resolveBindingValue(cell.content.field, itemData).formatted : (cell.content.value || '')
      return `<svg class="barcode" data-value="${escapeHtml(val)}" data-format="${escapeHtml(cell.content.format || 'CODE128')}" data-showtext="${cell.content.showText !== false}"></svg>`
    }
    return ''
  }

  // 渲染一行
  function renderRow(r: number, itemData: any, actualRowIndex?: number): string {
    const rowCells = cells.filter(cell => cell.row === r && !occupied.has(`${r}_${cell.col}`)).sort((a, b) => a.col - b.col)
    let cellsHtml = ''
    for (const cell of rowCells) {
      const rs = cell.rowspan || 1
      const cs = cell.colspan || 1
      const colW = colWidths[cell.col] ?? defaultColWidth
      const widthPct = ((colW * cs) / totalColWidth * 100).toFixed(2)
      const align = cell.align || 'left'
      const valign = cell.valign || 'middle'
      const fontSize = cell.fontSize || 10
      const fontWeight = cell.fontWeight || 'normal'
      const fontStyle = cell.fontStyle || 'normal'
      const textDecoration = cell.textDecoration || 'none'
      const altBg = (actualRowIndex !== undefined && !cell.backgroundColor) ? getAlternatingBg(actualRowIndex) : null
      const bgColor = cell.backgroundColor || altBg || 'transparent'
      const textColor = cell.textColor || '#000000'
      const padding = cell.padding ?? 1

      const borderTop = cell.borderTop ? `${(cell.borderTop.width ?? props.defaultBorderWidth) * 0.3}mm ${cell.borderTop.style ?? defaultBorderStyle} ${cell.borderTop.color ?? defaultBorderColor}` : defaultBorderCss
      const borderRight = cell.borderRight ? `${(cell.borderRight.width ?? props.defaultBorderWidth) * 0.3}mm ${cell.borderRight.style ?? defaultBorderStyle} ${cell.borderRight.color ?? defaultBorderColor}` : defaultBorderCss
      const borderBottom = cell.borderBottom ? `${(cell.borderBottom.width ?? props.defaultBorderWidth) * 0.3}mm ${cell.borderBottom.style ?? defaultBorderStyle} ${cell.borderBottom.color ?? defaultBorderColor}` : defaultBorderCss
      const borderLeft = cell.borderLeft ? `${(cell.borderLeft.width ?? props.defaultBorderWidth) * 0.3}mm ${cell.borderLeft.style ?? defaultBorderStyle} ${cell.borderLeft.color ?? defaultBorderColor}` : defaultBorderCss
      const borderStyle = `border-top: ${borderTop}; border-right: ${borderRight}; border-bottom: ${borderBottom}; border-left: ${borderLeft};`
      const inner = renderCellContent(cell, itemData)
      cellsHtml += `<td rowspan="${rs}" colspan="${cs}" style="${borderStyle} padding: ${padding}mm; text-align: ${align}; vertical-align: ${valign}; font-size: ${fontSize}pt; font-weight: ${fontWeight}; font-style: ${fontStyle}; text-decoration: ${textDecoration}; color: ${textColor}; background: ${bgColor}; width: ${widthPct}%;">${inner}</td>`
    }
    const rowH = rowHeights[r] ?? defaultRowHeight
    return `<tr style="height: ${rowH}mm;">${cellsHtml}</tr>`
  }

  // 构建所有行(追踪实际行号用于斑马线)
  let allRowsHtml = ''
  let actualRowIndex = 0
  // 头部行
  for (const r of headerRows) {
    allRowsHtml += renderRow(r, data, actualRowIndex++)
  }
  // 重复行(每个数据项渲染一次模板行区间；无重复绑定时用整份数据渲染一次)
  for (let i = 0; i < itemCount; i++) {
    const itemData = hasRepeat ? (repeatData[i] || {}) : data
    for (const r of templateRows) {
      allRowsHtml += renderRow(r, itemData, actualRowIndex++)
    }
  }
  // 尾部行
  for (const r of footerRows) {
    allRowsHtml += renderRow(r, data, actualRowIndex++)
  }

  return `<table style="${baseStyle} border-collapse: collapse; table-layout: fixed; width: 100%; border-spacing: 0;">${allRowsHtml}</table>`
}

// 渲染条形码
function renderBarcode(control: AnyControl, data: any, baseStyle: string): string {
  const props = control.properties || {}
  const value = resolveBindingValue(props.dataBinding, data).formatted || props.value || '12345678'
  const barcodeType = props.barcodeType || 'CODE128'
  const formatMap: Record<string, string> = {
    CODE128: 'CODE128',
    CODE39: 'CODE39',
    EAN13: 'EAN13',
    UPC: 'UPC',
  }
  const format = formatMap[barcodeType] || 'CODE128'

  return `<div style="${baseStyle} display: flex; align-items: center; justify-content: center;">
    <svg class="barcode" data-value="${value}" data-format="${format}" data-showtext="${props.showText !== false}"></svg>
  </div>`
}

// 渲染二维码
function renderQRCode(control: AnyControl, data: any, baseStyle: string): string {
  const props = control.properties || {}
  const value = resolveBindingValue(props.dataBinding, data).formatted || props.value || 'QR'

  return `<div style="${baseStyle} display: flex; align-items: center; justify-content: center;">
    <canvas class="qrcode" data-value="${value}"></canvas>
  </div>`
}

// 渲染图片
function renderImage(control: AnyControl, baseStyle: string): string {
  const props = control.properties || {}
  const src = props.src || ''

  return `<div style="${baseStyle} display: flex; align-items: center; justify-content: center; overflow: hidden;">
    <img src="${src}" style="max-width: 100%; max-height: 100%;" />
  </div>`
}

// 渲染页码
function renderPageNumber(control: AnyControl, pageIndex: number, pageCount: number, baseStyle: string): string {
  const props = control.properties || {}
  const format = props.format || '第 {page} 页 / 共 {total} 页'

  const text = format
    .replace('{page}', String(pageIndex + 1))
    .replace('{total}', String(pageCount))

  return `<div style="${baseStyle} display: flex; align-items: center; justify-content: center;">${text}</div>`
}

// 渲染报表标题
function renderReportTitle(control: AnyControl, baseStyle: string): string {
  const props = control.properties || {}
  return `<div style="${baseStyle} display: flex; align-items: center; justify-content: center; font-size: 18pt; font-weight: bold;">${props.text || '报表标题'}</div>`
}

// 渲染日期时间
function renderDateTime(control: AnyControl, baseStyle: string): string {
  const props = control.properties || {}
  const format = props.format || 'yyyy-MM-dd HH:mm:ss'
  const now = new Date()

  const text = format
    .replace('yyyy', String(now.getFullYear()))
    .replace('MM', String(now.getMonth() + 1).padStart(2, '0'))
    .replace('dd', String(now.getDate()).padStart(2, '0'))
    .replace('HH', String(now.getHours()).padStart(2, '0'))
    .replace('mm', String(now.getMinutes()).padStart(2, '0'))
    .replace('ss', String(now.getSeconds()).padStart(2, '0'))

  return `<div style="${baseStyle} display: flex; align-items: center;">${text}</div>`
}

/**
 * 渲染单个页面
 */
function renderPage(
  controls: AnyControl[],
  data: any,
  pageIndex: number,
  pageCount: number,
  paper: PaperConfig
): string {
  const widthPx = mmToPx(paper.width)
  const heightPx = mmToPx(paper.height)

  let html = `<div class="report-page" style="width: ${widthPx}px; height: ${heightPx}px; position: relative; overflow: hidden; background: #fff;">`

  // 渲染每个控件
  for (const control of controls) {
    html += renderControl(control, data, pageIndex, pageCount)
  }

  html += '</div>'
  return html
}

/**
 * 生成报表 HTML
 */
export function generateReportHtml(
  template: ReportTemplate,
  data: any,
  options: ExportOptions = { format: 'html' }
): string {
  const { paper, controls } = template
  const pageWidthPx = mmToPx(paper.width)
  const pageHeightPx = mmToPx(paper.height)
  const marginTop = mmToPx(paper.margins.top)
  const marginRight = mmToPx(paper.margins.right)
  const marginBottom = mmToPx(paper.margins.bottom)
  const marginLeft = mmToPx(paper.margins.left)

  // 计算内容区域高度
  const contentHeightPx = pageHeightPx - marginTop - marginBottom

  // 检测是否需要分页(简单逻辑:所有控件都在一页内就不分页)
  const maxControlY = controls.reduce((max, c) => Math.max(max, c.y + c.height), 0)
  const needsPagination = mmToPx(maxControlY) > contentHeightPx

  let pageCount = 1
  let pageGroups: AnyControl[][] = [controls]

  if (needsPagination) {
    // 简单的控件级分页:按 Y 坐标分配到不同页面
    // 实际生产环境需要更复杂的算法
    pageGroups = splitControlsToPages(controls, contentHeightPx)
    pageCount = pageGroups.length
  }

  // 构建 HTML
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${template.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f0f0f0; }
    .report-page {
      margin: 10mm auto;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .report-page canvas { position: absolute; top: 0; left: 0; }
    @media print {
      body { background: #fff; }
      .report-page {
        margin: 0;
        box-shadow: none;
        page-break-after: always;
      }
    }
  </style>
</head>
<body>`

  for (let i = 0; i < pageGroups.length; i++) {
    const pageControls = pageGroups[i]
    html += renderPage(pageControls, data, i, pageCount, paper)
  }

  html += `
</body>
</html>`

  return html
}

/**
 * 将控件分配到不同页面
 */
function splitControlsToPages(controls: AnyControl[], pageHeightPx: number): AnyControl[][] {
  const pages: AnyControl[][] = []
  let currentPage: AnyControl[] = []
  let currentPageHeight = 0

  // 按 Y 坐标排序
  const sorted = [...controls].sort((a, b) => a.y - b.y)

  for (const control of sorted) {
    const controlTop = mmToPx(control.y)
    const controlBottom = controlTop + mmToPx(control.height)

    // 如果控件在当前页面放不下
    if (currentPageHeight + mmToPx(control.height) > pageHeightPx && currentPage.length > 0) {
      // 保存当前页,开始新页
      pages.push(currentPage)
      currentPage = []
      currentPageHeight = 0
    }

    currentPage.push(control)
    currentPageHeight += mmToPx(control.height)
  }

  // 最后一页
  if (currentPage.length > 0) {
    pages.push(currentPage)
  }

  return pages.length > 0 ? pages : [controls]
}

/**
 * 生成用于打印的 HTML(优化样式)
 */
export function generatePrintHtml(template: ReportTemplate, data: any): string {
  const html = generateReportHtml(template, data, { format: 'print' })

  // 在 </body> 前添加条码渲染脚本
  const barcodeScript = `
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // 渲染条形码
      document.querySelectorAll('svg.barcode').forEach(function(svg) {
        var value = svg.getAttribute('data-value');
        var format = svg.getAttribute('data-format') || 'CODE128';
        var showText = svg.getAttribute('data-showtext') !== 'false';
        try {
          JsBarcode(svg, value, {
            format: format,
            displayValue: showText,
            fontSize: 12,
            margin: 2
          });
        } catch(e) { console.warn('Barcode error:', e); }
      });

      // 渲染二维码
      document.querySelectorAll('canvas.qrcode').forEach(function(canvas) {
        var value = canvas.getAttribute('data-value');
        QRCode.toCanvas(canvas, value, {
          width: Math.min(canvas.parentElement.offsetWidth, canvas.parentElement.offsetHeight) || 80,
          margin: 1
        });
      });
    });
  </script>
  `

  return html.replace('</body>', barcodeScript + '</body>')
}

/**
 * 导出报表
 */
export async function exportReport(
  template: ReportTemplate,
  data: any,
  options: ExportOptions = { format: 'html' }
): Promise<Blob> {
  const html = generateReportHtml(template, data, options)

  if (options.format === 'html') {
    return new Blob([html], { type: 'text/html' })
  }

  if (options.format === 'pdf') {
    // 使用 html2canvas + jsPDF
    return generatePdf(html, template.name)
  }

  // 打印格式返回 HTML
  return new Blob([html], { type: 'text/html' })
}

/**
 * 生成 PDF
 */
async function generatePdf(html: string, filename: string): Promise<Blob> {
  // 创建临时 iframe
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) throw new Error('Cannot create iframe document')

  iframeDoc.open()
  iframeDoc.write(html)
  iframeDoc.close()

  // 等待内容加载
  await new Promise(resolve => {
    iframe.onload = resolve
    setTimeout(resolve, 1000)
  })

  // 使用 window.print 触发打印对话框
  // 实际生产环境应该用 jsPDF
  return new Blob([html], { type: 'text/html' })
}

/**
 * 打印报表
 */
export function printReport(template: ReportTemplate, data: any): void {
  const html = generatePrintHtml(template, data)

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert('请允许弹出窗口以进行打印')
    return
  }

  printWindow.document.write(html)
  printWindow.document.close()

  printWindow.onload = () => {
    printWindow.print()
  }
}
