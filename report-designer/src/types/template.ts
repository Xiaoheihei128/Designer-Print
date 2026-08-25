import type { AnyControl } from './control'

// 纸张方向
export type Orientation = 'portrait' | 'landscape'

// 预设纸张尺寸
export interface PaperSize {
  name: string
  width: number   // mm
  height: number  // mm
}

export const PAPER_SIZES: PaperSize[] = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'A4横向', width: 297, height: 210 },
  { name: 'A3', width: 297, height: 420 },
  { name: 'A3横向', width: 420, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'Letter', width: 216, height: 279 },
  { name: 'Legal', width: 216, height: 356 },
]

// 页面设置
export interface PaperConfig {
  size: string
  width: number
  height: number
  unit: 'mm'
  orientation: Orientation
  margins: {
    top: number
    bottom: number
    left: number
    right: number
  }
}

// 页面
export interface Page {
  id: number
  background: string
}

// 匹配规则
export interface MatchRule {
  field: string
  operator: string
  value: string
  priority: number
}

// 报表模板
export interface ReportTemplate {
  id: number
  version: number
  name: string
  category: 'RawMaterial' | 'FinishedProduct' | 'SemiFinished' | 'Package' | 'Other'
  description: string
  paper: PaperConfig
  controls: AnyControl[]
  pages: Page[]
  isActive: boolean
  matchRules: MatchRule[]
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

// 模板分类选项
export const TEMPLATE_CATEGORIES = [
  { value: 'RawMaterial', label: '原料检验报告' },
  { value: 'FinishedProduct', label: '成品检验报告' },
  { value: 'SemiFinished', label: '半成品检验报告' },
  { value: 'Package', label: '包材检验报告' },
  { value: 'Other', label: '其他' },
]

// 创建默认模板
export function createDefaultTemplate(): ReportTemplate {
  return {
    id: 0,
    version: 1,
    name: '新模板',
    category: 'Other',
    description: '',
    paper: {
      size: 'A4',
      width: 210,
      height: 297,
      unit: 'mm',
      orientation: 'portrait',
      margins: {
        top: 20,
        bottom: 20,
        left: 20,
        right: 20,
      },
    },
    controls: [],
    pages: [{ id: 1, background: '#FFFFFF' }],
    isActive: true,
    matchRules: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    updatedAt: new Date().toISOString(),
    updatedBy: 'admin',
  }
}
