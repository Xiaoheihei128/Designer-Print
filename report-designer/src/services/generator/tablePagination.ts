// 表格分页处理器
// 处理表头重复、表尾固底、空白行填充

import type { TableControl, TableRowConfig } from '@/types/control'
import type { TablePaginationResult, TableDataRow } from './types'
import { resolveTableData } from './dataResolver'

// 表格高度计算器
function calculateTableRowHeight(
  rowConfig: TableRowConfig,
  defaultHeight: number
): number {
  if (rowConfig.height === 'auto') {
    // 自动高度：根据内容行数估算
    if (rowConfig.minHeight && rowConfig.maxHeight) {
      return (rowConfig.minHeight + rowConfig.maxHeight) / 2
    }
    return defaultHeight
  }
  return rowConfig.height || defaultHeight
}

/**
 * 计算表格内容能容纳的行数
 */
function calculateRowsPerPage(
  tableHeight: number,
  headerConfig: TableRowConfig | null,
  footerConfig: TableRowConfig | null,
  dataRowHeight: number,
  pageContentHeight: number
): number {
  let usedHeight = 0
  
  // 减去表头高度
  if (headerConfig) {
    usedHeight += calculateTableRowHeight(headerConfig, 10)
  }
  
  // 减去表尾高度
  if (footerConfig) {
    usedHeight += calculateTableRowHeight(footerConfig, 10)
  }
  
  const availableHeight = Math.min(pageContentHeight, tableHeight) - usedHeight
  
  if (availableHeight <= 0) return 0
  
  return Math.floor(availableHeight / dataRowHeight)
}

/**
 * 计算表头高度
 */
function getHeaderHeight(headerConfig: TableRowConfig | null): number {
  if (!headerConfig || !headerConfig.enabled) return 0
  return calculateTableRowHeight(headerConfig, 10)
}

/**
 * 计算表尾高度
 */
function getFooterHeight(footerConfig: TableRowConfig | null): number {
  if (!footerConfig || !footerConfig.enabled) return 0
  return calculateTableRowHeight(footerConfig, 10)
}

/**
 * 分页表格数据
 */
export function paginateTable(
  table: TableControl,
  data: any,
  pageHeight: number,
  margins: { top: number; bottom: number }
): TablePaginationResult {
  const props = table.properties
  const headerConfig = props.headerRow
  const dataRowConfig = props.dataRow
  const footerConfig = props.footerRow
  const fillConfig = props.fillEmptyRows
  
  // 获取数据数组
  const allRows = resolveTableData(data, props.dataBinding || '')
  
  // 计算高度
  const dataRowHeight = calculateTableRowHeight(dataRowConfig, 8)
  const headerHeight = getHeaderHeight(headerConfig)
  const footerHeight = getFooterHeight(footerConfig)
  
  // 可用内容高度
  const pageContentHeight = pageHeight - margins.top - margins.bottom
  
  // 计算每页能容纳的数据行数
  const rowsPerPage = calculateRowsPerPage(
    table.height,
    headerConfig?.enabled ? headerConfig : null,
    footerConfig?.enabled ? footerConfig : null,
    dataRowHeight,
    pageContentHeight
  )
  
  if (rowsPerPage <= 0) {
    return {
      headerHtml: '',
      footerHtml: '',
      pageGroups: []
    }
  }
  
  // 准备数据行
  let dataRows: TableDataRow[] = allRows.map((row, index) => ({
    index,
    data: row
  }))
  
  // 如果没有数据，应用空白行填充
  if (dataRows.length === 0 && fillConfig?.enabled) {
    const minEmptyRows = fillConfig.minEmptyRows || 0
    for (let i = 0; i < minEmptyRows; i++) {
      dataRows.push({ index: i, data: {} })
    }
  }
  
  // 分页
  const pageGroups: TableDataRow[][] = []
  
  if (dataRows.length > 0) {
    // 检查是否需要填满到表尾
    if (fillConfig?.enabled && fillConfig.fillToBottom) {
      // 计算需要的总行数
      const totalRowsNeeded = Math.max(
        fillConfig.minEmptyRows || 0,
        rowsPerPage * Math.ceil(dataRows.length / rowsPerPage)
      )
      
      // 补齐到刚好填满最后一页
      while (dataRows.length < totalRowsNeeded) {
        dataRows.push({ index: dataRows.length, data: {} })
      }
    }
    
    // 均匀分配到各页
    for (let i = 0; i < dataRows.length; i += rowsPerPage) {
      const group = dataRows.slice(i, i + rowsPerPage)
      
      // 如果是最后一页，且启用了填满到表尾
      if (fillConfig?.enabled && fillConfig.fillToBottom && i + rowsPerPage >= dataRows.length) {
        // 补齐空白行使表尾到达固定位置
        const pageHeight_mm = pageContentHeight
        const rowsFitted = group.length
        const currentHeight = rowsFitted * dataRowHeight
        const targetHeight = pageHeight_mm - headerHeight - footerHeight
        const rowsNeeded = Math.ceil(targetHeight / dataRowHeight)
        
        while (group.length < rowsNeeded) {
          group.push({ index: group.length, data: {} })
        }
      }
      
      pageGroups.push(group)
    }
  }
  
  return {
    headerHtml: '', // HTML 将在渲染阶段生成
    footerHtml: '',
    pageGroups
  }
}

/**
 * 判断某一行是否应该在页顶部重复
 */
export function shouldRepeatHeader(
  headerConfig: TableRowConfig | null,
  isFirstPage: boolean,
  isNewPageGroup: boolean
): boolean {
  if (!headerConfig || !headerConfig.enabled) return false
  
  // 第一页总是显示表头
  if (isFirstPage) return true
  
  // 如果配置了每页重复
  if (headerConfig.repeatOnEachPage) return true
  
  return false
}

/**
 * 判断表尾是否应该显示
 */
export function shouldShowFooter(
  footerConfig: TableRowConfig | null,
  isLastPage: boolean,
  pageCount: number
): boolean {
  if (!footerConfig || !footerConfig.enabled) return false
  
  if (footerConfig.position === 'follow') {
    // 跟随模式：只在最后一页显示
    return isLastPage
  }
  
  if (footerConfig.position === 'sticky') {
    // 固底模式
    if (footerConfig.stickToLastPage) {
      return isLastPage
    }
    return true // 每页都显示
  }
  
  return false
}

/**
 * 计算表头/表尾位置偏移
 */
export function calculateFooterOffset(
  footerConfig: TableRowConfig | null,
  tableBottom: number,
  pageBottom: number
): number {
  if (!footerConfig || !footerConfig.enabled) return 0
  
  const minSpace = footerConfig.minSpaceFromBottom || 0
  return pageBottom - minSpace - tableBottom
}
