/**
 * PrintBarcode —— 条形码控件（§5.7，bwip-js 离屏渲染）
 * 设计期用绑定路径占位文本渲染，运行期由渲染引擎注入真实值。
 */
import { FabricImage } from 'fabric'
import type { BarcodeControl, Segment, SegmentDisplayOpts } from '@op/types/control'
import { mm, readBaseGeometry, type IPrintObject } from './PrintObject'
import { drawBarcode } from '../barcode-draw'

export class PrintBarcode extends FabricImage implements IPrintObject {
  controlId: string
  controlType = 'barcode' as const
  zoneId?: string
  printable = true
  visibleIf?: string
  controlName?: string

  binding?: string
  textValue?: string
  exprValue?: string
  /** v2 segments 模式：与 ContentValueEditor 文本一致 */
  segments?: Segment[]
  contentType?: 'fixed' | 'variable' | 'expression'
  format = 'CODE128'
  showText = true
  /** ★ PR-D:用户调尺寸字段 */
  display?: SegmentDisplayOpts
  /**
   * ★ PR-D.1 bug fix:用户未设 display.widthMm/heightMm 时,regenerate 兜底用的原始控件
   *   几何(mm)。setElement(canvas) 会把 this.width 重置为 canvas 自然像素宽(典型 bwip-js
   *   30mm 输出 canvas ≈ 64px = 17mm),直接 px(this.width || 1) 返回 ~17mm 而非用户原始
   *   30mm → 设计画布变小。在 constructor + applyControlProps 同步刷新,作为可靠兜底。
   */
  baseWidthMm: number
  baseHeightMm: number

  constructor(control: BarcodeControl) {
    super(document.createElement('canvas'), {
      left: mm(control.left),
      top: mm(control.top),
      angle: control.angle ?? 0,
      lockMovementX: control.locked,
      lockMovementY: control.locked,
    })
    this.controlId = control.id
    this.contentType = control.contentType
    this.binding = control.binding
    this.textValue = control.value
    this.exprValue = control.expression
    this.segments = control.segments
    this.format = control.format ?? 'CODE128'
    this.showText = control.showText ?? true
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    // ★ PR-D:display 持久化
    this.display = control.display
    // ★ PR-D.1 bug fix:缓存原始控件几何(mm),regenerate 兜底用
    this.baseWidthMm = control.width
    this.baseHeightMm = control.height
    // 初始尺寸（未缩放），regenerate 会按它换算 scale
    this.set({ width: mm(control.width), height: mm(control.height) })
    void this.regenerate()
  }

  /** 设计期占位显示文本：v2 segments 模式优先（拼接 segments），老模板走 contentType 启发式 */
  private displayValue(): string | undefined {
    // ★ v2 segments 模式优先：有 segments 即按 segmentsToDisplayValue 拼接
    if (this.segments && this.segments.length) {
      return segmentsToDisplayValue(this.segments)
    }
    const m = this.contentType
    if (m === 'expression') return this.exprValue
    if (m === 'variable') return this.binding ? `{{${this.binding}}}` : undefined
    if (m === 'fixed') return this.textValue
    return this.textValue ?? (this.binding ? `{{${this.binding}}}` : undefined)
  }

