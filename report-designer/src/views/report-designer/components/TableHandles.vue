<template>
  <div class="table-handles">
    <!-- 列控制行（表头区域上方） -->
    <div class="column-controls" v-if="table.properties.headerRow.enabled">
      <div 
        v-for="(col, colIndex) in table.properties.columns" 
        :key="'col-' + col.id"
        class="column-handle"
        :style="{ flex: col.width }"
      >
        <!-- 添加列按钮（左侧） -->
        <div 
          class="add-col-btn left" 
          @click.stop="$emit('add-column', table.id, colIndex)"
          title="在左侧插入列"
        >+</div>
        
        <!-- 列宽调整手柄 -->
        <div 
          class="col-resize-handle"
          @mousedown.stop="handleColResizeStart($event, colIndex)"
        ></div>
        
        <!-- 删除列按钮 -->
        <div 
          v-if="table.properties.columns.length > 1"
          class="delete-col-btn"
          @click.stop="$emit('delete-column', table.id, colIndex)"
          title="删除列"
        >×</div>
      </div>
      <!-- 最后一列添加按钮 -->
      <div 
        class="column-handle last"
        @click.stop="$emit('add-column', table.id, table.properties.columns.length)"
        title="在右侧添加列"
      >
        <span>+</span>
      </div>
    </div>

    <!-- 单元格点击层（绝对定位，匹配 ControlRenderer 的实际单元格位置） -->
    <div class="cell-click-layer" :style="layerStyle" v-if="cellPositions.length > 0">
      <div
        v-for="(cell, idx) in cellPositions"
        :key="'click-cell-' + idx"
        class="click-cell"
        :class="{ 'click-cell-selected': isCellSelected(cell.rowType, cell.rowIndex, cell.colIndex) }"
        :style="{
          left: cell.left + 'px',
          top: cell.top + 'px',
          width: cell.width + 'px',
          height: cell.height + 'px',
        }"
        @click.stop="handleCellClick(cell.rowType, cell.rowIndex, cell.colIndex, $event)"
      ></div>
    </div>

    <!-- 空白行填充提示 -->
    <div v-if="table.properties.fillEmptyRows.enabled" class="empty-rows-hint">
      <span>将自动填充空白行 (最少 {{ table.properties.fillEmptyRows.minEmptyRows }} 行)</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import type { TableControl } from '@/types/control'

const props = defineProps<{
  control: TableControl
}>()

const emit = defineEmits<{
  (e: 'cell-click', tableId: string, rowType: 'header' | 'data' | 'footer', rowIndex: number, colIndex: number): void
  (e: 'add-column', tableId: string, colIndex: number): void
  (e: 'delete-column', tableId: string, colIndex: number): void
}>()

const store = useReportDesignerStore()

// 模板中使用的别名
const table = computed(() => props.control)

// 选中单元格的位置信息
const selectedCellPos = computed(() => {
  if (!store.selectedCell || store.selectedCell.tableId !== props.control.id) return null
  return store.selectedCell
})

// 单元格位置（通过测量 ControlRenderer 的实际单元格）
interface CellPos {
  rowType: 'header' | 'data' | 'footer'
  rowIndex: number
  colIndex: number
  left: number
  top: number
  width: number
  height: number
}

const cellPositions = ref<CellPos[]>([])
const layerOffset = ref({ left: 0, top: 0 })

// 测量 ControlRenderer 中的实际单元格位置
function measureCellPositions() {
  if (typeof document === 'undefined') return
  
  // 找到 ControlRenderer 的 table-content 元素
  const tableContent = document.querySelector(`[data-table-id="${props.control.id}"]`) as HTMLElement
  if (!tableContent) return
  
  const tableRect = tableContent.getBoundingClientRect()
  layerOffset.value = { left: tableRect.left, top: tableRect.top }
  
  const positions: CellPos[] = []
  
  // 测量表头单元格
  if (tableContent.querySelector('.table-header')) {
    const headerCells = tableContent.querySelectorAll('.table-header .table-th')
    headerCells.forEach((cell, colIndex) => {
      const rect = (cell as HTMLElement).getBoundingClientRect()
      positions.push({
        rowType: 'header',
        rowIndex: 0,
        colIndex,
        left: rect.left - tableRect.left,
        top: rect.top - tableRect.top,
        width: rect.width,
        height: rect.height,
      })
    })
  }
  
  // 测量数据行单元格
  const dataRows = tableContent.querySelectorAll('.table-body .table-tr')
  dataRows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('.table-td')
    cells.forEach((cell, colIndex) => {
      const rect = (cell as HTMLElement).getBoundingClientRect()
      positions.push({
        rowType: 'data',
        rowIndex,
        colIndex,
        left: rect.left - tableRect.left,
        top: rect.top - tableRect.top,
        width: rect.width,
        height: rect.height,
      })
    })
  })
  
  // 测量表尾单元格
  if (tableContent.querySelector('.table-footer')) {
    const footerCells = tableContent.querySelectorAll('.table-footer .table-td')
    footerCells.forEach((cell, colIndex) => {
      const rect = (cell as HTMLElement).getBoundingClientRect()
      positions.push({
        rowType: 'footer',
        rowIndex: 0,
        colIndex,
        left: rect.left - tableRect.left,
        top: rect.top - tableRect.top,
        width: rect.width,
        height: rect.height,
      })
    })
  }
  
  cellPositions.value = positions
}

