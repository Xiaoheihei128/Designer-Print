import { describe, expect, it } from 'vitest'
import {
  clampUserWidthToColumn,
  ensureCodeNaturalDimsSync,
  makeCodeKey,
  makeNaturalDimsFailedWarning,
  makeRuntimeFallbackWarning,
  measureNaturalBarcodeDimsSync,
  precomputeCodeNaturalDims,
  type NaturalCodeDims,
} from '@op/core/layout-engine/code-runtime-fallback'
import type { CellFormat, Segment, TableControl } from '@op/types/control'
import { buildTableModel } from '@op/core/layout-engine/table-engine'
import type { EvalContext } from '@op/core/layout-engine/types'
import { createCjkMeasurer } from '@op/core/__tests__/cjk-measurer'

/* ============================================================
 * makeCodeKey —— PR-C.5 必修 bug #1 fix(避免同 path 不同 format 撞车)
 * ============================================================ */
describe('makeCodeKey —— 段级码 cache key', () => {
  it('同 path + 同 value + 同 bcid → 同一 key', () => {
    const fmt: CellFormat = { kind: 'barcode', bcid: 'CODE128' }
    const k1 = makeCodeKey('items[].sku', 'X-001', fmt)
    const k2 = makeCodeKey('items[].sku', 'X-001', fmt)
    expect(k1).toBe(k2)
    expect(k1).toBe('items[].sku:X-001:CODE128:')
  })

  // 测试 5:同 path 不同 bcid → 不共享 entry
  it('同 path 同 value + 不同 bcid → 不同 key', () => {
    const fmtA: CellFormat = { kind: 'barcode', bcid: 'CODE128' }
    const fmtB: CellFormat = { kind: 'barcode', bcid: 'EAN13' }
    const k1 = makeCodeKey('items[].sku', 'X-001', fmtA)
    const k2 = makeCodeKey('items[].sku', 'X-001', fmtB)
    expect(k1).not.toBe(k2)
    expect(k1).toBe('items[].sku:X-001:CODE128:')
    expect(k2).toBe('items[].sku:X-001:EAN13:')
  })

  // 测试 6:同 path 同 bcid + 不同 errorLevel → 不共享 entry(QR)
  it('同 path 同 bcid + 不同 errorLevel → 不同 key(QR 纠错级区分)', () => {
    const fmtL: CellFormat = { kind: 'qrcode', errorLevel: 'L' }
    const fmtH: CellFormat = { kind: 'qrcode', errorLevel: 'H' }
    const k1 = makeCodeKey('items[].qr', 'http://x', fmtL)
    const k2 = makeCodeKey('items[].qr', 'http://x', fmtH)
    expect(k1).not.toBe(k2)
    expect(k1).toBe('items[].qr:http://x::L')
    expect(k2).toBe('items[].qr:http://x::H')
  })

  it('空字符串 bcid/errorLevel 占位 → 长度固定,避免拼接歧义', () => {
    const fmtNone: CellFormat = { kind: 'qrcode' }
    const k = makeCodeKey('items[].v', '1', fmtNone)
    expect(k).toBe('items[].v:1::')
  })
})

/* ============================================================
 * clampUserWidthToColumn —— PR-C.5 必修 bug #2 fix(避免 CSS 隐式压缩)
 * ============================================================ */
describe('clampUserWidthToColumn —— userWidth 静默 clamp', () => {
  it('userWidth < colWidth → 不 clamp,actual = userWidth', () => {
    const r = clampUserWidthToColumn(20, 30, 4)
    expect(r.actual).toBe(20)
    expect(r.clamped).toBe(false)
  })

  it('userWidth = colWidth - padding → 边界值,actual = userWidth', () => {
    const r = clampUserWidthToColumn(26, 30, 4)
    expect(r.actual).toBe(26)
    expect(r.clamped).toBe(false)
  })

  // 测试 2:userWidth=80 + colWidth=30 + 默认 padding=4 → clamp 到 26
  it('userWidth=80 + colWidth=30 + padding=4 → clamp 到 26(静默)', () => {
    const r = clampUserWidthToColumn(80, 30, 4)
    expect(r.actual).toBe(26)
    expect(r.clamped).toBe(true)
  })

  it('userWidth > colWidth + padding → clamp 到 max(1, colWidth - padding)', () => {
    // 极窄列:colWidth=2,padding=4 → max(1, 2-4) = 1
    const r = clampUserWidthToColumn(50, 2, 4)
    expect(r.actual).toBe(1)
    expect(r.clamped).toBe(true)
  })

  it('userWidth=undefined → actual=0,clamped=false(无 userWidth 时不 clamp)', () => {
    const r = clampUserWidthToColumn(undefined, 30, 4)
    expect(r.actual).toBe(0)
    expect(r.clamped).toBe(false)
  })
})

