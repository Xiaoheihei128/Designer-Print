/**
 * introspect-json —— 从业务 JSON 反推字段目录
 *
 * 关键行为锁定（任何修改都要重跑这些 case）：
 * - 顶层 object → main 表 / isArray=false
 * - 顶层 array of object → detail 表 / isArray=true / pathPrefix 用 `[]`
 * - 数组多行取并集（避免只采第一行漏字段）
 * - 已有 FieldDef 同 path 时沿用 label（标注优先）
 * - 叶子类型推断：number / boolean / ISO date / image URL / string
 */
import { describe, expect, it } from 'vitest'
import { introspectJson } from './introspect-json'
import type { FieldDef } from '@op/types/datasource'

describe('introspectJson', () => {
  it('顶层 object → main 表，叶子字段 path 用「表名.键」拼接', () => {
    const r = introspectJson({
      Header: {
        ReportNo: 'RM-2026-00123',
        ReportDate: '2026-08-12',
        Inspector: '张伟',
      },
    })

    expect(r.meta.tables).toEqual([
      { id: 'Header', name: 'Header', relation: 'main', pathPrefix: 'Header.', isArray: false },
    ])
    const paths = r.fields.map((f) => f.path).sort()
    expect(paths).toEqual(['Header.Inspector', 'Header.ReportDate', 'Header.ReportNo'])
    const reportNo = r.fields.find((f) => f.path === 'Header.ReportNo')!
    expect(reportNo.type).toBe('string')
    expect(reportNo.label).toBe('ReportNo') // 无标注时 label = 键名
    expect(reportNo.sample).toBe('RM-2026-00123')
  })

  it('顶层 array of object → detail 表 + isArray=true + pathPrefix 用「表名[].」', () => {
    const r = introspectJson({
      ReportItems: [
        { AnalysisItem: '外观', FinalVal: '符合规定' },
        { AnalysisItem: '含量', FinalVal: '99.5%' },
      ],
    })

    expect(r.meta.tables).toEqual([
      { id: 'ReportItems', name: 'ReportItems', relation: 'detail', pathPrefix: 'ReportItems[].', isArray: true },
    ])
    const paths = r.fields.map((f) => f.path).sort()
    expect(paths).toEqual(['ReportItems[].AnalysisItem', 'ReportItems[].FinalVal'])
    // 数组 sample 取自合并后对象的值（同 key 后写覆盖前写，反映最后一行）——
    // 真实场景中这是合理的（"这列最新一行长啥样"），sample 只用于设计器占位
    expect(r.fields.find((f) => f.path === 'ReportItems[].FinalVal')?.sample).toBe('99.5%')
    expect(r.fields.find((f) => f.path === 'ReportItems[].AnalysisItem')?.sample).toBe('含量')
  })

  it('数组多行并集：第二行的额外字段不会被漏掉', () => {
    const r = introspectJson({
      ReportItems: [
        { AnalysisItem: '外观', FinalVal: '符合规定' },
        { AnalysisItem: '含量', FinalVal: '99.5%', Unit: '%' },
      ],
    })

    const paths = r.fields.map((f) => f.path).sort()
    expect(paths).toContain('ReportItems[].Unit') // ← 第二行独有，不能漏
  })

  it('ISO 8601 字符串被识别为 date 类型', () => {
    const r = introspectJson({
      Header: {
        DateOnly: '2026-08-12',
        DateTime: '2026-08-12T10:30:00.000Z',
        DateTimeOffset: '2026-08-12T10:30:00+08:00',
        Plain: 'hello',
      },
    })

    const types = Object.fromEntries(r.fields.map((f) => [f.path, f.type]))
    expect(types['Header.DateOnly']).toBe('date')
    expect(types['Header.DateTime']).toBe('date')
    expect(types['Header.DateTimeOffset']).toBe('date')
    expect(types['Header.Plain']).toBe('string')
  })

  it('叶子类型推断：number / boolean / image URL / 标量数组', () => {
    const r = introspectJson({
      Header: {
        Quantity: 50,
        Passed: true,
        Logo: 'https://example.com/a.png',
        Signature: 'data:image/png;base64,iVBORw0KGgo=',
        Tags: ['A', 'B', 'C'],
      },
    })

    const types = Object.fromEntries(r.fields.map((f) => [f.path, f.type]))
    expect(types['Header.Quantity']).toBe('number')
    expect(types['Header.Passed']).toBe('boolean')
    expect(types['Header.Logo']).toBe('image')
    expect(types['Header.Signature']).toBe('image')
    expect(types['Header.Tags']).toBe('array') // 标量数组 → 单个叶子，type=array
  })

  it('嵌套对象：递归展开为平铺叶子，不产生中间分组节点', () => {
    const r = introspectJson({
      Header: {
        Inspector: { Name: '张伟', Department: 'QA' },
      },
    })

    const paths = r.fields.map((f) => f.path).sort()
    // 关键：直接出叶子 path，不出现「Header.Inspector」这条（否则 DataSourceTree 会重复显示）
    expect(paths).toEqual(['Header.Inspector.Department', 'Header.Inspector.Name'])
  })

  it('existingFields 同 path 沿用 label（标注优先）', () => {
    const existing: FieldDef[] = [
      { path: 'Header.ReportNo', label: '报告编号', type: 'string', group: '基础信息' },
      { path: 'Header.Inspector', label: '检验员', type: 'string' },
    ]
    const r = introspectJson(
      { Header: { ReportNo: 'X-1', Inspector: '李四', NewField: 1 } },
      { existingFields: existing },
    )

    const reportNo = r.fields.find((f) => f.path === 'Header.ReportNo')!
    expect(reportNo.label).toBe('报告编号') // ← 沿用
    expect(reportNo.group).toBe('基础信息') // ← 沿用
    const inspector = r.fields.find((f) => f.path === 'Header.Inspector')!
    expect(inspector.label).toBe('检验员')
    const newField = r.fields.find((f) => f.path === 'Header.NewField')!
    expect(newField.label).toBe('NewField') // ← 新字段无标注，回退到键名
  })

  it('顶层叶子（字符串/数字）归入 __root__ 主表', () => {
    const r = introspectJson({
      PlainString: 'hello',
      PlainNumber: 42,
    })

    expect(r.meta.tables).toEqual([
      { id: '__root__', name: '根对象', relation: 'main', pathPrefix: '', isArray: false },
    ])
    const paths = r.fields.map((f) => f.path).sort()
    expect(paths).toEqual(['PlainNumber', 'PlainString'])
  })

  it('sourceId / sourceName 透传：注入到指定数据源', () => {
    const r = introspectJson(
      { Header: { ReportNo: 'X' } },
      { sourceId: 'inspection-report', sourceName: '原料检验报告（matcher）' },
    )
    expect(r.meta.id).toBe('inspection-report')
    expect(r.meta.name).toBe('原料检验报告（matcher）')
    expect(r.meta.description).toMatch(/1 字段/)
  })

  it('半成品示例数据：只导出数据里实际有的字段（验收"目录-数据同步"主线场景）', () => {
    // 模拟半成品 JSON：没有 SupplierName/MaterialName
    const r = introspectJson({
      Header: { ReportNo: 'SF-2026-01', Quantity: 100, InspectionDate: '2026-08-12' },
      ReportItems: [{ Item: '目检', Result: '合格', Val: 99.5 }],
    })

    const paths = r.fields.map((f) => f.path)
    // 关键：不出现 SupplierName/MaterialName（因为数据里没有）
    expect(paths.some((p) => p.includes('SupplierName'))).toBe(false)
    expect(paths.some((p) => p.includes('MaterialName'))).toBe(false)
    // 该有的都有
    expect(paths).toContain('Header.ReportNo')
    expect(paths).toContain('Header.Quantity')
    expect(paths).toContain('ReportItems[].Item')
    expect(paths).toContain('ReportItems[].Val')
  })

  it('每个 FieldDef 都带 tableId（fieldTree 按它分组，缺了就渲染不出来）', () => {
    // ★ 关键回归：fieldCatalog.fieldTree 用 f.tableId 做分组键，
    //   introspectJson 不写 tableId 时所有字段会被分到 '' 表下，
    //   DataSourceTree 一片空白。
    const r = introspectJson({
      Header: { ReportNo: 'X' },
      ReportItems: [{ Item: 'A' }],
    })

    for (const f of r.fields) {
      expect(f.tableId, `field ${f.path} 缺 tableId`).toBeTruthy()
    }
    expect(r.fields.find((f) => f.path === 'Header.ReportNo')?.tableId).toBe('Header')
    expect(r.fields.find((f) => f.path === 'ReportItems[].Item')?.tableId).toBe('ReportItems')
  })
})
