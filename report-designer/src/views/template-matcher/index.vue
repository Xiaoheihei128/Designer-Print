<template>
  <div class="matcher-page">
    <div class="page-header">
      <h2>模板匹配引擎</h2>
    </div>
    
    <div class="matcher-content">
      <!-- 左侧：数据输入 -->
      <div class="data-input-section">
        <h3>输入数据</h3>
        <p class="hint">输入或粘贴 JSON 格式的报表数据，系统将自动匹配最佳模板</p>
        
        <el-input
          v-model="dataJson"
          type="textarea"
          :rows="15"
          placeholder='{"Header": {"ReportType": "RawMaterial", ...}}'
          class="data-textarea"
        />
        
        <div class="data-actions">
          <el-button type="primary" @click="handleMatch">匹配模板</el-button>
          <el-button @click="loadSampleData">加载示例</el-button>
        </div>
        
        <!-- 快速设置 -->
        <div class="quick-set">
          <h4>快速设置</h4>
          <el-radio-group v-model="quickType" size="small" @change="handleQuickChange">
            <el-radio-button value="rawMaterial">原料检验</el-radio-button>
            <el-radio-button value="finishedProduct">成品检验</el-radio-button>
            <el-radio-button value="semiFinished">半成品检验</el-radio-button>
            <el-radio-button value="package">包材检验</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      
      <!-- 右侧：匹配结果 -->
      <div class="result-section">
        <h3>匹配结果</h3>
        
        <div v-if="!matchResult" class="no-result">
          <p>暂无匹配结果</p>
        </div>
        
        <div v-else class="match-result">
          <div class="result-card" :class="{ 'best-match': true }">
            <div class="card-header">
              <span class="badge">最佳匹配</span>
              <span class="score">{{ matchResult.score }} 分</span>
            </div>
            <div class="card-body">
              <h4>{{ matchResult.template.name }}</h4>
              <div class="meta">
                <el-tag size="small">{{ getCategoryLabel(matchResult.template.category) }}</el-tag>
                <el-tag size="small" type="success">v{{ matchResult.template.version }}</el-tag>
              </div>
              <p class="desc">{{ matchResult.template.description || '无描述' }}</p>
            </div>
            <div class="card-footer">
              <el-button type="primary" size="small" @click="handleUseTemplate">使用此模板</el-button>
            </div>
          </div>
          
          <!-- 匹配详情 -->
          <div class="match-details" v-if="matchResult.matchedRules.length > 0">
            <h4>匹配规则详情</h4>
            <el-table :data="matchResult.matchedRules" size="small" border>
              <el-table-column prop="rule.field" label="字段" width="150" />
              <el-table-column prop="rule.operator" label="操作符" width="100" />
              <el-table-column prop="rule.value" label="期望值" width="120" />
              <el-table-column prop="fieldValue" label="实际值" />
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.matched ? 'success' : 'danger'" size="small">
                    {{ row.matched ? '匹配' : '不匹配' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
          
          <!-- 其他候选模板 -->
          <div class="other-candidates" v-if="otherCandidates.length > 0">
            <h4>其他候选模板</h4>
            <div v-for="(candidate, index) in otherCandidates" :key="candidate.template.id" class="candidate-card">
              <div class="candidate-header">
                <span class="rank">#{{ index + 2 }}</span>
                <span class="name">{{ candidate.template.name }}</span>
                <span class="score">{{ candidate.score }} 分</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 诊断面板 -->
    <div class="diagnosis-section" v-if="showDiagnosis">
      <h3>匹配诊断</h3>
      <el-tabs>
        <el-tab-pane 
          v-for="diag in diagnosisResults" 
          :key="diag.templateName" 
          :label="diag.templateName"
        >
          <el-table :data="diag.rules" size="small" border>
            <el-table-column prop="field" label="字段" width="150" />
            <el-table-column prop="operator" label="操作符" width="100" />
            <el-table-column prop="expectedValue" label="期望值" width="120" />
            <el-table-column prop="actualValue" label="实际值" />
            <el-table-column label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.matched ? 'success' : 'danger'" size="small">
                  {{ row.matched ? '✓' : '✗' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <div class="diagnosis-footer">
            得分: {{ diag.overallScore }} | 
            匹配: {{ diag.isMatch ? '是' : '否' }}
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getAllMatchResults, getMatchDiagnosis, type MatchResult } from '@/services/templateMatcher'
import { getMockData } from '@/services/mockData'
import { TEMPLATE_CATEGORIES, type ReportTemplate } from '@/types/template'

const router = useRouter()

// 数据输入
const dataJson = ref('')
const quickType = ref('rawMaterial')
const showDiagnosis = ref(false)

// 匹配结果
const matchResult = ref<MatchResult | null>(null)
const otherCandidates = ref<MatchResult[]>([])

// 诊断结果
const diagnosisResults = ref<ReturnType<typeof getMatchDiagnosis>[]>([])

// 模板列表（后端 /api/print/templates, 含 matchRules; 后端不可用时回退模拟数据）
const templates = ref<ReportTemplate[]>([])

// 后端模板摘要 → 匹配器需要的 ReportTemplate 形状
function mapBackendTemplate(item: any): ReportTemplate {
  let matchRules: ReportTemplate['matchRules'] = []
  if (item.matchRules) {
    try {
      matchRules = JSON.parse(item.matchRules)
    } catch { /* 忽略损坏的规则 */ }
  }
  return {
    id: item.id as any, // 后端 id 为字符串 "tpl_xxx"
    version: 1,
    name: item.name || '未命名模板',
    category: item.category || 'Other',
    description: item.remark || '',
    paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
    controls: [],
    pages: [{ id: 1, background: '#FFFFFF' }],
    isActive: true,
    matchRules,
    createdAt: item.createdAt || '',
    createdBy: item.createdBy || '',
    updatedAt: item.updatedAt || '',
    updatedBy: item.updatedBy || '',
  }
}

onMounted(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/print/templates')
    const data = await res.json()
    if (Array.isArray(data.items) && data.items.length > 0) {
      templates.value = data.items.map(mapBackendTemplate)
      ElMessage.success(`已从后端加载 ${templates.value.length} 个模板`)
      return
    }
  } catch { /* 后端不可用, 回退模拟数据 */ }
  templates.value = buildMockTemplates()
})

// 模拟模板列表（后端不可用时的回退数据）
function buildMockTemplates(): ReportTemplate[] {
  return [
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
    matchRules: [
      { field: 'Header.ReportType', operator: 'Equals', value: 'RawMaterial', priority: 10 },
      { field: 'Header.Category', operator: 'Equals', value: 'RawMaterial', priority: 5 }
    ],
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
    matchRules: [
      { field: 'Header.ReportType', operator: 'Equals', value: 'FinishedProduct', priority: 10 }
    ],
    createdAt: '2026-08-02T10:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-08-10T10:00:00Z',
    updatedBy: 'admin'
  },
  {
    id: 3,
    version: 1,
    name: '半成品检验报告',
    category: 'SemiFinished',
    description: '半成品加工检验模板',
    paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
    controls: [],
    pages: [{ id: 1, background: '#FFFFFF' }],
    isActive: true,
    matchRules: [
      { field: 'Header.ReportType', operator: 'Equals', value: 'SemiFinished', priority: 10 }
    ],
    createdAt: '2026-08-03T10:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-08-09T10:00:00Z',
    updatedBy: 'admin'
  },
  {
    id: 4,
    version: 1,
    name: '包材检验报告',
    category: 'Package',
    description: '包装材料检验模板',
    paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
    controls: [],
    pages: [{ id: 1, background: '#FFFFFF' }],
    isActive: true,
    matchRules: [
      { field: 'Header.ReportType', operator: 'Equals', value: 'Package', priority: 10 }
    ],
    createdAt: '2026-08-04T10:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-08-08T10:00:00Z',
    updatedBy: 'admin'
  }
  ]
}
function getCategoryLabel(category: string): string {
  const cat = TEMPLATE_CATEGORIES.find(c => c.value === category)
  return cat ? cat.label : category
}

