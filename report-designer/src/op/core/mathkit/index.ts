/**
 * mathkit/index —— 对外统一入口
 *
 * - `renderMathHtml(control)`：KaTeX 渲染 → 自包含 HTML（含内联 CSS + 字体 data-URI）。
 * - `renderMathControl(control)`：MathControl → HTML 字符串（一步到位）。
 *
 * KaTeX 输出 HTML + web fonts（非 SVG），与图表的原生 SVG 不同。
 * 设计期 overlay 直接用 KaTeX HTML 渲染（屏幕矢量清晰）；
 * 导出走和正文相同的栅格化路径（foreignObject + 高清位图）——简单可靠不糊。
 */
import katex from 'katex'
import type { MathControl } from '../../types/control'

export { renderMathControl, renderMathHtml }
export type { MathControl }

/** KaTeX CSS（导入时自动注入） */
import 'katex/dist/katex.min.css'

/** 默认字号（pt） */
const DEFAULT_FONT_SIZE = 16

/** 默认颜色 */
const DEFAULT_COLOR = '#000000'

/** MathControl → KaTeX 渲染后的 HTML 字符串 */
function renderMathControl(control: MathControl): string {
  return renderMathHtml(
    control.latex ?? '',
    control.displayMode ?? true,
    control.fontSize ?? DEFAULT_FONT_SIZE,
    control.color ?? DEFAULT_COLOR,
  )
}

/**
 * 渲染 LaTeX 为 KaTeX HTML。
 * 返回的 HTML 包含 KaTeX 内联 class（katex / katex-display / katex-mathml 等），
 * 依赖 katex.min.css（已在 index.ts import）和 KaTeX web fonts。
 *
 * throwOnError:false —— 语法错误时渲染红色错误提示，而非抛异常。
 */
function renderMathHtml(
  latex: string,
  displayMode: boolean,
  fontSize: number,
  color: string,
): string {
  if (!latex?.trim()) {
    return `<div style="font-size:${fontSize}pt;color:#999;text-align:center">公式预览（输入 LaTeX 源码）</div>`
  }
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    })
    return `<div style="font-size:${fontSize}pt;color:${color};text-align:${displayMode ? 'center' : 'left'}">${html}</div>`
  } catch (e) {
    return `<div style="font-size:${fontSize}pt;color:#e53935;text-align:center">公式渲染失败：${e instanceof Error ? e.message : String(e)}</div>`
  }
}
