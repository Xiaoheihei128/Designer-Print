// 报表生成器类型定义

import type { ReportTemplate, PaperConfig } from '@/types/template'
import type { AnyControl, TableControl, TableRowConfig } from '@/types/control'

// 渲染上下文
export interface RenderContext {
  template: ReportTemplate
  data: any
  pageIndex: number
  pageCount: number
  controls: AnyControl[]
  paper: PaperConfig
}

// 页面渲染结果
export interface PageRenderResult {
  pageIndex: number
  html: string
  height: number
}

// 表格数据行
export interface TableDataRow {
  index: number
  data: any
}

// 表格分页结果
export interface TablePaginationResult {
  headerHtml: string
  footerHtml: string
  pageGroups: TableDataRow[][]
}

// 导出选项
export interface ExportOptions {
  format: 'html' | 'pdf' | 'print'
  pageRange?: 'all' | number[]
  showBackground?: boolean
  inlineCss?: boolean
}

// 绑定值解析结果
export interface ResolvedValue {
  value: any
  formatted: string
  isNull: boolean
}

// 数据路径解析
export interface DataPath {
  segments: string[]
  root: string
}
