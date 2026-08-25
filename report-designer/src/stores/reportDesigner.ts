import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { AnyControl, ControlType, TableControl, TableColumn } from '@/types/control'
import { createDefaultControl } from '@/types/control'
import { createDefaultTemplate, type ReportTemplate } from '@/types/template'

// 操作历史记录
interface HistoryAction {
  type: 'add' | 'delete' | 'modify' | 'move' | 'resize'
  before: AnyControl[]
  after: AnyControl[]
  description: string
}

export const useReportDesignerStore = defineStore('reportDesigner', () => {
  // ============ 状态 ============

  // 当前模板
  const template = ref<ReportTemplate>(createDefaultTemplate())

  // 选中的控件ID
  const selectedControlId = ref<string | null>(null)

  // 多选的控件ID列表
  const multiSelectedIds = ref<string[]>([])

  // 当前缩放比例
  const zoom = ref(100)

  // 当前页面ID
  const currentPageId = ref(1)

  // 是否显示网格
  const showGrid = ref(true)

  // 是否显示标尺
  const showRuler = ref(true)

  // 网格吸附
  const snapToGrid = ref(true)
  const gridSize = ref(5) // mm

  // 操作历史
  const history = ref<HistoryAction[]>([])
  const historyIndex = ref(-1)

  // 剪贴板
  const clipboard = ref<AnyControl[]>([])

  // 当前选中的单元格 (tableId, rowType, rowIndex, colIndex)
  const selectedCell = ref<{ tableId: string; rowType: 'header' | 'data' | 'footer'; rowIndex: number; colIndex: number } | null>(null)

  // 当前选中的静态表格单元格 (tableId, cellId)
  const selectedStaticTableCell = ref<{ tableId: string; cellId: string } | null>(null)

  // 当前选中的目标('control' | 'page' | null)
  const selectedTarget = ref<'control' | 'page' | null>(null)

  // 数据源字段(可被设计器读写)
  const dataSourceFields = ref<any>(null)

  // 静态表格单元格编辑弹窗是否打开
  const staticCellEditorOpen = ref(false)

  // 静态表格多选单元格列表
  const multiSelectedStaticCells = ref<{ tableId: string; cellId: string }[]>([])

  // 静态表格列选择（当前选中的列索引，0-based）
  const selectedStaticTableColumn = ref<{ tableId: string; colIndex: number } | null>(null)

  // 静态表格行选择（当前选中的行索引，0-based）
  const selectedStaticTableRow = ref<{ tableId: string; rowIndex: number } | null>(null)

  // ============ 计算属性 ============

  // 当前选中的控件
  const selectedControl = computed(() => {
    if (!selectedControlId.value) return null
    return template.value.controls.find(c => c.id === selectedControlId.value) || null
  })

  // 所有控件(按 zIndex 排序)
  const sortedControls = computed(() => {
    return [...template.value.controls].sort((a, b) => a.zIndex - b.zIndex)
  })

  // 当前页面的控件
  const currentPageControls = computed(() => {
    // 目前所有控件都在第一页,后续多页支持时按页面筛选
    return sortedControls.value
  })

  // 是否可以撤销
  const canUndo = computed(() => historyIndex.value >= 0)

  // 是否可以重做
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  // ============ 方法 ============

  // 添加控件
  function addControl(type: ControlType, x: number, y: number) {
    const control = createDefaultControl(type, x, y)

    // 设置 zIndex 为最大 + 1
    const maxZIndex = Math.max(0, ...template.value.controls.map(c => c.zIndex))
    control.zIndex = maxZIndex + 1

    saveHistory('添加控件', template.value.controls.map(c => ({ ...c })), [...template.value.controls, control])

    template.value.controls.push(control)
    selectedControlId.value = control.id
    multiSelectedIds.value = []

    return control
  }

  // 删除控件
  function deleteControl(id: string) {
    const index = template.value.controls.findIndex(c => c.id === id)
    if (index === -1) return

    const control = template.value.controls[index]
    const newControls = template.value.controls.filter(c => c.id !== id)

    saveHistory(`删除控件: ${control.name}`, template.value.controls.map(c => ({ ...c })), newControls)

    template.value.controls = newControls

    if (selectedControlId.value === id) {
      selectedControlId.value = null
    }
    multiSelectedIds.value = multiSelectedIds.value.filter(i => i !== id)
  }

  // 删除多选的控件
  function deleteSelectedControls() {
    if (multiSelectedIds.value.length === 0 && !selectedControlId.value) return

    const idsToDelete = multiSelectedIds.value.length > 0
      ? multiSelectedIds.value
      : (selectedControlId.value ? [selectedControlId.value] : [])

    const newControls = template.value.controls.filter(c => !idsToDelete.includes(c.id))
    const deletedControls = template.value.controls.filter(c => idsToDelete.includes(c.id))

    saveHistory(
      `删除 ${deletedControls.length} 个控件`,
      template.value.controls.map(c => ({ ...c })),
      newControls
    )

    template.value.controls = newControls
    selectedControlId.value = null
    multiSelectedIds.value = []
  }

  // 更新控件属性
  function updateControl(id: string, updates: Partial<AnyControl>) {
    const index = template.value.controls.findIndex(c => c.id === id)
    if (index === -1) return

    const oldControl = { ...template.value.controls[index] }
    const updatedControl = { ...template.value.controls[index], ...updates }

    // 如果更新的是 properties,深度合并
    if (updates.properties) {
      updatedControl.properties = {
        ...oldControl.properties,
        ...updates.properties,
      }
    }

    const before = template.value.controls.map(c => ({ ...c }))
    const after = before.map((c, i) => i === index ? updatedControl : { ...c })

    saveHistory(
      `更新控件: ${oldControl.name}`,
      before as AnyControl[],
      after as AnyControl[]
    )

    template.value.controls = after as AnyControl[]
  }

  // 更新控件位置
  function updateControlPosition(id: string, x: number, y: number) {
    const index = template.value.controls.findIndex(c => c.id === id)
    if (index === -1) return

    const oldControl = { ...template.value.controls[index] }
    template.value.controls[index] = { ...template.value.controls[index], x, y }

    // 不保存到历史,在 dragEnd 时统一保存
  }

  // 更新控件大小
  function updateControlSize(id: string, width: number, height: number) {
    const index = template.value.controls.findIndex(c => c.id === id)
    if (index === -1) return

    template.value.controls[index] = {
      ...template.value.controls[index],
      width: Math.max(5, width),
      height: Math.max(5, height),
    }
  }

  // 选中控件
  function selectControl(id: string | null, multi = false) {
    if (multi) {
      if (id && multiSelectedIds.value.includes(id)) {
        multiSelectedIds.value = multiSelectedIds.value.filter(i => i !== id)
      } else if (id) {
        multiSelectedIds.value.push(id)
      }
      selectedControlId.value = null
    } else {
      selectedControlId.value = id
      multiSelectedIds.value = []
      selectedTarget.value = id ? 'control' : null
    }
  }

  // 清空选择
  function clearSelection() {
    selectedControlId.value = null
    multiSelectedIds.value = []
    selectedCell.value = null
    selectedStaticTableCell.value = null
    selectedTarget.value = null
  }

  // 选中页面(点击画布空白时)
  function selectPage() {
    selectedControlId.value = null
    multiSelectedIds.value = []
    selectedCell.value = null
    selectedStaticTableCell.value = null
    selectedTarget.value = 'page'
  }

  // 复制控件
  function copyControls() {
    if (multiSelectedIds.value.length === 0 && !selectedControlId.value) return

    const ids = multiSelectedIds.value.length > 0
      ? multiSelectedIds.value
      : (selectedControlId.value ? [selectedControlId.value] : [])

    clipboard.value = template.value.controls
      .filter(c => ids.includes(c.id))
      .map(c => ({ ...c, id: `ctrl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` }))
  }

  // 粘贴控件
  function pasteControls() {
    if (clipboard.value.length === 0) return

    const newControls = clipboard.value.map(c => {
      const newControl = {
        ...c,
        id: `ctrl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        x: c.x + 10,
        y: c.y + 10,
      }
      return newControl as AnyControl
    })

    saveHistory(
      `粘贴 ${newControls.length} 个控件`,
      template.value.controls.map(c => ({ ...c })),
      [...template.value.controls, ...newControls]
    )

    template.value.controls.push(...newControls)
    selectedControlId.value = newControls[0].id
    multiSelectedIds.value = newControls.map(c => c.id)

    // 更新剪贴板(偏移量)
    clipboard.value = newControls
  }

  // 剪切控件
  function cutControls() {
    copyControls()
    deleteSelectedControls()
  }

  // 上移一层
  function bringForward(id: string) {
    const control = template.value.controls.find(c => c.id === id)
    if (!control) return

    const sorted = sortedControls.value
    const index = sorted.findIndex(c => c.id === id)
    if (index < sorted.length - 1) {
      const next = sorted[index + 1]
      const temp = control.zIndex
      updateControl(control.id, { zIndex: next.zIndex })
      updateControl(next.id, { zIndex: temp })
    }
  }

  // 下移一层
  function sendBackward(id: string) {
    const control = template.value.controls.find(c => c.id === id)
    if (!control) return

    const sorted = sortedControls.value
    const index = sorted.findIndex(c => c.id === id)
    if (index > 0) {
      const prev = sorted[index - 1]
      const temp = control.zIndex
      updateControl(control.id, { zIndex: prev.zIndex })
      updateControl(prev.id, { zIndex: temp })
    }
  }

  // 置顶
  function bringToFront(id: string) {
    const maxZIndex = Math.max(...template.value.controls.map(c => c.zIndex))
    updateControl(id, { zIndex: maxZIndex + 1 })
  }

  // 置底
  function sendToBack(id: string) {
    const minZIndex = Math.min(...template.value.controls.map(c => c.zIndex))
    updateControl(id, { zIndex: minZIndex - 1 })
  }

  // 撤销
  function undo() {
    if (!canUndo.value) return

    const action = history.value[historyIndex.value]
    template.value.controls = action.before
    historyIndex.value--
  }

  // 重做
  function redo() {
    if (!canRedo.value) return

    historyIndex.value++
    const action = history.value[historyIndex.value]
    template.value.controls = action.after
  }

  // 保存到历史
  function saveHistory(description: string, before: AnyControl[], after: AnyControl[]) {
    // 移除当前位置之后的历史
    history.value = history.value.slice(0, historyIndex.value + 1)

    history.value.push({
      type: 'modify',
      before,
      after,
      description,
    })

    historyIndex.value = history.value.length - 1

    // 限制历史记录数量
    if (history.value.length > 50) {
      history.value.shift()
      historyIndex.value--
    }
  }

  // 提交位置变更到历史
  function commitPositionChange(id: string, oldX: number, oldY: number, newX: number, newY: number) {
    const control = template.value.controls.find(c => c.id === id)
    if (!control) return

    const before = template.value.controls.map(c =>
      c.id === id ? { ...c, x: oldX, y: oldY } : { ...c }
    )
    const after = template.value.controls.map(c =>
      c.id === id ? { ...c, x: newX, y: newY } : { ...c }
    )

    saveHistory(`移动控件: ${control.name}`, before as AnyControl[], after as AnyControl[])
  }

  // 提交大小变更到历史
  function commitSizeChange(id: string, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number) {
    const control = template.value.controls.find(c => c.id === id)
    if (!control) return

    const before = template.value.controls.map(c =>
      c.id === id ? { ...c, width: oldWidth, height: oldHeight } : { ...c }
    )
    const after = template.value.controls.map(c =>
      c.id === id ? { ...c, width: newWidth, height: newHeight } : { ...c }
    )

    saveHistory(`调整控件大小: ${control.name}`, before as AnyControl[], after as AnyControl[])
  }

  // 设置缩放
  function setZoom(value: number) {
    zoom.value = Math.max(25, Math.min(200, value))
  }

  // 切换网格显示
  function toggleGrid() {
    showGrid.value = !showGrid.value
  }

  // 切换标尺显示
  function toggleRuler() {
    showRuler.value = !showRuler.value
  }

  // 切换网格吸附
  function toggleSnapToGrid() {
    snapToGrid.value = !snapToGrid.value
  }

  // 吸附到网格
  function snapToGridValue(value: number): number {
    if (!snapToGrid.value) return value
    return Math.round(value / gridSize.value) * gridSize.value
  }

  // 加载模板
  function loadTemplate(t: ReportTemplate) {
    template.value = t
    selectedControlId.value = null
    multiSelectedIds.value = []
    history.value = []
    historyIndex.value = -1
  }

  // 新建模板
  function newTemplate() {
    template.value = createDefaultTemplate()
    selectedControlId.value = null
    multiSelectedIds.value = []
    history.value = []
    historyIndex.value = -1
  }

  // 批量对齐
  function alignControls(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    if (multiSelectedIds.value.length < 2) return

    const controls = template.value.controls.filter(c => multiSelectedIds.value.includes(c.id))
    if (controls.length < 2) return

    let targetValue: number

    switch (direction) {
      case 'left':
        targetValue = Math.min(...controls.map(c => c.x))
        controls.forEach(c => updateControl(c.id, { x: targetValue }))
        break
      case 'center':
        targetValue = controls.reduce((sum, c) => sum + c.x + c.width / 2, 0) / controls.length
        controls.forEach(c => updateControl(c.id, { x: targetValue - c.width / 2 }))
        break
      case 'right':
        targetValue = Math.max(...controls.map(c => c.x + c.width))
        controls.forEach(c => updateControl(c.id, { x: targetValue - c.width }))
        break
      case 'top':
        targetValue = Math.min(...controls.map(c => c.y))
        controls.forEach(c => updateControl(c.id, { y: targetValue }))
        break
      case 'middle':
        targetValue = controls.reduce((sum, c) => sum + c.y + c.height / 2, 0) / controls.length
        controls.forEach(c => updateControl(c.id, { y: targetValue - c.height / 2 }))
        break
      case 'bottom':
        targetValue = Math.max(...controls.map(c => c.y + c.height))
        controls.forEach(c => updateControl(c.id, { y: targetValue - c.height }))
        break
    }
  }

  // ============ 表格行列操作 ============

  // 添加列
  function addTableColumn(tableId: string, colIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as TableControl
    if (!control || control.type !== 'Table') return

    const newColumn: TableColumn = {
      id: `col_${Date.now()}`,
      title: `列${control.properties.columns.length + 1}`,
      field: `Field${control.properties.columns.length + 1}`,
      width: 30,
      minWidth: 10,
      align: 'left',
    }

    const columns = [...control.properties.columns]
    columns.splice(colIndex, 0, newColumn)

    updateControl(tableId, {
      properties: { ...control.properties, columns }
    })
  }

  // 删除列
  function deleteTableColumn(tableId: string, colIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as TableControl
    if (!control || control.type !== 'Table') return
    if (control.properties.columns.length <= 1) return

    const columns = control.properties.columns.filter((_, i) => i !== colIndex)

    updateControl(tableId, {
      properties: { ...control.properties, columns }
    })
  }

  // 更新列
  function updateTableColumn(tableId: string, colIndex: number, updates: Partial<TableColumn>) {
    const control = template.value.controls.find(c => c.id === tableId) as TableControl
    if (!control || control.type !== 'Table') return

    const columns = [...control.properties.columns]
    columns[colIndex] = { ...columns[colIndex], ...updates }

    updateControl(tableId, {
      properties: { ...control.properties, columns }
    })
  }

  // 选中单元格
  function selectCell(tableId: string, rowType: 'header' | 'data' | 'footer', rowIndex: number, colIndex: number) {
    selectedCell.value = { tableId, rowType, rowIndex, colIndex }
  }

  // 清空单元格选择
  function clearCellSelection() {
    selectedCell.value = null
  }

  // 选中静态表格单元格
  function selectStaticTableCell(tableId: string, cellId: string) {
    // 同时选中表格控件，确保右侧属性面板切到 StaticTable
    if (selectedControlId.value !== tableId) {
      selectedControlId.value = tableId
      selectedTarget.value = 'control'
    }
    // 清除动态表格的选中状态，避免冲突
    selectedCell.value = null
    selectedStaticTableCell.value = { tableId, cellId }
  }

  // 清空静态表格单元格选择
  function clearStaticTableCellSelection() {
    selectedStaticTableCell.value = null
    staticCellEditorOpen.value = false
  }

  function openStaticCellEditor() {
    staticCellEditorOpen.value = true
  }

  function closeStaticCellEditor() {
    staticCellEditorOpen.value = false
  }

  // ============ StaticTable 行列操作 ============

  function insertStaticTableRow(tableId: string, rowIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const rows = props.rows + 1

    // 把所有 row >= rowIndex 的 cell 的 row += 1（保持 rowspan/colspan 不变）
    const cells = props.cells.map((c: any) => {
      if (c.row >= rowIndex) {
        return { ...c, row: c.row + 1 }
      }
      return { ...c }
    })

    // 建立占位集合：所有 cell 的所有占据位置（考虑 rowspan/colspan）
    const occupied = new Set<string>()
    for (const c of cells) {
      const rs = c.rowspan || 1
      const cs = c.colspan || 1
      for (let r = c.row; r < c.row + rs; r++) {
        for (let col = c.col; col < c.col + cs; col++) {
          occupied.add(`${r}_${col}`)
        }
      }
    }

    // 在 rowIndex 位置插入一行空 cell
    for (let col = 0; col < props.cols; col++) {
      if (!occupied.has(`${rowIndex}_${col}`)) {
        cells.push({
          id: `st_${Date.now()}_${rowIndex}_${col}_${Math.random().toString(36).slice(2, 6)}`,
          row: rowIndex,
          col,
          rowspan: 1,
          colspan: 1,
        })
        occupied.add(`${rowIndex}_${col}`)
      }
    }

    props.rows = rows
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function insertStaticTableRowBefore(tableId: string, cellId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const cell = control.properties.cells.find((c: any) => c.id === cellId)
    if (!cell) return
    insertStaticTableRow(tableId, cell.row)
  }

  function insertStaticTableRowAfter(tableId: string, cellId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const cell = control.properties.cells.find((c: any) => c.id === cellId)
    if (!cell) return
    insertStaticTableRow(tableId, cell.row + 1)
  }

  function insertStaticTableCol(tableId: string, colIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const cols = props.cols + 1

    // 把所有 col >= colIndex 的 cell 的 col += 1（保持 rowspan/colspan 不变）
    const cells = props.cells.map((c: any) => {
      if (c.col >= colIndex) {
        return { ...c, col: c.col + 1 }
      }
      return { ...c }
    })

    // 建立占位集合：所有 cell 的所有占据位置（考虑 colspan/rowspan）
    const occupied = new Set<string>()
    for (const c of cells) {
      const rs = c.rowspan || 1
      const cs = c.colspan || 1
      for (let r = c.row; r < c.row + rs; r++) {
        for (let col = c.col; col < c.col + cs; col++) {
          occupied.add(`${r}_${col}`)
        }
      }
    }

    // 在 colIndex 位置插入一列空 cell
    for (let row = 0; row < props.rows; row++) {
      if (!occupied.has(`${row}_${colIndex}`)) {
        cells.push({
          id: `st_${Date.now()}_${row}_${colIndex}_${Math.random().toString(36).slice(2, 6)}`,
          row,
          col: colIndex,
          rowspan: 1,
          colspan: 1,
        })
        occupied.add(`${row}_${colIndex}`)
      }
    }

    props.cols = cols
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function insertStaticTableColBefore(tableId: string, cellId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const cell = control.properties.cells.find((c: any) => c.id === cellId)
    if (!cell) return
    insertStaticTableCol(tableId, cell.col)
  }

  function insertStaticTableColAfter(tableId: string, cellId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const cell = control.properties.cells.find((c: any) => c.id === cellId)
    if (!cell) return
    insertStaticTableCol(tableId, cell.col + 1)
  }

  function deleteStaticTableRow(tableId: string, rowIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    if (control.properties.rows <= 1) return
    const props = { ...control.properties }

    // 移除该行所有 cell（只移除起点在该行的）
    let cells = props.cells.filter((c: any) => c.row !== rowIndex)
    // 其余 row > rowIndex 的 cell 的 row -= 1
    cells = cells.map((c: any) => {
      if (c.row > rowIndex) {
        return { ...c, row: c.row - 1 }
      }
      return c
    })

    props.rows = props.rows - 1
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function deleteStaticTableCol(tableId: string, colIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    if (control.properties.cols <= 1) return
    const props = { ...control.properties }

    // 移除该列所有 cell（只移除起点在该列的）
    let cells = props.cells.filter((c: any) => c.col !== colIndex)
    // 其余 col > colIndex 的 cell 的 col -= 1
    cells = cells.map((c: any) => {
      if (c.col > colIndex) {
        return { ...c, col: c.col - 1 }
      }
      return c
    })

    props.cols = props.cols - 1
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function duplicateStaticTableRow(tableId: string, rowIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }

    // 收集该行的所有 cell 及其 rowspan/colspan
    const rowCells = props.cells.filter((c: any) => c.row === rowIndex)

    // 下方所有 row >= rowIndex 的 cell row += 1（保持 rowspan/colspan 不变）
    const cells = props.cells.map((c: any) => {
      if (c.row >= rowIndex) return { ...c, row: c.row + 1 }
      return c
    })

    // 在 rowIndex 位置插入复制的行
    const occupied = new Set<string>()
    for (const c of cells) {
      const rs = c.rowspan || 1
      const cs = c.colspan || 1
      for (let r = c.row; r < c.row + rs; r++) {
        for (let col = c.col; col < c.col + cs; col++) {
          occupied.add(`${r}_${col}`)
        }
      }
    }

    for (const orig of rowCells) {
      const newCell = {
        ...orig,
        id: `st_${Date.now()}_${rowIndex}_${orig.col}_${Math.random().toString(36).slice(2, 6)}`,
        row: rowIndex,
      }
      cells.push(newCell)
      occupied.add(`${rowIndex}_${orig.col}`)
    }

    props.rows = props.rows + 1
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function duplicateStaticTableCol(tableId: string, colIndex: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }

    // 收集该列的所有 cell
    const colCells = props.cells.filter((c: any) => c.col === colIndex)

    // 右侧所有 col >= colIndex 的 cell col += 1
    const cells = props.cells.map((c: any) => {
      if (c.col >= colIndex) return { ...c, col: c.col + 1 }
      return c
    })

    const occupied = new Set<string>()
    for (const c of cells) {
      const rs = c.rowspan || 1
      const cs = c.colspan || 1
      for (let r = c.row; r < c.row + rs; r++) {
        for (let col = c.col; col < c.col + cs; col++) {
          occupied.add(`${r}_${col}`)
        }
      }
    }

    for (const orig of colCells) {
      const newCell = {
        ...orig,
        id: `st_${Date.now()}_${orig.row}_${colIndex}_${Math.random().toString(36).slice(2, 6)}`,
        col: colIndex,
      }
      cells.push(newCell)
      occupied.add(`${orig.row}_${colIndex}`)
    }

    props.cols = props.cols + 1
    props.cells = cells
    updateControl(tableId, { properties: props })
  }

  function mergeStaticTableCells(tableId: string) {
    if (multiSelectedStaticCells.value.length < 2) return
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const selected = multiSelectedStaticCells.value.filter(c => c.tableId === tableId)
    if (selected.length < 2) return

    // 找到所有选中 cell 的行列范围
    const cellIds = new Set(selected.map(s => s.cellId))
    const targetCells = props.cells.filter((c: any) => cellIds.has(c.id))
    const minRow = Math.min(...targetCells.map((c: any) => c.row))
    const maxRow = Math.max(...targetCells.map((c: any) => c.row + (c.rowspan || 1) - 1))
    const minCol = Math.min(...targetCells.map((c: any) => c.col))
    const maxCol = Math.max(...targetCells.map((c: any) => c.col + (c.colspan || 1) - 1))

    // 合并到左上角 cell
    const newCells = props.cells.filter((c: any) => !cellIds.has(c.id)).concat([{
      ...targetCells[0],
      row: minRow,
      col: minCol,
      rowspan: maxRow - minRow + 1,
      colspan: maxCol - minCol + 1,
    }])

    props.cells = newCells
    updateControl(tableId, { properties: props })
    multiSelectedStaticCells.value = []
  }

  function splitStaticTableCell(tableId: string, cellId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const cell = props.cells.find((c: any) => c.id === cellId)
    if (!cell || (cell.rowspan === 1 && cell.colspan === 1)) return

    const rowSpan = cell.rowspan || 1
    const colSpan = cell.colspan || 1

    // 替换为 rowSpan × colSpan 个独立 cell
    let newCells = props.cells.filter((c: any) => c.id !== cellId)
    for (let r = 0; r < rowSpan; r++) {
      for (let col = 0; col < colSpan; col++) {
        newCells.push({
          ...cell,
          id: `st_${Date.now()}_${cell.row + r}_${cell.col + col}_${Math.random().toString(36).slice(2, 6)}`,
          row: cell.row + r,
          col: cell.col + col,
          rowspan: 1,
          colspan: 1,
        })
      }
    }

    props.cells = newCells
    updateControl(tableId, { properties: props })
  }

  function toggleStaticCellMultiSelect(tableId: string, cellId: string) {
    const existing = multiSelectedStaticCells.value.find(c => c.tableId === tableId && c.cellId === cellId)
    if (existing) {
      multiSelectedStaticCells.value = multiSelectedStaticCells.value.filter(c => !(c.tableId === tableId && c.cellId === cellId))
    } else {
      multiSelectedStaticCells.value = [...multiSelectedStaticCells.value, { tableId, cellId }]
    }
  }

  function clearMultiStaticTableSelection() {
    multiSelectedStaticCells.value = []
  }

  function selectStaticTableColumn(tableId: string, colIndex: number) {
    selectedStaticTableColumn.value = { tableId, colIndex }
    selectedStaticTableRow.value = null
    // 同时选中该列第一个单元格
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const firstCell = control.properties.cells.find((c: any) => c.row === 0 && c.col === colIndex)
    if (firstCell) {
      selectStaticTableCell(tableId, firstCell.id)
    }
  }

  function selectStaticTableRow(tableId: string, rowIndex: number) {
    selectedStaticTableRow.value = { tableId, rowIndex }
    selectedStaticTableColumn.value = null
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const firstCell = control.properties.cells.find((c: any) => c.row === rowIndex && c.col === 0)
    if (firstCell) {
      selectStaticTableCell(tableId, firstCell.id)
    }
  }

  // 批量设置选中列的宽度
  function setSelectedColumnWidth(tableId: string, width: number) {
    if (!selectedStaticTableColumn.value || selectedStaticTableColumn.value.tableId !== tableId) return
    const { colIndex } = selectedStaticTableColumn.value
    updateStaticTableColWidth(tableId, colIndex, width)
  }

  // 批量设置选中行的高度
  function setSelectedRowHeight(tableId: string, height: number) {
    if (!selectedStaticTableRow.value || selectedStaticTableRow.value.tableId !== tableId) return
    const { rowIndex } = selectedStaticTableRow.value
    updateStaticTableRowHeight(tableId, rowIndex, height)
  }

  function updateStaticTableColWidth(tableId: string, colIndex: number, width: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const colWidths = [...(props.colWidths || [])]
    colWidths[colIndex] = width
    props.colWidths = colWidths
    updateControl(tableId, { properties: props })
  }

  function updateStaticTableRowHeight(tableId: string, rowIndex: number, height: number) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const rowHeights = [...(props.rowHeights || [])]
    rowHeights[rowIndex] = height
    props.rowHeights = rowHeights
    updateControl(tableId, { properties: props })
  }

  function clearStaticTableCellContents(tableId: string) {
    const control = template.value.controls.find(c => c.id === tableId) as any
    if (!control || control.type !== 'StaticTable') return
    const props = { ...control.properties }
    const cells = props.cells.map((c: any) => ({ ...c, content: undefined }))
    updateControl(tableId, { properties: { ...props, cells } })
  }

  return {
    // 状态
    template,
    selectedControlId,
    multiSelectedIds,
    zoom,
    currentPageId,
    showGrid,
    showRuler,
    snapToGrid,
    gridSize,

    // 计算属性
    selectedControl,
    sortedControls,
    currentPageControls,
    canUndo,
    canRedo,

    // 方法
    addControl,
    deleteControl,
    deleteSelectedControls,
    updateControl,
    updateControlPosition,
    updateControlSize,
    selectControl,
    clearSelection,
    copyControls,
    pasteControls,
    cutControls,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    undo,
    redo,
    commitPositionChange,
    commitSizeChange,
    setZoom,
    toggleGrid,
    toggleRuler,
    toggleSnapToGrid,
    snapToGridValue,
    loadTemplate,
    newTemplate,
    alignControls,
    // 表格操作
    addTableColumn,
    deleteTableColumn,
    updateTableColumn,
    selectCell,
    clearCellSelection,
    selectedCell,
    selectedStaticTableCell,
    selectStaticTableCell,
    clearStaticTableCellSelection,
    staticCellEditorOpen,
    openStaticCellEditor,
    closeStaticCellEditor,
    multiSelectedStaticCells,
    selectedStaticTableColumn,
    selectedStaticTableRow,
    toggleStaticCellMultiSelect,
    clearMultiStaticTableSelection,
    insertStaticTableRow,
    insertStaticTableRowBefore,
    insertStaticTableRowAfter,
    insertStaticTableCol,
    insertStaticTableColBefore,
    insertStaticTableColAfter,
    deleteStaticTableRow,
    deleteStaticTableCol,
    mergeStaticTableCells,
    splitStaticTableCell,
    updateStaticTableColWidth,
    updateStaticTableRowHeight,
    duplicateStaticTableRow,
    duplicateStaticTableCol,
    clearStaticTableCellContents,
    selectStaticTableColumn,
    selectStaticTableRow,
    setSelectedColumnWidth,
    setSelectedRowHeight,
    selectedTarget,
    dataSourceFields,
    selectPage,
  }
})
// Build timestamp: Fri Aug 14 16:18:43 CST 2026
