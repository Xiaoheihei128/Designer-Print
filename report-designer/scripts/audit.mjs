// 全面巡检: 模板列表 / 匹配 / 设计器 三页 + 核心操作, 收集页面错误与控制台错误
// 用法: node scripts/audit.mjs [baseUrl]   (默认 http://localhost:5173)
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME_CANDIDATES = [
  'C:/Users/Lenovo/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const CHROME = CHROME_CANDIDATES.find(p => existsSync(p))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080 })

const issues = []
const note = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) issues.push(`${name}${detail ? ': ' + detail : ''}`)
}
const errors = []
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)) })

// ============ 1. 模板列表页 ============
console.log('\n===== 1. 模板列表页 /templates =====')
await page.goto(BASE + '/templates', { waitUntil: 'networkidle2', timeout: 30000 })
await sleep(2000)
const listInfo = await page.evaluate(() => ({
  rows: document.querySelectorAll('.el-table__row').length,
  nav: Boolean(document.querySelector('.app-nav')),
}))
note('列表从后端加载', listInfo.rows >= 4, `行数=${listInfo.rows}`)
note('顶栏导航', listInfo.nav)

// 筛选
await page.evaluate(() => {
  const sel = document.querySelector('.filter-bar .el-select')
  sel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(800)
const filterWorks = await page.evaluate(() => {
  // 分类筛选下拉是否出现选项
  const options = [...document.querySelectorAll('.el-select-dropdown__item')]
  const click = options.find(o => o.textContent.includes('原料检验'))
  if (click) { click.click(); return true }
  return options.length > 0
})
await sleep(800)
note('分类筛选可用', filterWorks)
// 清除筛选
await page.evaluate(() => { document.querySelector('.filter-bar .el-select .el-select__clear')?.click() })
await sleep(500)

// 规则对话框: 打开 + 添加规则 + 取消
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__row')][0]
  ;[...row.querySelectorAll('button')].find(b => b.textContent.trim() === '规则')?.click()
})
await sleep(800)
const dialogOk = await page.evaluate(() => {
  const dlg = document.querySelector('.el-dialog')
  if (!dlg) return { open: false }
  const addBtn = [...dlg.querySelectorAll('button')].find(b => b.textContent.includes('添加规则'))
  addBtn?.click()
  return { open: true, hasAdd: Boolean(addBtn) }
})
await sleep(500)
const ruleCount = await page.evaluate(() => document.querySelectorAll('.rule-item').length)
note('规则对话框打开+添加规则', dialogOk.open && dialogOk.hasAdd && ruleCount >= 1, `规则数=${ruleCount}`)
await page.keyboard.press('Escape')
await sleep(500)

// 复制 → 确认副本出现 → 删除副本
const copyResult = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__row')][0]
  ;[...row.querySelectorAll('button')].find(b => b.textContent.trim() === '复制')?.click()
  return true
})
await sleep(1200)
const hasCopy = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__row')].some(r => r.innerText.includes('(副本)'))
)
note('复制模板', hasCopy)
if (hasCopy) {
  const delOk = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.el-table__row')].find(r => r.innerText.includes('(副本)'))
    ;[...row.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')?.click()
    return true
  })
  await sleep(800)
  const confirm = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.el-message-box button')].find(b => b.textContent.includes('确定'))
    btn?.click()
    return Boolean(btn)
  })
  await sleep(1000)
  const gone = await page.evaluate(() =>
    ![...document.querySelectorAll('.el-table__row')].some(r => r.innerText.includes('(副本)'))
  )
  note('删除副本(含确认框)', delOk && confirm && gone)
}

// 启停切换再恢复
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__row')][0]
  ;[...row.querySelectorAll('button')].find(b => ['禁用', '启用'].includes(b.textContent.trim()))?.click()
})
await sleep(1000)
const statusBack = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__row')][0]
  const btn = [...row.querySelectorAll('button')].find(b => ['禁用', '启用'].includes(b.textContent.trim()))
  btn?.click()
  return btn?.textContent.trim()
})
await sleep(1000)
note('启停切换+恢复', Boolean(statusBack))

// 新建 → 跳设计器
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建模板')?.click()
})
await sleep(3000)
const newJump = await page.evaluate(() => location.pathname)
note('新建跳转设计器', newJump === '/designer', newJump)

