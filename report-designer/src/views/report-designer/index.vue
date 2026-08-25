<template>
  <div class="report-designer">
    <!-- 顶部工具栏 -->
    <div class="designer-toolbar">
      <div class="toolbar-left">
        <!-- 模板名称（可编辑） -->
        <el-input
          v-model="templateName"
          size="small"
          class="toolbar-name-input"
          placeholder="模板名称"
          @change="handleNameChange"
        />
        
        <!-- 分类 -->
        <el-select 
          v-model="templateCategory" 
          size="small" 
          class="toolbar-category-select"
          @change="handleCategoryChange"
        >
          <el-option v-for="cat in TEMPLATE_CATEGORIES" :key="cat.value" :label="cat.label" :value="cat.value" />
        </el-select>
        
        <!-- 描述 -->
        <el-tooltip content="描述" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Document" 
            @click="descriptionDialogVisible = true"
          />
        </el-tooltip>
        
        <!-- 匹配规则 -->
        <el-tooltip content="匹配规则" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Filter" 
            @click="matchRulesDialogVisible = true"
          />
        </el-tooltip>
        
        <span class="toolbar-divider"></span>
        
        <!-- CRUD 按钮组 -->
        <div class="crud-buttons">
          <el-tooltip content="新建模板" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="Plus" 
              @click="handleNew"
            />
          </el-tooltip>
          <el-tooltip content="保存模板" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="Document" 
              @click="handleSave"
            />
          </el-tooltip>
          <el-tooltip content="加载模板" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="Upload" 
              @click="handleLoad"
            />
          </el-tooltip>
          <el-tooltip content="复制 (Ctrl+C)" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="CopyDocument" 
              :disabled="!store.selectedControlId"
              @click="store.copyControls()"
            />
          </el-tooltip>
          <el-tooltip content="粘贴 (Ctrl+V)" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="DocumentAdd" 
              :disabled="!store.clipboard || store.clipboard.length === 0"
              @click="store.pasteControls()"
            />
          </el-tooltip>
          <el-tooltip content="删除选中 (Del)" placement="bottom">
            <el-button 
              class="icon-btn" 
              :icon="Delete" 
              :disabled="!store.selectedControlId"
              @click="store.deleteSelectedControls()"
            />
          </el-tooltip>
        </div>
      </div>
      
      <div class="toolbar-right">
        <!-- 撤销/重做 -->
        <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="RefreshLeft" 
            :disabled="!store.canUndo" 
            @click="store.undo()"
          />
        </el-tooltip>
        <el-tooltip content="重做 (Ctrl+Y)" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="RefreshRight" 
            :disabled="!store.canRedo" 
            @click="store.redo()"
          />
        </el-tooltip>
        
        <!-- 网格 -->
        <el-tooltip content="网格" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Grid" 
            :class="{ active: store.showGrid }"
            @click="store.toggleGrid()"
          />
        </el-tooltip>
        
        <!-- 标尺 -->
        <el-tooltip content="标尺" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Histogram" 
            :class="{ active: store.showRuler }"
            @click="store.toggleRuler()"
          />
        </el-tooltip>
        
        <!-- 锁定/吸附 -->
        <el-tooltip content="吸附网格" placement="bottom">
          <el-button 
            class="icon-btn icon-btn-red" 
            :icon="Magnet" 
            :class="{ active: store.snapToGrid }"
            @click="store.toggleSnapToGrid()"
          />
        </el-tooltip>
        
        <!-- 对齐 -->
        <el-tooltip content="置顶" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Top" 
            :disabled="!store.selectedControlId"
            @click="store.selectedControlId && store.bringToFront(store.selectedControlId)"
          />
        </el-tooltip>
        <el-tooltip content="置底" placement="bottom">
          <el-button 
            class="icon-btn" 
            :icon="Bottom" 
            :disabled="!store.selectedControlId"
            @click="store.selectedControlId && store.sendToBack(store.selectedControlId)"
          />
        </el-tooltip>
        
        <!-- 发布/预览 -->
        <el-button class="text-btn" @click="handlePublish">发布</el-button>
        <el-button class="text-btn text-btn-primary" @click="handlePreview">预览</el-button>
        
        <!-- 关闭 -->
        <el-tooltip content="关闭" placement="bottom">
          <el-button 
            class="icon-btn icon-btn-close" 
            :icon="Close" 
            @click="emit('close')"
          />
        </el-tooltip>
      </div>
    </div>
    
    <!-- 描述弹窗 -->
    <el-dialog v-model="descriptionDialogVisible" title="模板描述" width="500px" append-to-body>
      <el-input
        v-model="templateDescription"
        type="textarea"
        :rows="5"
        placeholder="请输入模板描述"
        maxlength="500"
        show-word-limit
      />
      <template #footer>
        <el-button @click="descriptionDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleDescriptionSave">保存</el-button>
      </template>
    </el-dialog>
    
    <!-- 匹配规则弹窗 -->
    <el-dialog v-model="matchRulesDialogVisible" title="匹配规则" width="640px" append-to-body>
      <div class="match-rules-editor">
        <p class="match-rules-hint">根据数据源字段定义匹配规则，相同的模板可适用不同业务场景。</p>
        <el-button @click="handleAddMatchRule" type="primary" plain size="small">
          <el-icon><Plus /></el-icon> 添加规则
        </el-button>
        <div class="match-rules-list">
          <div 
            v-for="(rule, idx) in editableMatchRules" 
            :key="idx"
            class="match-rule-row"
          >
            <el-select v-model="rule.field" placeholder="字段" size="small" class="match-field-select" filterable>
              <el-option-group v-for="(group, gi) in dataSourceGroups" :key="gi" :label="group.label">
                <el-option v-for="f in group.fields" :key="group.path + '.' + f.name" :label="f.label || f.name" :value="group.path + '.' + f.name" />
              </el-option-group>
            </el-select>
            <el-select v-model="rule.operator" placeholder="条件" size="small" class="match-op-select">
              <el-option label="等于" value="=" />
              <el-option label="不等于" value="!=" />
              <el-option label="包含" value="contains" />
              <el-option label="大于" value=">" />
              <el-option label="小于" value="<" />
              <el-option label="为空" value="empty" />
              <el-option label="不为空" value="notEmpty" />
            </el-select>
            <el-input v-model="rule.value" placeholder="值" size="small" class="match-value-input" />
            <el-input-number v-model="rule.priority" :min="0" :max="100" size="small" placeholder="优先级" class="match-priority-input" />
            <el-button :icon="Delete" circle size="small" @click="handleRemoveMatchRule(idx)" />
          </div>
          <div v-if="editableMatchRules.length === 0" class="match-rules-empty">
            暂无匹配规则，点击上方按钮添加
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="matchRulesDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleMatchRulesSave">保存</el-button>
      </template>
    </el-dialog>
    
    <!-- 工具栏（横向） -->
    <Toolsbar @add-control="handleAddControl" />
    
    <!-- 主体区域 -->
    <div class="designer-main">
      <!-- 数据绑定面板 -->
      <DataBindingPanel />
      
      <!-- 中间画布 -->
      <div class="canvas-container" ref="canvasContainerRef">
        <Canvas 
          ref="canvasRef"
          @control-select="handleControlSelect"
          @control-move="handleControlMove"
          @control-resize="handleControlResize"
        />
      </div>
      
      <!-- 右侧属性面板 -->
      <PropertiesPanel />
    </div>
    
    <!-- 加载模板对话框 -->
    <el-dialog v-model="loadDialogVisible" title="加载模板" width="400px">
      <el-input
        v-model="templateJsonInput"
        type="textarea"
        :rows="10"
        placeholder="粘贴模板 JSON..."
      />
      <template #footer>
        <el-button @click="loadDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleLoadTemplate">加载</el-button>
      </template>
    </el-dialog>
    
    <!-- 预览对话框 -->
    <el-dialog v-model="previewDialogVisible" title="报表预览" width="900px" fullscreen>
      <PreviewPanel />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Plus, Document, Upload, Delete, CopyDocument, DocumentAdd,
  RefreshLeft, RefreshRight,
  Grid, Histogram,
  Magnet, Top, Bottom,
  Setting, Close, Filter,
} from '@element-plus/icons-vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import type { ControlType } from '@/types/control'
import Toolsbar from './components/Toolsbar.vue'
import Canvas from './components/Canvas.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import DataBindingPanel from './components/DataBindingPanel.vue'
import { PAPER_SIZES, type PaperConfig } from '@/types/template'

