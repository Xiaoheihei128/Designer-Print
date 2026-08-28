/**
 * ContentValueEditor 内部纯函数（提取出来便于单测）
 */
import type { Segment } from '@op/types/control'

/**
 * Bug8 修复：检测 cell 当前 segments 是否处于「legacy field 自动迁移」状态。
 *
 * 典型场景：用户打开一个**含 cell.field='X'**的单元格（例如数据表的列默认字段），
 * CellToolbar 的 watch 触发 ensureSegments 把 field 镜像为 segments=[{field,'X'}]。
 * 此时用户通过 VariableModal 选**新**字段 path，**重绑意图**而非「在原字段后再追加」。
 *
 * 判定条件（必须同时满足）：
 * - segments 仅含 1 个 field 段
 * - cell.field 非空且与 segments[0].path 严格匹配
 * - cell.value（text/expression）为空 —— 用户没手写文本，可视为「纯字段态」
 *
 * @returns true → onVarConfirm 应走覆盖路径（更新 cell.field + 替换 segments）
 *          false → 走原有 segments 追加 / 覆盖逻辑
 */
export function isAutoMigratedFieldOnly(opts: {
  segments?: Segment[]
  field?: string
  value?: string
  expression?: string
}): boolean {
  const segs = opts.segments
  if (!segs || segs.length !== 1) return false
  const s = segs[0]!
  if (s.kind !== 'field') return false
  if (!opts.field) return false
  if (opts.field !== s.path) return false
  if ((opts.value ?? '').trim()) return false
  if ((opts.expression ?? '').trim()) return false
  return true
}