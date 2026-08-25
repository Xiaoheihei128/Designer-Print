// PDF 导出服务
// 使用 html2canvas + jsPDF 将报表导出为 PDF

import type { ReportTemplate } from '@/types/template'
import { generateReportHtml } from './generator/reportGenerator'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

// mm 转 px (96 DPI)
const MM_TO_PX = 96 / 25.4

/**
 * 导出报表为 PDF
 */
export async function exportToPdf(
  template: ReportTemplate,
  data: any,
  filename?: string
): Promise<void> {
  // 生成 HTML
  const html = generateReportHtml(template, data, { format: 'html' })
  
  // 创建隐藏的 iframe
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:absolute;width:210mm;height:297mm;left:-9999px;top:0;visibility:hidden;'
  document.body.appendChild(iframe)
  
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) {
    document.body.removeChild(iframe)
    throw new Error('Cannot create iframe document')
  }
  
  iframeDoc.open()
  iframeDoc.write(html)
  iframeDoc.close()
  
  // 等待内容加载和条码渲染
  await new Promise<void>(resolve => {
    iframe.onload = () => setTimeout(resolve, 2000)
    // 超时保护
    setTimeout(resolve, 5000)
  })
  
  // 等待条码渲染
  await waitForBarcodes(iframeDoc)
  
  // 获取页面尺寸
  const pageWidth = template.paper.width
  const pageHeight = template.paper.height
  
  // 创建 PDF
  const orientation = template.paper.orientation === 'landscape' ? 'l' : 'p'
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [pageWidth, pageHeight]
  })
  
  // 获取所有页面
  const pages = iframeDoc.querySelectorAll('.report-page')
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as HTMLElement
    
    if (i > 0) {
      pdf.addPage()
    }
    
    try {
      // 将页面转换为 canvas
      const canvas = await html2canvas(page, {
        scale: 2, // 提高清晰度
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: page.offsetWidth,
        height: page.offsetHeight,
      })
      
      // 添加到 PDF
      const imgData = canvas.toDataURL('image/jpeg', 0.95)
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight)
    } catch (e) {
      console.error('Page render error:', e)
      // 继续处理下一页
    }
  }
  
  // 清理
  document.body.removeChild(iframe)
  
  // 下载
  pdf.save(filename || `${template.name || 'report'}.pdf`)
}

/**
 * 等待条码渲染完成
 */
function waitForBarcodes(doc: Document): Promise<void> {
  return new Promise(resolve => {
    // 检查是否已经有渲染好的条码
    const barcodes = doc.querySelectorAll('svg.barcode')
    const qrcodes = doc.querySelectorAll('canvas.qrcode')
    
    let waitCount = 0
    const maxWait = 20 // 最多等待 2 秒
    
    function check() {
      // 检查是否有未渲染的条码（没有 viewBox 属性的就是未渲染）
      const unrendered = Array.from(barcodes).filter(b => !b.getAttribute('viewBox'))
      const unrenderedQR = Array.from(qrcodes).filter(q => q.width === 0 || q.height === 0)
      
      if (unrendered.length === 0 && unrenderedQR.length === 0) {
        resolve()
      } else if (waitCount < maxWait) {
        waitCount++
        setTimeout(check, 100)
      } else {
        resolve() // 超时后继续
      }
    }
    
    check()
  })
}

/**
 * 直接打印（触发浏览器打印）
 */
export function printReport(template: ReportTemplate, data: any): void {
  const html = generateReportHtml(template, data, { format: 'print' })
  
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