// 加载示例数据
function loadSampleData() {
  const sample = getMockData(quickType.value)
  dataJson.value = JSON.stringify(sample, null, 2)
}

// 快速设置变化
function handleQuickChange(value: string) {
  loadSampleData()
}

// 执行匹配
function handleMatch() {
  if (!dataJson.value.trim()) {
    ElMessage.warning('请输入数据')
    return
  }
  
  let data
  try {
    data = JSON.parse(dataJson.value)
  } catch (e) {
    ElMessage.error('JSON 格式错误')
    return
  }
  
  // 获取所有匹配结果
  const allResults = getAllMatchResults(templates.value, data)
  
  if (allResults.length === 0) {
    // 没有匹配，使用默认模板
    const defaultTemplate = templates.value.find(t => t.isActive !== false)
    if (defaultTemplate) {
      matchResult.value = {
        template: defaultTemplate,
        score: 1,
        matchedRules: []
      }
      otherCandidates.value = []
    }
    ElMessage.warning('没有精确匹配的模板，使用默认模板')
    return
  }
  
  // 最佳匹配
  matchResult.value = allResults[0]
  otherCandidates.value = allResults.slice(1)
  
  // 诊断信息
  showDiagnosis.value = true
  diagnosisResults.value = templates.value
    .filter(t => t.isActive !== false)
    .map(t => getMatchDiagnosis(t, data))
    .filter(d => d.rules.length > 0) // 只显示有规则的模板
  
  ElMessage.success(`匹配到: ${matchResult.value.template.name}`)
}

