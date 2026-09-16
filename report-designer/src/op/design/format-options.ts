/**
 * 单元格数据格式 —— 属性面板 / 单元格工具栏共用的 UI 选项与默认值。
 * 类型定义见 src/types/control.ts 的 CellFormat / CellFormatKind；
 * 实际格式化由 core/layout-engine/expression.ts 的 formatCellValue 完成（与 `{{field | date:'...'}}` 过滤器等价）。
 */
import type { CellFormat, CellFormatKind } from '@op/types/control'

/** 格式类型下拉选项 */
export const formatKindOptions: Array<{ label: string; value: CellFormatKind }> = [
  { label: '默认（不格式化）', value: 'none' },
  { label: '文本', value: 'text' },
  { label: '日期', value: 'date' },
  { label: '整数', value: 'int' },
  { label: '小数', value: 'decimal' },
  { label: '货币', value: 'currency' },
  { label: '百分比', value: 'percent' },
  { label: '二维码', value: 'qrcode' },
  { label: '条形码', value: 'barcode' },
  { label: '图片', value: 'image' },
]

/** 日期模板预设（pattern 即 formatDate 的模板语法） */
export const datePatternOptions: Array<{ label: string; value: string }> = [
  { label: '2026-08-11（年-月-日）', value: 'YYYY-MM-DD' },
  { label: '2026/08/11（年/月/日）', value: 'YYYY/MM/DD' },
  { label: '2026年08月11日', value: 'YYYY年MM月DD日' },
  { label: '08/11/2026（美式 月/日/年）', value: 'MM/DD/YYYY' },
  { label: '11/08/2026（欧式 日/月/年）', value: 'DD/MM/YYYY' },
  { label: '2026-08-11 14:30（带时间）', value: 'YYYY-MM-DD HH:mm' },
  { label: '自定义…', value: '__custom__' },
]

/** 货币代码选项（与 expression.ts 的 CURRENCY_SYMBOL 对应） */
export const currencyCodeOptions: Array<{ label: string; value: string }> = [
  { label: '人民币 CNY（¥）', value: 'CNY' },
  { label: '美元 USD（$）', value: 'USD' },
  { label: '欧元 EUR（€）', value: 'EUR' },
  { label: '英镑 GBP（£）', value: 'GBP' },
  { label: '港币 HKD（HK$）', value: 'HKD' },
  { label: '日元 JPY（¥）', value: 'JPY' },
]

/** 按类型生成该种类的默认格式（用户第一次选择某类型时套用） */
export function makeFormat(kind: CellFormatKind): CellFormat {
  switch (kind) {
    case 'date':
      return { kind, pattern: 'YYYY-MM-DD' }
    case 'int':
      return { kind, thousands: true }
    case 'decimal':
      return { kind, digits: 2, thousands: true }
    case 'currency':
      return { kind, code: 'CNY', digits: 2, thousands: true }
    case 'percent':
      return { kind, digits: 2 }
    case 'qrcode':
      // 段级二维码默认：M 纠错 + scaleFactor=1(30mm×30mm 基准)
      // ★ PR-D:scaleFactor 优先于 fitMode 走倍率路径,确保新建段就有明确尺寸
      //   (不设 scaleFactor 时 lockRatio 分支会用 naturalDims 兜底,但显式写更稳)
      return { kind, errorLevel: 'M', display: { scaleFactor: 1, fitMode: 'auto' } }
    case 'barcode':
      // 段级条形码默认：CODE128 + 显示数字 + fitMode='auto'（同 qrcode）
      return { kind, bcid: 'code128', showText: true, display: { fitMode: 'auto' } }
    case 'image':
      // 段级图片默认：contain 模式 + fitMode='auto'（与 qrcode/barcode 对齐）
      return { kind, fit: 'contain', display: { fitMode: 'auto' } }
    case 'none':
    case 'text':
    default:
      return { kind: 'none' }
  }
}

export function needsPattern(kind: CellFormatKind | undefined): boolean {
  return kind === 'date'
}
export function needsDigits(kind: CellFormatKind | undefined): boolean {
  return kind === 'int' || kind === 'decimal' || kind === 'currency' || kind === 'percent'
}
export function needsCode(kind: CellFormatKind | undefined): boolean {
  return kind === 'currency'
}
export function supportsThousands(kind: CellFormatKind | undefined): boolean {
  return kind === 'int' || kind === 'decimal' || kind === 'currency'
}

/** ★ 段级形态专属谓词：UI 条件渲染子控件用 */
export function needsErrorLevel(kind: CellFormatKind | undefined): boolean {
  return kind === 'qrcode'
}
export function needsBcid(kind: CellFormatKind | undefined): boolean {
  return kind === 'barcode'
}
export function needsBarcodeShowText(kind: CellFormatKind | undefined): boolean {
  return kind === 'barcode'
}
export function needsFit(kind: CellFormatKind | undefined): boolean {
  return kind === 'image'
}
/** 公共：是否需要 display 几何配置（widthMm/heightMm） */
export function needsDisplaySize(kind: CellFormatKind | undefined): boolean {
  return kind === 'qrcode' || kind === 'barcode' || kind === 'image'
}

/** bwip-js bcid 常用选项（与 BarcodeControl.format 同语义） */
export const barcodeBcidOptions: Array<{ label: string; value: string }> = [
  { label: 'CODE128（通用）', value: 'code128' },
  { label: 'EAN13（商品码）', value: 'ean13' },
  { label: 'EAN8（短商品码）', value: 'ean8' },
  { label: 'CODE39（工业）', value: 'code39' },
  { label: 'UPC（北美商品）', value: 'upca' },
  { label: 'ITF14（物流）', value: 'itf14' },
  { label: 'CODE93（紧凑）', value: 'code93' },
]

/** 二维码纠错等级选项 */
export const qrErrorLevelOptions: Array<{ label: string; value: 'L' | 'M' | 'Q' | 'H' }> = [
  { label: 'L（低 7%）', value: 'L' },
  { label: 'M（中 15%）', value: 'M' },
  { label: 'Q（较高 25%）', value: 'Q' },
  { label: 'H（高 30%）', value: 'H' },
]

/** 图片 fit 选项 */
export const imageFitOptions: Array<{ label: string; value: 'contain' | 'cover' | 'fill' | 'none' }> = [
  { label: 'contain（完整显示）', value: 'contain' },
  { label: 'cover（裁剪填满）', value: 'cover' },
  { label: 'fill（拉伸填满）', value: 'fill' },
  { label: 'none（原尺寸）', value: 'none' },
]

/** 由数据源字段类型推荐一个默认格式类型（仅作 UI 提示，不直接落库） */
export function suggestKindByFieldType(type: string | undefined): CellFormatKind | null {
  if (type === 'date') return 'date'
  if (type === 'number') return 'decimal'
  return null
}
