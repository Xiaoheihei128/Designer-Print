// 控件类型枚举
export type ControlType =
  | 'Label'
  | 'TextField'
  | 'TextArea'
  | 'Image'
  | 'Line'
  | 'Rectangle'
  | 'Barcode'
  | 'QRCode'
  | 'Table'
  | 'StaticTable'
  | 'PageBreak'
  | 'PageNumber'
  | 'ReportTitle'
  | 'DateTime'

// 控件分类
export type ControlCategory = 'static' | 'data' | 'auto'

// 控件元信息
export interface ControlMeta {
  type: ControlType
  name: string
  category: ControlCategory
  icon: string
  description: string
}

// 所有控件的元信息定义
export const CONTROL_METAS: ControlMeta[] = [
  { type: 'Label', name: '静态文本', category: 'static', icon: 'Edit', description: '静态文本，用于标题、说明文字' },
  { type: 'TextField', name: '数据文本', category: 'data', icon: 'Edit', description: '数据绑定文本' },
  { type: 'TextArea', name: '多行文本', category: 'data', icon: 'Document', description: '多行文本输入框' },
  { type: 'Image', name: '图片', category: 'static', icon: 'Picture', description: '图片，支持 Logo、签名图' },
  { type: 'Line', name: '线条', category: 'static', icon: 'Minus', description: '水平/垂直线条' },
  { type: 'Rectangle', name: '矩形', category: 'static', icon: 'Box', description: '矩形/圆角矩形' },
  { type: 'Barcode', name: '条形码', category: 'data', icon: 'Tickets', description: '条形码' },
  { type: 'QRCode', name: '二维码', category: 'data', icon: 'Grid', description: '二维码' },
  { type: 'Table', name: '表格', category: 'data', icon: 'List', description: '动态数据表格' },
  { type: 'StaticTable', name: '静态表格', category: 'static', icon: 'Grid', description: '静态表格，每格独立绑定字段' },
  { type: 'PageBreak', name: '分页符', category: 'static', icon: 'Bottom', description: '分页符' },
  { type: 'PageNumber', name: '页码', category: 'auto', icon: 'Document', description: '页码，自动生成' },
  { type: 'ReportTitle', name: '报表标题', category: 'auto', icon: 'Document', description: '报表标题' },
  { type: 'DateTime', name: '日期时间', category: 'auto', icon: 'Clock', description: '当前日期时间' },
]

// 基础控件属性
export interface BaseControl {
  id: string
  type: ControlType
  name: string
  x: number          // mm
  y: number          // mm
  width: number      // mm
  height: number     // mm
  zIndex: number
  locked: boolean
  visible: boolean
}

// Label 控件
export interface LabelControl extends BaseControl {
  type: 'Label'
  properties: LabelProperties
}

export interface LabelProperties {
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  color: string
  backgroundColor: string
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
}

// TextField 控件
export interface TextFieldControl extends BaseControl {
  type: 'TextField'
  properties: TextFieldProperties
}

export interface TextFieldProperties {
  dataBinding: string
  format: string
  nullValue: string
  fontFamily: string
  fontSize: number
  color: string
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
}

// TextArea 控件
export interface TextAreaControl extends BaseControl {
  type: 'TextArea'
  properties: TextAreaProperties
}

export interface TextAreaProperties {
  dataBinding: string
  placeholder: string
  fontFamily: string
  fontSize: number
  color: string
  backgroundColor: string
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
}

// Image 控件
export interface ImageControl extends BaseControl {
  type: 'Image'
  properties: ImageProperties
}

export interface ImageProperties {
  src: string
  dataBinding?: string
  fit: 'contain' | 'cover' | 'fill' | 'none'
}

// Line 控件
export interface LineControl extends BaseControl {
  type: 'Line'
  properties: LineProperties
}

export interface LineProperties {
  direction: 'horizontal' | 'vertical'
  strokeStyle: 'solid' | 'dashed' | 'dotted'
  strokeWidth: number
  color: string
}

// Rectangle 控件
export interface RectangleControl extends BaseControl {
  type: 'Rectangle'
  properties: RectangleProperties
}

export interface RectangleProperties {
  borderStyle: 'none' | 'thin' | 'medium' | 'thick'
  borderColor: string
  fillColor: string
  cornerRadius: number
}

// Barcode 控件
export interface BarcodeControl extends BaseControl {
  type: 'Barcode'
  properties: BarcodeProperties
}

export interface BarcodeProperties {
  dataBinding: string
  barcodeType: 'CODE128' | 'CODE39' | 'EAN13' | 'UPC'
  showText: boolean
  barHeight: number
}

// QRCode 控件
export interface QRCodeControl extends BaseControl {
  type: 'QRCode'
  properties: QRCodeProperties
}

export interface QRCodeProperties {
  dataBinding: string
  size: number
}

// Table 控件
export interface TableControl extends BaseControl {
  type: 'Table'
  properties: TableProperties
}