// 使用模板：跳转到 OpenPrint 设计器并加载该模板
function handleUseTemplate() {
  if (!matchResult.value) return
  const id = matchResult.value.template.id
  ElMessage.success(`已选择模板: ${matchResult.value.template.name}, 正在打开设计器...`)
  router.push({ path: '/op-designer', query: { id: String(id) } })
}

// 初始化
loadSampleData()
</script>

<style scoped>
.matcher-page {
  padding: 20px;
  background: #f0f2f5;
  min-height: 100vh;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.matcher-content {
  display: flex;
  gap: 20px;
}

.data-input-section {
  width: 45%;
  background: #fff;
  border-radius: 4px;
  padding: 20px;
}

.data-input-section h3 {
  margin: 0 0 8px 0;
  font-size: 15px;
}

.hint {
  margin: 0 0 16px 0;
  font-size: 12px;
  color: #909399;
}

.data-textarea {
  margin-bottom: 16px;
}

.data-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.quick-set {
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.quick-set h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #606266;
}

.result-section {
  width: 55%;
  background: #fff;
  border-radius: 4px;
  padding: 20px;
}

.result-section h3 {
  margin: 0 0 16px 0;
  font-size: 15px;
}

.no-result {
  text-align: center;
  padding: 60px 20px;
  color: #909399;
}

.result-card {
  border: 2px solid #67c23a;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.result-card.best-match {
  background: #f0f9eb;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #67c23a;
  color: #fff;
}

.badge {
  font-weight: 600;
}

.score {
  font-size: 18px;
  font-weight: bold;
}

.card-body {
  padding: 16px;
}

.card-body h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.meta {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.desc {
  margin: 0;
  font-size: 13px;
  color: #606266;
}

.card-footer {
  padding: 12px 16px;
  border-top: 1px solid #e8e8e8;
}

.match-details {
  margin-top: 20px;
}

.match-details h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #606266;
}

.other-candidates {
  margin-top: 20px;
}

.other-candidates h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: #606266;
}

.candidate-card {
  padding: 10px 12px;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  margin-bottom: 8px;
}

.candidate-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.candidate-header .rank {
  color: #909399;
  font-size: 12px;
}

.candidate-header .name {
  flex: 1;
  font-size: 13px;
}

.candidate-header .score {
  color: #909399;
  font-size: 12px;
}

.diagnosis-section {
  margin-top: 20px;
  background: #fff;
  border-radius: 4px;
  padding: 20px;
}

.diagnosis-section h3 {
  margin: 0 0 16px 0;
  font-size: 15px;
}

.diagnosis-footer {
  margin-top: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