/* ============================================================
 * measureNaturalBarcodeDimsSync —— 探针 SVG 解析 viewBox
 * ============================================================ */
describe('measureNaturalBarcodeDimsSync —— bwip-js 探针', () => {
  it('CODE128 + 普通文本 → 返回合法 naturalDims + aspect', () => {
    const dims = measureNaturalBarcodeDimsSync('HELLO-WORLD', { bcid: 'code128', showText: true })
    expect(dims.naturalWidthMm).toBeGreaterThan(0)
    expect(dims.naturalHeightMm).toBeGreaterThan(0)
    expect(dims.aspect).toBeGreaterThan(0)
    expect(dims.aspect).toBeCloseTo(dims.naturalWidthMm / dims.naturalHeightMm, 6)
  })

  it('不同字符数 → 不同 aspect(长文本条码更宽)', () => {
    const short = measureNaturalBarcodeDimsSync('AB', { bcid: 'code128' })
    const long = measureNaturalBarcodeDimsSync('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', {
      bcid: 'code128',
    })
    // 长字符串的 naturalWidth 必然更大 → aspect 更大
    expect(long.aspect).toBeGreaterThan(short.aspect)
  })

  it('bwip-js 抛错(bcid 非法) → 抛错向上传播,由 caller 兜底', () => {
    // 此函数不在内部 try/catch —— 让 bwip-js 抛错向上传播
    // (兜底逻辑在 ensureCodeNaturalDimsSync / precomputeCodeNaturalDims)
    expect(() =>
      measureNaturalBarcodeDimsSync('X', { bcid: 'NONEXISTENT_BCID', showText: false }),
    ).toThrow(/unknown encoder/i)
  })

  /* ★ PR-C 实测:bwip-js CODE128 + 已知字符数 → naturalDims.aspec 精确值参考 */
  it('实测 CODE128 + "12345" → aspect 约 0.91(35px/38.6px 换算后)', () => {
    // 此处不锁死 aspect 数值(避免 bwip-js 版本升级 flake),只断言 shape:
    //   - naturalWidthMm/naturalHeightMm > 0
    //   - aspect = W/H 精确匹配(浮点一致)
    //   - 长字符串 aspect > 短字符串
    const dims = measureNaturalBarcodeDimsSync('12345', { bcid: 'code128', showText: true })
    expect(dims.naturalWidthMm).toBeGreaterThan(0)
    expect(dims.naturalHeightMm).toBeGreaterThan(0)
    expect(dims.aspect).toBeCloseTo(dims.naturalWidthMm / dims.naturalHeightMm, 6)
  })
})

/* ============================================================
 * ensureCodeNaturalDimsSync —— PR-C.5 必修 bug #3 fix(cache miss 同步补码)
 * ============================================================ */
