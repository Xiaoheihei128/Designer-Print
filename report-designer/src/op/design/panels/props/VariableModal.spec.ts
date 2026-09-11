/**
 * 回归:VariableModal.vue 模板里用到的 row.* 派生函数必须 import 进 setup,
 * 否则运行期 ReferenceError → 弹窗里 row 分组渲染挂掉 + 右侧面板锁死。
 *
 * 历史坑:VariableModal 在 setup 里调用了 deriveRowScopedGroupLabel,
 * 但 import 行只导了 deriveRowScopedFields / type RowScopedField,
 * 漏了 deriveRowScopedGroupLabel。打开弹窗 → "is not defined" →
 * rowScopedGroupLabel computed 抛错 → 后续 rowScopedFields 等派生也被阻塞 →
 * 整个弹窗只显示骨架 / 看不到 row.* 分组,用户无法选 row.Photo。
 *
 * 通用检查(模板所有标识符 vs setup 所有 import 名)不实用:setup 内 const
 * 局部声明对模板可见但不在 importNames 里,误报率高。改成精准断言:
 * 历史 bug 涉及的两个派生函数必须 import。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET = resolve(HERE, 'VariableModal.vue')

describe('VariableModal.vue —— 关键派生函数 import 防回归', () => {
  const src = readFileSync(TARGET, 'utf-8')
  const scriptSetupMatch = src.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)
  if (!scriptSetupMatch) throw new Error('找不到 <script setup> 块')
  const setup = scriptSetupMatch[1]!

  /** 从整段 setup 文本里抓所有 named import 名,跨行 OK。 */
  const importNames = new Set<string>()
  const re = /import\s+(?:type\s+)?([\s\S]+?)\s+from\s+['"][^'"]+['"]\s*,?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(setup))) {
    const clause = m[1]!
    // 默认导入 `Foo` 或 `Foo as Bar`(named 前缀)
    if (!/^\s*\{/.test(clause)) {
      const def = clause.match(/^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*(,|$)/)
      if (def) importNames.add(def[2] ?? def[1]!)
    }
    const named = clause.match(/\{([\s\S]+)\}/)
    if (named) {
      for (const part of named[1]!.split(',')) {
        const n = part.trim()
        if (!n) continue
        const cleaned = n.startsWith('type ') ? n.slice(5).trim() : n
        const nm = cleaned.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/)
        if (nm) importNames.add(nm[2] ?? nm[1]!)
      }
    }
  }

  it('deriveRowScopedGroupLabel 已被 import(Bug 修复:历史上漏导 → 弹窗 ReferenceError → row 分组消失 + 右侧锁死)', () => {
    expect(importNames.has('deriveRowScopedGroupLabel')).toBe(true)
  })

  it('deriveRowScopedFields 已被 import(配套使用,row.* 选项派生核心)', () => {
    expect(importNames.has('deriveRowScopedFields')).toBe(true)
  })

  it('RowScopedField 类型已被 import(模板 / 内部函数都需要)', () => {
    expect(importNames.has('RowScopedField')).toBe(true)
  })
})
