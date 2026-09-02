/**
 * content-value-insert —— 字段拖到 textarea 插入 {{path}} 的纯逻辑测试
 *
 * 场景复现：用户从左栏字段树拖 Header.SupplierName 到画布上文本控件的多片段
 * 输入框（ContentValueEditor 的 textarea），期望插入 `{{Header.SupplierName}}`
 * 到当前光标位置（光标选区语义），不再是裸字段名（segments 模式没 {{}} 包裹
 * 渲染层 resolveBinding 失败，字段值静默丢失）。
 */
import { describe, expect, it } from 'vitest'
import { insertFieldAt } from './content-value-insert'

describe('insertFieldAt（拖字段到 segments textarea）', () => {
  it('空文本末尾插入：返回 `{{path}}` 与 caret=path 包裹长度', () => {
    const r = insertFieldAt('', 0, 'Header.SupplierName')
    expect(r.next).toBe('{{Header.SupplierName}}')
    expect(r.caret).toBe('{{Header.SupplierName}}'.length)
  })

  it('文本中间位置插入（无选区）：光标处插入，光标后移到插入末尾', () => {
    // "abc|def"  在 | 处（光标 = 3）插入
    const r = insertFieldAt('abcdef', 3, 'x.y')
    expect(r.next).toBe('abc{{x.y}}def')
    expect(r.caret).toBe(3 + '{{x.y}}'.length)
  })

  it('文本末尾位置插入：追加，光标停在末尾', () => {
    const r = insertFieldAt('外观：', '外观：'.length, 'ReportItems[].AnalysisItem')
    expect(r.next).toBe('外观：{{ReportItems[].AnalysisItem}}')
    expect(r.caret).toBe(r.next.length)
  })

  it('选中文本替换：start<end 时替换选区', () => {
    // "abc[XYZ]def" → "abc{{x.y}}def"，光标指向 } 后
    const r = insertFieldAt('abcXYZdef', 6, 'x.y', 3)
    expect(r.next).toBe('abc{{x.y}}def')
    expect(r.caret).toBe(3 + '{{x.y}}'.length)
  })

  it('字段路径含特殊字符（数组标记 []/点号）也正确包裹', () => {
    const r = insertFieldAt('单价', 2, 'ReportItems[].Unit')
    expect(r.next).toBe('单价{{ReportItems[].Unit}}')
    expect(r.caret).toBe(2 + '{{ReportItems[].Unit}}'.length)
  })

  it('多次调用累加：模拟连续拖多个字段', () => {
    let text = ''
    let caret = 0
    const r1 = insertFieldAt(text, caret, 'Header.A')
    text = r1.next
    caret = r1.caret
    const r2 = insertFieldAt(text, caret, 'Header.B')
    text = r2.next
    caret = r2.caret
    expect(text).toBe('{{Header.A}}{{Header.B}}')
    expect(caret).toBe('{{Header.A}}{{Header.B}}'.length)
  })

  it('返回的字符串必须以 {{ 开头、以 }} 结尾（绑定表达式语法契约）', () => {
    const r = insertFieldAt('', 0, 'Header.SupplierName')
    // segments 模式 textarea parse 按 {{...}} 切片段，缺一对就识别成 text 段，
    // 渲染层 resolveBinding 永远找不到路径 → 字段值丢失。
    expect(r.next.startsWith('{{')).toBe(true)
    expect(r.next.endsWith('}}')).toBe(true)
  })
})