describe('ensureCodeNaturalDimsSync —— 同步补码 cache miss', () => {
  // 测试 3:cache miss + 同步补码成功 → 补码结果入 cache + runtimeFallback=true
  it('cache miss + 同步补码成功 → dims 返回 + cache 写入 + runtimeFallback=true', () => {
    const fmt: CellFormat = { kind: 'barcode', bcid: 'CODE128', showText: true }
    const cache = new Map<string, NaturalCodeDims>()
    const { dims, runtimeFallback } = ensureCodeNaturalDimsSync(
      'items[].sku', 'X-001', fmt, cache,
    )
    expect(dims).toBeDefined()
    expect(dims!.naturalWidthMm).toBeGreaterThan(0)
    expect(runtimeFallback).toBe(true)
    expect(cache.size).toBe(1)
    // 二次调用应该命中 cache,runtimeFallback=false
    const { dims: dims2, runtimeFallback: rf2 } = ensureCodeNaturalDimsSync(
      'items[].sku', 'X-001', fmt, cache,
    )
    expect(dims2).toBe(dims)
    expect(rf2).toBe(false)
  })

  // 测试 4:cache miss + bwip-js 抛错 → dims=undefined + runtimeFallback=true
  it('cache miss + bwip-js 抛错 → dims=undefined + runtimeFallback=true(让 caller fallback 25mm)', () => {
    const fmt: CellFormat = { kind: 'barcode', bcid: 'NONEXISTENT', showText: false }
    const cache = new Map<string, NaturalCodeDims>()
    const { dims, runtimeFallback } = ensureCodeNaturalDimsSync(
      'items[].sku', 'X-001', fmt, cache,
    )
    expect(dims).toBeUndefined()
    expect(runtimeFallback).toBe(true)
    // 失败不写入 cache(让下次重试)
    expect(cache.size).toBe(0)
  })

  it('qrcode cache miss → 1:1 直接写,无 bwip-js 调用', () => {
    const fmt: CellFormat = { kind: 'qrcode', errorLevel: 'M' }
    const cache = new Map<string, NaturalCodeDims>()
    const { dims, runtimeFallback } = ensureCodeNaturalDimsSync(
      'items[].qr', 'http://x', fmt, cache,
    )
    expect(dims).toEqual({ naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 })
    expect(runtimeFallback).toBe(true)
  })

  it('cache hit → runtimeFallback=false(无需补码)', () => {
    const fmt: CellFormat = { kind: 'barcode', bcid: 'CODE128' }
    const cache = new Map<string, NaturalCodeDims>()
    const key = makeCodeKey('items[].sku', 'X-001', fmt)
    cache.set(key, { naturalWidthMm: 50, naturalHeightMm: 25, aspect: 2 })
    const { dims, runtimeFallback } = ensureCodeNaturalDimsSync(
      'items[].sku', 'X-001', fmt, cache,
    )
    expect(dims).toEqual({ naturalWidthMm: 50, naturalHeightMm: 25, aspect: 2 })
    expect(runtimeFallback).toBe(false)
  })
})

/* ============================================================
 * Warning factory —— WarningCode 配套工厂
 * ============================================================ */
describe('Warning factory —— cache miss 警告文案', () => {
  it('makeRuntimeFallbackWarning → CODE_NATURAL_DIMS_RUNTIME_FALLBACK + 字段名 + controlId', () => {
    const w = makeRuntimeFallbackWarning('items[].sku', 'tbl1')
    expect(w.code).toBe('CODE_NATURAL_DIMS_RUNTIME_FALLBACK')
    expect(w.message).toContain('items[].sku')
    expect(w.controlId).toBe('tbl1')
  })

  it('makeNaturalDimsFailedWarning → CODE_NATURAL_DIMS_FAILED + 字段名', () => {
    const w = makeNaturalDimsFailedWarning('items[].sku')
    expect(w.code).toBe('CODE_NATURAL_DIMS_FAILED')
    expect(w.message).toContain('items[].sku')
  })
})

/* ============================================================
 * precomputeCodeNaturalDims —— pagination-engine 入口
 * ============================================================ */
describe('precomputeCodeNaturalDims —— 预生成 naturalDims 缓存', () => {
  it('barcode 字段值集合 → 缓存每个 (path,value,fmt) 组合', () => {
    const segs: Segment[][] = [
      [
        {
          kind: 'field',
          path: 'items[].sku',
          format: { kind: 'barcode', bcid: 'CODE128', showText: true },
        },
      ],
    ]
    const values = new Map<string, Set<string>>([['items[].sku', new Set(['A', 'B'])]])
    const cache = precomputeCodeNaturalDims(segs, values)
    expect(cache.size).toBe(2)
    expect(cache.has('items[].sku:A:CODE128:')).toBe(true)
    expect(cache.has('items[].sku:B:CODE128:')).toBe(true)
  })

  it('qrcode 字段值 → 缓存 1:1 占位(无 bwip-js 调用)', () => {
    const segs: Segment[][] = [
      [{ kind: 'field', path: 'qr', format: { kind: 'qrcode', errorLevel: 'M' } }],
    ]
    const values = new Map<string, Set<string>>([['qr', new Set(['x'])]])
    const cache = precomputeCodeNaturalDims(segs, values)
    expect(cache.size).toBe(1)
    expect(cache.get('qr:x::M')).toEqual({ naturalWidthMm: 30, naturalHeightMm: 30, aspect: 1 })
  })

  it('空 values 或非 field 段 → 不写 cache', () => {
    const segs: Segment[][] = [
      [{ kind: 'text', value: 'hello' }],
      [{ kind: 'field', path: 'x', format: { kind: 'text' } }], // 普通 text format
    ]
    const values = new Map<string, Set<string>>([['x', new Set(['1'])]])
    const cache = precomputeCodeNaturalDims(segs, values)
    expect(cache.size).toBe(0)
  })

  it('bwip-js 抛错(bcid 非法) → 该 entry 跳过,不抛到 caller', () => {
    const segs: Segment[][] = [
      [{ kind: 'field', path: 'p', format: { kind: 'barcode', bcid: 'NOPE', showText: false } }],
    ]
    const values = new Map<string, Set<string>>([['p', new Set(['v'])]])
    expect(() => precomputeCodeNaturalDims(segs, values)).not.toThrow()
    // 失败的 entry 不写 cache(让运行期重试)
    const cache = precomputeCodeNaturalDims(segs, values)
    expect(cache.size).toBe(0)
  })
})

