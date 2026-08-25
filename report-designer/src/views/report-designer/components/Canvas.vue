<template>
  <div 
    class="canvas-wrapper"
    ref="wrapperRef"
    tabindex="0"
    @dragover.prevent="handleDragOver"
    @drop="handleDrop"
    @click="handleCanvasClick"
    @keydown="handleCanvasKeyDown"
  >
    <div class="canvas-body">
      <div class="canvas-with-ruler" :class="{ 'with-rulers': store.showRuler }">
        <!-- 左上角标尺角标 -->
        <div v-if="store.showRuler" class="ruler-corner"></div>

        <!-- 左侧标尺 -->
        <div v-if="store.showRuler" class="ruler ruler-v">
          <div class="ruler-content" :style="{ height: rulerContentStyle.height }">
            <span v-for="i in rulerMarksV" :key="i" class="ruler-mark" :style="{ top: mmToRulerPx(i) + 'px' }">
              {{ i }}
            </span>
          </div>
        </div>

        <!-- 顶部标尺 -->
        <div v-if="store.showRuler" class="ruler ruler-h">
          <div class="ruler-content" :style="{ width: rulerContentStyle.width }">
            <span v-for="i in rulerMarks" :key="i" class="ruler-mark" :style="{ left: mmToRulerPx(i) + 'px' }">
              {{ i }}
            </span>
          </div>
        </div>
        
        <!-- 画布 -->
        <div 
          class="canvas"
          :style="canvasStyle"
          ref="canvasRef"
        >
        <!-- 网格 -->
        <svg v-if="store.showGrid" class="canvas-grid" :style="canvasStyle">
          <defs>
            <pattern id="grid" :width="mmToPx(store.gridSize)" :height="mmToPx(store.gridSize)" patternUnits="userSpaceOnUse">
              <path :d="`M ${mmToPx(store.gridSize)} 0 L 0 0 0 ${mmToPx(store.gridSize)}`" fill="none" stroke="#e0e0e0" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        
        <!-- 页面背景 -->
        <div class="page-background" :style="canvasStyle">
          <!-- 控件渲染 -->
          <div
            v-for="control in store.currentPageControls"
            :key="control.id"
            class="control-wrapper"
            :class="{ 
              'selected': store.selectedControlId === control.id,
              'multi-selected': store.multiSelectedIds.includes(control.id),
              'locked': control.locked
            }"
            :style="getControlStyle(control)"
            @mousedown.stop="handleControlMouseDown($event, control.id)"
            @click.stop="handleControlClick($event, control.id)"
          >
            <!-- 控件内容 -->
            <ControlRenderer 
              :control="control" 
              @static-cell-click="handleStaticCellClick"
              @static-cell-dblclick="handleStaticCellDblClick"
              @static-cell-open-editor="handleStaticCellOpenEditor"
              @static-cell-contextmenu="handleStaticCellContextMenu"
            />
            
            <!-- 选中边框和调整手柄 -->
            <template v-if="store.selectedControlId === control.id || store.multiSelectedIds.includes(control.id)">
              <div class="selection-border"></div>
              <template v-if="!control.locked">
                <div class="resize-handle n" @mousedown.stop="handleResizeStart($event, control.id, 'n')"></div>
                <div class="resize-handle s" @mousedown.stop="handleResizeStart($event, control.id, 's')"></div>
                <div class="resize-handle e" @mousedown.stop="handleResizeStart($event, control.id, 'e')"></div>
                <div class="resize-handle w" @mousedown.stop="handleResizeStart($event, control.id, 'w')"></div>
                <div class="resize-handle ne" @mousedown.stop="handleResizeStart($event, control.id, 'ne')"></div>
                <div class="resize-handle nw" @mousedown.stop="handleResizeStart($event, control.id, 'nw')"></div>
                <div class="resize-handle se" @mousedown.stop="handleResizeStart($event, control.id, 'se')"></div>
                <div class="resize-handle sw" @mousedown.stop="handleResizeStart($event, control.id, 'sw')"></div>
              </template>
              <!-- 表格行列手柄 -->
              <TableHandles 
                v-if="control.type === 'Table'"
                :control="control"
                @cell-click="handleTableCellClick"
                @add-column="handleAddColumn"
                @delete-column="handleDeleteColumn"
              />
            </template>
          </div>
        </div>
        </div>
      </div>
    </div>
    
    <!-- 页面缩略图 -->
    <div class="page-nav">
      <div 
        v-for="(page, index) in store.template.pages" 
        :key="page.id"
        class="page-thumb"
        :class="{ active: store.currentPageId === page.id }"
        @click="store.currentPageId = page.id"
      >
        <span>第 {{ index + 1 }} 页</span>
      </div>
    </div>

    <!-- 静态表格单元格右键菜单 -->
    <div
      v-if="staticCellContextMenu.show"
      class="static-cell-contextmenu"
      :style="{ left: staticCellContextMenu.x + 'px', top: staticCellContextMenu.y + 'px' }"
      @contextmenu.prevent
    >
      <div class="ctx-item" @click="ctxInsertRowBefore">⬆️ 上插行</div>
      <div class="ctx-item" @click="ctxInsertRowAfter">⬇️ 下插行</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="ctxInsertColBefore">⬅️ 左插列</div>
      <div class="ctx-item" @click="ctxInsertColAfter">➡️ 右插列</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" @click="ctxDeleteRow">🗑️ 删除行</div>
      <div class="ctx-item danger" @click="ctxDeleteCol">🗑️ 删除列</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="ctxDuplicateRow">📋 复制行</div>
      <div class="ctx-item" @click="ctxDuplicateCol">📋 复制列</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="ctxMergeCells" :class="{ disabled: store.multiSelectedStaticCells.length < 2 }">🔗 合并选中</div>
      <div class="ctx-item" @click="ctxSplitCell" :class="{ disabled: !canSplitCell }">🔀 拆分单元格</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="ctxEditCell">✏️ 编辑单元格...</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" @click="ctxClearTable">🧹 清空整张表</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import type { AnyControl, ControlType, TableControl } from '@/types/control'
