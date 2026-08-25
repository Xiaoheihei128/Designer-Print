<template>
  <div class="data-binding-panel">
    <div class="panel-title">
      <span>数据绑定</span>
      <div class="panel-actions">
        <el-tooltip content="导入 JSON / TS 接口 / C# 类" placement="top">
          <el-button text @click="importDialogVisible = true">
            <el-icon><Upload /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="清除自定义数据源" placement="top">
          <el-button text @click="handleClearCustom" :disabled="!hasCustom">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>
    
    <!-- 导入数据源弹窗 -->
    <el-dialog
      v-model="importDialogVisible"
      title="导入数据源定义"
      width="640px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="import-tips">
        <p>支持四种格式，注释（<code>// ...</code>、<code>/* ... */</code>、<code>/// ...</code>）会自动作为字段显示名：</p>
        <ol>
          <li><b>JSON 格式</b>：<code>{"{ \"Header\": { \"ReportNo\": \"...\" } }"}</code></li>
          <li><b>TS 接口</b>：<code>interface Data { /** 报告编号 */ ReportNo: string }</code></li>
          <li><b>C# 类</b>：<code>public class Data { public string ReportNo { get; set; } public List&lt;Item&gt; Items { get; set; } }</code></li>
          <li><b>对象字面量</b>：<code>{ /** 行项 */ ReportItems: { AnaItem: string }[] }</code></li>
        </ol>
      </div>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="14"
        placeholder="粘贴 JSON 或 TypeScript 接口定义..."
        class="import-textarea"
      />
      <div v-if="parsePreview" class="preview-section">
        <div class="preview-title">解析预览（{{ parsePreview.length }} 个字段）</div>
        <div class="preview-tree">
          <div v-for="node in parsePreview" :key="node.path || node.name" class="preview-node">
            <span class="preview-name">{{ node.name }}</span>
            <el-tag size="small" :type="node.type === 'array' ? 'warning' : 'info'">{{ node.type }}</el-tag>
            <span v-if="node.label" class="preview-label">「{{ node.label }}」</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button @click="handlePreviewParse" :disabled="!importText">预览</el-button>
        <el-button type="primary" @click="handleApplyImport" :disabled="!parsePreview">应用</el-button>
      </template>
    </el-dialog>
    
    <div class="data-source-tree">
      <el-tree
        :data="treeData"
        :props="treeProps"
        node-key="path"
        default-expand-all
        draggable
        @node-click="handleNodeClick"
        @node-contextmenu="handleContextMenu"
      >
        <template #default="{ node, data }">
          <div 
            class="tree-node"
            :class="{ 'is-array': data.type === 'array' }"
            @dragstart="handleDragStart($event, data)"
          >
            <el-icon v-if="data.type === 'object'"><Folder /></el-icon>
            <el-icon v-else-if="data.type === 'array'"><Collection /></el-icon>
            <el-icon v-else><Document /></el-icon>
            <span class="tree-name">{{ data.label || node.label }}</span>
            <span v-if="data.label && data.label !== data.name" class="tree-label-hint" :title="data.label">{{ data.label }}</span>
            <el-tag v-if="data.type === 'array'" size="small" type="warning">数组</el-tag>
          </div>
        </template>
      </el-tree>
    </div>
    
    <div class="binding-hint">
      <p>💡 从数据源拖拽字段到控件即可绑定</p>
    </div>
    
    <!-- 绑定历史 -->
    <div class="binding-list" v-if="bindingHistory.length > 0">
      <div class="section-title">最近绑定</div>
      <div 
        v-for="(item, index) in bindingHistory" 
        :key="index"
        class="binding-item"
        @click="handleApplyBinding(item)"
      >
        <span class="control-name">{{ item.controlName }}</span>
        <span class="field-path">{{ item.fieldPath }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Refresh, Folder, Collection, Document, Upload } from '@element-plus/icons-vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import { getDataSourceFields, parseDataSourceText, setCustomDataSource, clearCustomDataSource, type DataSourceField } from '@/types/dataSource'
import { ElMessage } from 'element-plus'

const store = useReportDesignerStore()

const treeProps = {
  children: 'fields',
  label: 'name',
}

