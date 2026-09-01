/**
 * 文本控件 segments ↔ string 互转的共享实现
 *
 * 历史：原本散在 ContentValueEditor.vue（属性面板用）与 PrintText.ts:segmentsToDisplayText（画布用）
 * 两处；v2 反向同步修复（fabric.Textbox editing:exited → store.segments）要求两条路径解析同一份
 * 字符串得到完全一致的 Segment 数组，否则 watch(props.segments) 会因引用/内容差异无法触发。
 *
 * 因此把这两段逻辑提到共享模块：
 * - segmentsToText：segments 数组 → 占位符文本（渲染到 fabric.Textbox.text / 显示在 textarea）
 * - textToSegments：占位符文本 → segments 数组（用户在画布编辑退出后回写 store）
 *
 * 解析规则与 ContentValueEditor.vue:143-166 完全一致：
 * - 空字符串 → 单 text 段 ['']
 * - 无 {{ → 单 text 段
 * - {{#token}}（聚合 token）→ 整体保留为 text 段（buildFooterRow 直接读 cell.text，不解析）
 * - {{path}}（纯路径，^[A-Za-z_$][\w$.\[\]]*$）→ field 段
 * - 其他 {{body}} → expr 段（body 含运算符/管道/函数调用）
 */
import type { Segment } from '@op/types/control'

/** segments → 占位符文本。空数组 → 空字符串。 */
export function segmentsToText(segs: Segment[]): string {
  if (!segs || !segs.length) return ''
  return segs
    .map((s) => {
      if (s.kind === 'text') return s.value
      if (s.kind === 'field') return `{{${s.path}}}`
      return `{{${s.src}}}`
    })
    .join('')
}

/** 占位符文本 → segments。永远返回非空数组。 */
export function textToSegments(text: string): Segment[] {
  if (!text) return [{ kind: 'text', value: '' }]
  if (!text.includes('{{')) return [{ kind: 'text', value: text }]

  const parts: Segment[] = []
  // 非贪婪跨行：覆盖 {{#xxx}} 多行 agg token 与 {{expr | filter:arg}} 表达式
  const re = /\{\{([\s\S]*?)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ kind: 'text', value: text.slice(last, m.index) })
    }
    const body = m[1]!.trim()
    if (body.startsWith('#')) {
      // 聚合 token（#pageSum/#rowSum/...）：保留为单 text 段，渲染引擎原样读取
      parts.push({ kind: 'text', value: m[0] })
    } else if (/^[A-Za-z_$][\w$.\[\]]*$/.test(body)) {
      // 纯字段路径（无运算符、无过滤器）
      parts.push({ kind: 'field', path: body })
    } else {
      // 表达式（运算符、管道、函数调用）
      parts.push({ kind: 'expr', src: body })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    parts.push({ kind: 'text', value: text.slice(last) })
  }
  return parts.length ? parts : [{ kind: 'text', value: text }]
}