export interface TableProperties {
  dataBinding: string
  border: {
    style: 'none' | 'solid' | 'dashed' | 'dotted'
    color: string
    width: number  // mm
  }
  columns: TableColumn[]
  headerRow: TableRowConfig
  dataRow: TableDataRowConfig
  fillEmptyRows: FillEmptyRowsConfig
  footerRow: TableRowConfig
}

export interface TableColumn {
  id: string
  title: string
  field: string
  width: number
  minWidth: number
  align: 'left' | 'center' | 'right'
  format?: string  // 数值格式，如 {0:N2}
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  textColor?: string
  backgroundColor?: string
}

export interface TableRowConfig {
  enabled: boolean
  height: 'auto' | number
  minHeight?: number
  maxHeight?: number
  position?: 'sticky' | 'follow'
  repeatOnEachPage?: boolean
  stickToEachPage?: boolean
  stickToLastPage?: boolean
  minSpaceFromBottom?: number
  backgroundColor?: string
}

export interface TableDataRowConfig extends Omit<TableRowConfig, 'position' | 'repeatOnEachPage' | 'stickToEachPage' | 'stickToLastPage' | 'minSpaceFromBottom'> {
  minRows: number
  maxRows: number
}

export interface FillEmptyRowsConfig {
  enabled: boolean
  minEmptyRows: number
  fillToBottom: boolean
}

// StaticTable 控件（静态表格，完全自定义，无表头列概念，每格可独立设置内容和边框）
export interface StaticTableControl extends BaseControl {
  type: 'StaticTable'
  properties: StaticTableProperties
}

export interface StaticTableProperties {
  rows: number
  cols: number
  defaultRowHeight: number  // mm
  defaultColWidth: number   // mm
  defaultBorderWidth: number  // 默认边框粗细 (px)
  defaultBorderColor: string  // 默认边框颜色
  defaultBorderStyle: 'none' | 'solid' | 'dashed' | 'dotted'
  cells: StaticTableCell[]  // 平铺数组，每个 cell 可跨多行多列
  colWidths?: number[]      // 每列自定义宽度 (mm)，索引对应列
  rowHeights?: number[]     // 每行自定义高度 (mm)，索引对应行
  // 动态重复行
  repeatBinding?: string    // 数据源路径，如 'Items' 或 'Header.Details'
  repeatRowStart?: number   // 重复起始行（0-based），该行内容作为模板
  repeatRowEnd?: number     // 重复结束行（0-based），含此行
  repeatExpand?: 'down' | 'up'  // 展开方向，默认向下
  // 重复行固定份数（当无数据绑定时使用）
  repeatCount?: number
  // 斑马线（交替行颜色）
  alternatingRows?: boolean
  alternatingRowColor?: string   // 偶数行背景色（奇数行透明）
}

// 单元格内容类型
export type StaticTableCellContent =
  | { type: 'text'; value?: string; field?: string; format?: string }     // 文本
  | { type: 'image'; src?: string; field?: string; fit?: 'cover' | 'contain' | 'fill' }   // 图片
  | { type: 'qrcode'; value?: string; field?: string; size?: number }      // 二维码
  | { type: 'barcode'; value?: string; field?: string; format?: string; showText?: boolean } // 条形码

export interface StaticTableCell {
  id: string
  row: number          // 起始行 (0-based)
  col: number          // 起始列 (0-based)
  rowspan?: number     // 跨行数，默认 1
  colspan?: number     // 跨列数，默认 1
  width?: number       // 自定义列宽 (mm)，覆盖默认列宽
  minWidth?: number    // 最小宽度 (mm)
  height?: number      // 自定义行高 (mm)，覆盖默认行高
  minHeight?: number   // 最小行高 (mm)
  content?: StaticTableCellContent
  // 边框（可选，不设置则使用默认）
  borderTop?: { width?: number; style?: string; color?: string }
  borderRight?: { width?: number; style?: string; color?: string }
  borderBottom?: { width?: number; style?: string; color?: string }
  borderLeft?: { width?: number; style?: string; color?: string }
  // 样式
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  backgroundColor?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline'
  lineHeight?: number
  textColor?: string
  padding?: number  // 内边距 (mm)
}

// PageBreak 控件
export interface PageBreakControl extends BaseControl {
  type: 'PageBreak'
  properties: PageBreakProperties
}

export interface PageBreakProperties {
  label: string
}

// PageNumber 控件
export interface PageNumberControl extends BaseControl {
  type: 'PageNumber'
  properties: PageNumberProperties
}

export interface PageNumberProperties {
  format: string
  fontSize: number
  color: string
}

// ReportTitle 控件
export interface ReportTitleControl extends BaseControl {
  type: 'ReportTitle'
  properties: ReportTitleProperties
}

export interface ReportTitleProperties {
  fontSize: number
  fontWeight: 'normal' | 'bold'
  color: string
  align: 'left' | 'center' | 'right'
}

// DateTime 控件
export interface DateTimeControl extends BaseControl {
  type: 'DateTime'
  properties: DateTimeProperties
}