interface TreeNode {
  name: string
  label?: string
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  fields?: TreeNode[]
  path?: string
}

// === 导入数据源 ===
const importDialogVisible = ref(false)
const importText = ref('')
const parsePreview = ref<TreeNode[] | null>(null)
const hasCustom = ref(true)  // 进入设计器后重设

function handlePreviewParse() {
  if (!importText.value.trim()) {
    ElMessage.warning('请粘贴 JSON 或 TypeScript 定义')
    return
  }
  const result = parseDataSourceText(importText.value)
  if (!result) {
    ElMessage.error('解析失败，请检查格式')
    parsePreview.value = null
    return
  }
  // 扁平化用于预览
  parsePreview.value = flattenTree(result.fields || [], '')
  ElMessage.success(`成功解析 ${countFields(result)} 个字段`)
}

function countFields(node: DataSourceField): number {
  let count = 1
  if (node.fields) {
    for (const f of node.fields) {
      count += countFields(f)
    }
  }
  return count
}

function flattenTree(fields: DataSourceField[], parentPath: string): TreeNode[] {
  return fields.map(f => {
    const path = parentPath ? `${parentPath}.${f.name}` : f.name
    return {
      name: f.name,
      label: f.label,
      type: f.type,
      fields: f.fields,
      path
    }
  })
}

function handleApplyImport() {
  const result = parseDataSourceText(importText.value)
  if (!result) {
    ElMessage.error('解析失败')
    return
  }
  setCustomDataSource(result)
  hasCustom.value = true
  importDialogVisible.value = false
  importText.value = ''
  parsePreview.value = null
  ElMessage.success('数据源已应用，刷新后生效')
  // 强制刷新 - 重新计算 treeData
  triggerRefresh()
}

function handleClearCustom() {
  clearCustomDataSource()
  hasCustom.value = false
  ElMessage.success('已恢复默认数据源')
  triggerRefresh()
}

const refreshTick = ref(0)
function triggerRefresh() {
  refreshTick.value++
}

// 绑定历史
const bindingHistory = ref<Array<{
  controlId: string
  controlName: string
  fieldPath: string
}>>([])

// 构建树数据
const treeData = computed<TreeNode[]>(() => {
  // 依赖 refreshTick 以便导入后强制刷新
  void refreshTick.value
  const fields = getDataSourceFields()
  return buildTree(fields, '')
})

function buildTree(node: any, parentPath: string): TreeNode[] {
  if (!node.fields) return []

  return node.fields.map((field: any) => {
    const path = parentPath ? `${parentPath}.${field.name}` : field.name
    return {
      name: field.name,
      label: field.label,
      type: field.type,
      path,
      fields: field.fields ? buildTree(field, path) : undefined,
    }
  })
}

// 处理节点点击
function handleNodeClick(data: TreeNode) {
  // 如果选中了控件，将当前字段绑定到该控件
  if (store.selectedControlId && data.path) {
    bindFieldToControl(store.selectedControlId, data.path)
  }
}

// 处理拖拽开始
function handleDragStart(e: DragEvent, data: TreeNode) {
  if (!data.path) return
  e.dataTransfer?.setData('field-path', data.path)
  e.dataTransfer!.effectAllowed = 'copy'
}