const store = useReportDesignerStore()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const canvasRef = ref()
const canvasContainerRef = ref()
const loadDialogVisible = ref(false)
const previewDialogVisible = ref(false)

// === 模板基础信息（顶部标题栏） ===
const TEMPLATE_CATEGORIES = [
  { value: 'RawMaterial', label: '原料检验报告' },
  { value: 'FinishedProduct', label: '成品检验报告' },
  { value: 'SemiFinished', label: '半成品检验报告' },
  { value: 'Package', label: '包材检验报告' },
  { value: 'Other', label: '其他' },
]

const templateName = ref(store.template.name || '')
const templateCategory = ref(store.template.category || 'Other')
const templateDescription = ref(store.template.description || '')
watch(() => store.template.name, (v) => templateName.value = v || '')
watch(() => store.template.category, (v) => templateCategory.value = v || 'Other')
watch(() => store.template.description, (v) => templateDescription.value = v || '')

function handleNameChange(val: string) {
  store.template.name = val
  ElMessage.success('模板名称已更新')
}

function handleCategoryChange(val: string) {
  store.template.category = val as any
}

// === 描述弹窗 ===
const descriptionDialogVisible = ref(false)
function handleDescriptionSave() {
  store.template.description = templateDescription.value
  descriptionDialogVisible.value = false
  ElMessage.success('描述已保存')
}

