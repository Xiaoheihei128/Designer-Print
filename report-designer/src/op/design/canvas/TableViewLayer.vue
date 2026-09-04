<script setup lang="ts">
/**
 * TableViewLayer —— 表格 HTML overlay（方案 A 的载体）
 *
 * 设计期表格不再由 Fabric 画位图，而是用**真 DOM 表格**绝对定位覆盖在画布上，
 * transform 与 Fabric 节点（left/top/scale/angle）+ 视口（zoom/offset）实时同步。
 * 由于渲染 HTML 与运行期 html-renderer 同构、CSS 来自同一个 `tableCss()`，
 * 所以「设计所见」= 「打印所得」，且浏览器原生白送文本编辑 / 选区 / 键盘 / Excel 粘贴。
 *
 * 交互契约（关键）：
 * - 平时整层 `pointer-events:none`，所有点击照旧落到 Fabric（选中 / 拖拽 / 缩放不受影响）
 * - 双击表格 → Fabric 命中单元格 → store.editingCell 置位 → **仅该表**开启 pointer-events
 *   与 contenteditable，进入单元格编辑；Esc / 点击别处退出
 * - 编辑期间冻结该表 HTML（不因 store 变化重渲染），避免光标被吞
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDesignerStore } from '@op/design/stores/designer'
import { PrintTable } from './controls/PrintTable'
import { renderTableGridHtml } from './table-design-render'
import { tableCss } from '@op/core/renderer-html/css-generator'
import { buildDesignGrid, designRowInfo, patchCellText, rowRoleLabel } from '@op/core/layout-engine/table-cells'
import type { AnyControl, TableControl } from '@op/types/control'
import { MM_TO_PX } from '@op/utils/constants'
import CellToolbar from './CellToolbar.vue'

const store = useDesignerStore()

const layerRef = ref<HTMLElement | null>(null)
/** 编辑中表格的冻结 HTML：编辑期间不随 store 重渲染，保护光标 */
const frozenHtml = ref<string>('')
const toolbarPos = ref<{ x: number; y: number } | null>(null)

interface OverlayItem {
  id: string
  x: number
  y: number
  zoom: number
  angle: number
  widthMm: number
  heightMm: number
  html: string
}

const editingId = computed(() => store.editingCell?.controlId ?? null)
/** 待绑态单元格 id（与 editingCell 互斥） */
const pendingId = computed(() => store.pendingBindCell?.controlId ?? null)
/** 待绑态气泡位置（锚定到目标 td 顶部） */
const pendingBubblePos = ref<{ x: number; y: number } | null>(null)

/** 编辑行首列左侧的角色名标签（标题行 / 数据行 / 本页合计行 / 总计行 / 大写金额行）位置与文案 */
const rowLabelPos = ref<{ x: number; y: number } | null>(null)
const editingRowLabel = computed(() => {
  const control = editingControl.value
  const e = store.editingCell
  if (!control || !e) return ''
  return rowRoleLabel(buildDesignGrid(control), e.row)
})

/**
 * 给当前 pendingBindCell 对应的 td 打 `is-pending-bind` 类。
 * 设计期 v-html 输出已生成，DOM 后处理比改渲染函数更不侵入。
 */
watch(
  () => [store.pendingBindCell?.controlId, store.pendingBindCell?.row, store.pendingBindCell?.col, store.canvasTick] as const,
  async () => {
    await nextTick()
    // 清掉所有旧标记
    layerRef.value?.querySelectorAll('td.is-pending-bind').forEach((td) => td.classList.remove('is-pending-bind'))
    const p = store.pendingBindCell
    if (!p) {
      pendingBubblePos.value = null
      return
    }
    const wrap = wrapperOf(p.controlId)
    if (!wrap) {
      pendingBubblePos.value = null
      return
    }
    const td = wrap.querySelector<HTMLElement>(`td[data-row="${p.row}"][data-col="${p.col}"]`)
    if (!td) {
      pendingBubblePos.value = null
      return
    }
    td.classList.add('is-pending-bind')
    // 气泡定位：锚定到 td 顶部 + 上方 28px
    const a = td.getBoundingClientRect()
    const layer = layerRef.value
    if (!layer) return
    const b = layer.getBoundingClientRect()
    pendingBubblePos.value = { x: a.left - b.left, y: a.top - b.top - 28 }
  },
  { immediate: false },
)