// 将字段绑定到控件
function bindFieldToControl(controlId: string, fieldPath: string) {
  const control = store.template.controls.find(c => c.id === controlId)
  if (!control) return

  // 静态表格：绑定到当前选中的单元格（未选中单元格时提示）
  if (control.type === 'StaticTable') {
    const sel = store.selectedStaticTableCell
    if (!sel || sel.tableId !== controlId) {
      ElMessage.warning('请先选中静态表格中的单元格，再点击字段进行绑定')
      return
    }
    const cells = (control.properties as any).cells.map((c: any) => {
      if (c.id !== sel.cellId) return c
      const content = { ...(c.content || {}), type: c.content?.type || 'text', field: fieldPath }
      // 绑定字段与静态值二选一，绑定后清除静态值
      if (content.value) delete content.value
      return { ...c, content }
    })
    store.updateControl(controlId, { properties: { ...(control.properties as any), cells } })
    bindingHistory.value.unshift({ controlId, controlName: control.name, fieldPath })
    if (bindingHistory.value.length > 10) bindingHistory.value = bindingHistory.value.slice(0, 10)
    ElMessage.success(`已绑定到单元格: ${fieldPath}`)
    return
  }

  // 根据控件类型设置绑定字段
  if (control.type === 'TextField') {
    store.updateControl(controlId, {
      properties: {
        ...control.properties,
        dataBinding: fieldPath,
      }
    })
  } else if (control.type === 'Barcode' || control.type === 'QRCode') {
    store.updateControl(controlId, {
      properties: {
        ...control.properties,
        dataBinding: fieldPath,
      }
    })
  } else if (control.type === 'Table') {
    store.updateControl(controlId, {
      properties: {
        ...control.properties,
        dataBinding: fieldPath,
      }
    })
  }
  
  // 添加到历史
  bindingHistory.value.unshift({
    controlId,
    controlName: control.name,
    fieldPath,
  })
  
  // 只保留最近10条
  if (bindingHistory.value.length > 10) {
    bindingHistory.value = bindingHistory.value.slice(0, 10)
  }
  
  ElMessage.success(`已绑定: ${fieldPath}`)
}

// 应用历史绑定
function handleApplyBinding(item: any) {
  bindFieldToControl(item.controlId, item.fieldPath)
}

// 刷新
function handleRefresh() {
  triggerRefresh()
  ElMessage.success('数据源已刷新')
}

// 暴露方法给外部调用（用于从 Canvas 拖拽绑定）
defineExpose({
  bindFieldToControl,
})

// 监听全局拖拽放置
function handleGlobalDrop(e: DragEvent) {
  const fieldPath = e.dataTransfer?.getData('field-path')
  if (fieldPath && store.selectedControlId) {
    bindFieldToControl(store.selectedControlId, fieldPath)
  }
}

// 在 mounted 时添加全局监听
import { onMounted, onUnmounted } from 'vue'

onMounted(() => {
  document.addEventListener('drop', handleGlobalDrop)
})

onUnmounted(() => {
  document.removeEventListener('drop', handleGlobalDrop)
})
</script>

<style scoped>
.data-binding-panel {
  width: 220px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.panel-actions {
  display: flex;
  gap: 2px;
}

.data-source-tree {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  cursor: grab;
}

.tree-name {
  font-size: 12px;
}

.tree-label-hint {
  font-size: 10px;
  color: #909399;
  background: #f0f7ff;
  padding: 0 4px;
  border-radius: 2px;
  margin-left: 4px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node:active {
  cursor: grabbing;
}

.tree-node.is-array {
  color: #e6a23c;
}

.binding-hint {
  padding: 12px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}

.binding-hint p {
  margin: 0;
  font-size: 11px;
  color: #909399;
}

.binding-list {
  border-top: 1px solid #e8e8e8;
  max-height: 150px;
  overflow: auto;
}

.section-title {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #909399;
  background: #fafafa;
}

.binding-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 11px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.binding-item:hover {
  background: #f0f7ff;
}

.control-name {
  color: #409eff;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-path {
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.el-tree-node__content) {
  padding: 2px 0;
}

:deep(.el-tree-node__label) {
  font-size: 12px;
}

/* 导入弹窗样式 */
.import-tips {
  background: #f5f7fa;
  border-left: 3px solid #409eff;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 4px;
}

.import-tips p {
  margin: 0 0 6px;
  font-size: 12px;
  color: #606266;
}

.import-tips ol {
  margin: 0;
  padding-left: 18px;
  font-size: 11px;
  color: #909399;
}

.import-tips code {
  background: #fff;
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 10px;
  color: #d63384;
  font-family: monospace;
}

.import-textarea {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}

.import-textarea :deep(.el-textarea__inner) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.preview-section {
  margin-top: 12px;
  border-top: 1px solid #ebeef5;
  padding-top: 12px;
}

.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: #67c23a;
  margin-bottom: 8px;
}

.preview-tree {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.preview-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
}

.preview-name {
  font-weight: 500;
  color: #303133;
}

.preview-label {
  color: #909399;
  font-size: 11px;
  font-style: italic;
}
</style>