const layerStyle = computed(() => ({
  left: '0',
  top: '0',
  width: '100%',
  height: '100%',
}))

// 监听选中状态、控件变化，重新测量
watch(() => [props.control.id, props.control.properties.columns.length, store.selectedControlId, store.selectedCell], () => {
  nextTick(() => measureCellPositions())
}, { deep: true, immediate: false })

// 监听store.zoom变化，重新测量（影响位置）
watch(() => store.zoom, () => {
  nextTick(() => measureCellPositions())
})

onMounted(() => {
  // 初始测量
  nextTick(() => measureCellPositions())
  
  // 监听窗口resize和store变化
  window.addEventListener('resize', handleResize)
  
  // 定期重测（兜底，以防某些变化没触发watch）
  intervalId = window.setInterval(measureCellPositions, 500)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (intervalId) clearInterval(intervalId)
})

let intervalId: number | null = null

function handleResize() {
  measureCellPositions()
}

// 判断单元格是否选中
function isCellSelected(rowType: 'header' | 'data' | 'footer', rowIndex: number, colIndex: number): boolean {
  if (!store.selectedCell) return false
  return store.selectedCell.tableId === props.control.id &&
         store.selectedCell.rowType === rowType &&
         store.selectedCell.rowIndex === rowIndex &&
         store.selectedCell.colIndex === colIndex
}

// 处理单元格点击
function handleCellClick(rowType: 'header' | 'data' | 'footer', rowIndex: number, colIndex: number, e: MouseEvent) {
  e.stopPropagation()
  emit('cell-click', props.control.id, rowType, rowIndex, colIndex)
}

// 处理列宽调整开始
function handleColResizeStart(e: MouseEvent, colIndex: number) {
  const startX = e.clientX
  const startWidth = props.control.properties.columns[colIndex].width
  const zoom = store.zoom / 100
  
  function handleMouseMove(e: MouseEvent) {
    const deltaX = e.clientX - startX
    const deltaMm = deltaX / (3.78 * zoom)
    const newWidth = Math.max(10, startWidth + deltaMm)
    store.updateTableColumn(props.control.id, colIndex, { width: Math.round(newWidth) })
  }
  
  function handleMouseUp() {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}
</script>

<style scoped>
.table-handles {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 5;
}

/* 列控制行 */
.column-controls {
  position: absolute;
  top: -28px;
  left: 0;
  display: flex;
  height: 24px;
  background: #f0f7ff;
  border: 1px dashed #409eff;
  border-bottom: none;
  pointer-events: auto;
}

.column-handle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #d9ecff;
  font-size: 10px;
  color: #409eff;
}

.column-handle.last {
  width: 24px;
  min-width: 24px;
  background: #e6f0ff;
  cursor: pointer;
}

.column-handle.last:hover {
  background: #d9ecff;
}

.add-col-btn {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #409eff;
  color: #fff;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}

.column-handle:hover .add-col-btn {
  opacity: 1;
}

.add-col-btn.left {
  left: -7px;
}

.col-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: transparent;
}

.col-resize-handle:hover {
  background: rgba(64, 158, 255, 0.3);
}

.delete-col-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 16px;
  height: 16px;
  background: #f56c6c;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}

.column-handle:hover .delete-col-btn {
  opacity: 1;
}

/* 单元格点击层 - 绝对定位 */
.cell-click-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.click-cell {
  position: absolute;
  cursor: cell;
  border: 2px solid transparent;
  box-sizing: border-box;
  transition: border-color 0.1s, background 0.1s;
  pointer-events: auto;
}

.click-cell:hover {
  background: rgba(64, 158, 255, 0.1);
}

.click-cell-selected {
  border: 2px solid #409eff !important;
  background: rgba(64, 158, 255, 0.25) !important;
}

/* 空白行填充提示 */
.empty-rows-hint {
  position: absolute;
  bottom: -22px;
  left: 0;
  right: 0;
  height: 20px;
  background: #fdf6ec;
  border: 1px dashed #e6a23c;
  border-top: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #e6a23c;
  pointer-events: none;
}
</style>