  /** 重新渲染条码位图，并按控件几何缩放显示
   *
   * ★ PR-D:display.widthMm/heightMm 优先(用户在 properties panel 调过的尺寸);
   *   未设时退化到 control.width/height(老模板行为)。
   */
  async regenerate(): Promise<void> {
    const text = this.displayValue() ?? '0123456789'
    // 绑定占位符含中文/大括号无法编码，设计期用示例码代替
    const encodable = /[{}\u4e00-\u9fa5]/.test(text) ? 'DEMO123456' : text
    // \u2605 PR-D.1 bug fix:display \u4f18\u5148 \u2192 baseWidthMm/baseHeightMm \u515c\u5e95
    //   \u539f\u56e0:setElement(canvas) \u540e this.width \u88ab\u91cd\u7f6e\u4e3a canvas \u81ea\u7136\u50cf\u7d20\u5bbd
    //   (\u5178\u578b 30mm bwip-js \u8f93\u51fa canvas \u2248 64px = 17mm),px(this.width || 1)
    //   \u4f1a\u8fd4\u56de ~17mm \u800c\u975e\u7528\u6237\u539f\u59cb 30mm \u2192 \u8bbe\u8ba1\u753b\u5e03\u53d8\u5c0f\u3002
    //   \u7528 baseWidthMm \u76f4\u63a5\u62ff\u539f\u59cb\u63a7\u4ef6\u51e0\u4f55,\u4fdd\u8bc1\u515c\u5e95\u503c\u6052\u7b49\u4e8e control.width/height\u3002
    const wMm = this.display?.widthMm ?? this.baseWidthMm
    const hMm = this.display?.heightMm ?? this.baseHeightMm
    // 按控件几何反算条码条高度（mm）：条码条占 60%，剩 40% 留给文字行（textsize=12）+ 上下留白。
    // 这样 bwip-js 直接按目标尺寸渲染，canvas 自然高度 ≈ 控件高度，scaleY ≈ 1，文字不被压扁。
    const controlHeightMM = Math.max(1, hMm)
    const barHeightMM = Math.max(2, controlHeightMM * 0.6)
    const paddingMM = Math.max(0.5, controlHeightMM * 0.04)
    // 目标宽度（mm）：bwip-js 以 72dpi 换算像素（输出px = width_mm × 2.8346 × scale），
    // 而画布是 96dpi。传「控件宽mm × 96/72 ÷ scale」使输出自然宽 ≈ 控件 px 宽，
    // 于是 scaleX ≈ 1，条码条与数字都不被拉伸变形，且宽度独立可调。
    const widthMM = Math.max(1, wMm) * (96 / 72) / 2
    const canvas = await drawBarcode({
      format: this.format,
      text: encodable,
      showText: this.showText,
      barHeightMM,
      paddingMM,
      widthMM,
    })
    if (canvas) {
      this.setElement(canvas)
      // 宽高独立填满控件框（所见即所得）：
      // - scaleX = targetPxW/natW：宽度精确跟随 display.widthMm（缩窄即变窄，regenerate 不弹回）
      // - scaleY = targetPxH/natH：高度精确跟随 display.heightMm
      // 由于 widthMM/barHeightMM 已让自然尺寸 ≈ 目标尺寸，两个 scale 均 ≈ 1，变形可忽略。
      // ★ PR-D:目标 px 由 display 决定(mm → px @ 96dpi),不再用 this.width/this.height(老模板兜底)
      const targetPxW = mm(Math.max(1, wMm))
      const targetPxH = mm(Math.max(1, hMm))
      const natW = canvas.width || 1
      const natH = canvas.height || 1
      this.set({ scaleX: targetPxW / natW, scaleY: targetPxH / natH })
    }
    this.setCoords()
    this.canvas?.requestRenderAll()
  }

  toControl(): BarcodeControl {
    return {
      ...readBaseGeometry(this),
      type: 'barcode',
      contentType: this.contentType,
      binding: this.binding,
      value: this.textValue,
      expression: this.exprValue,
      segments: this.segments,
      format: this.format,
      showText: this.showText,
      printable: this.printable,
      visibleIf: this.visibleIf,
      name: this.controlName,
      // ★ PR-D:display 写回,确保 panel 改的尺寸不丢
      display: this.display,
    }
  }

  applyControlProps(control: BarcodeControl): void {
    this.contentType = control.contentType
    this.binding = control.binding
    this.textValue = control.value
    this.exprValue = control.expression
    this.segments = control.segments
    this.format = control.format ?? 'CODE128'
    this.showText = control.showText ?? true
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    // ★ PR-D:display 持久化,后续 regenerate 按它决定渲染尺寸
    this.display = control.display
    // ★ PR-D.1 bug fix:同步刷新 baseWidthMm/baseHeightMm(applyControlProps 时 geometry 可能变了)
    this.baseWidthMm = control.width
    this.baseHeightMm = control.height
    this.set({
      lockMovementX: control.locked,
      lockMovementY: control.locked,
      scaleX: 1,
      scaleY: 1,
      width: mm(control.width),
      height: mm(control.height),
    })
    void this.regenerate()
  }
}

/** segments → 文本（与 ContentValueEditor.segmentsToText 逻辑一致 —— field/expr 都包 {{ }}） */
function segmentsToDisplayValue(segments: Segment[]): string {
  return segments
    .map((s) => {
      if (s.kind === 'text') return s.value
      if (s.kind === 'field') return `{{${s.path}}}`
      return `{{${s.src}}}`
    })
    .join('')
}
