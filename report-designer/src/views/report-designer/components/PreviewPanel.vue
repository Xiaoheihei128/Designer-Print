<template>
  <div class="preview-panel">
    <div class="preview-header">
      <span>预览</span>
      <div class="preview-actions">
        <el-button-group size="small">
          <el-button :icon="Refresh" @click="handleRefresh">刷新</el-button>
          <el-button :icon="Printer" @click="handlePrint">打印</el-button>
          <el-button :icon="Document" @click="handleExportHtml">HTML</el-button>
          <el-button :icon="Document" @click="handleExportPdf">PDF</el-button>
        </el-button-group>
      </div>
    </div>
    
    <div class="preview-toolbar">
      <el-radio-group v-model="dataSourceType" size="small">
        <el-radio-button value="mock">模拟数据</el-radio-button>
        <el-radio-button value="custom">自定义数据</el-radio-button>
      </el-radio-group>
      
      <el-select v-model="mockDataPreset" size="small" style="width: 150px" v-if="dataSourceType === 'mock'">
        <el-option label="原料检验报告" value="rawMaterial" />
        <el-option label="成品检验报告" value="finishedProduct" />
        <el-option label="半成品检验报告" value="semiFinished" />
        <el-option label="包材检验报告" value="package" />
      </el-select>
    </div>
    
    <!-- 自定义数据输入 -->
    <div v-if="dataSourceType === 'custom'" class="custom-data-input">
      <el-input
        v-model="customDataJson"
        type="textarea"
        :rows="8"
        placeholder="输入 JSON 格式数据..."
      />
      <el-button @click="handleParseCustomData" size="small" type="primary">解析</el-button>
    </div>
    
    <!-- 预览容器 -->
    <div class="preview-container" ref="previewContainerRef">
      <div 
        class="preview-iframe-wrapper"
        v-html="previewHtml"
      ></div>
    </div>
    
    <!-- 分页导航 -->
    <div class="preview-pagination" v-if="pageCount > 1">
      <el-button 
        :icon="ArrowLeft" 
        :disabled="currentPage <= 0" 
        @click="currentPage--"
        size="small"
      />
      <span>{{ currentPage + 1 }} / {{ pageCount }}</span>
      <el-button 
        :icon="ArrowRight" 
        :disabled="currentPage >= pageCount - 1" 
        @click="currentPage++"
        size="small"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Refresh, Printer, Document, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { useReportDesignerStore } from '@/stores/reportDesigner'
import { generateReportHtml, print, exportAsPdf } from '@/services/generator'
import { getMockData } from '@/services/mockData'

const store = useReportDesignerStore()

const dataSourceType = ref<'mock' | 'custom'>('mock')
const mockDataPreset = ref('rawMaterial')
const customDataJson = ref('')
const currentPage = ref(0)
const pageCount = ref(1)
const previewContainerRef = ref<HTMLElement>()

// 当前使用的数据
const currentData = computed(() => {
  if (dataSourceType.value === 'mock') {
    return getMockData(mockDataPreset.value)
  }
  // 自定义数据
  if (customDataJson.value) {
    try {
      return JSON.parse(customDataJson.value)
    } catch {
      return {}
    }
  }
  return {}
})

// 生成的预览 HTML
const previewHtml = computed(() => {
  if (!store.template) return ''
  
  try {
    const html = generateReportHtml(store.template, currentData.value, { format: 'html' })
    return html
  } catch (e) {
    return `<div style="padding: 20px; color: red;">预览生成失败: ${e}</div>`
  }
})

// 刷新预览
function handleRefresh() {
  currentPage.value = 0
}

// 打印
function handlePrint() {
  if (!store.template) return
  print(store.template, currentData.value)
}

// 导出 HTML
function handleExportHtml() {
  if (!store.template) return
  
  const html = generateReportHtml(store.template, currentData.value, { format: 'html' })
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.template.name || 'report'}.html`
  a.click()
  URL.revokeObjectURL(url)
}

// 导出 PDF
async function handleExportPdf() {
  if (!store.template) return
  try {
    await exportAsPdf(store.template, currentData.value)
  } catch (e) {
    alert('PDF 导出失败: ' + e)
  }
}

// 解析自定义数据
function handleParseCustomData() {
  try {
    JSON.parse(customDataJson.value)
  } catch (e) {
    alert('JSON 格式错误: ' + e)
  }
}

// 监听模板变化
watch(() => store.template, () => {
  currentPage.value = 0
}, { deep: true })
</script>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f5f5;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  font-weight: 600;
  font-size: 14px;
}

.preview-toolbar {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}

.custom-data-input {
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.custom-data-input :deep(.el-textarea) {
  flex: 1;
}

.preview-container {
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  justify-content: center;
}

.preview-iframe-wrapper {
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.preview-iframe-wrapper :deep(.report-page) {
  background: #fff;
}

.preview-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border-top: 1px solid #e8e8e8;
}

.preview-pagination span {
  font-size: 13px;
  color: #606266;
}

:deep(iframe) {
  border: none;
  display: block;
}
</style>