/** 从 store 模型里取表格控件（overlay 写回的目标） */
function controlById(id: string): TableControl | undefined {
  const flat: AnyControl[] = [
    ...store.controls,
    ...store.zones.flatMap((z) => z.children),
  ]
  const hit = flat.find((c) => c.id === id)
  return hit?.type === 'table' ? (hit as TableControl) : undefined
}

/**
 * 每个表格一项：几何取自 Fabric 对象（拖拽/缩放过程中实时），内容取自 toControl()。
 * canvasTick 是显式依赖 —— Fabric 对象不是响应式的，靠画布事件驱动重算。
 */
const items = computed<OverlayItem[]>(() => {
  void store.canvasTick
  void store.controls
  void store.zones
  // Bug9 修复：显式把 frozenHtml 列为依赖。
  // editing 态下 overlay 用 frozenHtml 快照，若 items 不订阅 frozenHtml，
  // refreshFrozen 改 frozenHtml 后画布不会立刻刷新 —— 表现为「改了字段画布不变」。
  void frozenHtml.value
  const d = store.designer
  if (!d?.canvas) return []
  const vt = d.canvas.viewportTransform
  const zoom = vt[0] ?? 1
  const offsetX = vt[4] ?? 0
  const offsetY = vt[5] ?? 0
  const out: OverlayItem[] = []
  for (const obj of d.canvas.getObjects()) {
    if (!(obj instanceof PrintTable)) continue
    if (obj.visible === false) continue
    // 内容真相取自 store 模型（几何才从 Fabric 实时读），避免两边不同步
    const control = controlById(obj.controlId) ?? obj.toControl()
    out.push({
      id: obj.controlId,
      x: (obj.left ?? 0) * zoom + offsetX,
      y: (obj.top ?? 0) * zoom + offsetY,
      zoom,
      angle: obj.angle ?? 0,
      widthMm: obj.getScaledWidth() / MM_TO_PX,
      heightMm: obj.getScaledHeight() / MM_TO_PX,
      html:
        obj.controlId === editingId.value && frozenHtml.value
          ? frozenHtml.value
          : renderTableGridHtml(control),
    })
  }
  return out
})

function itemStyle(it: OverlayItem): Record<string, string> {
  return {
    // 先平移到节点屏幕坐标，再按节点角度旋转，最后套视口缩放 —— 顺序与 Fabric 完全一致
    transform: `translate(${it.x}px, ${it.y}px) rotate(${it.angle}deg) scale(${it.zoom})`,
    width: `${it.widthMm}mm`,
    height: `${it.heightMm}mm`,
  }
}

/* ------------------------------ 样式注入 ------------------------------ */

// 与打印产物共用同一份表格 CSS（tableCss），只是限定在 overlay 作用域内
const STYLE_ID = 'op-table-overlay-css'
onMounted(() => {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = tableCss('.op-table-overlay')
  document.head.appendChild(el)
})

/* ------------------------------ 编辑会话 ------------------------------ */

function wrapperOf(id: string): HTMLElement | null {
  return layerRef.value?.querySelector<HTMLElement>(`[data-table-id="${CSS.escape(id)}"]`) ?? null
}

function tdOf(id: string, row: number, col: number): HTMLElement | null {
  return wrapperOf(id)?.querySelector<HTMLElement>(`td[data-row="${row}"][data-col="${col}"]`) ?? null
}

