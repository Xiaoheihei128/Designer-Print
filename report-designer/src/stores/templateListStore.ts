// 模板列表管理 Store（前端内存版，跨页面共享模板数据）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ReportTemplate } from '@/types/template'
import { createDefaultTemplate } from '@/types/template'

export const useTemplateListStore = defineStore('templateList', () => {
  // 模板列表
  const templates = ref<ReportTemplate[]>([])

  // 是否已初始化（避免重复加载 mock 数据）
  const initialized = ref(false)

  // 计算属性
  const totalCount = computed(() => templates.value.length)
  const activeCount = computed(() => templates.value.filter(t => t.isActive).length)

  // 初始化 mock 数据（只在首次访问列表时执行一次）
  function initIfEmpty() {
    if (initialized.value) return
    initialized.value = true

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
        matchRules: [{ field: 'ReportType', operator: 'Equals', value: 'FinishedProduct', priority: 10 }],
        createdAt: '2026-08-01T10:00:00Z',
        createdBy: 'admin',
        updatedAt: '2026-08-12T10:00:00Z',
        updatedBy: 'admin'
      },
      {
        id: 3,
        version: 1,
        name: '半成品检验报告',
        category: 'SemiFinished',
        description: '半成品过程检验模板',
        paper: { size: 'A4', width: 210, height: 297, unit: 'mm', orientation: 'portrait', margins: { top: 20, bottom: 20, left: 20, right: 20 } },
        controls: [],
        pages: [{ id: 1, background: '#FFFFFF' }],
        isActive: false,
        matchRules: [{ field: 'ReportType', operator: 'Equals', value: 'SemiFinished', priority: 10 }],
        createdAt: '2026-08-05T10:00:00Z',
        createdBy: 'admin',
        updatedAt: '2026-08-10T10:00:00Z',
        updatedBy: 'admin'
      }
    ]
  }

  // 按 id 查找
  function getById(id: number): ReportTemplate | undefined {
    return templates.value.find(t => t.id === id)
  }

  // 创建新模板
  function create(): ReportTemplate {
    const newTemplate: ReportTemplate = {
      ...createDefaultTemplate(),
      id: Date.now(),
      version: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: 'admin',
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin'
    }
    templates.value.push(newTemplate)
    return newTemplate
  }

  // 更新模板（覆盖）
  function update(id: number, patch: Partial<ReportTemplate>) {
    const index = templates.value.findIndex(t => t.id === id)
    if (index === -1) return
    templates.value[index] = {
      ...templates.value[index],
      ...patch,
      updatedAt: new Date().toISOString()
    }
  }

  // 复制模板
  function duplicate(id: number): ReportTemplate | null {
    const source = getById(id)
    if (!source) return null
    const copy: ReportTemplate = {
      ...JSON.parse(JSON.stringify(source)),
      id: Date.now(),
      version: 1,
      name: source.name + ' (副本)',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    templates.value.push(copy)
    return copy
  }

  // 切换启用状态
  function toggleActive(id: number) {
    const t = getById(id)
    if (!t) return
    t.isActive = !t.isActive
    t.updatedAt = new Date().toISOString()
  }

  // 删除模板
  function remove(id: number) {
    const index = templates.value.findIndex(t => t.id === id)
    if (index !== -1) {
      templates.value.splice(index, 1)
    }
  }

  return {
    templates,
    initialized,
    totalCount,
    activeCount,
    initIfEmpty,
    getById,
    create,
    update,
    duplicate,
    toggleActive,
    remove
  }
})