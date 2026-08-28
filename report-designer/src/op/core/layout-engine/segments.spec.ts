import { describe, expect, it } from 'vitest'

import type { Segment } from '@op/types/control'

import { legacyToSegments, resolveSegments } from '@op/core/layout-engine/segments'

// EvalContext 必须有 data 字段；测试里无变量时用 { data: {} }

describe('resolveSegments 求值', () => {
  it('undefined / 空数组 → 空串 + 无错误', () => {
    expect(resolveSegments(undefined, { data: {} })).toEqual({ text: '', errors: [] })
    expect(resolveSegments([], { data: {} })).toEqual({ text: '', errors: [] })
  })

  it('单 text 段原样拼接', () => {
    const segs: Segment[] = [{ kind: 'text', value: '外观：' }]
    expect(resolveSegments(segs, { data: {} })).toEqual({ text: '外观：', errors: [] })
  })

  it('单 field 段按路径取值', () => {
    const segs: Segment[] = [{ kind: 'field', path: 'items[].name' }]
    const r = resolveSegments(segs, { data: { items: [{ name: '香叶醇' }] }, row: { name: '香叶醇' } })
    expect(r.text).toBe('香叶醇')
    expect(r.errors).toEqual([])
  })

  it('field 段应用段级 format > fallbackFormat > 无', () => {
    // 段级 format 优先
    const segs1: Segment[] = [
      { kind: 'field', path: 'v', format: { kind: 'percent', digits: 0 } },
    ]
    const r1 = resolveSegments(
      segs1,
      { data: { v: 0.946 } },
      { fallbackFormat: { kind: 'currency', code: 'CNY' } },
    )
    expect(r1.text).toBe('95%') // 段级 percent 生效

    // fallback 兜底
    const segs2: Segment[] = [{ kind: 'field', path: 'v' }]
    const r2 = resolveSegments(
      segs2,
      { data: { v: 12.5 } },
      { fallbackFormat: { kind: 'decimal', digits: 1 } },
    )
    expect(r2.text).toBe('12.5')

    // 无 format
    const segs3: Segment[] = [{ kind: 'field', path: 'v' }]
    expect(resolveSegments(segs3, { data: { v: 12.5 } }).text).toBe('12.5')
  })

  it('field 段空 path → 空串', () => {
    const segs: Segment[] = [{ kind: 'field', path: '' }]
    expect(resolveSegments(segs, { data: {} }).text).toBe('')
  })

  it('单 expr 段调 evaluate 求值', () => {
    const segs: Segment[] = [{ kind: 'expr', src: 'a + b' }]
    expect(resolveSegments(segs, { data: { a: 1, b: 2 } }).text).toBe('3')
  })

  it('expr 段含运算符/过滤器 → 正常求值', () => {
    const segs: Segment[] = [{ kind: 'expr', src: "rowIndex + 1" }]
    const r = resolveSegments(segs, { data: {}, rowIndex: 4 })
    expect(r.text).toBe('5')
  })

  it('expr 段返回 null/undefined → 空串', () => {
    const segs: Segment[] = [{ kind: 'expr', src: 'missing.field' }]
    const r = resolveSegments(segs, { data: {} })
    // evaluate('missing.field', {}) 不抛，返回 undefined → resolveOne 走空值分支 → 无 error
    expect(r.text).toBe('')
    expect(r.errors).toEqual([])
  })

  it('多段拼接：text + field + text', () => {
    const segs: Segment[] = [
      { kind: 'text', value: '外观：' },
      { kind: 'field', path: 'items[].name' },
      { kind: 'text', value: ' kg' },
    ]
    const r = resolveSegments(segs, {
      data: { items: [{ name: '香叶醇' }] },
      row: { name: '香叶醇' },
    })
    expect(r.text).toBe('外观：香叶醇 kg')
  })

  it('多段拼接：text + expr + text', () => {
    const segs: Segment[] = [
      { kind: 'text', value: '第' },
      { kind: 'expr', src: 'rowIndex + 1' },
      { kind: 'text', value: '行' },
    ]
    expect(
      resolveSegments(segs, { data: {}, rowIndex: 0 }).text,
    ).toBe('第1行')
  })

  it('单片段失败不影响其它片段', () => {
    const segs: Segment[] = [
      { kind: 'text', value: 'A' },
      { kind: 'expr', src: '(((invalid syntax' }, // 解析失败
      { kind: 'text', value: 'B' },
    ]
    const r = resolveSegments(segs, { data: {} })
    expect(r.text).toBe('AB') // 中间空，其它段拼接
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('segment[1]')
  })

  it('中文文本含 { } 不被误解析', () => {
    const segs: Segment[] = [
      { kind: 'text', value: '{锦鲤} 的 { mol/L } 浓度' },
    ]
    const r = resolveSegments(segs, { data: {} })
    // text 段原样拼接，不走 regex
    expect(r.text).toBe('{锦鲤} 的 { mol/L } 浓度')
    expect(r.errors).toEqual([])
  })
})

