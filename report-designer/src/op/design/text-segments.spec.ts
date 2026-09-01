/**
 * text-segments 单测：v2 文本控件 segments ↔ string 互转共享实现
 *
 * 覆盖（任何修改都要重跑）：
 * - segmentsToText：空数组 → ''；text 段原样；field/expr 段包 {{ }}
 * - textToSegments：空字符串、纯文本、单 {{field}}、{{expr}}、{{#token}}、多片段混合
 * - 双向 round-trip 语义对称（用任一边解析得到的字符串应能被另一边还原）
 * - agg token 边界：保持为字面 text 段（buildFooterRow 直接读 cell.text）
 */
import { describe, expect, it } from 'vitest'
import { segmentsToText, textToSegments } from './text-segments'

describe('segmentsToText', () => {
  it('空数组 → 空字符串', () => {
    expect(segmentsToText([])).toBe('')
  })

  it('undefined → 空字符串（防御性）', () => {
    expect(segmentsToText(undefined as unknown as never[])).toBe('')
  })

  it('单 text 段原样输出', () => {
    expect(segmentsToText([{ kind: 'text', value: '和和和' }])).toBe('和和和')
  })

  it('单 field 段包 {{ }}', () => {
    expect(segmentsToText([{ kind: 'field', path: 'Header.ReportDate' }])).toBe(
      '{{Header.ReportDate}}',
    )
  })

  it('单 expr 段包 {{ }}', () => {
    expect(segmentsToText([{ kind: 'expr', src: 'Header.Qty * 2' }])).toBe('{{Header.Qty * 2}}')
  })

  it('text + field + expr 拼接', () => {
    expect(
      segmentsToText([
        { kind: 'text', value: '合计：' },
        { kind: 'field', path: 'Header.Total' },
        { kind: 'text', value: ' 元' },
        { kind: 'expr', src: 'a + b' },
      ]),
    ).toBe('合计：{{Header.Total}} 元{{a + b}}')
  })
})

describe('textToSegments', () => {
  it('空字符串 → 单 text 段（value=""）', () => {
    expect(textToSegments('')).toEqual([{ kind: 'text', value: '' }])
  })

  it('纯文本无 {{ → 单 text 段', () => {
    expect(textToSegments('hello world')).toEqual([{ kind: 'text', value: 'hello world' }])
  })

  it('中文文本（含 {{ 之外的字符）原样', () => {
    expect(textToSegments('和和和')).toEqual([{ kind: 'text', value: '和和和' }])
  })

  it('单 {{field}} 解析为单 field 段', () => {
    expect(textToSegments('{{Header.ReportDate}}')).toEqual([
      { kind: 'field', path: 'Header.ReportDate' },
    ])
  })

  it('单 {{expr}}（含运算符）→ expr 段', () => {
    expect(textToSegments('{{Header.Qty * 2}}')).toEqual([
      { kind: 'expr', src: 'Header.Qty * 2' },
    ])
  })

  it('单 {{expr}}（管道过滤器）→ expr 段', () => {
    expect(textToSegments("{{order.total | currency:'CNY'}}")).toEqual([
      { kind: 'expr', src: "order.total | currency:'CNY'" },
    ])
  })

  it('{{#token}} 聚合 token → 整体保留为 text 段', () => {
    expect(textToSegments('{{#pageSum}}')).toEqual([{ kind: 'text', value: '{{#pageSum}}' }])
  })

  it('字段路径含数组下标 [] 仍识别为 field', () => {
    expect(textToSegments('{{ReportItems[].AnalysisItem}}')).toEqual([
      { kind: 'field', path: 'ReportItems[].AnalysisItem' },
    ])
  })

  it('多片段：text + field + text', () => {
    expect(textToSegments('和和和{{Header.X}}完')).toEqual([
      { kind: 'text', value: '和和和' },
      { kind: 'field', path: 'Header.X' },
      { kind: 'text', value: '完' },
    ])
  })

  it('多片段：field + expr + text', () => {
    expect(textToSegments('{{Header.A}}+{{Header.B | toFixed:2}} 余')).toEqual([
      { kind: 'field', path: 'Header.A' },
      { kind: 'text', value: '+' },
      { kind: 'expr', src: 'Header.B | toFixed:2' },
      { kind: 'text', value: ' 余' },
    ])
  })

  it('纯 {{ ... }} 前缀无前导 text 段', () => {
    expect(textToSegments('{{a}}b{{c}}')).toEqual([
      { kind: 'field', path: 'a' },
      { kind: 'text', value: 'b' },
      { kind: 'field', path: 'c' },
    ])
  })

  it('body 含空白（前后空格）被 trim 后再判定', () => {
    expect(textToSegments('{{  Header.X  }}')).toEqual([
      { kind: 'field', path: 'Header.X' },
    ])
  })
})

describe('round-trip 对称性', () => {
  it('segmentsToText → textToSegments 得到等价 segments', () => {
    const segs = [
      { kind: 'text' as const, value: '和和和' },
      { kind: 'field' as const, path: 'Header.ReportDate' },
      { kind: 'text' as const, value: ' 元' },
      { kind: 'expr' as const, src: 'Header.Qty * 2' },
    ]
    const text = segmentsToText(segs)
    expect(textToSegments(text)).toEqual(segs)
  })

  it('textToSegments → segmentsToText 还原原字符串（agg token 例外）', () => {
    // agg token 在 textToSegments 里变成 text 段，segmentsToText 原样输出，
    // 所以含 agg 的文本往返也对称
    const cases = [
      '{{Header.A}}',
      '和和和{{Header.B}}',
      '{{a}}+{{b}}',
      '{{#pageSum}}',
      '{{order.total | currency}}',
    ]
    for (const s of cases) {
      expect(segmentsToText(textToSegments(s))).toBe(s)
    }
  })
})