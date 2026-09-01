<template>
  <div class="matcher-page">
    <div class="page-header">
      <h2>模板匹配引擎</h2>
    </div>

    <div class="matcher-content">
      <!-- 左侧：数据输入 -->
      <div class="data-input-section">
        <h3>输入数据</h3>
        <div class="data-input-scroll">
          <p class="hint">输入或粘贴 JSON 格式的报表数据，系统将自动匹配最佳模板</p>

          <el-input
            v-model="dataJson"
            type="textarea"
            :rows="12"
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
      </div>

      <!-- 右侧：匹配结果 -->
      <div class="result-section">
        <h3>匹配结果</h3>
        <div class="result-scroll">
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
            <h4>
              其他候选模板
              <el-tag v-if="matchResult && matchResult.score === 0" size="small" type="info" style="margin-left: 8px">
                无匹配 · 请从下方手动选用
              </el-tag>
            </h4>
            <div class="other-candidates-scroll">
              <div v-for="(candidate, index) in otherCandidates" :key="candidate.template.id" class="candidate-card">
                <div class="candidate-header">
                  <span class="rank">#{{ index + 2 }}</span>
                  <span class="name">{{ candidate.template.name }}</span>
                  <span class="score">{{ candidate.score }} 分</span>
                </div>
                <div class="candidate-actions">
                  <el-button
                    size="small"
                    type="primary"
                    plain
                    @click="handleUseTemplate(candidate.template)"
                  >
                    使用此模板
                  </el-button>
                </div>
              </div>
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
import { useBusinessDataStore } from '@op/design/stores/businessData'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'

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
    const res = await fetch('/api/print/templates')
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
    // 没有匹配 —— 用默认模板兜底，但其他候选展示全部 active 模板，
    // 让用户能从滚动列表里手动挑一个，而不是被锁死。
    const activeTemplates = templates.value.filter(t => t.isActive !== false)
    const defaultTemplate = activeTemplates[0]
    if (defaultTemplate) {
      matchResult.value = {
        template: defaultTemplate,
        score: 0,
        matchedRules: [],
      }
      // 兜底候选：除最佳匹配外的全部 active 模板，标记 isFallback 让 UI 区分
      otherCandidates.value = activeTemplates
        .filter((t) => t.id !== defaultTemplate.id)
        .map((t) => ({ template: t, score: 0, matchedRules: [] }))
    }
    ElMessage.warning('没有精确匹配的模板，请从下方列表手动选用')
    // 继续走诊断分支，不要提前 return
  } else {
    // 最佳匹配
    matchResult.value = allResults[0]!
    otherCandidates.value = allResults.slice(1)
  }
  
  // 诊断信息
  showDiagnosis.value = true
  diagnosisResults.value = templates.value
    .filter(t => t.isActive !== false)
    .map(t => getMatchDiagnosis(t, data))
    .filter(d => d.rules.length > 0) // 只显示有规则的模板
  
  ElMessage.success(`匹配到: ${matchResult.value!.template.name}`)
}

