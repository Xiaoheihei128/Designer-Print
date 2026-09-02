/**
 * content-value-insert —— 把 {{path}} 插入到 textarea 文本的指定位置
 *
 * 拆分理由：放在 .vue 文件里 export 出去也行，但 vue-loader 在某些环境下处理
 * script setup export 的纯函数开销更高；独立 .ts 文件更便于 vitest 直接 import
 * 跑纯函数断言（不依赖 @vue/test-utils 挂载整个组件）。
 *
 * 用法：ContentValueEditor 的 drop handler 调 insertFieldAt(text, end, path, start)
 * 拿到 next（覆盖 segmentsText）和 caret（下一帧设回光标）。
 */

export interface InsertFieldAtResult {
  /** 插入后的完整字符串 */
  next: string
  /** 插入后光标应在的位置（指向插入末尾） */
  caret: number
}

/**
 * 把 {{path}} 插入到 text 的 [start, end) 选区。
 *
 * - 若 start === end（无选区）→ 在光标位置插入
 * - 若 start < end（有选区）→ 替换选区内容
 *
 * @param text  当前 textarea 文本
 * @param end   选区结束位置（无选区时 = start）
 * @param path  字段路径（来自 left栏 字段拖拽 dataTransfer）
 * @param start 选区起始位置（默认 = end，即纯插入）
 */
export function insertFieldAt(
  text: string,
  end: number,
  path: string,
  start: number = end,
): InsertFieldAtResult {
  const insertion = `{{${path}}}`
  return {
    next: text.slice(0, start) + insertion + text.slice(end),
    caret: start + insertion.length,
  }
}