function selectAll(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** 会话开始：冻结 HTML → 开 contenteditable → 聚焦目标单元格并全选 */
watch(
  () => editingId.value,
  async (id) => {
    if (!id) {
      frozenHtml.value = ''
      cleanupLiveInput()
      toolbarPos.value = null
      rowLabelPos.value = null
      return
    }
    const control = controlById(id)
    frozenHtml.value = control ? renderTableGridHtml(control) : ''
    await nextTick()
    enableEditing(id)
    installLiveInput(id)
    focusCell()
  },
)

/** 编辑目标单元格变化（Tab / 点击别的格子）→ 移动工具栏 */
watch(() => [store.editingCell?.row, store.editingCell?.col], () => void nextTick(syncToolbarPos))
watch(() => store.canvasTick, () => syncToolbarPos())

function enableEditing(id: string): void {
  const wrap = wrapperOf(id)
  if (!wrap) return
  for (const td of wrap.querySelectorAll('td')) {
    td.setAttribute('contenteditable', 'true')
    td.setAttribute('spellcheck', 'false')
  }
}

async function focusCell(): Promise<void> {
  const e = store.editingCell
  if (!e) return
  await nextTick()
  const td = tdOf(e.controlId, e.row, e.col)
  if (!td) return
  td.focus({ preventScroll: true })
  selectAll(td)
  syncToolbarPos()
}

function syncToolbarPos(): void {
  const e = store.editingCell
  const root = layerRef.value
  if (!e || !root) {
    toolbarPos.value = null
    return
  }
  const td = tdOf(e.controlId, e.row, e.col)
  if (!td) {
    toolbarPos.value = null
    return
  }
  const a = td.getBoundingClientRect()
  const b = root.getBoundingClientRect()
  toolbarPos.value = { x: a.left - b.left, y: a.top - b.top }
  // 行名标签：锚定到当前行首列左侧
  const firstTd = tdOf(e.controlId, e.row, 0)
  if (firstTd) {
    const fa = firstTd.getBoundingClientRect()
    rowLabelPos.value = { x: fa.left - b.left, y: fa.top - b.top }
  } else {
    rowLabelPos.value = null
  }
}

/* ------------------------------ 内容写回 ------------------------------ */

/** 把某个 td 的文本提交到模型（未变化则不入撤销栈）
 *
 * ★ 守卫：blur / click-outside 链路里浏览器可能把 contenteditable td 的
 *   innerText 清成空（focus 离开且无选区时部分浏览器自动清理 <br> 占位符），
 *   此时若 cell 已有非空 segments，再调 patchCellText 写入 segments=[]
 *   就会把用户已键入的内容覆盖为空。store 在 input 监听阶段已同步过
 *   最新值，这里直接跳过 commit，由 closeCellEditor 后 items 用 store
 *   当前 cell 自然渲染最新 segments。 */
function commitTd(td: HTMLElement): void {
  const id = td.closest<HTMLElement>('[data-table-id]')?.dataset.tableId
  if (!id) return
  const control = controlById(id)
  if (!control) return
  const row = Number(td.dataset.row)
  const col = Number(td.dataset.col)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return
  const raw = td.innerText ?? ''
  const text = raw.replace(/ /g, ' ').trim()
  // ★ 守卫：DOM 为空但 cell 已有 segments → 不覆盖（可能是 blur 副作用）
  if (!text) {
    const grid = buildDesignGrid(control)
    const cell = grid.cells[row]?.[col]
    if (cell?.segments?.length) return
  }
  const next = patchCellText(control, row, col, text)
  if (next === control) return
  store.updateControl(id, next)
}

/** editing 期 input 监听器：把用户在画布上的键入实时同步到 store，
 *  避免 blur/click-outside 链路里 td.innerText 被浏览器擦空后覆盖 store。 */
let liveInputCleanup: (() => void) | null = null
function installLiveInput(id: string): void {
  cleanupLiveInput()
  const wrap = wrapperOf(id)
  if (!wrap) return
  const handler = (e: Event): void => {
    const td = (e.target as HTMLElement | null)?.closest<HTMLElement>('td[data-row]')
    if (!td) return
    const row = Number(td.dataset.row)
    const col = Number(td.dataset.col)
    if (!Number.isFinite(row) || !Number.isFinite(col)) return
    const cur = controlById(id)
    if (!cur) return
    const raw = td.innerText ?? ''
    const text = raw.replace(/ /g, ' ').trim()
    if (!text) return  // 空内容不写，避免覆盖已存在 segments
    const next = patchCellText(cur, row, col, text)
    if (next === cur) return
    store.updateControlSilent(id, next)
  }
  wrap.addEventListener('input', handler, true)
  liveInputCleanup = () => wrap.removeEventListener('input', handler, true)
}
function cleanupLiveInput(): void {
  if (liveInputCleanup) {
    liveInputCleanup()
    liveInputCleanup = null
  }
}

function onFocusIn(e: FocusEvent): void {
  const td = (e.target as HTMLElement | null)?.closest<HTMLElement>('td[data-row]')
  const id = td?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId
  if (!td || !id) return
  store.openCellEditor(id, Number(td.dataset.row), Number(td.dataset.col))
  void nextTick(syncToolbarPos)
}

function onFocusOut(e: FocusEvent): void {
  const td = (e.target as HTMLElement | null)?.closest<HTMLElement>('td[data-row]')
  if (td) commitTd(td)
}

/** Tab / Enter 的下一个目标单元格（跨行回绕，越界返回 null） */
function nextCell(control: TableControl, row: number, col: number, dir: 1 | -1): { row: number; col: number } | null {
  const grid = buildDesignGrid(control)
  let r = row
  let c = col + dir
  if (c >= grid.colCount) {
    c = 0
    r += 1
  } else if (c < 0) {
    c = grid.colCount - 1
    r -= 1
  }
  if (r < 0 || r >= grid.rowCount) return null
  return { row: r, col: c }
}

async function moveTo(id: string, row: number, col: number): Promise<void> {
  store.openCellEditor(id, row, col)
  await nextTick()
  const td = tdOf(id, row, col)
  if (td) {
    td.focus({ preventScroll: true })
    selectAll(td)
  }
  syncToolbarPos()
}

function onKeyDown(e: KeyboardEvent): void {
  const td = (e.target as HTMLElement | null)?.closest<HTMLElement>('td[data-row]')
  const id = td?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId
  if (!td || !id) return

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    commitTd(td)
    exitEditing()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    commitTd(td)
    const control = controlById(id)
    if (!control) return
    const to = nextCell(control, Number(td.dataset.row), Number(td.dataset.col), e.shiftKey ? -1 : 1)
    if (to) void moveTo(id, to.row, to.col)
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    // Excel 习惯：回车提交并下移一行；末行则结束编辑
    e.preventDefault()
    commitTd(td)
    const control = controlById(id)
    if (!control) return
    const grid = buildDesignGrid(control)
    const r = Number(td.dataset.row) + 1
    if (r < grid.rowCount) void moveTo(id, r, Number(td.dataset.col))
    else exitEditing()
  }
}