// === 匹配规则弹窗 ===
const matchRulesDialogVisible = ref(false)
const editableMatchRules = ref<Array<{ field: string; operator: string; value: string; priority: number }>>([])

watch(() => matchRulesDialogVisible, (val) => {
  if (val) {
    editableMatchRules.value = JSON.parse(JSON.stringify(store.template.matchRules || []))
  }
})

interface DataSourceField { name: string; label?: string; type: string; fields?: DataSourceField[] }

// 从 store 获取数据源字段（扁平化）
const dataSourceGroups = computed(() => {
  const root = store.dataSourceFields || { name: '数据源', type: 'object', fields: [] }
  const groups: Array<{ label: string; path: string; fields: DataSourceField[] }> = []
  function walk(node: DataSourceField, parentPath: string) {
    if (node.type === 'object' || node.type === 'array') {
      if (parentPath) {
        groups.push({ label: parentPath, path: parentPath, fields: node.fields || [] })
      }
      if (node.fields) {
        for (const f of node.fields) {
          const p = parentPath ? `${parentPath}.${f.name}` : f.name
          walk(f, p)
        }
      }
    }
  }
  walk(root, '')
  return groups
})

function handleAddMatchRule() {
  editableMatchRules.value.push({
    field: '', operator: '=', value: '', priority: editableMatchRules.value.length
  })
}

function handleRemoveMatchRule(idx: number) {
  editableMatchRules.value.splice(idx, 1)
}

function handleMatchRulesSave() {
  store.template.matchRules = JSON.parse(JSON.stringify(editableMatchRules.value))
  matchRulesDialogVisible.value = false
  ElMessage.success('匹配规则已保存')
}

// === 画布空白点击选择页面 ===
function selectPage() {
  store.clearSelection()
  store.selectedTarget = 'page' as any
}
const templateJsonInput = ref('')

const zoomValue = computed({
  get: () => store.zoom,
  set: (v) => store.setZoom(v)
})

// 处理添加控件
function handleAddControl(type: ControlType) {
  // 在画布中心添加
  const x = (store.template.paper.width - 30) / 2
  const y = (store.template.paper.height - 10) / 2
  store.addControl(type, x, y)
}

// 处理控件选中
function handleControlSelect(id: string | null, multi: boolean) {
  store.selectControl(id, multi)
}

// 处理控件移动
function handleControlMove(id: string, x: number, y: number) {
  const snappedX = store.snapToGridValue(x)
  const snappedY = store.snapToGridValue(y)
  store.updateControlPosition(id, snappedX, snappedY)
}

// 处理控件大小调整
function handleControlResize(id: string, width: number, height: number) {
  const snappedWidth = store.snapToGridValue(width)
  const snappedHeight = store.snapToGridValue(height)
  store.updateControlSize(id, snappedWidth, snappedHeight)
}

// 处理缩放
function handleZoomChange(value: number) {
  store.setZoom(value)
}

// 处理新建
function handleNew() {
  store.newTemplate()
  ElMessage.success('已新建模板')
}

// 处理保存
function handleSave() {
  const json = JSON.stringify(store.template, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.template.name || 'template'}_v${store.template.version}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('模板已保存')
}

