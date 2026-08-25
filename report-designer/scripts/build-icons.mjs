// 生成 carbon 图标静态 CSS(unocss presetIcons 66.8.1 自动加载在本环境失效,
// 此脚本直接读取 @iconify-json/carbon 数据集, 输出 public/icons.css 供全局引用)
// 用法: node scripts/build-icons.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { iconToSVG, iconToHTML } from '@iconify/utils'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICONS_JSON = JSON.parse(
  readFileSync(join(ROOT, 'node_modules/@iconify-json/carbon/icons.json'), 'utf-8')
)

// 1. 扫描 src/op 里所有 i-carbon-* 类名(静态出现)
const iconNames = new Set()
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full)
    } else if (/\.(vue|ts|mjs|js)$/.test(entry)) {
      const text = readFileSync(full, 'utf-8')
      for (const m of text.matchAll(/i-carbon-([a-z0-9-]+)/g)) iconNames.add(m[1])
    }
  }
}
walk(join(ROOT, 'src'))

// 2. 合并 uno.config.ts 的 safelist(动态拼接图标)
const unoConfig = readFileSync(join(ROOT, 'uno.config.ts'), 'utf-8')
for (const m of unoConfig.matchAll(/i-carbon-([a-z0-9-]+)/g)) iconNames.add(m[1])

// 3. 生成 CSS(mask 模式, 跟随 currentColor)
const missing = []
let css = '/* 由 scripts/build-icons.mjs 生成 - 勿手改 */\n'
for (const name of [...iconNames].sort()) {
  const icon = ICONS_JSON.icons?.[name]
  if (!icon) { missing.push(name); continue }
  const svg = iconToSVG(icon, { height: '1em', width: '1em' })
  const html = iconToHTML(svg.body, svg.attributes)
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(html)}`
  css += `.i-carbon-${name} {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  background-color: currentColor;
  -webkit-mask: url("${dataUri}") center / contain no-repeat;
  mask: url("${dataUri}") center / contain no-repeat;
}
`
}

writeFileSync(join(ROOT, 'public/icons.css'), css)
console.log(`✅ 生成 ${iconNames.size} 个图标 CSS → public/icons.css`)
if (missing.length) console.log(`⚠️ 缺失图标(${missing.length}): ${missing.slice(0, 10).join(', ')}`)