/** 粘贴：一律纯文本；含制表符/换行时按 Excel 语义铺到多个单元格 */
function onPaste(e: ClipboardEvent): void {
  const td = (e.target as HTMLElement | null)?.closest<HTMLElement>('td[data-row]')
  const id = td?.closest<HTMLElement>('[data-table-id]')?.dataset.tableId
  if (!td || !id) return
  const text = e.clipboardData?.getData('text/plain') ?? ''
  e.preventDefault()
  if (!text) return

  const matrix = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((line) => line.split('\t'))
  if (matrix.length === 1 && matrix[0]!.length === 1) {
    document.execCommand('insertText', false, matrix[0]![0]!)
    return
  }

  const control = controlById(id)
  if (!control) return
  const grid = buildDesignGrid(control)
  const baseRow = Number(td.dataset.row)
  const baseCol = Number(td.dataset.col)
  let next: TableControl = control
  matrix.forEach((line, dr) => {
    line.forEach((value, dc) => {
      const r = baseRow + dr
      const c = baseCol + dc
      if (r >= grid.rowCount || c >= grid.colCount) return
      next = patchCellText(next, r, c, value)
    })
  })
  if (next !== control) {
    store.updateControl(id, next)
    refreshFrozen(id)
  }
}

/* ------------------------------ 会话收尾 ------------------------------ */

