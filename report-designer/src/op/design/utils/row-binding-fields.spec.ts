/**
 * row-binding-fields —— 首卡行上下文（row.*）派生函数单测
 *
 * 验证 4 个边界:
 *  - 无 hostLabelGrid / 未配 dataSource → 返回 null
 *  - dataSource 指向的明细表不是数组 → 返回 null
 *  - 对应表存在但 flatFields 为空 → 返回 null
 *  - 正常派生 → row.* 路径正确,label/sample/type 沿用原字段
 */
import { describe, expect, it } from 'vitest'
import type { FieldDef, DataSourceMeta } from '@op/types/datasource'
import type { LabelGridControl } from '@op/types/control'
import { deriveRowScopedFields, deriveRowScopedGroupLabel } from './row-binding-fields'

/* ------------------------------ 测试夹具 ------------------------------ */

const ds: DataSourceMeta = {
  id: 'ds1',
  name: '原料检验',
  tables: [
    { id: 'main', name: '主表', relation: 'main', pathPrefix: 'Header.', isArray: false },
    { id: 'ReportItems', name: '检验明细', relation: 'detail', pathPrefix: 'ReportItems[]', isArray: true },
  ],
}

const fields: FieldDef[] = [
  { path: 'Header.ReportNo', label: '报告编号', type: 'string', tableId: 'main' },
  { path: 'ReportItems[].Item', label: '检验项目', type: 'string', tableId: 'ReportItems', sample: '外观' },
  { path: 'ReportItems[].Photo', label: '样本照片', type: 'image', tableId: 'ReportItems' },
  {
    path: 'ReportItems[].FinalVal',
    label: '测定值',
    type: 'number',
    tableId: 'ReportItems',
    sample: 0.872,
  },
]

const gridWithDS = (dataSource?: string): LabelGridControl => ({
  id: 'grid1',
  type: 'labelgrid',
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  columns: 3,
  dataSource,
  children: [],
  printable: true,
})

/* ------------------------------ 测试用例 ------------------------------ */

describe('deriveRowScopedFields', () => {
  it('无 hostLabelGrid → null', () => {
    expect(
      deriveRowScopedFields({ hostLabelGrid: null, activeSource: ds, flatFields: fields }),
    ).toBeNull()
  })

  it('hostLabelGrid 未配 dataSource → null（纯布局平铺不应有 row 上下文）', () => {
    expect(
      deriveRowScopedFields({
        hostLabelGrid: gridWithDS(undefined),
        activeSource: ds,
        flatFields: fields,
      }),
    ).toBeNull()
  })

  it('dataSource 指向的明细表不是数组 → null', () => {
    expect(
      deriveRowScopedFields({
        hostLabelGrid: gridWithDS('Header'),
        activeSource: ds,
        flatFields: fields,
      }),
    ).toBeNull()
  })

  it('对应明细表存在但 flatFields 里无该表字段 → null', () => {
    expect(
      deriveRowScopedFields({
        hostLabelGrid: gridWithDS('ReportItems'),
        activeSource: ds,
        flatFields: [{ path: 'Header.ReportNo', label: '报告编号', type: 'string', tableId: 'main' }],
      }),
    ).toBeNull()
  })

  it('正常派生:ReportItems[].X → row.X,沿用 label/type/sample', () => {
    const result = deriveRowScopedFields({
      hostLabelGrid: gridWithDS('ReportItems'),
      activeSource: ds,
      flatFields: fields,
    })
    expect(result).not.toBeNull()
    expect(result).toEqual([
      {
        path: 'row.Item',
        label: '检验项目',
        type: 'string',
        samplePath: 'ReportItems[].Item',
        sample: '外观',
      },
      {
        path: 'row.Photo',
        label: '样本照片',
        type: 'image',
        samplePath: 'ReportItems[].Photo',
        sample: undefined,
      },
      {
        path: 'row.FinalVal',
        label: '测定值',
        type: 'number',
        samplePath: 'ReportItems[].FinalVal',
        sample: 0.872,
      },
    ])
  })

  it('activeSource 为 null → null', () => {
    expect(
      deriveRowScopedFields({
        hostLabelGrid: gridWithDS('ReportItems'),
        activeSource: null,
        flatFields: fields,
      }),
    ).toBeNull()
  })

  it('pathPrefix 末尾带点号（如 ReportItems[].）也能正确派生', () => {
    const dsWithDot: DataSourceMeta = {
      ...ds,
      tables: [{ ...ds.tables[1]!, pathPrefix: 'ReportItems[].' }],
    }
    const result = deriveRowScopedFields({
      hostLabelGrid: gridWithDS('ReportItems'),
      activeSource: dsWithDot,
      flatFields: fields,
    })
    expect(result?.map((f) => f.path)).toEqual(['row.Item', 'row.Photo', 'row.FinalVal'])
  })
})

describe('deriveRowScopedGroupLabel', () => {
  it('派生分组标签:含明细表中文名', () => {
    expect(
      deriveRowScopedGroupLabel({
        hostLabelGrid: gridWithDS('ReportItems'),
        activeSource: ds,
        flatFields: fields,
      }),
    ).toBe('首卡行上下文(检验明细)')
  })

  it('未配 dataSource → null', () => {
    expect(
      deriveRowScopedGroupLabel({
        hostLabelGrid: gridWithDS(undefined),
        activeSource: ds,
        flatFields: fields,
      }),
    ).toBeNull()
  })
})