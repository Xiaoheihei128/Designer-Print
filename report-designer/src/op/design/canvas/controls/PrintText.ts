/**
 * PrintText —— 文本控件（《设计方案》§5.2 / §5.3）
 * 基于 fabric.Textbox：对齐/字体/颜色均为原生属性。
 * 字号协议层是 pt，Fabric 用 px，此处统一换算。
 */
import { Textbox } from 'fabric'
import type { Segment, TextControl, TextStyle } from '@op/types/control'
import { ptToPx, pxToPt } from '@op/core/units'
import { segmentsToText, textToSegments } from '@op/design/text-segments'
import { mm, px, readBaseGeometry, round2, type IPrintObject } from './PrintObject'

/** 画布文本编辑退出事件载荷，由 CanvasDesigner 注入回调透传到 store */
export interface PrintTextEditedPayload {
  controlId: string
  rawText: string
  segments: Segment[]
}

export class PrintText extends Textbox implements IPrintObject {
  controlId: string
  controlType = 'text' as const
  zoneId?: string

  /** 协议 extras（设计期保留，显示文本只是占位） */
  binding?: string
  expression?: string
  contentType?: TextControl['contentType']
  controlFormat?: TextControl['format']
  printable = true
  visibleIf?: string
  controlName?: string

  /**
   * 编辑退出时反向 parse 的目标回调（由 CanvasDesigner.addControl 注入）。
   * 不直接调 store —— CanvasDesigner 是 fabric ↔ store 的唯一桥梁，画布层不持有 store 引用。
   * 仅在 segments 模式下生效（其他模式下 displayText 已经和 store 同步）。
   */
  private _canvasTextListener?: (info: PrintTextEditedPayload) => void
  /** 编辑退出 diff 守卫：保存"上次文本"，raw 与之相同时直接 return，避免无意义回写 */
  private _origDisplayText = ''

  constructor(control: TextControl) {
    super(displayText(control), {
      left: mm(control.left),
      top: mm(control.top),
      width: mm(control.width),
      angle: control.angle ?? 0,
      ...styleToFabric(control.style),
      lockMovementX: control.locked,
      lockMovementY: control.locked,
    })
    this.controlId = control.id
    this.zoneId = undefined
    this.binding = control.binding
    this.expression = control.expression
    this.contentType = control.contentType
    this.controlFormat = control.format
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name

    // v2 segments 模式：双击进入 fabric 编辑态、失焦退出时把 fabric.text 反向解析
    // 为 segments，回写到 store（CanvasDesigner 注入的 listener）。否则 fabric.text
    // 改了 store 完全不知道 → 预览丢失 + 右侧 ContentValueEditor 不同步。
    // 仅 segments 模式需要监听，老 schema（contentType=value 自由编辑）由 fabric 原生
    // object:modified 走 toControl 回写 value，已经工作。
    if (control.segments && control.segments.length) {
      this._origDisplayText = this.text
      this.on('editing:exited', () => {
        const raw = this.text
        if (raw === this._origDisplayText) return // 用户未改 → 跳过避免空转
        const next = textToSegments(raw)
        this._canvasTextListener?.({ controlId: this.controlId, rawText: raw, segments: next })
        this._origDisplayText = raw
      })
    }
  }

  /**
   * CanvasDesigner.addControl 调一次：把"反向 parse → store"回调注入进来。
   * 一个 PrintText 实例只 attach 一次；applyControlProps 不重置此字段。
   */
  attachCanvasTextListener(cb: (info: PrintTextEditedPayload) => void): void {
    this._canvasTextListener = cb
  }

  /** 序列化回协议模型（px → mm / px → pt） */
  toControl(): TextControl {
    return {
      ...readBaseGeometry(this),
      type: 'text',
      contentType: this.contentType,
      value: this.binding || this.expression ? undefined : this.text,
      binding: this.binding,
      expression: this.expression,
      format: this.controlFormat,
      printable: this.printable,
      visibleIf: this.visibleIf,
      locked: this.lockMovementX && this.lockMovementY ? true : undefined,
      name: this.controlName,
      style: {
        fontSize: round2(pxToPt(this.fontSize)),
        fill: typeof this.fill === 'string' ? this.fill : undefined,
        fontFamily: this.fontFamily,
        fontWeight: (this.fontWeight as 'normal' | 'bold') || undefined,
        fontStyle: this.fontStyle === 'italic' ? 'italic' : undefined,
        textDecoration: this.underline ? 'underline' : undefined,
        textAlign: (this.textAlign as TextStyle['textAlign']) || undefined,
        lineHeight: this.lineHeight,
        letterSpacing: this.charSpacing ? round2(pxToPt(this.charSpacing / 1000 * this.fontSize)) : undefined,
      },
    }
  }

  /** 属性面板编辑后回写（不触发 object:modified） */
  applyControlProps(control: TextControl): void {
    this.set({
      ...styleToFabric(control.style),
      lockMovementX: control.locked,
      lockMovementY: control.locked,
    })
    this.binding = control.binding
    this.expression = control.expression
    this.contentType = control.contentType
    this.controlFormat = control.format
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    this.text = displayText(control)
    // 非绑定文本允许直接改内容尺寸
    if (control.width) this.set('width', mm(control.width))
    this.setCoords()
    this.canvas?.requestRenderAll()
  }
}

/** 设计期显示文本：按 contentType 显示占位符，老模板回退到 expression/binding 启发式
 *  v2 优先：segments 模式 → 拼接 segments 字符串作为占位显示（与 ContentValueEditor 一致）
 */
function displayText(control: TextControl): string {
  // ★ v2 segments 模式优先：有 segments 即按 segmentsToText 拼接
  // 即使 value/binding/expression 为空，segments 也提供占位文本
  if (control.segments && control.segments.length) {
    return segmentsToText(control.segments)
  }
  const mode = control.contentType
  if (mode === 'expression') return control.expression ?? ''
  if (mode === 'variable') return control.binding ? `{{${control.binding}}}` : ''
  if (mode === 'fixed') return control.value ?? '文本'
  // 无 contentType（老模板）：沿用既有启发式
  if (control.expression) return control.expression
  if (control.binding) return `{{${control.binding}}}`
  return control.value ?? '文本'
}

function styleToFabric(style?: TextStyle) {
  return {
    fontSize: ptToPx(style?.fontSize ?? 12),
    fill: style?.fill ?? '#000000',
    fontFamily: style?.fontFamily ?? 'Source Han Sans CN, PingFang SC, sans-serif',
    fontWeight: style?.fontWeight ?? 'normal',
    fontStyle: style?.fontStyle ?? 'normal',
    underline: style?.textDecoration === 'underline',
    textAlign: style?.textAlign ?? 'left',
    lineHeight: style?.lineHeight ?? 1.16,
    charSpacing: style?.letterSpacing ? (style.letterSpacing / (style.fontSize ?? 12)) * 1000 : 0,
  }
}