function exitEditing(): void {
  const e = store.editingCell
  if (e) {
    const td = tdOf(e.controlId, e.row, e.col)
    if (td) commitTd(td)
  }
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  store.closeCellEditor()
  // 不联动关闭快速面板：用户决策——CellToolbar 与快速面板关闭独立，
  // 关闭工具栏后用户仍可在快速面板上调整列配置，避免点击右栏误触发工具栏关闭。
}

/**
 * 工具栏改样式后重放 HTML（保留编辑态与焦点）
 *
 * Bug9 修复：除更新 frozenHtml 外，主动 bump canvasTick 触发 items 重算。
 * 背景：editing 态下 overlay 展示 frozenHtml 快照，若 items computed 未把
 * frozenHtml 列为依赖（或与 store.controls 的更新被合并到同一 tick 但
 * 控制流中间有别处读 items 的早返），画布会停留在旧字段占位符。bump 后
 * 强制 Vue 调度一次新渲染，避免与 CellToolbar apply 链路的竞态。
 */
async function refreshFrozen(id: string): Promise<void> {
  const control = controlById(id)
  if (!control) return
  frozenHtml.value = renderTableGridHtml(control)
  store.bumpCanvasTick()
  await nextTick()
  enableEditing(id)
  void focusCell()
}

/**
 * naive-ui 的浮层（下拉菜单 / 取色器 / 弹层）会被 teleport 到 body，
 * 不在 overlay 内。点击它们时若走 onDocMouseDown 的"点外面就关闭"逻辑，
 * 会在选项真正生效前就销毁工具栏，导致下拉交互（如单元格斜线）"点了没反应"。
 * 因此对这类 teleport 浮层内的 mousedown 一律豁免，不结束编辑。
 */
const NAIVE_TELEPORT_SELECTOR =
  '.n-base-select-menu, .n-color-picker, .n-popover, .n-dropdown-menu, .n-base-select, ' +
  '.n-tooltip, .n-modal, .n-drawer, .n-message, .n-notification, .n-dialog, [class*="n-base-select"]'

function isNaiveTeleportTarget(target: Node | null): boolean {
  if (!target) return false
  if (!(target instanceof Element)) {
    const parent = target.parentElement
    return parent ? isNaiveTeleportTarget(parent) : false
  }
  return Boolean(target.closest(NAIVE_TELEPORT_SELECTOR))
}

function onDocMouseDown(e: MouseEvent): void {
  if (store.editingCell) {
    const target = e.target as Node | null
    // ★ 偶发锁定修复：把"层内点击豁免"从整个 overlay 收到【当前正在编辑的那个表格 wrapper】。
    //   旧逻辑用 layerRef.contains(target) —— 它会把所有 .op-table-overlay__item
    //   （含 editing 那个 wrapper 通过 overflow:visible 溢出覆盖到画布其它控件上的部分）
    //   一律判为"层内"，结果：用户在 editing 表格外、但被 wrapper 溢出区域盖住的文本
    //   控件上 mousedown 时，Fabric 既收不到事件（被 overlay 截获）、overlay 又不退出
    //   （被旧判断误判为"层内"），控件永远选不中拖不动，按 Esc 或点画布空白才恢复——
    //   与"绑定字段后偶发锁定"的体感完全一致。
    //   修复：只有 target 真的落在当前 editingId 对应那个 [data-table-id=editingId]
    //         wrapper 内，才视为"在 editing 表格内"而豁免退出。
    if (target) {
      const editingWrapper = layerRef.value?.querySelector(
        `[data-table-id="${CSS.escape(store.editingCell.controlId)}"]`,
      )
      if (editingWrapper && editingWrapper.contains(target)) return
    }
    if (isNaiveTeleportTarget(target)) return
    // ★ Bug6 修复：CellToolbar 内点击不退出编辑
    // 之前 NPopover 按钮（聚合/字段/函数）被 document capture 阶段的 mousedown 拦截，
    // 触发 exitEditing → CellToolbar 消失 → popover 来不及弹 → 用户点了聚合按钮却看不到任何响应。
    // 现在豁免：CellToolbar 是个独立的 floating UI，按钮 / popover / 输入都不应被"点外即关"误伤。
    if (target && (target as Element).closest?.('.op-cell-toolbar')) return
    exitEditing()
  }
  // 待绑态：点任何非 overlay / 非左栏字段 / 非数据源弹窗的地方都退出
  if (store.pendingBindCell) {
    const target = e.target as Node | null
    // 左栏数据源字段区 / 变量弹窗（naive-ui teleport）不退出，等用户点字段
    const inDataSource = !!(target && (target as Element).closest?.('[data-op-datasource-tree], .n-base-select-menu'))
    if (target && layerRef.value?.contains(target)) return
    if (inDataSource) return
    if (isNaiveTeleportTarget(target)) return
    store.closePendingBind()
  }
}