import ControlRenderer from './ControlRenderer.vue'
import TableHandles from './TableHandles.vue'

const store = useReportDesignerStore()

const wrapperRef = ref()
const canvasRef = ref()

// 静态表格单元格右键菜单
const staticCellContextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  tableId: '',
  cellId: '',
})

function ctxInsertRowBefore() {
  store.insertStaticTableRowBefore(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  staticCellContextMenu.value.show = false
}
function ctxInsertRowAfter() {
  store.insertStaticTableRowAfter(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  staticCellContextMenu.value.show = false
}
function ctxInsertColBefore() {
  store.insertStaticTableColBefore(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  staticCellContextMenu.value.show = false
}
function ctxInsertColAfter() {
  store.insertStaticTableColAfter(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  staticCellContextMenu.value.show = false
}
function ctxDeleteRow() {
  const cell = getStaticCellInfo(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  if (cell) store.deleteStaticTableRow(staticCellContextMenu.value.tableId, cell.row)
  staticCellContextMenu.value.show = false
}
function ctxDeleteCol() {
  const cell = getStaticCellInfo(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  if (cell) store.deleteStaticTableCol(staticCellContextMenu.value.tableId, cell.col)
  staticCellContextMenu.value.show = false
}

function ctxDuplicateRow() {
  const cell = getStaticCellInfo(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  if (cell) store.duplicateStaticTableRow(staticCellContextMenu.value.tableId, cell.row)
  staticCellContextMenu.value.show = false
}

function ctxDuplicateCol() {
  const cell = getStaticCellInfo(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  if (cell) store.duplicateStaticTableCol(staticCellContextMenu.value.tableId, cell.col)
  staticCellContextMenu.value.show = false
}
function ctxMergeCells() {
  store.mergeStaticTableCells(staticCellContextMenu.value.tableId)
  staticCellContextMenu.value.show = false
}
function ctxSplitCell() {
  store.splitStaticTableCell(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  staticCellContextMenu.value.show = false
}
function ctxEditCell() {
  store.openStaticCellEditor()
  staticCellContextMenu.value.show = false
}

function ctxClearTable() {
  store.clearStaticTableCellContents(staticCellContextMenu.value.tableId)
  staticCellContextMenu.value.show = false
}

const canSplitCell = computed(() => {
  if (!staticCellContextMenu.value.tableId || !staticCellContextMenu.value.cellId) return false
  const cell = getStaticCellInfo(staticCellContextMenu.value.tableId, staticCellContextMenu.value.cellId)
  return cell ? (cell.rowspan > 1 || cell.colspan > 1) : false
})

function getStaticCellInfo(tableId: string, cellId: string) {
  const control = store.template.controls.find(c => c.id === tableId)
  if (!control || control.type !== 'StaticTable') return null
  return (control.properties as any).cells.find((c: any) => c.id === cellId) || null
}

function showStaticCellContextMenu(tableId: string, cellId: string, ev: MouseEvent) {
  // 确保该单元格被选中
  store.selectStaticTableCell(tableId, cellId)
  staticCellContextMenu.value = {
    show: true,
    x: ev.clientX,
    y: ev.clientY,
    tableId,
    cellId,
  }
}

function hideStaticCellContextMenu() {
  staticCellContextMenu.value.show = false
}

// 点击其他地方关闭菜单
onMounted(() => {
  document.addEventListener('click', hideStaticCellContextMenu)
})
onUnmounted(() => {
  document.removeEventListener('click', hideStaticCellContextMenu)
})

// 键盘导航（StaticTable 单元格方向键移动）
function handleCanvasKeyDown(ev: KeyboardEvent) {
  const isCtrl = ev.ctrlKey || ev.metaKey

  // 撤销 Ctrl+Z / 重做 Ctrl+Y
  if (isCtrl && ev.key === 'z') { ev.preventDefault(); store.undo(); return }
  if (isCtrl && ev.key === 'y') { ev.preventDefault(); store.redo(); return }

  if (!store.selectedStaticTableCell) return
  const { tableId, cellId } = store.selectedStaticTableCell
  const cell = getStaticCellInfo(tableId, cellId)
  if (!cell) return

  const control = store.template.controls.find(c => c.id === tableId) as any
  if (!control || control.type !== 'StaticTable') return
  const { rows, cols, cells } = control.properties

  const key = ev.key

  // 单元格内容复制（Ctrl+C）
  if (isCtrl && key === 'c') {
    const text = cell.content?.value || cell.content?.field || ''
    if (text) navigator.clipboard.writeText(text)
    return
  }

  // 单元格内容粘贴（Ctrl+V）
  if (isCtrl && key === 'v') {
    navigator.clipboard.readText().then(text => {
      if (!text || !store.selectedStaticTableCell) return
      const { tableId, cellId } = store.selectedStaticTableCell
      const c = store.template.controls.find(t => t.id === tableId) as any
      if (!c || c.type !== 'StaticTable') return
      const newCells = c.properties.cells.map((cl: any) =>
        cl.id === cellId ? { ...cl, content: { type: 'text', value: text } } : cl
      )
      store.updateControl(tableId, { properties: { ...c.properties, cells: newCells } })
    }).catch(() => {})
    return
  }

  let targetRow = cell.row
  let targetCol = cell.col

  if (key === 'ArrowUp') { targetRow = Math.max(0, cell.row - 1); ev.preventDefault() }
  else if (key === 'ArrowDown') { targetRow = Math.min(rows - 1, cell.row + 1); ev.preventDefault() }
  else if (key === 'ArrowLeft') { targetCol = Math.max(0, cell.col - 1); ev.preventDefault() }
  else if (key === 'ArrowRight') { targetCol = Math.min(cols - 1, cell.col + 1); ev.preventDefault() }
  else if (key === 'Escape') { store.clearStaticTableCellSelection(); return }
  else if (key === 'Delete' || key === 'Backspace') {
    ev.preventDefault()
    if ((cell.rowspan || 1) > 1 || (cell.colspan || 1) > 1) {
      store.splitStaticTableCell(tableId, cellId)
    } else {
      const c = store.template.controls.find(t => t.id === tableId) as any
      if (!c) return
      const newCells = c.properties.cells.map((cl: any) =>
        cl.id === cellId ? { ...cl, content: undefined } : cl
      )
      store.updateControl(tableId, { properties: { ...c.properties, cells: newCells } })
    }
    return
  }
  else return

  // 找到目标行列的起始 cell
  const occupied = new Set<string>()
  for (const c of cells) {
    const rs = c.rowspan || 1
    const cs = c.colspan || 1
    for (let r = c.row; r < c.row + rs; r++) {
      for (let col = c.col; col < c.col + cs; col++) {
        if (r !== c.row || col !== c.col) occupied.add(`${r}_${col}`)
      }
    }
  }

  const targetCell = cells.find((c: any) => c.row === targetRow && c.col === targetCol)
  if (targetCell) {
    store.selectStaticTableCell(tableId, targetCell.id)
  }
}

// 1mm = 3.78px (基于 96dpi)
const MM_TO_PX = 3.78

// mm 转 px（画布/控件内部坐标，不含缩放，由 canvas 的 transform 统一缩放）
function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

// mm 转标尺 px（标尺本身不做 transform 缩放，刻度直接按缩放比例计算）
function mmToRulerPx(mm: number): number {
  return mm * MM_TO_PX * (store.zoom / 100)
}

// px 转 mm（屏幕坐标 → 画布内部 mm）
function pxToMm(px: number): number {
  return px / (MM_TO_PX * (store.zoom / 100))
}

// 画布样式（内部尺寸不含缩放，视觉缩放由 transform 完成）
const canvasStyle = computed(() => ({
  width: mmToPx(store.template.paper.width) + 'px',
  height: mmToPx(store.template.paper.height) + 'px',
  transform: `scale(${store.zoom / 100})`,
  transformOrigin: 'top left',
}))

// 标尺内容尺寸（含缩放，与画布视觉尺寸一致）
const rulerContentStyle = computed(() => ({
  width: mmToRulerPx(store.template.paper.width) + 'px',
  height: mmToRulerPx(store.template.paper.height) + 'px',
}))

// 水平标尺刻度
const rulerMarks = computed(() => {
  const marks: number[] = []
  const maxMm = store.template.paper.width
  for (let i = 0; i <= maxMm; i += 10) {
    marks.push(i)
  }
  return marks
})

// 垂直标尺刻度
const rulerMarksV = computed(() => {
  const marks: number[] = []
  const maxMm = store.template.paper.height
  for (let i = 0; i <= maxMm; i += 10) {
    marks.push(i)
  }
  return marks
})

// 获取控件样式
function getControlStyle(control: AnyControl) {
  return {
    left: mmToPx(control.x) + 'px',
    top: mmToPx(control.y) + 'px',
    width: mmToPx(control.width) + 'px',
    height: mmToPx(control.height) + 'px',
    zIndex: control.zIndex,
    display: control.visible ? 'block' : 'none',
  }
}

// 处理画布点击（选中页面，进入页面设置模式）
function handleCanvasClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('page-background') ||
      (e.target as HTMLElement).classList.contains('canvas')) {
    store.selectPage()
  }
}

// 处理控件点击
function handleControlClick(e: MouseEvent, id: string) {
  const multi = e.shiftKey || e.ctrlKey || e.metaKey
  store.selectControl(id, multi)
}

// 处理控件鼠标按下（拖拽开始）
const dragState = ref({
  isDragging: false,
  controlId: '',
  startX: 0,
  startY: 0,
  startControlX: 0,
  startControlY: 0,
})

function handleControlMouseDown(e: MouseEvent, id: string) {
  const control = store.template.controls.find(c => c.id === id)
  if (!control || control.locked) return
  
  dragState.value = {
    isDragging: true,
    controlId: id,
    startX: e.clientX,
    startY: e.clientY,
    startControlX: control.x,
    startControlY: control.y,
  }
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(e: MouseEvent) {
  if (!dragState.value.isDragging) return
  
  const dx = pxToMm(e.clientX - dragState.value.startX)
  const dy = pxToMm(e.clientY - dragState.value.startY)
  
  const newX = store.snapToGridValue(dragState.value.startControlX + dx)
  const newY = store.snapToGridValue(dragState.value.startControlY + dy)
  
  store.updateControlPosition(dragState.value.controlId, newX, newY)
}

function handleMouseUp(e: MouseEvent) {
  if (dragState.value.isDragging) {
    const dx = pxToMm(e.clientX - dragState.value.startX)
    const dy = pxToMm(e.clientY - dragState.value.startY)
    
    const newX = store.snapToGridValue(dragState.value.startControlX + dx)
    const newY = store.snapToGridValue(dragState.value.startControlY + dy)
    
    store.commitPositionChange(
      dragState.value.controlId,
      dragState.value.startControlX,
      dragState.value.startControlY,
      newX,
      newY
    )
  }
  
  dragState.value.isDragging = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 处理大小调整
const resizeState = ref({
  isResizing: false,
  controlId: '',
  direction: '',
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
  startCtrlX: 0,
  startCtrlY: 0,
})

function handleResizeStart(e: MouseEvent, id: string, direction: string) {
  const control = store.template.controls.find(c => c.id === id)
  if (!control || control.locked) return
  
  resizeState.value = {
    isResizing: true,
    controlId: id,
    direction,
    startX: e.clientX,
    startY: e.clientY,
    startWidth: control.width,
    startHeight: control.height,
    startCtrlX: control.x,
    startCtrlY: control.y,
  }
  
  document.addEventListener('mousemove', handleResizeMove)
  document.addEventListener('mouseup', handleResizeEnd)
}

function handleResizeMove(e: MouseEvent) {
  if (!resizeState.value.isResizing) return
  
  const dx = pxToMm(e.clientX - resizeState.value.startX)
  const dy = pxToMm(e.clientY - resizeState.value.startY)
  const dir = resizeState.value.direction
  
  let newWidth = resizeState.value.startWidth
  let newHeight = resizeState.value.startHeight
  let newX = resizeState.value.startCtrlX
  let newY = resizeState.value.startCtrlY
  
  // 根据方向调整
  if (dir.includes('e')) newWidth = Math.max(5, resizeState.value.startWidth + dx)
  if (dir.includes('w')) {
    newWidth = Math.max(5, resizeState.value.startWidth - dx)
    newX = resizeState.value.startCtrlX + dx
  }
  if (dir.includes('s')) newHeight = Math.max(5, resizeState.value.startHeight + dy)
  if (dir.includes('n')) {
    newHeight = Math.max(5, resizeState.value.startHeight - dy)
    newY = resizeState.value.startCtrlY + dy
  }
  
  // 吸附
  newWidth = store.snapToGridValue(newWidth)
  newHeight = store.snapToGridValue(newHeight)
  newX = store.snapToGridValue(newX)
  newY = store.snapToGridValue(newY)
  
  store.updateControl(resizeState.value.controlId, { x: newX, y: newY, width: newWidth, height: newHeight })
}

function handleResizeEnd(e: MouseEvent) {
  if (resizeState.value.isResizing) {
    const dx = pxToMm(e.clientX - resizeState.value.startX)
    const dy = pxToMm(e.clientY - resizeState.value.startY)
    const dir = resizeState.value.direction
    
    let newWidth = resizeState.value.startWidth
    let newHeight = resizeState.value.startHeight
    let newX = resizeState.value.startCtrlX
    let newY = resizeState.value.startCtrlY
    
    if (dir.includes('e')) newWidth = Math.max(5, resizeState.value.startWidth + dx)
    if (dir.includes('w')) {
      newWidth = Math.max(5, resizeState.value.startWidth - dx)
      newX = resizeState.value.startCtrlX + dx
    }
    if (dir.includes('s')) newHeight = Math.max(5, resizeState.value.startHeight + dy)
    if (dir.includes('n')) {
      newHeight = Math.max(5, resizeState.value.startHeight - dy)
      newY = resizeState.value.startCtrlY + dy
    }
    
    store.commitSizeChange(
      resizeState.value.controlId,
      resizeState.value.startWidth,
      resizeState.value.startHeight,
      newWidth,
      newHeight
    )
  }
  
  resizeState.value.isResizing = false
  document.removeEventListener('mousemove', handleResizeMove)
  document.removeEventListener('mouseup', handleResizeEnd)
}

// 处理拖拽放置
function handleDragOver(e: DragEvent) {
  e.dataTransfer!.dropEffect = 'copy'
}

function handleDrop(e: DragEvent) {
  const type = e.dataTransfer?.getData('control-type') as ControlType
  if (!type) return
  
  // 计算放置位置
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  
  const x = pxToMm(e.clientX - rect.left)
  const y = pxToMm(e.clientY - rect.top)
  
  // 吸附
  const snappedX = store.snapToGridValue(x)
  const snappedY = store.snapToGridValue(y)
  
  store.addControl(type, snappedX, snappedY)
}

// 处理表格单元格点击
function handleTableCellClick(tableId: string, rowType: 'header' | 'data' | 'footer', rowIndex: number, colIndex: number) {
  store.selectCell(tableId, rowType, rowIndex, colIndex)
}

// 处理静态表格单元格点击（单选）
function handleStaticCellClick(tableId: string, cellId: string, ev: MouseEvent) {
  // 先选中控件（如果当前选中的不是它），确保右侧属性面板切换到 StaticTable
  if (store.selectedControlId !== tableId) {
    store.selectControl(tableId)
  }

  // Shift+Click 范围选择
  if (ev.shiftKey && store.selectedStaticTableCell && store.selectedStaticTableCell.tableId === tableId) {
    const lastCell = getStaticCellInfo(tableId, store.selectedStaticTableCell.cellId)
    const curCell = getStaticCellInfo(tableId, cellId)
    if (lastCell && curCell) {
      const r1 = Math.min(lastCell.row, curCell.row)
      const r2 = Math.max(lastCell.row, curCell.row)
      const c1 = Math.min(lastCell.col, curCell.col)
      const c2 = Math.max(lastCell.col, curCell.col)
      const control = store.template.controls.find(c => c.id === tableId) as any
      if (control) {
        const cells = control.properties.cells
        const selected: { tableId: string; cellId: string }[] = [{ tableId, cellId }]
        for (const cell of cells) {
          if (cell.row >= r1 && cell.row <= r2 && cell.col >= c1 && cell.col <= c2) {
            selected.push({ tableId, cellId: cell.id })
          }
        }
        // 保留非当前 table 的多选状态
        store.clearMultiStaticTableSelection()
        for (const s of selected) {
          store.toggleStaticCellMultiSelect(s.tableId, s.cellId)
        }
        return
      }
    }
  }

  // Ctrl/Cmd+Click 多选切换
  if (ev.ctrlKey || ev.metaKey) {
    store.toggleStaticCellMultiSelect(tableId, cellId)
    store.selectStaticTableCell(tableId, cellId)
    return
  }

  store.selectStaticTableCell(tableId, cellId)
}

// 处理静态表格单元格双击 - 选中并进入内联编辑（内联编辑由 ControlRenderer 处理）
function handleStaticCellDblClick(tableId: string, cellId: string, ev: MouseEvent) {
  if (store.selectedControlId !== tableId) {
    store.selectControl(tableId)
  }
  store.selectStaticTableCell(tableId, cellId)
}

// 处理点击编辑图标 - 直接打开编辑弹窗
function handleStaticCellOpenEditor(tableId: string, cellId: string, ev: MouseEvent) {
  if (store.selectedControlId !== tableId) {
    store.selectControl(tableId)
  }
  store.selectStaticTableCell(tableId, cellId)
  store.openStaticCellEditor()
}

function handleStaticCellContextMenu(tableId: string, cellId: string, ev: MouseEvent) {
  ev.preventDefault()
  showStaticCellContextMenu(tableId, cellId, ev)
}

// 添加列
function handleAddColumn(tableId: string, colIndex: number) {
  store.addTableColumn(tableId, colIndex)
}

// 删除列
function handleDeleteColumn(tableId: string, colIndex: number) {
  store.deleteTableColumn(tableId, colIndex)
}

// 暴露方法
defineExpose({
  canvasRef,
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handleResizeMove)
  document.removeEventListener('mouseup', handleResizeEnd)
})
</script>

<style scoped>
.canvas-wrapper {
  display: flex;
  flex-direction: column;
  background: #e8e8e8;
  min-height: 100%;
  flex: 1;
  overflow: auto;
}

.canvas-body {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px;
  min-height: 100%;
  box-sizing: border-box;
}

.canvas-with-ruler {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

/* 显示标尺时使用 2×2 网格：角标 + 水平标尺 / 垂直标尺 + 画布 */
.canvas-with-ruler.with-rulers {
  display: grid;
  grid-template-columns: 24px auto;
  grid-template-rows: 24px auto;
}

.canvas-with-ruler.with-rulers .ruler-corner {
  grid-column: 1;
  grid-row: 1;
}

.canvas-with-ruler.with-rulers .ruler-h {
  grid-column: 2;
  grid-row: 1;
}

.canvas-with-ruler.with-rulers .ruler-v {
  grid-column: 1;
  grid-row: 2;
}

.canvas-with-ruler.with-rulers .canvas {
  grid-column: 2;
  grid-row: 2;
}

/* 标尺 */
.ruler {
  background: #f5f5f5;
  position: relative;
  overflow: hidden;
  border: 1px solid #d0d0d0;
  box-sizing: border-box;
}

.ruler-h {
  height: 24px;
  display: block;
  width: max-content;
}

.ruler-v {
  width: 24px;
  flex-shrink: 0;
  align-self: flex-start;
}

.ruler-corner {
  background: #f5f5f5;
  border: 1px solid #d0d0d0;
  box-sizing: border-box;
}

.ruler-content {
  position: relative;
  width: 100%;
  height: 100%;
}

.ruler-mark {
  position: absolute;
  font-size: 9px;
  color: #606266;
}

/* 水平标尺刻度 */

/* 画布 */
.canvas {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transform-origin: top left;
}

.canvas-grid {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.page-background {
  position: absolute;
  top: 0;
  left: 0;
}

/* 控件包装 */
.control-wrapper {
  position: absolute;
  cursor: move;
  user-select: none;
}

.control-wrapper.locked {
  cursor: not-allowed;
}

.control-wrapper.selected .selection-border,
.control-wrapper.multi-selected .selection-border {
  display: block;
}

/* 选中边框 */
.selection-border {
  display: none;
  position: absolute;
  top: -1px;
  left: -1px;
  right: -1px;
  bottom: -1px;
  border: 2px solid #409eff;
  pointer-events: none;
}

/* 调整手柄 */
.resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
  border: 1px solid #409eff;
  z-index: 10;
}

.resize-handle.n { top: -4px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -4px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { right: -4px; top: 50%; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { left: -4px; top: 50%; transform: translateY(-50%); cursor: w-resize; }
.resize-handle.ne { top: -4px; right: -4px; cursor: ne-resize; }
.resize-handle.nw { top: -4px; left: -4px; cursor: nw-resize; }
.resize-handle.se { bottom: -4px; right: -4px; cursor: se-resize; }
.resize-handle.sw { bottom: -4px; left: -4px; cursor: sw-resize; }

/* 页面导航 */
.page-nav {
  position: fixed;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}

.page-thumb {
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.page-thumb:hover {
  border-color: #409eff;
  color: #409eff;
}

.page-thumb.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

/* 静态表格单元格右键菜单 */
.static-cell-contextmenu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 160px;
  font-size: 13px;
}

.ctx-item {
  padding: 6px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.ctx-item:hover {
  background: #f5f7fa;
}

.ctx-item.danger {
  color: #f56c6c;
}

.ctx-item.danger:hover {
  background: #fef0f0;
}

.ctx-item.disabled {
  color: #c0c4cc;
  cursor: not-allowed;
  pointer-events: none;
}

.ctx-divider {
  height: 1px;
  background: #ebeef5;
  margin: 4px 0;
}
</style>
