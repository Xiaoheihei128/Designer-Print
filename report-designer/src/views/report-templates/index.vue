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
      <el-button size="default" @click="loadTemplates">刷新</el-button>
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
      <el-table-column label="匹配规则" width="90" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.matchRules?.length" type="warning" size="small">{{ row.matchRules.length }} 条</el-tag>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="isActive" label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
            {{ row.isActive ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="170">
        <template #default="{ row }">
          {{ formatDate(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="handleEditRules(row)">规则</el-button>
          <el-button link type="primary" @click="handleCopy(row)">复制</el-button>
          <el-button link :type="row.isActive ? 'warning' : 'success'" @click="handleToggleStatus(row)">
            {{ row.isActive ? '禁用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && templates.length === 0" description="暂无模板, 点击右上角新建" />

    <!-- 模板规则编辑对话框 -->
    <el-dialog v-model="dialogVisible" title="模板设置" width="640px">
      <el-form :model="formData" label-width="90px">
        <el-form-item label="模板名称">
          <el-input v-model="formData.name" placeholder="请输入模板名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="formData.category" placeholder="请选择分类">
            <el-option v-for="cat in categories" :key="cat.value" :label="cat.label" :value="cat.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="2" placeholder="请输入描述" />
        </el-form-item>

        <el-divider>匹配规则</el-divider>

        <div class="match-rules">
          <div v-for="(rule, index) in formData.matchRules" :key="index" class="rule-item">
            <el-select v-model="rule.field" placeholder="字段" style="width: 140px">
              <el-option label="Header.ReportType" value="Header.ReportType" />
              <el-option label="Header.ReportNo" value="Header.ReportNo" />
              <el-option label="Header.MaterialName" value="Header.MaterialName" />
              <el-option label="Header.Result" value="Header.Result" />
              <el-option label="Header.Inspector" value="Header.Inspector" />
            </el-select>
            <el-select v-model="rule.operator" placeholder="操作符" style="width: 110px">
              <el-option v-for="op in OPERATORS" :key="op.value" :label="op.label" :value="op.value" />
            </el-select>
            <el-input v-model="rule.value" placeholder="值" style="width: 130px" />
            <el-input-number v-model="rule.priority" :min="0" :max="100" controls-position="right" title="优先级" style="width: 90px" />
            <el-button @click="removeRule(index)" :icon="Delete" />
          </div>
          <el-button @click="addRule" :icon="Plus">添加规则</el-button>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { TEMPLATE_CATEGORIES } from '@/types/template'

const router = useRouter()
const categories = TEMPLATE_CATEGORIES

// 匹配操作符(与 templateMatcher.ts 对齐)
const OPERATORS = [
  { label: '等于', value: 'Equals' },
  { label: '不等于', value: 'NotEquals' },
  { label: '包含', value: 'Contains' },
  { label: '开头是', value: 'StartsWith' },
  { label: '结尾是', value: 'EndsWith' },
  { label: '为空', value: 'Empty' },
  { label: '非空', value: 'NotEmpty' },
  { label: '大于', value: 'GreaterThan' },
  { label: '小于', value: 'LessThan' },
]

const API_BASE = 'http://localhost:5000/api/print/templates'

// 列表
const templates = ref<any[]>([])
const loading = ref(false)
const filterCategory = ref('')
const filterStatus = ref('')
const searchKeyword = ref('')

const filteredTemplates = computed(() => {
  return templates.value.filter(t => {
    if (filterCategory.value && t.category !== filterCategory.value) return false
    if (filterStatus.value === 'active' && !t.isActive) return false
    if (filterStatus.value === 'inactive' && t.isActive) return false
    if (searchKeyword.value && !t.name.includes(searchKeyword.value)) return false
    return true
  })
})

function parseMatchRules(raw: string | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

async function loadTemplates() {
  loading.value = true
  try {
    const res = await fetch(API_BASE)
    const data = await res.json()
    templates.value = (data.items || []).map((item: any) => ({
      ...item,
      matchRules: parseMatchRules(item.matchRules),
    }))
  } catch (e) {
    ElMessage.error('加载模板失败, 请确认后端已启动 (dotnet run)')
    templates.value = []
  } finally {
    loading.value = false
  }
}

// 规则编辑对话框
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const formData = ref({
  name: '',
  category: 'Other',
  description: '',
  matchRules: [] as Array<{ field: string; operator: string; value: string; priority: number }>,
})

function handleEditRules(row: any) {
  editingId.value = row.id
  formData.value = {
    name: row.name,
    category: row.category || 'Other',
    description: row.description || '',
    matchRules: (row.matchRules || []).map((r: any) => ({ ...r })),
  }
  dialogVisible.value = true
}

function addRule() {
  formData.value.matchRules.push({ field: 'Header.ReportType', operator: 'Equals', value: '', priority: 0 })
}

function removeRule(index: number) {
  formData.value.matchRules.splice(index, 1)
}

async function handleSave() {
  if (!formData.value.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  try {
    const res = await fetch(API_BASE + '/' + editingId.value, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.value.name.trim(),
        category: formData.value.category,
        matchRules: JSON.stringify(formData.value.matchRules),
      }),
    })
    if (!res.ok) throw new Error('保存失败')
    ElMessage.success('模板设置已保存')
    dialogVisible.value = false
    loadTemplates()
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

// 新建 → 直接进设计器(保存时自动创建)
function handleCreate() {
  router.push('/op-designer')
}

// 编辑 → 打开设计器加载模板
function handleEdit(row: any) {
  router.push({ path: '/op-designer', query: { id: row.id } })
}

// 复制
async function handleCopy(row: any) {
  try {
    const detail = await fetch(API_BASE + '/' + row.id).then(r => r.json())
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: row.name + ' (副本)',
        code: row.code ? row.code + '-COPY' : '',
        category: row.category,
        content: detail.content,
        matchRules: detail.matchRules,
        isActive: true,
      }),
    })
    if (!res.ok) throw new Error('复制失败')
    ElMessage.success('模板已复制')
    loadTemplates()
  } catch (e) {
    ElMessage.error('复制失败')
  }
}

// 启停
async function handleToggleStatus(row: any) {
  try {
    const res = await fetch(API_BASE + '/' + row.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    })
    if (!res.ok) throw new Error('操作失败')
    ElMessage.success(`模板已${row.isActive ? '禁用' : '启用'}`)
    loadTemplates()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

// 删除
function handleDelete(row: any) {
  ElMessageBox.confirm('确定要删除这个模板吗?', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(async () => {
    try {
      const res = await fetch(API_BASE + '/' + row.id, { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败')
      ElMessage.success('模板已删除')
      loadTemplates()
    } catch (e) {
      ElMessage.error('删除失败')
    }
  }).catch(() => {})
}

function getCategoryLabel(category: string): string {
  const cat = categories.find(c => c.value === category)
  return cat ? cat.label : category
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

onMounted(loadTemplates)
</script>

<style scoped>
.template-list-page {
  padding: 20px;
  background: #f0f2f5;
  height: calc(100vh - 48px);
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

.muted {
  color: #c0c4cc;
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
</style>