/**
 * 全局 keydown：Esc 退出待绑态 / 编辑态。
 * 用 capture 阶段拦截，避免被 CellToolbar 等组件吞掉。
 */
function onDocKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (store.pendingBindCell) {
    e.preventDefault()
    e.stopPropagation()
    store.closePendingBind()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKeyDown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onDocKeyDown, true)
  cleanupLiveInput()
})

/* ------------------------------ 工具栏动作 ------------------------------ */

function onToolbarApply(next: TableControl): void {
  const id = store.editingCell?.controlId
  if (!id) return
  store.updateControl(id, next)
  void refreshFrozen(id)
}

/**
 * CellToolbar lazy migration emit —— 仅添加 segments 字段、不动用户内容。
 * 走 silent 写入：进 store 模型但不进 undo 栈、不标 dirty；
 * 用户关闭工具栏前若没主动编辑，不应产生可撤销副作用。
 */
function onToolbarMigrate(next: TableControl): void {
  const id = store.editingCell?.controlId
  if (!id) return
  store.updateControlSilent(id, next)
  void refreshFrozen(id)
}

const editingControl = computed<TableControl | null>(() => {
  const id = editingId.value
  return id ? (controlById(id) ?? null) : null
})

/** 当前编辑格的行语义（表头 / 数据样例 / 静态），工具栏据此调整可用项 */
const editingRowKind = computed(() => {
  const control = editingControl.value
  const e = store.editingCell
  if (!control || !e) return null
  return designRowInfo(buildDesignGrid(control), e.row)
})
</script>

<template>
  <div
    ref="layerRef"
    class="op-table-overlay absolute inset-0 overflow-hidden"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown="onKeyDown"
    @paste="onPaste"
  >
    <div
      v-for="it in items"
      :key="it.id"
      class="op-table-overlay__item"
      :class="{ 'is-editing': it.id === editingId }"
      :data-table-id="it.id"
      :style="itemStyle(it)"
      v-html="it.html"
    />

    <div
      v-if="editingControl && store.editingCell && rowLabelPos"
      class="op-row-label"
      :style="{ left: `${rowLabelPos.x}px`, top: `${rowLabelPos.y}px` }"
    >
      {{ editingRowLabel }}
    </div>

    <div
      v-if="store.pendingBindCell && pendingBubblePos"
      class="op-pending-bubble"
      :style="{ left: `${pendingBubblePos.x}px`, top: `${pendingBubblePos.y}px` }"
    >
      请点击左侧字段树中的字段完成绑定（Esc 取消）
    </div>

    <CellToolbar
      v-if="editingControl && store.editingCell && toolbarPos"
      :control="editingControl"
      :row="store.editingCell.row"
      :col="store.editingCell.col"
      :row-kind="editingRowKind?.kind ?? 'static'"
      :x="toolbarPos.x"
      :y="toolbarPos.y"
      @apply="onToolbarApply"
      @migrate="onToolbarMigrate"
      @close="exitEditing"
    />
  </div>
