/**
 * ContentValueEditor 内部纯函数单测
 *
 * 覆盖：isAutoMigratedFieldOnly —— Bug8 修复关键判定
 */
import { describe, expect, it } from 'vitest'
import { isAutoMigratedFieldOnly } from './content-value-helpers'

describe('isAutoMigratedFieldOnly (Bug8 fix)', () => {
  it('single field segment matching cell.field with no leftover text -> true', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'field', path: 'order.orderNo' }],
        field: 'order.orderNo',
      }),
    ).toBe(true)
  })

  it('multiple segments (user already has text mixed in) -> false (append path)', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [
          { kind: 'text', value: 'sum: ' },
          { kind: 'field', path: 'order.orderNo' },
        ],
        field: 'order.orderNo',
      }),
    ).toBe(false)
  })

  it('single field segment but field does not match -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'field', path: 'order.total' }],
        field: 'order.orderNo',
      }),
    ).toBe(false)
  })

  it('single field segment but value has text content -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'field', path: 'order.orderNo' }],
        field: 'order.orderNo',
        value: 'any text',
      }),
    ).toBe(false)
  })

  it('cell.field empty -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'field', path: 'order.orderNo' }],
      }),
    ).toBe(false)
  })

  it('segments undefined -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        field: 'order.orderNo',
      }),
    ).toBe(false)
  })

  it('single expr segment (legacy text-based binding) -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'expr', src: 'order.orderNo' }],
        field: 'order.orderNo',
      }),
    ).toBe(false)
  })

  it('single text segment with mustache placeholder -> false', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'text', value: '{{order.orderNo}}' }],
        field: 'order.orderNo',
      }),
    ).toBe(false)
  })

  /**
   * Bug8 regression: root-cause scenario.
   * ensureSegments migrates cell.field into segments=[{field,'order.orderNo'}];
   * subsequent VariableModal selection should be treated as REBIND (overwrite),
   * not APPEND.
   */
  it('Bug8 regression: auto-migrated single field segment + matching field + clean leftover = true', () => {
    expect(
      isAutoMigratedFieldOnly({
        segments: [{ kind: 'field', path: 'order.orderNo' }],
        field: 'order.orderNo',
        value: '',
        expression: '',
      }),
    ).toBe(true)
  })
})