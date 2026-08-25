// report-designer 冒烟测试
// 验证:服务器可访问 + 设计器页面渲染 + 静态表格单元格绑定/上插行 + 预览绑定值
// 用法: node scripts/smoke.mjs [baseUrl]    (默认 http://localhost:5173)
// 依赖: puppeteer-core(如缺失会给出安装提示)

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] || 'http://localhost:5173'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- 0. 先做 HTTP 探活,服务器没起就不浪费时间 ----
const probe = await fetch(BASE).then(r => r.status).catch(() => 0)
if (probe !== 200) {
  console.error(`❌ 服务器未运行(${BASE} 返回 ${probe})。`)
  console.error('   在 report-designer 目录执行: npm run dev')
  process.exit(1)
}
console.log(`✅ 服务器可达: ${BASE}`)

// ---- 1. 加载 puppeteer-core(不在项目依赖中,可选) ----
let puppeteer
try {
  puppeteer = await import('puppeteer-core')
} catch {
  console.error('❌ 未找到 puppeteer-core,跳过浏览器验证。')
  console.error('   安装: npm i -D puppeteer-core   (然后重跑本脚本)')
  process.exit(0)
}

const CHROME_CANDIDATES = [
  'C:/Users/Lenovo/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const CHROME = CHROME_CANDIDATES.find(p => existsSync(p))
if (!CHROME) {
  console.error('❌ 未找到 Chrome/Edge,请修改 scripts/smoke.mjs 顶部的 CHROME_CANDIDATES')
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1920, height: 1080 },
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message.slice(0, 150)))
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 150)) })

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

// ---- 2. 设计器页面基础渲染 ----
await page.goto(BASE + '/designer', { waitUntil: 'networkidle2', timeout: 30000 })
await sleep(2500)
const base = await page.evaluate(() => ({
  tools: [...document.querySelectorAll('.toolsbar *')].some(e => e.textContent.trim() === '静态表格'),
  tree: document.querySelectorAll('.el-tree-node').length > 0,
  corner: Boolean(document.querySelector('.ruler-corner')),
  rulerH: Boolean(document.querySelector('.ruler-h')),
  rulerV: Boolean(document.querySelector('.ruler-v')),
}))
check('工具栏控件齐全', base.tools)
check('数据源树渲染', base.tree)
check('标尺角标存在(修复①)', base.corner)
check('横/纵标尺存在', base.rulerH && base.rulerV)

// ---- 3. 添加静态表格 + 列头槽位对齐 ----
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.toolsbar *')].find(e => e.textContent.trim() === '静态表格' && e.children.length === 0)
  el?.closest('div')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(1200)
const table = await page.evaluate(() => {
  const rect = el => el?.getBoundingClientRect()
  const gutter = rect(document.querySelector('.static-table-col-gutter'))
  const rowHeader = rect(document.querySelector('.static-table-row-header'))
  const colHeader = rect(document.querySelector('.static-table-col-header'))
  const firstCell = rect(document.querySelector('.static-table-row .static-table-cell'))
  return {
    rows: document.querySelectorAll('.static-table-row').length,
    gutterEqRowHeader: gutter && rowHeader ? Math.abs(gutter.width - rowHeader.width) < 1 : false,
    colHeaderEqFirstCell: colHeader && firstCell ? Math.abs(colHeader.left - firstCell.left) < 1 : false,
  }
})
check('静态表格添加成功', table.rows >= 4, `行数=${table.rows}`)
check('列头槽位与行号对齐(修复①)', table.gutterEqRowHeader)
check('列头与首格左对齐(修复①)', table.colHeaderEqFirstCell)

// ---- 4. 单元格绑定字段(修复②) ----
await page.evaluate(() => {
  const cell = document.querySelectorAll('.static-table-row')[1]?.querySelector('.static-table-cell')
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(400)
await page.evaluate(() => {
  const leaf = [...document.querySelectorAll('.el-tree-node')].find(n => n.textContent.trim() === 'ReportNo')
  leaf?.querySelector('.el-tree-node__content')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
const boundText = await page.evaluate(() => {
  const rows = document.querySelectorAll('.static-table-row')
  return rows[1]?.querySelector('.static-table-cell')?.textContent.trim() || null
})
check('单元格绑定字段显示路径(修复②)', boundText === '{Header.ReportNo}', boundText || 'null')

// ---- 5. 上插行,绑定跟随(修复③) ----
await page.evaluate(() => {
  const cell = document.querySelectorAll('.static-table-row')[1]?.querySelector('.static-table-cell')
  cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 400 }))
})
await sleep(400)
const insertClicked = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.static-cell-contextmenu .ctx-item')].find(e => e.textContent.includes('上插行'))
  if (!item) return false
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})
await sleep(600)
const afterInsert = await page.evaluate(() => {
  const rows = document.querySelectorAll('.static-table-row')
  const cells = [...rows].map(r => r.querySelector('.static-table-cell')?.textContent.trim())
  const boundIdx = cells.findIndex(t => t === '{Header.ReportNo}')
  return { rows: rows.length, boundRowIndex: boundIdx }
})
check('上插行菜单可用', insertClicked)
check('上插行后绑定仍在(修复③)', afterInsert.rows === 5 && afterInsert.boundRowIndex === 2,
  `行数=${afterInsert.rows}, 绑定在第${afterInsert.boundRowIndex}行`)

// ---- 6. 预览出现绑定数据(修复③) ----
const previewOpened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.el-button')].find(b => b.textContent.trim() === '预览')
  if (!btn) return false
  btn.click()
  return true
})
await sleep(2500)
const preview = await page.evaluate(() => {
  const container = document.querySelector('.preview-container')
  return { opened: Boolean(container), hasValue: container?.innerHTML.includes('RM-2026-00123') ?? false }
})
check('预览打开', previewOpened && preview.opened)
check('预览包含绑定数据(修复③)', preview.hasValue)

console.log('--- 页面错误 ---')
console.log(pageErrors.length ? pageErrors.join('\n') : '(无)')
if (pageErrors.length) failures++

await browser.close()
console.log(failures === 0 ? '\n🎉 全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
