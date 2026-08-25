// 报表导出服务
// 统一导出入口

import type { ReportTemplate } from '@/types/template'
import type { ExportOptions } from './types'
import { exportReport, generateReportHtml } from './reportGenerator'
import { exportToPdf, printReport as printReportCore } from '../pdfExporter'

export { ExportOptions }
export { generateReportHtml }
export { exportToPdf }

/**
 * 导出报表为 HTML 文件
 */
export function exportAsHtml(template: ReportTemplate, data: any): void {
  const blob = exportReport(template, data, { format: 'html' })
  downloadBlob(blob, `${template.name || 'report'}.html`)
}

/**
 * 导出报表为 PDF 文件
 */
export async function exportAsPdf(template: ReportTemplate, data: any, filename?: string): Promise<void> {
  await exportToPdf(template, data, filename)
}

/**
 * 打印报表
 */
export function print(template: ReportTemplate, data: any): void {
  printReportCore(template, data)
}

/**
 * 预览报表（在新窗口打开）
 */
export function preview(template: ReportTemplate, data: any): Window | null {
  const html = generateReportHtml(template, data, { format: 'html' })
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    alert('请允许弹出窗口以进行预览')
    return null
  }
  previewWindow.document.write(html)
  previewWindow.document.close()
  return previewWindow
}

/**
 * 下载 Blob 为文件
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