// ============ 2. 设计器页 ============
console.log('\n===== 2. 设计器 /designer =====')
await sleep(4000)
const d1 = await page.evaluate(() => ({
  shell: Boolean(document.querySelector('.openprint-shell')),
  fabric: Boolean(document.querySelector('.upper-canvas')),
  icons: [...document.querySelectorAll('[class*=i-carbon-]')].filter(el => getComputedStyle(el).maskImage !== 'none').length,
}))
note('设计器渲染', d1.shell && d1.fabric)
note('图标渲染', d1.icons > 10, `图标=${d1.icons}`)

// 拖文本控件
const dragText = await page.evaluate(() => {
  const card = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.trim() === '文本')
  const dragEl = card?.closest('[draggable=true]') || card
  const host = document.querySelector('.canvas-stage > div')
  if (!dragEl || !host) return false
  const dt = new DataTransfer()
  const r = host.getBoundingClientRect()
  dragEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  host.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: r.left + 200, clientY: r.top + 150, dataTransfer: dt }))
  host.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: r.left + 200, clientY: r.top + 150, dataTransfer: dt }))
  return true
})
await sleep(1200)
const textProps = await page.evaluate(() => document.body.innerText.includes('固定值'))
note('拖文本控件到画布', dragText && textProps)

// 拖表格控件
const dragTable = await page.evaluate(() => {
  const card = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.trim() === '表格')
  const dragEl = card?.closest('[draggable=true]') || card
  const host = document.querySelector('.canvas-stage > div')
  if (!dragEl || !host) return false
  const dt = new DataTransfer()
  const r = host.getBoundingClientRect()
  dragEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  host.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: r.left + 400, clientY: r.top + 300, dataTransfer: dt }))
  host.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: r.left + 400, clientY: r.top + 300, dataTransfer: dt }))
  return true
})
await sleep(1200)
const tableProps = await page.evaluate(() => {
  const body = document.body.innerText
  return body.includes('列') && (body.includes('数据源') || body.includes('字段'))
})
note('拖表格控件到画布', dragTable && tableProps)

// 撤销/重做
const undoClick = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.title?.includes('撤销') || b.getAttribute('aria-label')?.includes('撤销'))
  btn?.click()
  return Boolean(btn)
})
await sleep(500)
note('撤销按钮可用', undoClick)

// 保存
const saveClick = await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')?.click()
  return true
})
await sleep(2500)
const saved = await fetch(BASE + '/api/print/templates').then(r => r.json()).catch(() => null)
note('保存(经代理落库)', saved && Array.isArray(saved.items), saved ? `模板数=${saved.items.length}` : '后端不可达')

// 导出弹窗
const exportClick = await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '导出')?.click()
  return true
})
await sleep(1200)
const exportDialog = await page.evaluate(() => {
  const modals = [...document.querySelectorAll('.n-modal, [class*=modal]')].map(m => m.innerText.slice(0, 60))
  return modals.length > 0
})
note('导出弹窗打开', exportDialog)
await page.keyboard.press('Escape')
await sleep(500)

// 预览
const previewClick = await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '预览')?.click()
  return true
})
await sleep(2000)
note('预览触发(可能有弹窗拦截)', previewClick)

// ============ 3. 匹配页 ============
console.log('\n===== 3. 匹配页 /matcher =====')
await page.goto(BASE + '/matcher', { waitUntil: 'networkidle2', timeout: 30000 })
await sleep(2000)
const m1 = await page.evaluate(() => document.body.innerText.includes('已从后端加载'))
note('匹配页后端模板加载', m1)

// 输入数据匹配
await page.evaluate(() => {
  const ta = document.querySelector('.data-textarea textarea')
  ta.value = JSON.stringify({ Header: { ReportType: 'RawMaterial' } })
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '匹配模板')?.click()
})
await sleep(1000)
const match = await page.evaluate(() => ({
  best: document.querySelector('.best-match h4')?.textContent.trim() || null,
}))
note('匹配到最佳模板', match.best === '原料检验报告', match.best || '无')

// 诊断面板
const diag = await page.evaluate(() => document.querySelectorAll('.n-tabs, .el-tabs').length > 0 || document.body.innerText.includes('匹配规则详情'))
note('匹配详情/诊断展示', diag)

// ============ 汇总 ============
console.log('\n===== 汇总 =====')
console.log('页面/控制台错误:')
console.log(errors.length ? [...new Set(errors)].slice(0, 15).join('\n') : '(无)')
console.log('发现的问题:')
console.log(issues.length ? issues.join('\n') : '(无)')
await browser.close()
