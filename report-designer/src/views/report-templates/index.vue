<template>
  <div class="template-list-page">
    <div class="page-header">
      <h2>报表模板管理</h2>
      <el-button type="primary" @click="handleCreate">新建模板</el-button>
    </div>
    
    <!-- 筛选 -->
    <div class="filter-bar">
      <el-select v-model="filterCategory" placeholder="按分类筛选" clearable size="default" style="width: 150px">
        <el-option label="全部" value="" />
        <el-option v-for="cat in categories" :key="cat.value" :label="cat.label" :value="cat.value" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="按状态筛选" clearable size="default" style="width: 120px">
        <el-option label="全部" value="" />
        <el-option label="启用" value="active" />
        <el-option label="禁用" value="inactive" />
      </el-select>
      <el-input v-model="searchKeyword" placeholder="搜索模板名称" size="default" style="width: 200px" clearable />
    </div>
    
    <!-- 模板列表 -->
    <el-table :data="filteredTemplates" stripe style="width: 100%">
      <el-table-column prop="name" label="模板名称" min-width="150">
        <template #default="{ row }">
          <span class="template-name" @click="handleEdit(row)">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="category" label="分类" width="120">
        <template #default="{ row }">
          <el-tag>{{ getCategoryLabel(row.category) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
      <el-table-column prop="version" label="版本" width="80" align="center" />
      <el-table-column prop="isActive" label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
            {{ row.isActive ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="160">
        <template #default="{ row }">
          {{ formatDate(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="handleCopy(row)">复制</el-button>
          <el-button link :type="row.isActive ? 'warning' : 'success'" @click="handleToggleStatus(row)">
            {{ row.isActive ? '禁用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    
    <!-- 新建/编辑对话框 -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="isEdit ? '编辑模板' : '新建模板'" 
      width="900px"
      fullscreen
    >
      <div class="template-edit-form">
        <!-- 左侧配置 -->
        <div class="form-left">
          <el-form :model="formData" label-width="100px">
            <el-form-item label="模板名称">
              <el-input v-model="formData.name" placeholder="请输入模板名称" />
            </el-form-item>
            <el-form-item label="分类">
              <el-select v-model="formData.category" placeholder="请选择分类">
                <el-option v-for="cat in categories" :key="cat.value" :label="cat.label" :value="cat.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="描述">
              <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="请输入描述" />
            </el-form-item>
            
            <el-divider>页面设置</el-divider>
            
            <el-form-item label="纸张大小">
              <el-select v-model="formData.paper.size" @change="handlePaperSizeChange">
                <el-option v-for="size in paperSizes" :key="size.name" :label="size.name" :value="size.name">
                  {{ size.name }} ({{ size.width }}×{{ size.height }}mm)
                </el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="方向">
              <el-radio-group v-model="formData.paper.orientation" @change="handleOrientationChange">
                <el-radio value="portrait">竖向</el-radio>
                <el-radio value="landscape">横向</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="边距 (mm)">
              <el-row :gutter="8">
                <el-col :span="6">
                  <el-input-number v-model="formData.paper.margins.top" :min="0" :max="50" controls-position="right" title="上边距" />
                  <span class="margin-label">上</span>
                </el-col>
                <el-col :span="6">
                  <el-input-number v-model="formData.paper.margins.bottom" :min="0" :max="50" controls-position="right" title="下边距" />
                  <span class="margin-label">下</span>
                </el-col>
                <el-col :span="6">
                  <el-input-number v-model="formData.paper.margins.left" :min="0" :max="50" controls-position="right" title="左边距" />
                  <span class="margin-label">左</span>
                </el-col>
                <el-col :span="6">
                  <el-input-number v-model="formData.paper.margins.right" :min="0" :max="50" controls-position="right" title="右边距" />
                  <span class="margin-label">右</span>
                </el-col>
              </el-row>
            </el-form-item>
            
            <el-divider>匹配规则</el-divider>
            
            <div class="match-rules">
              <div v-for="(rule, index) in formData.matchRules" :key="index" class="rule-item">
                <el-select v-model="rule.field" placeholder="字段" style="width: 120px">
                  <el-option label="ReportType" value="ReportType" />
                  <el-option label="MaterialCategory" value="MaterialCategory" />
                  <el-option label="CustomerCode" value="CustomerCode" />
                  <el-option label="ProductCode" value="ProductCode" />
                </el-select>
                <el-select v-model="rule.operator" placeholder="操作符" style="width: 100px">
                  <el-option label="等于" value="Equals" />
                  <el-option label="包含" value="Contains" />
                  <el-option label="为空" value="Empty" />
                </el-select>
                <el-input v-model="rule.value" placeholder="值" style="width: 120px" />
                <el-input-number v-model="rule.priority" :min="0" :max="100" controls-position="right" title="优先级" style="width: 80px" />
                <el-button @click="removeRule(index)" :icon="Delete" />
              </div>
              <el-button @click="addRule" :icon="Plus">添加规则</el-button>
            </div>
          </el-form>
        </div>
        
        <!-- 右侧设计器 -->
        <div class="form-right">
          <div class="mini-designer-placeholder">
            <p>点击下方按钮进入设计器编辑模板内容</p>
            <el-button type="primary" @click="openDesigner">打开设计器</el-button>
          </div>
        </div>
      </div>
      
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
    
    <!-- 设计器对话框（隐藏默认标题栏，关闭按钮集成到设计器工具栏） -->
    <el-dialog 
      v-model="designerVisible" 
      width="100%" 
      fullscreen
      :show-close="false"
      :before-close="handleDesignerClose"
      class="designer-fullscreen"
    >
      <ReportDesigner @close="() => handleDesignerClose(() => designerVisible = false)" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { PAPER_SIZES, TEMPLATE_CATEGORIES, createDefaultTemplate, type ReportTemplate } from '@/types/template'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import ReportDesigner from '@/views/report-designer/index.vue'

const store = useReportDesignerStore()

const categories = TEMPLATE_CATEGORIES
const paperSizes = PAPER_SIZES

// 筛选
const filterCategory = ref('')
const filterStatus = ref('')
const searchKeyword = ref('')

// 列表数据（模拟）
const templates = ref<ReportTemplate[]>([])

// 对话框
const dialogVisible = ref(false)
const designerVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<number | null>(null)

// 表单数据
const formData = ref({
  name: '',
  category: 'Other',
  description: '',
  paper: {
    size: 'A4',
    width: 210,
    height: 297,
    unit: 'mm' as const,
    orientation: 'portrait' as const,
    margins: { top: 20, bottom: 20, left: 20, right: 20 }
  },
  matchRules: [] as Array<{
    field: string
    operator: string
    value: string
    priority: number
  }>
})

// 过滤后的模板列表
const filteredTemplates = computed(() => {
  return templates.value.filter(t => {
    if (filterCategory.value && t.category !== filterCategory.value) return false
    if (filterStatus.value === 'active' && !t.isActive) return false
    if (filterStatus.value === 'inactive' && t.isActive) return false
    if (searchKeyword.value && !t.name.includes(searchKeyword.value)) return false
    return true
  })
})

// 获取分类标签
function getCategoryLabel(category: string): string {
  const cat = categories.find(c => c.value === category)
  return cat ? cat.label : category
}

// 格式化日期
function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

// 处理新建
function handleCreate() {
  isEdit.value = false
  editingId.value = null
  formData.value = {
    name: '',
    category: 'Other',
    description: '',
    paper: {
      size: 'A4',
      width: 210,
      height: 297,
      unit: 'mm',
      orientation: 'portrait',
      margins: { top: 20, bottom: 20, left: 20, right: 20 }
    },
    matchRules: []
  }
  dialogVisible.value = true
}

// 处理编辑
function handleEdit(row: ReportTemplate) {
  isEdit.value = true
  editingId.value = row.id
  formData.value = {
    name: row.name,
    category: row.category,
    description: row.description,
    paper: { ...row.paper },
    matchRules: row.matchRules || []
  }
  dialogVisible.value = true
}

// 处理复制
function handleCopy(row: ReportTemplate) {
  const newTemplate = {
    ...row,
    id: Date.now(),
    name: row.name + ' (副本)',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  templates.value.push(newTemplate)
  ElMessage.success('模板已复制')
}

// 处理切换状态
function handleToggleStatus(row: ReportTemplate) {
  row.isActive = !row.isActive
  ElMessage.success(`模板已${row.isActive ? '启用' : '禁用'}`)
}

// 处理删除
function handleDelete(row: ReportTemplate) {
  ElMessageBox.confirm('确定要删除这个模板吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    const index = templates.value.findIndex(t => t.id === row.id)
    if (index !== -1) {
      templates.value.splice(index, 1)
      ElMessage.success('模板已删除')
    }
  }).catch(() => {})
}

// 处理纸张大小变化
function handlePaperSizeChange(sizeName: string) {
  const size = paperSizes.find(s => s.name === sizeName)
  if (size) {
    if (formData.value.paper.orientation === 'landscape') {
      formData.value.paper.width = size.height
      formData.value.paper.height = size.width
    } else {
      formData.value.paper.width = size.width
      formData.value.paper.height = size.height
    }
  }
}

// 处理方向变化
function handleOrientationChange() {
  const temp = formData.value.paper.width
  formData.value.paper.width = formData.value.paper.height
  formData.value.paper.height = temp
}

// 添加规则
function addRule() {
  formData.value.matchRules.push({
    field: 'ReportType',
    operator: 'Equals',
    value: '',
    priority: 0
  })
}

// 移除规则
function removeRule(index: number) {
  formData.value.matchRules.splice(index, 1)
}

// 打开设计器
function openDesigner() {
  // 从当前编辑项加载完整的模板数据（包含 controls、pages 等）
  const editingTemplate = templates.value.find(t => t.id === editingId.value)
  if (editingTemplate) {
    store.loadTemplate(JSON.parse(JSON.stringify(editingTemplate)))
  } else {
    // 新建模板的情况
    store.loadTemplate({
      ...createDefaultTemplate(),
      name: formData.value.name || '新模板',
      category: formData.value.category as any,
      description: formData.value.description,
      paper: { ...formData.value.paper }
    })
  }
  designerVisible.value = true
}

// 关闭设计器时同步数据回模板
// 关闭设计器确认（3 个按钮：保存、丢弃、取消）
function handleDesignerClose(done: () => void) {
  const msg = '是否保存设计器中的修改到模板？\n选择“保存修改”将写回模板；选择“丢弃修改”将不保存并关闭；选择“取消”会返回设计器。'
  ElMessageBox({
    title: '关闭设计器',
    message: msg,
    type: 'warning',
    showCancelButton: true,
    showClose: true,
    distinguishCancelAndClose: true,
    confirmButtonText: '保存修改',
    cancelButtonText: '丢弃修改',
    closeButtonText: '取消',
    confirmButtonClass: 'el-button--primary',
    cancelButtonClass: 'el-button--danger is-plain',
    showCloseOnPressEscape: true,
    closeOnPressEscape: true,
  }).then(() => {
    // 确定 → 保存
    if (editingId.value !== null) {
      const index = templates.value.findIndex(t => t.id === editingId.value)
      if (index !== -1) {
        templates.value[index] = {
          ...templates.value[index],
          controls: JSON.parse(JSON.stringify(store.template.controls)),
          pages: JSON.parse(JSON.stringify(store.template.pages)),
          paper: JSON.parse(JSON.stringify(store.template.paper)),
          version: templates.value[index].version + 1,
          updatedAt: new Date().toISOString()
        }
        ElMessage.success('设计器修改已保存到模板')
      }
    } else {
      formData.value.paper = JSON.parse(JSON.stringify(store.template.paper))
    }
    done()
  }).catch((action: string) => {
    if (action === 'cancel') {
      // 取消按钮 → 丢弃修改并关闭
      ElMessage.info('已丢弃设计器的修改')
      done()
    } else if (action === 'close') {
      // X / Esc → 返回设计器
      ElMessage.info('已取消关闭')
      // 不调用 done()，对话框不关闭
    }
  })
}

// 保存
function handleSave() {
  if (!formData.value.name) {
    ElMessage.warning('请输入模板名称')
    return
  }
  
  if (isEdit.value && editingId.value !== null) {
    // 更新
    const index = templates.value.findIndex(t => t.id === editingId.value)
    if (index !== -1) {
      templates.value[index] = {
        ...templates.value[index],
        ...formData.value,
        updatedAt: new Date().toISOString()
      }
    }
    ElMessage.success('模板已更新')
  } else {
    // 新建
    const newTemplate: ReportTemplate = {
      id: Date.now(),
      version: 1,
      name: formData.value.name,
      category: formData.value.category as any,
      description: formData.value.description,
      paper: { ...formData.value.paper },
      controls: [],
      pages: [{ id: 1, background: '#FFFFFF' }],
      matchRules: formData.value.matchRules,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: 'admin',
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin'
    }
    templates.value.push(newTemplate)
    ElMessage.success('模板已创建')
  }
  
  dialogVisible.value = false
}

// 初始化
onMounted(() => {
  // 模拟加载一些模板
  templates.value = [
    {
      id: 1,
      version: 1,
      name: '原料检验报告',
      category: 'RawMaterial',
      description: '标准原料检验报告模板',
      paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      controls: [],
      pages: [{ id: 1, background: '#FFFFFF' }],
      isActive: true,
      matchRules: [{ field: 'ReportType', operator: 'Equals', value: 'RawMaterial', priority: 10 }],
      createdAt: '2026-08-01T10:00:00Z',
      createdBy: 'admin',
      updatedAt: '2026-08-11T10:00:00Z',
      updatedBy: 'admin'
    },
    {
      id: 2,
      version: 2,
      name: '成品检验报告',
      category: 'FinishedProduct',
      description: '成品出厂检验模板',
      paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      controls: [],
      pages: [{ id: 1, background: '#FFFFFF' }],
      isActive: true,
      matchRules: [],
      createdAt: '2026-08-02T10:00:00Z',
      createdBy: 'admin',
      updatedAt: '2026-08-10T10:00:00Z',
      updatedBy: 'admin'
    }
  ]
})
</script>

<style scoped>
.template-list-page {
  padding: 20px;
  background: #f0f2f5;
  height: 100vh;
  overflow: auto;
  box-sizing: border-box;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 16px;
  background: #fff;
  border-radius: 4px;
}

.template-name {
  color: #409eff;
  cursor: pointer;
}

.template-name:hover {
  text-decoration: underline;
}

.template-edit-form {
  display: flex;
  gap: 20px;
  height: 70vh;
}

.form-left {
  width: 400px;
  overflow-y: auto;
  padding-right: 20px;
  border-right: 1px solid #e8e8e8;
}

.form-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-designer-placeholder {
  text-align: center;
  color: #909399;
}

.mini-designer-placeholder p {
  margin-bottom: 16px;
}

.margin-label {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.match-rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

:deep(.el-dialog__body) {
  padding: 20px;
}

/* 覆盖全局 #app 的 max-width 限制 */
:deep(#app) {
  width: 100% !important;
  max-width: none !important;
}

/* 设计器对话框 - 全屏充满 */
:deep(.el-dialog.designer-fullscreen),
:deep(.el-dialog.is-fullscreen.designer-fullscreen) {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  max-width: none !important;
  height: 100vh !important;
  margin: 0 !important;
  transform: none !important;
  display: flex !important;
  flex-direction: column !important;
}

/* 完全隐藏 el-dialog 的 header 和 footer 区域 */
:deep(.el-dialog.designer-fullscreen .el-dialog__header),
:deep(.el-dialog.is-fullscreen.designer-fullscreen .el-dialog__header),
:deep(.el-dialog.designer-fullscreen .el-dialog__footer),
:deep(.el-dialog.is-fullscreen.designer-fullscreen .el-dialog__footer) {
  display: none !important;
  height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* 让 ReportDesigner 占满对话框内容 */
:deep(.el-dialog.designer-fullscreen > .el-dialog__body),
:deep(.el-dialog.is-fullscreen.designer-fullscreen > .el-dialog__body) {
  display: flex !important;
  flex-direction: column !important;
  padding: 0 !important;
  margin: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-height: none !important;
  overflow: hidden !important;
}

/* 防止页面本身出现滚动条 */
.template-list-page {
  overflow: hidden;
}

:deep(.el-overlay) {
  width: 100vw !important;
  height: 100vh !important;
}

:deep(.el-dialog.designer-fullscreen .el-dialog__body),
:deep(.el-dialog.is-fullscreen.designer-fullscreen .el-dialog__body) {
  padding: 0;
  height: 100vh;
  width: 100vw;
  max-width: none;
  max-height: none;
  overflow: hidden;
  flex: 1;
}
</style>