export interface DateTimeProperties {
  format: string
  fontSize: number
  color: string
}

// 联合类型
export type AnyControl =
  | LabelControl
  | TextFieldControl
  | TextAreaControl
  | ImageControl
  | LineControl
  | RectangleControl
  | BarcodeControl
  | QRCodeControl
  | TableControl
  | StaticTableControl
  | PageBreakControl
  | PageNumberControl
  | ReportTitleControl
  | DateTimeControl

// 创建默认属性工厂函数
export function createDefaultProperties(type: ControlType): any {
  switch (type) {
    case 'Label':
      return {
        text: '文本',
        fontFamily: '思源黑体',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#000000',
        backgroundColor: 'transparent',
        textAlign: 'left',
        verticalAlign: 'middle',
        lineHeight: 1.2,
      }
    case 'TextField':
      return {
        dataBinding: '',
        format: '',
        nullValue: '—',
        fontFamily: '思源黑体',
        fontSize: 10,
        color: '#000000',
        textAlign: 'left',
        verticalAlign: 'middle',
      }
    case 'TextArea':
      return {
        dataBinding: '',
        placeholder: '请输入...',
        fontFamily: '思源黑体',
        fontSize: 10,
        color: '#000000',
        backgroundColor: '#ffffff',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.5,
      }
    case 'Image':
      return {
        src: '',
        dataBinding: '',
        fit: 'contain',
      }
    case 'Line':
      return {
        direction: 'horizontal',
        strokeStyle: 'solid',
        strokeWidth: 1,
        color: '#000000',
      }
    case 'Rectangle':
      return {
        borderStyle: 'thin',
        borderColor: '#000000',
        fillColor: 'transparent',
        cornerRadius: 0,
      }
    case 'Barcode':
      return {
        dataBinding: '',
        barcodeType: 'CODE128',
        showText: true,
        barHeight: 10,
      }
    case 'QRCode':
      return {
        dataBinding: '',
        size: 30,
      }
    case 'Table':
      return {
        dataBinding: '',
        border: {
          style: 'solid',
          color: '#000000',
          width: 1,
        },
        columns: [
          { id: 'col_1', title: '列1', field: 'Field1', width: 30, minWidth: 10, align: 'left' },
          { id: 'col_2', title: '列2', field: 'Field2', width: 30, minWidth: 10, align: 'left' },
          { id: 'col_3', title: '列3', field: 'Field3', width: 30, minWidth: 10, align: 'left' },
        ],
        headerRow: {
          enabled: true,
          height: 'auto',
          minHeight: 8,
          maxHeight: 20,
          repeatOnEachPage: true,
          position: 'sticky',
          backgroundColor: '#E0E0E0',
        },
        dataRow: {
          height: 'auto',
          minHeight: 6,
          maxHeight: 30,
          minRows: 0,
          maxRows: 100,
        },
        fillEmptyRows: {
          enabled: true,
          minEmptyRows: 10,
          fillToBottom: true,
        },
        footerRow: {
          enabled: true,
          height: 'auto',
          minHeight: 10,
          maxHeight: 50,
          position: 'sticky',
          stickToEachPage: false,
          stickToLastPage: true,
          minSpaceFromBottom: 10,
          backgroundColor: '#F5F5F5',
        },
      }
    case 'StaticTable': {
      // 默认 4 行 × 4 列，空表格，用户自行定义
      const rows = 4
      const cols = 4
      const cells: any[] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells.push({
            id: `st_${Date.now()}_${r}_${c}`,
            row: r,
            col: c,
            rowspan: 1,
            colspan: 1,
          })
        }
      }
      return {
        rows,
        cols,
        defaultRowHeight: 10,
        defaultColWidth: 30,
        defaultBorderWidth: 1,
        defaultBorderColor: '#000000',
        defaultBorderStyle: 'solid',
        cells,
      }
    }
    case 'PageBreak':
      return { label: '分页符' }
    case 'PageNumber':
      return {
        format: '第 {page} 页 / 共 {total} 页',
        fontSize: 9,
        color: '#000000',
      }
    case 'ReportTitle':
      return {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#000000',
        align: 'center',
      }
    case 'DateTime':
      return {
        format: 'yyyy-MM-dd HH:mm:ss',
        fontSize: 10,
        color: '#000000',
      }
    default:
      return {}
  }
}

// 创建默认控件
export function createDefaultControl(type: ControlType, x: number, y: number): AnyControl {
  const id = `ctrl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const meta = CONTROL_METAS.find(m => m.type === type)!

  const base = {
    id,
    type,
    name: `${meta.name}_${id.slice(-4)}`,
    x,
    y,
    width: type === 'Table' || type === 'StaticTable' ? 120 : 30,
    height: type === 'Table' || type === 'StaticTable' ? 60 : 10,
    zIndex: 1,
    locked: false,
    visible: true,
  }

  return {
    ...base,
    properties: createDefaultProperties(type),
  } as AnyControl
}