describe('legacyToSegments 老 schema 兼容', () => {
  it('undefined / 全空 → null', () => {
    expect(legacyToSegments({})).toBeNull()
    expect(legacyToSegments({ type: 'text' })).toBeNull()
    expect(legacyToSegments({ type: 'barcode' })).toBeNull()
  })

  it('text ctor: contentType=expression → expr 段', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'expression', expression: 'a + 1' }),
    ).toEqual([{ kind: 'expr', src: 'a + 1' }])
  })

  it('text ctor: contentType=variable+binding → field 段', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'variable', binding: 'order.no' }),
    ).toEqual([{ kind: 'field', path: 'order.no' }])
  })

  it('text ctor: contentType=variable 无 binding → 回落到 value（fixed）', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'variable', value: 'fallback' }),
    ).toEqual([{ kind: 'text', value: 'fallback' }])
  })

  it('text ctor: contentType=fixed+plain → text 段', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'fixed', value: 'hello' }),
    ).toEqual([{ kind: 'text', value: 'hello' }])
  })

  it('text ctor: contentType=fixed+含 {{...}} → 多段切分', () => {
    const r = legacyToSegments({
      type: 'text',
      contentType: 'fixed',
      value: '外观：{{items[].name}} kg',
    })
    expect(r).toEqual([
      { kind: 'text', value: '外观：' },
      { kind: 'expr', src: 'items[].name' },
      { kind: 'text', value: ' kg' },
    ])
  })

  it('text ctor: 无 contentType 启发式 expression > binding > value', () => {
    expect(
      legacyToSegments({ type: 'text', expression: 'x', binding: 'x', value: 'x' }),
    ).toEqual([{ kind: 'expr', src: 'x' }])
    expect(
      legacyToSegments({ type: 'text', binding: 'a.b', value: 'c' }),
    ).toEqual([{ kind: 'field', path: 'a.b' }])
    expect(
      legacyToSegments({ type: 'text', value: 'c' }),
    ).toEqual([{ kind: 'text', value: 'c' }])
  })

  it('cell ctor: 用 text/field（与 text ctor 不同字段名）', () => {
    expect(
      legacyToSegments({ type: 'cell', contentType: 'fixed', text: '表头' }),
    ).toEqual([{ kind: 'text', value: '表头' }])
    expect(
      legacyToSegments({ type: 'cell', contentType: 'variable', field: 'qty' }),
    ).toEqual([{ kind: 'field', path: 'qty' }])
    // cell 无 contentType 时，field 优先（与 text 启发式对齐）
    expect(
      legacyToSegments({ type: 'cell', field: 'qty', text: 'fallback' }),
    ).toEqual([{ kind: 'field', path: 'qty' }])
  })

  it('★ cell ctor: text 含 {{...}} 混合内容 → 优先 text（保留前后缀），覆盖 field', () => {
    // 真实场景：用户先绑了 field='ReportItems[].TestStandard'，又在单元格输入后缀 "kg"
    // 旧行为：field 优先级吞掉 text → 只渲染 TestStandard 值，"kg" 后缀丢失
    // 新行为：text 的 {{...}} 是显式混合内容信号，直接按文本切分
    expect(
      legacyToSegments({
        type: 'cell',
        text: '{{ReportItems[].TestStandard}} kg',
        field: 'ReportItems[].TestStandard',
      }),
    ).toEqual([
      { kind: 'expr', src: 'ReportItems[].TestStandard' },
      { kind: 'text', value: ' kg' },
    ])
  })

  it('★ cell ctor: text 含 {{...}}prefix 多段切分', () => {
    expect(
      legacyToSegments({ type: 'cell', text: '外观：{{name}}', field: 'name' }),
    ).toEqual([
      { kind: 'text', value: '外观：' },
      { kind: 'expr', src: 'name' },
    ])
  })

  it('★ cell ctor: 纯 {{path}} 无后缀 + field 冗余 → 与 field 等价', () => {
    expect(
      legacyToSegments({ type: 'cell', text: '{{TestStandard}}', field: 'TestStandard' }),
    ).toEqual([{ kind: 'expr', src: 'TestStandard' }])
  })

  it('barcode/qrcode ctor: binding > value（不识别 expression —— 与 resolveCodeText 对齐）', () => {
    expect(
      legacyToSegments({ type: 'barcode', expression: 'x', binding: 'order.no', value: 'v' }),
    ).toEqual([{ kind: 'field', path: 'order.no' }])
    expect(
      legacyToSegments({ type: 'qrcode', value: '0123456789' }),
    ).toEqual([{ kind: 'text', value: '0123456789' }])
    expect(
      legacyToSegments({ type: 'barcode', binding: 'code' }),
    ).toEqual([{ kind: 'field', path: 'code' }])
  })

  it('agg-token fixed text → 整体保留为单 text 段（让 caller 短路）', () => {
    expect(
      legacyToSegments({ type: 'cell', contentType: 'fixed', text: '{{#pageSum}}' }),
    ).toEqual([{ kind: 'text', value: '{{#pageSum}}' }])
    expect(
      legacyToSegments({ type: 'cell', contentType: 'fixed', text: '  {{#totalSum}}  ' }),
    ).toEqual([{ kind: 'text', value: '  {{#totalSum}}  ' }])
  })

  it('fixed text 多 {{...}} 切分 + 末尾/开头字面量', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'fixed', value: '{{a}}-{{b}}-end' }),
    ).toEqual([
      { kind: 'expr', src: 'a' },
      { kind: 'text', value: '-' },
      { kind: 'expr', src: 'b' },
      { kind: 'text', value: '-end' },
    ])
  })

  it('empty string value → 单 text 段空值', () => {
    expect(
      legacyToSegments({ type: 'text', contentType: 'fixed', value: '' }),
    ).toEqual([{ kind: 'text', value: '' }])
  })
})

