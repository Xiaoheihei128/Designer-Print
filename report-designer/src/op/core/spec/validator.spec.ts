import { describe, expect, it } from 'vitest'

import { assertTemplate } from '@op/core/spec/validator'
import type { TemplateData } from '@op/types/template'

describe('template 协议：常驻辅助线字段', () => {
  const base = {
    version: '1.0',
    document: {
      type: 'report' as const,
      page: {
        width: 210,
        height: 297,
        unit: 'mm' as const,
        orientation: 'portrait' as const,
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
      },
      sections: [
        {
          type: 'body' as const,
          components: [
            {
              id: 'r1',
              type: 'rect' as const,
              left: 10,
              top: 10,
              width: 40,
              height: 25,
            },
          ],
        },
      ],
    },
  }

  it('允许控件带 showGuides 字段', () => {
    const t = {
      ...base,
      document: {
        ...base.document,
        sections: [
          {
            type: 'body' as const,
            components: [
              {
                id: 'r1',
                type: 'rect' as const,
                left: 10,
                top: 10,
                width: 40,
                height: 25,
                showGuides: true,
              },
            ],
          },
        ],
      },
    } as unknown as TemplateData
    expect(() => assertTemplate(t)).not.toThrow()
  })
})

/**
 * columns 字段在 schema 层面按 type 分支：
 * - table.columns   = 列定义数组（每个 item 必须含 title + width）
 * - labelgrid.columns = 每行列数（number, ≥1）
 *
 * 历史 bug：labelgrid.columns 写的是 number（每行列数），但 schema 里 columns
 * 单一地约束为 array of object，导致保存含标签网格的模板时报
 * "/document/sections/0/components/N/columns: must be array" 校验失败。
 * 修复：schema 用 anyOf 同时接受 number 与 array of object；语义在运行时层
 * （layout-engine）按 control.type 区分。
 */
describe('columns 字段按控件 type 分支', () => {
  function withComponents(components: unknown[]): unknown {
    return {
      version: '1.0',
      document: {
        type: 'report' as const,
        page: {
          width: 210,
          height: 297,
          unit: 'mm' as const,
          orientation: 'portrait' as const,
          margin: { top: 10, bottom: 10, left: 10, right: 10 },
        },
        sections: [
          {
            type: 'body' as const,
            components,
          },
        ],
      },
    }
  }

  it('labelgrid.columns = number (每行列数) → 校验通过', () => {
    const tpl = withComponents([
      {
        id: 'lg-1',
        type: 'labelgrid',
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        columns: 3,
        children: [],
      },
    ]) as TemplateData
    expect(() => assertTemplate(tpl)).not.toThrow()
  })

  it('table.columns = 列定义数组（每项含 title + width）→ 校验通过', () => {
    const tpl = withComponents([
      {
        id: 't-1',
        type: 'table',
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        columns: [{ title: '名称', width: 50 }, { title: '数量', width: 50 }],
      },
    ]) as TemplateData
    expect(() => assertTemplate(tpl)).not.toThrow()
  })

  it('table.columns 数组缺 title → 校验失败（强约束仍在）', () => {
    const tpl = withComponents([
      {
        id: 't-1',
        type: 'table',
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        columns: [{ width: 50 }],
      },
    ]) as TemplateData
    expect(() => assertTemplate(tpl)).toThrow()
  })
})