</template>

<style scoped>
.op-table-overlay {
  /* 平时完全透明于鼠标：所有交互照旧交给 Fabric */
  pointer-events: none;
  /* 与打印产物同名的边框色变量，供 tableCss 注入的规则取用 */
  --op-table-border: #333333;
}

.op-table-overlay__item {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  /* 不裁剪表格内容：行高可能被内容（如窄列里的"本页合计/大写金额"标签换行）撑得比
     控制框高度高，裁剪会把末尾行藏掉（看不见、拉大控制框才出现）。溢出显示保证
     画布所见 = 渲染所得；非编辑态 pointer-events:none，不挡 Fabric 交互。 */
  overflow: visible;
}

.op-table-overlay__item.is-editing {
  /* ★ 偶发锁定修复：wrapper 自身不接 pointer-events，只让 td 接。
     旧逻辑 wrapper 整块 auto + overflow:visible → 编辑态下 wrapper 通过溢出
     覆盖到画布上其它控件（如文本）上的部分会一并拦截 mousedown，
     既不让 Fabric 选中目标控件、又不触发 onDocMouseDown 退出编辑（被旧
     "layerRef.contains 一律豁免"误判），形成"绑定后拖不动"死锁。
     现在 wrapper=none + td=auto：溢出覆盖区透传，单元格区域仍可编辑。 */
  pointer-events: none;
  outline: 1px solid var(--brand-primary, #1677ff);
  outline-offset: 1px;
  /* 编辑态不裁剪：用户输入多行文本时允许撑出包围盒完整显示 */
  overflow: visible;
}

/* 编辑态放开占位符的单行截断（nowrap/ellipsis 是设计态展示用），允许换行输入；
   同步把 pointer-events: auto 收到 td 上，承接上面 wrapper 关闭拦截后的单元格交互 */
.op-table-overlay__item.is-editing :deep(td) {
  pointer-events: auto;
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}

/* v-html 内容不受 scoped 影响，需用 :deep 穿透 */
.op-table-overlay__item :deep(table) {
  margin: 0;
}

.op-table-overlay__item.is-editing :deep(td:focus) {
  outline: 2px solid var(--brand-primary, #1677ff);
  outline-offset: -2px;
  background-color: rgba(22, 119, 255, 0.06);
}

/* 双击编辑时，首列左侧行角色名标签（标题行/数据行/本页合计行/总计行/大写金额行） */
.op-row-label {
  position: absolute;
  transform: translateX(calc(-100% - 6px));
  pointer-events: none;
  font-size: 11px;
  line-height: 1.4;
  color: var(--brand-primary, #1677ff);
  background: rgba(22, 119, 255, 0.1);
  border: 1px solid var(--brand-primary, #1677ff);
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
  z-index: 29;
}

/* 待绑态：左键单击单元格进入的虚线高亮，等用户从左栏点字段 */
.op-table-overlay__item :deep(td.is-pending-bind) {
  outline: 2px dashed var(--brand-primary, #1677ff);
  outline-offset: -2px;
  cursor: crosshair;
  background-color: rgba(22, 119, 255, 0.06);
}

/* 待绑态高亮（"左键点单元格 + 点字段"路径） */
.op-table-overlay__item :deep(td.is-pending-bind) {
  outline: 2px dashed var(--brand-primary, #1677ff);
  outline-offset: -2px;
  cursor: crosshair;
  background-color: rgba(22, 119, 255, 0.06);
}

/* 待绑气泡：固定在目标 td 上方 */
.op-pending-bubble {
  position: absolute;
  pointer-events: none;
  font-size: 11px;
  line-height: 1.4;
  color: var(--brand-primary, #1677ff);
  background: rgba(22, 119, 255, 0.1);
  border: 1px solid var(--brand-primary, #1677ff);
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;
  z-index: 30;
}
</style>