describe('legacyToSegments + resolveSegments 联动', () => {
  it('老 text 模板（无 segments）经 legacyToSegments → resolveSegments 渲染与 expression 路径等价', () => {
    // 注：避免 `items[].xxx` 行路径 —— 是否能取到值取决于 row 上下文注入，
    // 这是 evaluate 的语义，不是 legacyToSegments 的责任。
    // 此处用 `{{name}}` 验证 basic 等价（text + expr + text 拼接）。
    const src = { type: 'text' as const, contentType: 'fixed' as const, value: '外观：{{name}} kg' }
    const segs = legacyToSegments(src)!
    const r = resolveSegments(segs, {
      data: { name: '香叶醇' },
      row: { name: '香叶醇' },
    })
    expect(r.text).toBe('外观：香叶醇 kg')
  })

  it('老 cell 模板（字段名 text/field）兼容还原', () => {
    const segs = legacyToSegments({
      type: 'cell',
      contentType: 'variable',
      field: 'qty',
    })!
    expect(
      resolveSegments(segs, { data: {}, row: { qty: 5 } }).text,
    ).toBe('5')
  })

  it('agg-token 老模板还原后 text 与原字面量一致（caller 自负责短路）', () => {
    // legacyToSegments 命中 isAggToken → 单 text 段，保留原字面量
    const segs = legacyToSegments({
      type: 'cell',
      contentType: 'fixed',
      text: '{{#pageSum}}',
    })!
    expect(segs).toEqual([{ kind: 'text', value: '{{#pageSum}}' }])
    // resolveSegments 直接走 text 段 → 输出原字面量（无错误）
    const r = resolveSegments(segs, { data: {} })
    expect(r.text).toBe('{{#pageSum}}')
    expect(r.errors).toEqual([])
    // caller（dataCellText/staticCellText）拿到 segs 后顶层用 isAggToken 短路返回 ''，
    // 让 buildFooterRow 接管。segments.ts 不在内部识别 agg token —— 这是 design 决策。
  })
})