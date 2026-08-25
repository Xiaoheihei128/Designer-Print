<template>
  <div class="control-renderer" :class="`control-${control.type.toLowerCase()}`">
    <!-- Label -->
    <template v-if="control.type === 'Label'">
      <textarea
        v-if="isLabelEditing"
        ref="labelTextareaRef"
        v-model="labelEditText"
        class="label-editor"
        :style="{
          fontFamily: control.properties.fontFamily,
          fontSize: control.properties.fontSize + 'pt',
          fontWeight: control.properties.fontWeight,
          fontStyle: control.properties.fontStyle,
          color: control.properties.color,
          backgroundColor: '#fffbe6',
          textAlign: control.properties.textAlign,
          lineHeight: control.properties.lineHeight,
        }"
        @blur="finishLabelEdit(true)"
        @keydown.enter.exact.prevent="finishLabelEdit(true)"
        @keydown.esc.prevent="cancelLabelEdit()"
        @click.stop
        @dblclick.stop
        @mousedown.stop
      />
      <div 
        v-else
        class="label-content"
        :style="{
          fontFamily: control.properties.fontFamily,
          fontSize: control.properties.fontSize + 'pt',
          fontWeight: control.properties.fontWeight,
          fontStyle: control.properties.fontStyle,
          color: control.properties.color,
          backgroundColor: control.properties.backgroundColor,
          textAlign: control.properties.textAlign,
          lineHeight: control.properties.lineHeight,
        }"
        @dblclick.stop="startLabelEdit"
      >
        {{ control.properties.text }}
      </div>
    </template>
    
    <!-- TextField -->
    <template v-else-if="control.type === 'TextField'">
      <div
        class="textfield-content"
        :style="{
          fontFamily: control.properties.fontFamily,
          fontSize: control.properties.fontSize + 'pt',
          color: control.properties.color,
          textAlign: control.properties.textAlign,
        }"
      >
        {{ control.properties.dataBinding || '未绑定' }}
      </div>
    </template>

    <!-- TextArea -->
    <template v-else-if="control.type === 'TextArea'">
      <textarea
        class="textarea-content"
        :value="control.properties.dataBinding || ''"
        :placeholder="control.properties.placeholder"
        :style="{
          fontFamily: control.properties.fontFamily,
          fontSize: control.properties.fontSize + 'pt',
          color: control.properties.color,
          backgroundColor: control.properties.backgroundColor,
          textAlign: control.properties.textAlign,
          lineHeight: control.properties.lineHeight,
        }"
        readonly
        @dblclick.stop="$emit('edit', control)"
      />
    </template>

    <!-- Image -->
    <template v-else-if="control.type === 'Image'">
      <div class="image-content">
        <img 
          v-if="control.properties.src" 
          :src="control.properties.src" 
          :style="{ objectFit: control.properties.fit }"
        />
        <span v-else class="placeholder">图片</span>
      </div>
    </template>
    
    <!-- Line -->
    <template v-else-if="control.type === 'Line'">
      <div 
        class="line-content"
        :style="{
          borderTopStyle: control.properties.direction === 'horizontal' ? control.properties.strokeStyle : 'none',
          borderLeftStyle: control.properties.direction === 'vertical' ? control.properties.strokeStyle : 'none',
          borderTopWidth: control.properties.strokeWidth + 'px',
          borderLeftWidth: control.properties.strokeWidth + 'px',
          borderColor: control.properties.color,
        }"
      ></div>
    </template>
    
    <!-- Rectangle -->
    <template v-else-if="control.type === 'Rectangle'">
      <div 
        class="rectangle-content"
        :style="{
          borderStyle: control.properties.borderStyle,
          borderWidth: getBorderWidth(control.properties.borderStyle),
          borderColor: control.properties.borderColor,
          backgroundColor: control.properties.fillColor,
          borderRadius: control.properties.cornerRadius + 'px',
        }"
      ></div>
    </template>
    
    <!-- Barcode -->
    <template v-else-if="control.type === 'Barcode'">
      <div class="barcode-content">
        <div class="barcode-placeholder">
          <span>条形码</span>
          <small>{{ control.properties.barcodeType }}</small>
        </div>
      </div>
    </template>
    
    <!-- QRCode -->
    <template v-else-if="control.type === 'QRCode'">
      <div class="qrcode-content">
        <div class="qrcode-placeholder">
          <span>二维码</span>
        </div>
      </div>
    </template>
    
    <!-- Table -->
    <template v-else-if="control.type === 'Table'">
      <div 
        class="table-content" 
        :data-table-id="control.id"
        :style="{ 
          borderStyle: control.properties.border.style === 'none' ? 'none' : 'solid',
          borderColor: control.properties.border.color,
          borderWidth: (control.properties.border.width || 1) + 'px'
        }"
      >
        <!-- 表头 -->
        <div 
          v-if="control.properties.headerRow.enabled" 
          class="table-header"
          :style="{ backgroundColor: control.properties.headerRow.backgroundColor || '#E0E0E0' }"
        >
          <div 
            v-for="col in control.properties.columns" 
            :key="col.id"
            class="table-th"
            :style="{ flex: col.width, textAlign: col.align }"
          >
            {{ col.title }}
          </div>
        </div>
        
        <!-- 数据行（预览3行） -->
        <div class="table-body">
          <div v-for="i in 3" :key="i" class="table-tr">
            <div 
              v-for="col in control.properties.columns" 
              :key="col.id"
              class="table-td"
              :style="{ flex: col.width, textAlign: col.align }"
            >
              {{ '{' + col.field + '}' }}
            </div>
          </div>
        </div>
        
        <!-- 表尾 -->
        <div 
          v-if="control.properties.footerRow.enabled" 
          class="table-footer"
          :style="{ backgroundColor: control.properties.footerRow.backgroundColor || '#F5F5F5' }"
        >
          <div 
            v-for="col in control.properties.columns" 
            :key="col.id"
            class="table-td"
            :style="{ flex: col.width, textAlign: col.align }"
          >
            {{ col.field ? '{' + col.field + '}' : '' }}
          </div>
        </div>
      </div>
    </template>
    
    <!-- StaticTable -->
    <template v-else-if="control.type === 'StaticTable'">
      <div class="static-table-content">
        <!-- 列头行 -->
        <div class="static-table-col-headers">
          <!-- 行号槽占位，保证列头与下方单元格列对齐 -->
          <div class="static-table-col-gutter" aria-hidden="true"></div>
          <div
            v-for="colIdx in (control.properties.cols || 0)"
            :key="'st-col-header-' + colIdx"
            class="static-table-col-header"
            :class="{ 'col-selected': store.selectedStaticTableColumn?.tableId === control.id && store.selectedStaticTableColumn?.colIndex === colIdx - 1 }"
            :style="{ width: ((control.properties.colWidths?.[colIdx - 1] ?? control.properties.defaultColWidth) * 3.78) + 'px' }"
            @click.stop="store.selectStaticTableColumn(control.id, colIdx - 1)"
            :title="'选中第 ' + colIdx + ' 列'"
          >
            {{ colIdx }}
          </div>
        </div>
        <div
          v-for="(renderRow, renderIdx) in staticTableRenderRows"
          :key="'st-render-' + renderIdx"
          class="static-table-row"
          :class="{ 'static-table-row-repeat': renderRow.isRepeat }"
          :style="{
            height: (control.properties.rowHeights?.[renderRow.rowIndex] ?? control.properties.defaultRowHeight) + 'mm'
          }"
        >
          <!-- 行号 -->
          <div
            class="static-table-row-header"
            :class="{ 'row-selected': store.selectedStaticTableRow?.tableId === control.id && store.selectedStaticTableRow?.rowIndex === renderRow.rowIndex }"
            @click.stop="store.selectStaticTableRow(control.id, renderRow.rowIndex)"
            :title="'选中第 ' + (renderRow.rowIndex + 1) + ' 行'"
          >{{ renderRow.rowIndex + 1 }}</div>
          <template v-for="cell in getCellsForRow(control.properties.cells || [], renderRow.rowIndex)" :key="cell.id">
            <div
              class="static-table-cell"
              :class="{ 'cell-selected': isStaticCellSelected(cell.id), 'cell-editing': editingCellId === cell.id, 'cell-repeat-row': renderRow.isRepeat }"
              :style="getCellStyle(cell, control.properties, renderRow)"
              @click.stop="$emit('static-cell-click', control.id, cell.id, $event)"
              @dblclick.stop="startCellEdit(cell)"
              @contextmenu.prevent="$emit('static-cell-contextmenu', control.id, cell.id, $event)"
            >
              <!-- 选中标记（点击编辑图标可弹出属性面板） -->
              <div 
                v-if="isStaticCellSelected(cell.id) && editingCellId !== cell.id" 
                class="cell-edit-badge" 
                title="点击编辑单元格属性（高级）"
                @click.stop="$emit('static-cell-open-editor', control.id, cell.id, $event)"
              >
                <el-icon><Edit /></el-icon>
              </div>
              <!-- 内联编辑输入框 -->
              <input
                v-if="editingCellId === cell.id"
                ref="cellEditRef"
                v-model="cellEditValue"
                class="cell-inline-editor"
                :style="{
                  fontSize: (cell.fontSize || 10) + 'pt',
                  fontWeight: cell.fontWeight || 'normal',
                  color: cell.textColor || '#000',
                  textAlign: cell.align || 'left',
                  width: '100%',
                  height: '100%',
                  background: '#fffbe6',
                  border: '2px solid #409eff',
                  borderRadius: '2px',
                  padding: '2px 4px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }"
                @blur="finishCellEdit(true)"
                @keydown="handleCellEditKeyDown"
                @click.stop
                @dblclick.stop
              />
              <!-- 文本内容 -->
              <template v-else-if="!cell.content || cell.content.type === 'text'">
                <span v-if="cell.content?.field" class="cell-binding" :title="getCellBindingTitle(cell, renderRow)">
                  {{ getCellBindingDisplay(cell, renderRow) }}
                </span>
                <span v-else-if="cell.content?.value">{{ cell.content.value }}</span>
                <span v-else class="cell-placeholder">双击编辑文本</span>
              </template>
              <!-- 图片 -->
              <template v-else-if="cell.content.type === 'image'">
                <div class="cell-image" :style="getImageStyle(cell.content)">
                  <img v-if="cell.content.src" :src="cell.content.src" :style="getImageFitStyle(cell.content.fit)" alt="" />
                  <span v-else-if="cell.content.field" class="cell-binding" :title="getCellBindingTitle(cell, renderRow)">{{ getCellBindingDisplay(cell, renderRow, '[图]') }}</span>
                  <span v-else class="image-placeholder">图片</span>
                </div>
              </template>
              <!-- 二维码 -->
              <template v-else-if="cell.content.type === 'qrcode'">
                <div class="cell-qrcode">
                  <div v-if="cell.content.field" class="cell-binding" :title="getCellBindingTitle(cell, renderRow)">{{ getCellBindingDisplay(cell, renderRow, 'QR') }}</div>
                  <div v-else-if="cell.content.value" class="qrcode-placeholder">QR: {{ cell.content.value.substring(0, 20) }}</div>
                  <div v-else class="qrcode-placeholder">二维码</div>
                </div>
              </template>
              <!-- 条形码 -->
              <template v-else-if="cell.content.type === 'barcode'">
                <div class="cell-barcode">
                  <div v-if="cell.content.field" class="cell-binding" :title="getCellBindingTitle(cell, renderRow)">{{ getCellBindingDisplay(cell, renderRow, 'BC') }}</div>
                  <div v-else-if="cell.content.value" class="barcode-placeholder">{{ cell.content.value }}</div>
                  <div v-else class="barcode-placeholder">条形码</div>
                </div>
              </template>

              <!-- 列宽/行高拖动把手（仅该列/该行最后一个可见cell显示） -->
              <div
                v-if="isStaticCellSelected(cell.id) && editingCellId !== cell.id"
                class="cell-resize-handle-right"
                :data-col="cell.col"
                @mousedown.stop="onColResizeStart($event, cell.col, control.properties)"
                title="拖动调整列宽"
              ></div>
              <div
                v-if="isStaticCellSelected(cell.id) && editingCellId !== cell.id"
                class="cell-resize-handle-bottom"
                :data-row="cell.row"
                @mousedown.stop="onRowResizeStart($event, cell.row, control.properties)"
                title="拖动调整行高"
              ></div>
            </div>
          </template>
        </div>
      </div>
    </template>
    
    <!-- PageBreak -->
    <template v-else-if="control.type === 'PageBreak'">
      <div class="pagebreak-content">
        <span>--- 分页符 ---</span>
      </div>
    </template>
    
    <!-- PageNumber -->
    <template v-else-if="control.type === 'PageNumber'">
      <div 
        class="pagenumber-content"
        :style="{
          fontSize: control.properties.fontSize + 'pt',
          color: control.properties.color,
        }"
      >
        {{ control.properties.format }}
      </div>
    </template>
    
    <!-- ReportTitle -->
    <template v-else-if="control.type === 'ReportTitle'">
      <div 
        class="reporttitle-content"
        :style="{
          fontSize: control.properties.fontSize + 'pt',
          fontWeight: control.properties.fontWeight,
          color: control.properties.color,
          textAlign: control.properties.align,
        }"
      >
        报表标题
      </div>
    </template>
    
    <!-- DateTime -->
    <template v-else-if="control.type === 'DateTime'">
      <div 
        class="datetime-content"
        :style="{
          fontSize: control.properties.fontSize + 'pt',
          color: control.properties.color,
        }"
      >
        {{ control.properties.format }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { AnyControl, StaticTableProperties, StaticTableCell } from '@/types/control'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import { Edit } from '@element-plus/icons-vue'

const props = defineProps<{
  control: AnyControl
}>()

// 矩形边框宽度：thin=1px / medium=2px / thick=3px / none=0
function getBorderWidth(style: string): string {
  switch (style) {
    case 'thin': return '1px'
    case 'medium': return '2px'
    case 'thick': return '3px'
    default: return '0px'
  }
}

const emit = defineEmits<{
  (e: 'static-cell-click', tableId: string, cellId: string, ev: MouseEvent): void
  (e: 'static-cell-dblclick', tableId: string, cellId: string, ev: MouseEvent): void
  (e: 'static-cell-contextmenu', tableId: string, cellId: string, ev: MouseEvent): void
  (e: 'static-cell-open-editor', tableId: string, cellId: string, ev: MouseEvent): void
}>()

const store = useReportDesignerStore()

// === StaticTable 重复行展开计算 ===
const staticTableRenderRows = computed(() => {
  if (props.control.type !== 'StaticTable') return []
  const p = props.control.properties
  const rows = p.rows || 0
  const rs = p.repeatRowStart ?? 1
  const re = p.repeatRowEnd ?? (rows - 2)
  const repeatCount = p.repeatCount ?? 3  // 预览默认展示3条

  // 没有 repeatBinding 时直接返回所有行
  if (!p.repeatBinding) {
    return Array.from({ length: rows }, (_, i) => ({ rowIndex: i, itemIndex: null, isRepeat: false }))
  }

  const result: { rowIndex: number; itemIndex: number | null; isRepeat: boolean }[] = []
  // 头部行
  for (let r = 0; r < rs; r++) {
    result.push({ rowIndex: r, itemIndex: null, isRepeat: false })
  }
  // 重复行 × repeatCount
  for (let i = 0; i < repeatCount; i++) {
    for (let r = rs; r <= re; r++) {
      result.push({ rowIndex: r, itemIndex: i, isRepeat: true })
    }
  }
  // 尾部行
  for (let r = re + 1; r < rows; r++) {
    result.push({ rowIndex: r, itemIndex: null, isRepeat: false })
  }
  return result
})

// 示例数据（用于预览重复行内容）
const STATIC_TABLE_PREVIEW_DATA: Record<string, any[]> = {
  // 每个 repeatBinding 用不同的示例数据
}

// === StaticTable 列宽/行高拖动调整 ===
const resizeState = ref<{
  type: 'col' | 'row'
  index: number
  startX: number
  startY: number
  startValue: number
} | null>(null)

function onColResizeStart(ev: MouseEvent, colIndex: number, props: StaticTableProperties) {
  ev.preventDefault()
  const currentWidth = props.colWidths?.[colIndex] ?? props.defaultColWidth
  resizeState.value = { type: 'col', index: colIndex, startX: ev.clientX, startY: ev.clientY, startValue: currentWidth }
  document.addEventListener('mousemove', onColResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onRowResizeStart(ev: MouseEvent, rowIndex: number, props: StaticTableProperties) {
  ev.preventDefault()
  const currentHeight = props.rowHeights?.[rowIndex] ?? props.defaultRowHeight
  resizeState.value = { type: 'row', index: rowIndex, startX: ev.clientX, startY: ev.clientY, startValue: currentHeight }
  document.addEventListener('mousemove', onRowResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onColResizeMove(ev: MouseEvent) {
  if (!resizeState.value || resizeState.value.type !== 'col') return
  const dx = ev.clientX - resizeState.value.startX
  // 屏幕像素 → 画布内部 mm（考虑画布 transform 缩放）
  const newWidth = Math.max(5, resizeState.value.startValue + dx / (3.78 * store.zoom / 100))
  const tableId = store.selectedControlId
  if (!tableId) return
  store.updateStaticTableColWidth(tableId, resizeState.value.index, Math.round(newWidth * 10) / 10)
}

function onRowResizeMove(ev: MouseEvent) {
  if (!resizeState.value || resizeState.value.type !== 'row') return
  const dy = ev.clientY - resizeState.value.startY
  const newHeight = Math.max(3, resizeState.value.startValue + dy / (3.78 * store.zoom / 100))
  const tableId = store.selectedControlId
  if (!tableId) return
  store.updateStaticTableRowHeight(tableId, resizeState.value.index, Math.round(newHeight * 10) / 10)
}

function onResizeEnd() {
  resizeState.value = null
  document.removeEventListener('mousemove', onColResizeMove)
  document.removeEventListener('mousemove', onRowResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

// === StaticTable 单元格内联编辑 ===
const editingCellId = ref<string | null>(null)
const cellEditValue = ref('')
const cellEditField = ref<'value' | 'field'>('value')
const cellEditRef = ref<HTMLInputElement | null>(null)

function startCellEdit(cell: any) {
  editingCellId.value = cell.id
  // 确保 content 对象存在
  if (!cell.content) {
    cell.content = { type: 'text', value: '', field: '' }
  }
  // 优先编辑 field（绑定字段），否则编辑静态文本 value
  if (cell.content?.field !== undefined && cell.content.field !== '') {
    cellEditField.value = 'field'
    cellEditValue.value = cell.content.field || ''
  } else {
    cellEditField.value = 'value'
    cellEditValue.value = cell.content?.value || ''
  }
  nextTick(() => {
    cellEditRef.value?.focus()
    cellEditRef.value?.select()
  })
}

function finishCellEdit(save: boolean) {
  if (!editingCellId.value) return
  if (save) {
    const cells = (props.control.properties as any).cells.map((c: any) => {
      if (c.id !== editingCellId.value) return c
      const content = {
        type: c.content?.type || 'text',
        ...(c.content || {}),
      }
      // 如果 value 和 field 都为空，清理 content
      if (cellEditField.value === 'value') {
        content.value = cellEditValue.value
        // value 和 field 只保存一个
        if (cellEditValue.value && content.field) {
          delete content.field
        }
      } else {
        content.field = cellEditValue.value
        if (cellEditValue.value && content.value) {
          delete content.value
        }
      }
      // 空内容时清理整个 content
      const finalContent = (!content.value && !content.field) ? undefined : content
      return { ...c, content: finalContent }
    })
    store.updateControl(props.control.id, {
      properties: { ...props.control.properties, cells },
    })
  }
  editingCellId.value = null
}

function handleCellEditKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    finishCellEdit(true)
  } else if (e.key === 'Escape') {
    finishCellEdit(false)
  }
}

// 切换控件时关闭编辑
watch(() => store.selectedControlId, (newId) => {
  if (newId !== props.control.id && editingCellId.value) {
    finishCellEdit(true)
  }
})

// === Label 文本编辑 ===
const editingLabelId = ref<string | null>(null)
const labelEditText = ref('')
const labelTextareaRef = ref<HTMLTextAreaElement | null>(null)

const isLabelEditing = computed(() => editingLabelId.value === props.control.id)

function startLabelEdit() {
  editingLabelId.value = props.control.id
  labelEditText.value = (props.control.properties as any).text || ''
  nextTick(() => {
    labelTextareaRef.value?.focus()
    labelTextareaRef.value?.select()
  })
}

function finishLabelEdit(save: boolean) {
  if (save && props.control.type === 'Label') {
    store.updateControl(props.control.id, {
      properties: { ...props.control.properties, text: labelEditText.value }
    })
  }
  editingLabelId.value = null
}

function cancelLabelEdit() {
  editingLabelId.value = null
}

// 监听选中变化，切换控件时关闭编辑
watch(() => store.selectedControlId, (newId) => {
  if (newId !== props.control.id && isLabelEditing.value) {
    finishLabelEdit(true)
  }
})

function isStaticCellSelected(cellId: string): boolean {
  return store.selectedStaticTableCell?.tableId === props.control.id &&
         store.selectedStaticTableCell?.cellId === cellId
}

// 单元格绑定字段显示（带 item 索引）
function getCellBindingDisplay(cell: any, renderRow: { rowIndex: number; itemIndex: number | null; isRepeat: boolean }, prefix = ''): string {
  const field = cell.content?.field || ''
  if (!field) return ''
  if (renderRow.isRepeat && renderRow.itemIndex !== null && props.control.properties.repeatBinding) {
    return prefix + `{${props.control.properties.repeatBinding}[${renderRow.itemIndex}].${field}}`
  }
  return prefix + `{${field}}`
}

function getCellBindingTitle(cell: any, renderRow: { rowIndex: number; itemIndex: number | null; isRepeat: boolean }): string {
  const field = cell.content?.field || ''
  if (!field) return ''
  if (renderRow.isRepeat && renderRow.itemIndex !== null && props.control.properties.repeatBinding) {
    return `数据源: ${props.control.properties.repeatBinding}[${renderRow.itemIndex}].${field}`
  }
  return `绑定字段: ${field}`
}

// 计算行高累计偏移量，用于 rowspan 定位
function getCellsForRow(cells: StaticTableCell[], rowIdx: number): StaticTableCell[] {
  // 返回属于该行的起始 cell（row == rowIdx）
  // 过滤掉被其他 cell 跨过的位置
  const occupied = new Set<string>()
  
  // 先标记所有被跨过的位置
  for (const cell of cells) {
    const rs = cell.rowspan || 1
    const cs = cell.colspan || 1
    for (let r = cell.row; r < cell.row + rs; r++) {
      for (let c = cell.col; c < cell.col + cs; c++) {
        if (r === cell.row && c === cell.col) continue  // 起始位置
        occupied.add(`${r}_${c}`)
      }
    }
  }
  
  return cells
    .filter(cell => cell.row === rowIdx && !occupied.has(`${rowIdx}_${cell.col}`))
    .sort((a, b) => a.col - b.col)  // 按 col 从左到右排序，flex 按数组顺序渲染
}

function getCellStyle(cell: StaticTableCell, props: StaticTableProperties, renderRow?: { rowIndex: number; itemIndex: number | null; isRepeat: boolean }) {
  const rs = cell.rowspan || 1
  const cs = cell.colspan || 1
  // 优先用 colWidths/rowHeights 中的自定义值，否则用默认值
  const colW = props.colWidths?.[cell.col] ?? props.defaultColWidth
  const rowH = props.rowHeights?.[cell.row] ?? props.defaultRowHeight
  const widthPx = cs * colW * 3.78  // mm to px
  const heightPx = rs * rowH * 3.78
  
  // 边框
  const defaultBorder = `${props.defaultBorderWidth}px ${props.defaultBorderStyle} ${props.defaultBorderColor}`
  const borderTop = cell.borderTop ? `${cell.borderTop.width ?? props.defaultBorderWidth}px ${cell.borderTop.style ?? props.defaultBorderStyle} ${cell.borderTop.color ?? props.defaultBorderColor}` : defaultBorder
  const borderRight = cell.borderRight ? `${cell.borderRight.width ?? props.defaultBorderWidth}px ${cell.borderRight.style ?? props.defaultBorderStyle} ${cell.borderRight.color ?? props.defaultBorderColor}` : defaultBorder
  const borderBottom = cell.borderBottom ? `${cell.borderBottom.width ?? props.defaultBorderWidth}px ${cell.borderBottom.style ?? props.defaultBorderStyle} ${cell.borderBottom.color ?? props.defaultBorderColor}` : defaultBorder
  const borderLeft = cell.borderLeft ? `${cell.borderLeft.width ?? props.defaultBorderWidth}px ${cell.borderLeft.style ?? props.defaultBorderStyle} ${cell.borderLeft.color ?? props.defaultBorderColor}` : defaultBorder

  // 斑马线背景（仅在 cell 没有自定义背景时应用）
  let bgColor = cell.backgroundColor || 'transparent'
  if (!cell.backgroundColor && props.alternatingRows && renderRow) {
    const originalRow = renderRow.rowIndex
    // 偶数行（0-based）使用交替背景色，优先级低于 cell.backgroundColor
    if (originalRow % 2 === 0 && props.alternatingRowColor) {
      bgColor = props.alternatingRowColor
    }
  }
  
  return {
    width: widthPx + 'px',
    height: heightPx + 'px',
    textAlign: cell.align || 'left',
    verticalAlign: cell.valign || 'middle',
    backgroundColor: bgColor,
    fontSize: (cell.fontSize || 10) + 'pt',
    fontWeight: cell.fontWeight || 'normal',
    fontStyle: cell.fontStyle || 'normal',
    textDecoration: cell.textDecoration || 'none',
    lineHeight: cell.lineHeight ? String(cell.lineHeight) : '1.4',
    color: cell.textColor || '#000',
    padding: (cell.padding ?? 1) + 'mm',
    borderTop,
    borderRight,
    borderBottom,
    borderLeft,
    boxSizing: 'border-box',
    overflow: 'hidden',
    whiteSpace: cell.writingMode ? 'pre' : 'nowrap',
    textOverflow: 'ellipsis',
    writingMode: cell.writingMode || 'horizontal-tb',
  }
}

function getImageStyle(content: any) {
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}

function getImageFitStyle(fit?: string) {
  switch (fit) {
    case 'cover': return { width: '100%', height: '100%', objectFit: 'cover' as const }
    case 'contain': return { width: '100%', height: '100%', objectFit: 'contain' as const }
    case 'fill': return { width: '100%', height: '100%', objectFit: 'fill' as const }
    default: return { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const }
  }
}
</script>

<style scoped>
.control-renderer {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.label-content,
.textfield-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  word-break: break-word;
  overflow: hidden;
  pointer-events: auto;  /* 覆盖 .control-renderer 的 none，让双击可触发 */
  cursor: text;
}

.textarea-content {
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  word-break: break-word;
  overflow-y: auto;
  pointer-events: auto;
  padding: 2px 4px;
  box-sizing: border-box;
  cursor: text;
}

.label-editor {
  width: 100%;
  height: 100%;
  border: 2px solid #409eff;
  border-radius: 2px;
  padding: 2px 4px;
  margin: 0;
  resize: none;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  overflow: auto;
  cursor: text;
  pointer-events: auto;  /* 覆盖 .control-renderer 的 none */
}

.image-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.image-content img {
  width: 100%;
  height: 100%;
}

.image-content .placeholder,
.barcode-placeholder,
.qrcode-placeholder,
.table-content .table-header span,
.table-content .table-body span,
.table-content .table-footer span {
  color: #909399;
  font-size: 10px;
}

.barcode-content,
.qrcode-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(
    90deg,
    #000 0px,
    #000 2px,
    #fff 2px,
    #fff 4px
  );
}

.barcode-placeholder,
.qrcode-placeholder {
  background: #fff;
  padding: 4px 8px;
  border-radius: 2px;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.barcode-placeholder small,
.qrcode-placeholder small {
  font-size: 8px;
  color: #c0c4cc;
}

.line-content {
  width: 100%;
  height: 100%;
}

.rectangle-content {
  width: 100%;
  height: 100%;
}

.table-content {
  width: 100%;
  height: 100%;
  min-height: 40px;
  display: flex;
  flex-direction: column;
  font-size: 9px;
  border-width: 1px;
  border-style: solid;
  box-sizing: border-box;
  background: #fff;
}

.table-header,
.table-footer,
.table-body {
  display: flex;
  min-height: 22px;
  box-sizing: border-box;
}

.table-header {
  background: #e0e0e0;
}

.table-body {
  flex-direction: column;
  padding: 0;
}

.table-header,
.table-footer {
  padding: 0;
}

.table-tr {
  display: flex;
  min-height: 18px;
  height: 22px;
  border-bottom: 1px solid #000;
  flex: 0 0 auto;
}

.table-tr:last-child {
  border-bottom: none;
}

.table-th,
.table-td {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border-right: 1px solid #000;
  font-size: 9px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.table-th:last-child,
.table-td:last-child {
  border-right: none;
}

.table-footer {
  background: #f5f5f5;
}

.table-content {
  overflow: hidden;
}

.pagebreak-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(
    45deg,
    #fff,
    #fff 10px,
    #ffe6e6 10px,
    #ffe6e6 20px
  );
  border: 1px dashed #ff4d4f;
  font-size: 10px;
  color: #ff4d4f;
}

.pagenumber-content,
.reporttitle-content,
.datetime-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
}

/* 静态表格（任意定义） */
.static-table-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  box-sizing: border-box;
  font-size: 10pt;
  overflow: hidden;
}

.static-table-row {
  display: flex;
  flex: 0 0 auto;
  min-height: 6mm;
}

/* 列头行 */
.static-table-col-headers {
  display: flex;
  flex: 0 0 auto;
  margin-bottom: 2px;
}

/* 列头行号槽占位：与行号列保持一致（20px + 边框 ×2 + 右侧 2px 间距） */
.static-table-col-gutter {
  width: 20px;
  flex-shrink: 0;
  height: 20px;
  margin-right: 2px;
  background: #f0f7ff;
  border: 1px solid #d0e8ff;
  border-radius: 3px 0 0 0;
}

.static-table-col-header {
  flex-shrink: 0;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f7ff;
  border: 1px solid #d0e8ff;
  border-radius: 3px 3px 0 0;
  cursor: pointer;
  font-size: 11px;
  color: #409eff;
  font-weight: 600;
  user-select: none;
  transition: background 0.15s;
}

.static-table-col-header:hover {
  background: #d0e8ff;
}

.static-table-col-header.col-selected {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.static-table-row-repeat {
  background: rgba(64, 158, 255, 0.04);
}

/* 行号头 */
.static-table-row-header {
  width: 20px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f7ff;
  border: 1px solid #d0e8ff;
  cursor: pointer;
  font-size: 10px;
  color: #409eff;
  font-weight: 600;
  user-select: none;
  transition: background 0.15s;
  margin-right: 2px;
  border-radius: 3px;
}

.static-table-row-header:hover {
  background: #d0e8ff;
}

.static-table-row-header.row-selected {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.cell-repeat-row {
  background: rgba(64, 158, 255, 0.06) !important;
}

/* 列宽拖动把手 */
.cell-resize-handle-right {
  position: absolute;
  right: 0;
  top: 10%;
  height: 80%;
  width: 5px;
  cursor: col-resize;
  z-index: 10;
  background: rgba(64, 158, 255, 0.6);
  border-radius: 2px;
  transition: background 0.15s;
}

.cell-resize-handle-right:hover {
  background: #409eff;
  width: 6px;
}

/* 行高拖动把手 */
.cell-resize-handle-bottom {
  position: absolute;
  bottom: 0;
  left: 10%;
  width: 80%;
  height: 5px;
  cursor: row-resize;
  z-index: 10;
  background: rgba(64, 158, 255, 0.6);
  border-radius: 2px;
  transition: background 0.15s;
}

.cell-resize-handle-bottom:hover {
  background: #409eff;
  height: 6px;
}

.static-table-cell {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
  cursor: cell;
  transition: outline 0.1s, background-color 0.1s;
  pointer-events: auto;  /* 覆盖 .control-renderer 的 pointer-events: none */
  flex-shrink: 0;  /* 外框缩小时 cell 不被 flex 自动压缩 */
}

.static-table-cell:hover {
  outline: 2px dashed rgba(64, 158, 255, 0.5);
  outline-offset: -2px;
}

.static-table-cell.cell-selected {
  outline: 2px solid #409eff;
  outline-offset: -2px;
  box-shadow: inset 0 0 0 1px rgba(64, 158, 255, 0.2);
}

.static-table-cell.cell-editing {
  outline: 2px solid #409eff;
  outline-offset: -2px;
  overflow: visible;
}

.cell-inline-editor {
  width: 100%;
  height: 100%;
  border: none;
  padding: 0 4px;
  margin: 0;
  resize: none;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  pointer-events: auto;
  cursor: text;
}

.cell-edit-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  background: #409eff;
  color: #fff;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  cursor: pointer;
  pointer-events: auto;
  z-index: 5;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  transition: transform 0.15s, background-color 0.15s;
}

.cell-edit-badge:hover {
  background: #66b1ff;
  transform: scale(1.15);
}

.cell-placeholder {
  color: #c0c4cc;
  font-style: italic;
  font-size: 0.85em;
  pointer-events: none;
}

.static-table-cell .cell-binding {
  color: #409eff;
  font-style: italic;
  font-size: 8pt;
  word-break: break-all;
}

.static-table-cell .image-placeholder,
.static-table-cell .qrcode-placeholder,
.static-table-cell .barcode-placeholder {
  color: #909399;
  font-size: 10pt;
  text-align: center;
  padding: 4px;
}

.static-table-cell .cell-image,
.static-table-cell .cell-qrcode,
.static-table-cell .cell-barcode {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.static-table-cell .cell-image img {
  max-width: 100%;
  max-height: 100%;
}
</style>