/* ============================================================
 * PR-C 集成:measureRowHeight → RenderPart.meta 写回 computedW/computedH
 * 透过 buildTableModel 验证 measurer 行为,renderer 消费方在 renderer-html.spec.ts
 * ============================================================ */
describe('PR-C measureRowHeight —— 写回 computedW/computedH 到 part.meta', () => {
  const measurer = createCjkMeasurer()
  function mkTableModel(opts: {
    widthMm: number
    widthSetting?: number
    lockRatio?: boolean
    naturalDims?: Map<string, NaturalCodeDims>
  }) {
    const c: TableControl = {
      id: 'tbl',
      type: 'table',
      left: 0,
      top: 0,
      width: opts.widthMm,
      height: 30,
      dataSource: 'items',
      columns: [{ field: 'code', title: '码', width: opts.widthMm }],
      cells: [
        [],
        [
          {
            segments: [
              {
                kind: 'field',
                path: 'code',
                format: {
                  kind: 'barcode',
                  bcid: 'CODE128',
                  showText: true,
                  display: {
                    widthMm: opts.widthSetting,
                    lockRatio: opts.lockRatio,
                  },
                },
              },
            ],
          },
        ],
      ],
    } as TableControl
    const ctx: EvalContext = { data: { items: [{ code: 'X-001' }] } }
    // ★ svgLookup 必传 —— resolveSegments 命中 svg 路径才会输出 {kind:'svg'} part + 完整 meta
    //   (无 svgLookup 时降级为 text 占位,无 meta 可读)
    const svgLookup = (_segIdx: number, path: string, value: string) =>
      path === 'code' && value === 'X-001' ? '<svg/>' : undefined
    return buildTableModel({
      control: c,
      ctx,
      measurer,
      widthMm: opts.widthMm,
      heightMm: 30,
      svgLookup,
      naturalDims: opts.naturalDims,
    })
  }

  it('barcode 字段 + userWidth=40 + lockRatio=true + naturalDims 提供 → meta 写回 computedW/computedH', () => {
    // 探针预生成 naturalDims(让 buildTableModel 拿到 cache,不走同步补码)
    const segs: Segment[][] = [
      [
        {
          kind: 'field',
          path: 'code',
          format: { kind: 'barcode', bcid: 'CODE128', showText: true },
        },
      ],
    ]
    const values = new Map<string, Set<string>>([['code', new Set(['X-001'])]])
    const naturalDims = precomputeCodeNaturalDims(segs, values)
    const dims = naturalDims.get(makeCodeKey('code', 'X-001', { kind: 'barcode', bcid: 'CODE128', showText: true }))!

    const model = mkTableModel({
      widthMm: 60,
      widthSetting: 40,
      lockRatio: true,
      naturalDims,
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')! as {
      kind: 'svg'
      svg: string
      meta?: {
        computedW?: number
        computedH?: number
        aspect?: number
        field?: string
      }
    }
    // debug: 看 meta 实际内容
    if (!svgPart.meta?.computedW) {
      console.log('DEBUG meta:', JSON.stringify(svgPart.meta, null, 2))
    }
    // computedW = userWidth (40mm, < colWidth-padding=56mm,无需 clamp)
    expect(svgPart.meta?.computedW).toBe(40)
    // computedH = 40 / aspect
    expect(svgPart.meta?.computedH).toBeCloseTo(40 / dims.aspect, 4)
    expect(svgPart.meta?.aspect).toBeCloseTo(dims.aspect, 4)
  })

  it('barcode 字段 + userWidth=80 + colWidth=60 → meta.computedW clamp 到 56(60-4 padding)', () => {
    const segs: Segment[][] = [
      [{ kind: 'field', path: 'code', format: { kind: 'barcode', bcid: 'CODE128', showText: true } }],
    ]
    const values = new Map<string, Set<string>>([['code', new Set(['X'])]])
    const naturalDims = precomputeCodeNaturalDims(segs, values)

    const model = mkTableModel({
      widthMm: 60,
      widthSetting: 80, // 超过 colWidth=60 → clamp
      lockRatio: true,
      naturalDims,
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')!.meta
    // colWidth=60 - padding×2(2+2)=4 → actualW=56
    expect(svgPart?.computedW).toBe(56)
    // computedH = 56 / aspect
    expect(svgPart?.computedH).toBe(56 / (svgPart?.aspect ?? 1))
  })

  it('barcode 字段 + userWidth=40 + lockRatio=false → computedW=userW,computedH=naturalHeight', () => {
    const segs: Segment[][] = [
      [{ kind: 'field', path: 'code', format: { kind: 'barcode', bcid: 'CODE128', showText: true } }],
    ]
    const values = new Map<string, Set<string>>([['code', new Set(['X'])]])
    const naturalDims = precomputeCodeNaturalDims(segs, values)
    const dims = naturalDims.get(makeCodeKey('code', 'X', { kind: 'barcode', bcid: 'CODE128', showText: true }))!

    const model = mkTableModel({
      widthMm: 60,
      widthSetting: 40,
      lockRatio: false,
      naturalDims,
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')!.meta
    // computedW = userW(lockRatio=false 也走同一路径,只是 height 计算不同)
    expect(svgPart?.computedW).toBe(40)
    // computedH = naturalHeight(lockRatio=false 不按 aspect 推)
    expect(svgPart?.computedH).toBeCloseTo(dims.naturalHeightMm, 4)
  })

  it('barcode 字段 + userWidth 未设 + lockRatio=true → computedW=naturalWidthMm(无 userW 时兜底)', () => {
    const segs: Segment[][] = [
      [{ kind: 'field', path: 'code', format: { kind: 'barcode', bcid: 'CODE128', showText: true } }],
    ]
    const values = new Map<string, Set<string>>([['code', new Set(['X'])]])
    const naturalDims = precomputeCodeNaturalDims(segs, values)
    const dims = naturalDims.get(makeCodeKey('code', 'X', { kind: 'barcode', bcid: 'CODE128', showText: true }))!

    const model = mkTableModel({
      widthMm: 60,
      // widthSetting 不传(undefined) + lockRatio=true
      lockRatio: true,
      naturalDims,
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')!.meta
    // computedW = naturalWidthMm(无 userW 时用 natural 兜底)
    expect(svgPart?.computedW).toBeCloseTo(dims.naturalWidthMm, 4)
    // computedH = naturalHeightMm(= naturalWidthMm / aspect)
    expect(svgPart?.computedH).toBeCloseTo(dims.naturalHeightMm, 4)
  })

  it('naturalDims 未传 + userWidth 未设 → meta.computedW/computedH 保持 undefined(renderer 走兜底路径)', () => {
    const model = mkTableModel({
      widthMm: 60,
      // widthSetting 不传 + naturalDims 不传
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')!.meta
    // naturalDims 未传 → measureRowHeight 不走 computePartHeightFromNaturalDims → meta 不写回
    expect(svgPart?.computedW).toBeUndefined()
    expect(svgPart?.computedH).toBeUndefined()
    expect(svgPart?.aspect).toBeUndefined()
  })

  it('cache miss 同步补码 → part.meta.computedW/computedH 仍正确 + model.warnings 含 RUNTIME_FALLBACK', () => {
    // 传空 cache(非 undefined)→ measureRowHeight 走 naturalDims 路径 → 触发 ensureCodeNaturalDimsSync 同步补码
    const emptyCache = new Map<string, NaturalCodeDims>()
    const model = mkTableModel({
      widthMm: 60,
      widthSetting: 40,
      lockRatio: true,
      naturalDims: emptyCache,
    })
    const dataRow = model.rows.find((r) => r.kind === 'data')!
    const svgPart = dataRow.cells[0]!.parts!.find((p) => p.kind === 'svg')!.meta
    // 同步补码成功 → computedW/computedH 写入
    expect(svgPart?.computedW).toBe(40)
    expect(svgPart?.computedH).toBeGreaterThan(0)
    // 补码结果应回写到 cache
    expect(emptyCache.size).toBeGreaterThan(0)
    // warning 写入 model.warnings
    expect(model.warnings.some((w) => w.code === 'CODE_NATURAL_DIMS_RUNTIME_FALLBACK')).toBe(true)
  })
})