// 处理加载
function handleLoad() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e: any) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev: any) => {
      try {
        const template = JSON.parse(ev.target.result)
        store.loadTemplate(template)
        ElMessage.success('模板已加载')
      } catch (err) {
        ElMessage.error('JSON 解析失败: ' + err)
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

// 处理预览
function handlePreview() {
  previewDialogVisible.value = true
}

// 处理发布
function handlePublish() {
  const json = JSON.stringify(store.template, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.template.name || 'template'}_v${store.template.version}_published.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('模板已发布')
}

// 键盘快捷键
function handleKeyDown(e: KeyboardEvent) {
  // 忽略输入框内的按键
  if ((e.target as HTMLElement).tagName === 'INPUT' || 
      (e.target as HTMLElement).tagName === 'TEXTAREA') {
    return
  }
  
  const isCtrl = e.ctrlKey || e.metaKey
  
  // 撤销
  if (isCtrl && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    store.undo()
    return
  }
  
  // 重做
  if (isCtrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault()
    store.redo()
    return
  }
  
  // 复制
  if (isCtrl && e.key === 'c') {
    e.preventDefault()
    store.copyControls()
    return
  }
  
  // 粘贴
  if (isCtrl && e.key === 'v') {
    e.preventDefault()
    store.pasteControls()
    return
  }
  
  // 剪切
  if (isCtrl && e.key === 'x') {
    e.preventDefault()
    store.cutControls()
    return
  }
  
  // 删除（控件）
  if (e.key === 'Delete' || e.key === 'Backspace') {
    // 优先处理 StaticTable 单元格删除（不在输入框中时）
    if (store.selectedStaticTableCell) {
      // 交给 Canvas 的键盘处理，避免冲突
      return
    }
    e.preventDefault()
    store.deleteSelectedControls()
    return
  }
  
  // 全选
  if (isCtrl && e.key === 'a') {
    e.preventDefault()
    store.multiSelectedIds = store.currentPageControls.map(c => c.id)
    return
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
.report-designer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #f0f2f5;
  overflow: hidden;
}

.designer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
  border-bottom: 1px solid #1a252f;
  gap: 16px;
  min-height: 48px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-divider {
  display: inline-block;
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 8px;
}

.crud-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-center {
  flex: 1;
  text-align: center;
}

.toolbar-title {
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.5px;
  user-select: none;
}

.toolbar-name-input {
  width: 180px !important;
  margin-right: 4px;
}

.toolbar-name-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
}

.toolbar-name-input :deep(.el-input__inner) {
  color: #fff !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.toolbar-name-input :deep(.el-input__inner::placeholder) {
  color: rgba(255, 255, 255, 0.5) !important;
}

.toolbar-category-select {
  width: 140px !important;
  margin-right: 4px;
}

.toolbar-category-select :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
}

.toolbar-category-select :deep(.el-input__inner) {
  color: #fff !important;
  font-size: 13px !important;
}

.template-name {
  font-weight: 500;
  font-size: 14px;
}

/* 图标按钮（深色主题） */
.toolbar-right :deep(.icon-btn) {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 18px;
  border-radius: 6px;
  transition: background-color 0.15s;
}

.toolbar-right :deep(.icon-btn:hover:not(:disabled)) {
  background: rgba(255, 255, 255, 0.12);
}

.toolbar-right :deep(.icon-btn:disabled) {
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

.toolbar-right :deep(.icon-btn.active) {
  background: rgba(64, 158, 255, 0.4);
  color: #fff;
}

.toolbar-right :deep(.icon-btn-red:not(:disabled)) {
  color: #ff4d4f;
}

.toolbar-right :deep(.icon-btn-red:not(:disabled):hover) {
  background: rgba(255, 77, 79, 0.15);
}

.toolbar-right :deep(.icon-btn-close:not(:disabled)) {
  color: rgba(255, 255, 255, 0.7);
}

.toolbar-right :deep(.icon-btn-close:not(:disabled):hover) {
  background: rgba(255, 77, 79, 0.2);
  color: #ff7875;
}

/* 文本按钮（深色主题） */
.toolbar-right :deep(.text-btn) {
  margin-left: 12px;
  padding: 0 16px;
  height: 36px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  font-size: 14px;
  border-radius: 6px;
  transition: all 0.15s;
}

.toolbar-right :deep(.text-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.toolbar-right :deep(.text-btn-primary) {
  background: #1890ff;
  border-color: #1890ff;
  color: #fff;
}

.toolbar-right :deep(.text-btn-primary:hover) {
  background: #40a9ff;
  border-color: #40a9ff;
}

.designer-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.canvas-container {
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

/* 匹配规则弹窗 */
.match-rules-editor {
  padding: 4px;
}

.match-rules-hint {
  font-size: 12px;
  color: #909399;
  margin: 0 0 12px 0;
}

.match-rules-list {
  margin-top: 12px;
}

.match-rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.match-field-select {
  flex: 2;
}

.match-op-select {
  flex: 1;
  min-width: 100px;
}

.match-value-input {
  flex: 1;
}

.match-priority-input {
  width: 90px;
}

.match-rules-empty {
  padding: 24px;
  text-align: center;
  color: #909399;
  font-size: 13px;
  background: #fafafa;
  border-radius: 4px;
  border: 1px dashed #dcdfe6;
}
</style>