// 使用模板：跳转到 OpenPrint 设计器并加载该模板
// 业务数据走 Pinia 直传：useBusinessDataStore.setFromMatcher()，
// 设计器页 onMounted 时通过 usePreviewDataStore.data 拿到同一份。
// sessionStorage 仅作兜底（SPA 重置/刷新整页时恢复）。
function handleUseTemplate(template?: ReportTemplate) {
  try {
    const target = template ?? matchResult.value?.template
    if (!target) return
    const id = target.id
    let parsed: unknown = null
    if (dataJson.value.trim()) {
      try {
        parsed = JSON.parse(dataJson.value)
      } catch {
        ElMessage.warning('JSON 解析失败，跳转后将使用默认示例数据')
      }
    }
    if (parsed && typeof parsed === 'object') {
      // ★ 同一份数据/同一份目录注入，要走同一 sourceId —— 不然 designer.onMounted
      //   兜底路径用 'matcher:restored' 覆盖 matcher 已经设的 'matcher:SemiFinished'，
      //   activeSourceId 被两个路径互掐，fieldTree 看到的是被覆盖的错 ID 对应的目录。
      const matchedCategory = target.category ?? ''
      const matchedSourceId = `matcher:${matchedCategory}`
      const matchedSourceName = `${target.name}（matcher 内省）`

      // 步骤化定位：每一步单独 try/catch，console.error 报具体哪一步抛错
      try {
        const bizStore = useBusinessDataStore()
        bizStore.setFromMatcher(parsed as Record<string, unknown>)
        console.info('[matcher] step 1 ok: businessData.setFromMatcher')
      } catch (e) {
        console.error('[matcher] step 1 throw (setFromMatcher):', e)
      }
      try {
        const fieldCatalog = useFieldCatalogStore()
        const fieldCount = fieldCatalog.injectFromJson(parsed as Record<string, unknown>, {
          sourceId: matchedSourceId,
          sourceName: matchedSourceName,
        })
        console.info(`[matcher] step 2 ok: injectFromJson wrote ${fieldCount} fields`)
      } catch (e) {
        console.error('[matcher] step 2 throw (injectFromJson):', e)
      }
      try {
        // 把 sourceId 一起塞进 sessionStorage，designer.onMounted 兜底时复用同一 ID
        sessionStorage.setItem(
          'op:matcher:lastData',
          JSON.stringify({
            __sourceId: matchedSourceId,
            __sourceName: matchedSourceName,
            data: parsed,
          }),
        )
        console.info('[matcher] step 3 ok: sessionStorage wrote')
      } catch (e) {
        console.warn('[matcher] step 3 warn (sessionStorage):', e)
      }
    }
    ElMessage.success(`已选择模板: ${target.name}, 正在打开设计器...`)
    router.push({ path: '/op-designer', query: { id: String(id) } })
  } catch (err) {
    console.error('[matcher] handleUseTemplate 异常：', err)
    ElMessage.error('跳转设计器失败，请查看控制台')
  }
}

// 初始化
loadSampleData()
</script>

<style scoped>
/* Bug：之前 min-height: 100vh 让页面随内容自由增高，正常窗口下要滚整页才能看完。
   用户被迫手动缩放或拖滚动条，体验差。改为 height: 100vh 锁视口，
   三个区（数据输入 / 匹配结果 / 诊断）各自 max-height + overflow-y 内部滚动。 */
.matcher-page {
  padding: 20px;
  background: #f0f2f5;
  height: 100vh;
  /* 100dvh 在移动浏览器里能避开地址栏的视觉跳动，桌面端回落 100vh */
  height: 100dvh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-header {
  margin-bottom: 16px;
  flex-shrink: 0;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.matcher-content {
  display: flex;
  flex: 1;
  min-height: 0; /* 关键：允许 flex 子项收缩到内容之下，否则内部 overflow 不生效 */
  gap: 20px;
  gap: 20px;
}

.data-input-section {
  width: 45%;
  background: #fff;
  border-radius: 4px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 滚动容器：包住 JSON textarea / 快速设置区，超出 viewport 时内部滚动
   （避免整个数据输入卡片被裁切或撑破 100vh 限制） */
.data-input-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
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
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 滚动容器：包住匹配结果卡片 / 候选列表 / 诊断区 */
.result-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
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
  display: flex;
  align-items: center;
}

/* 候选列表滚动容器 —— Bug：之前没有 max-height，模板多时整页被顶得很长
   用户无法用滚轮只看候选区。固定高度 + overflow-y 让候选区内部滚动，
   左侧数据输入面板保持在视野里不被顶下去。 */
.other-candidates-scroll {
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
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

.candidate-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.diagnosis-section {
  margin-top: 16px;
  background: #fff;
  border-radius: 4px;
  padding: 20px;
  flex-shrink: 0;
  /* 固定高度，不让诊断面板把页面顶破 100vh；
     内容超出时诊断面板内部 el-tabs__content 自己滚动。 */
  max-height: 40vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diagnosis-section h3 {
  margin: 0 0 16px 0;
  font-size: 15px;
  flex-shrink: 0;
}

/* 诊断面板滚动 —— 模板很多时 el-tabs 内容会很长 */
.diagnosis-section :deep(.el-tabs) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.diagnosis-section :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.diagnosis-footer {
  margin-top: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
