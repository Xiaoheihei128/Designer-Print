// 模板管理 Store（对接后端 API）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '@/services/api'
import type { TemplateDto } from '@/services/api'

export const useTemplateStore = defineStore('template', () => {
  // 状态
  const templates = ref<TemplateDto[]>([])
  const currentTemplate = ref<TemplateDto | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const statistics = ref<api.TemplateStatistics | null>(null)

  // 计算属性
  const totalCount = computed(() => statistics.value?.totalCount || 0)
  const activeCount = computed(() => statistics.value?.activeCount || 0)

  // 获取模板列表
  async function fetchTemplates(params?: {
    keyword?: string
    category?: string
    isActive?: boolean
    pageIndex?: number
    pageSize?: number
  }) {
    loading.value = true
    error.value = null
    try {
      const result = await api.getTemplates(params)
      templates.value = result.items
      return result
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取单个模板
  async function fetchTemplate(id: number) {
    loading.value = true
    error.value = null
    try {
      currentTemplate.value = await api.getTemplate(id)
      return currentTemplate.value
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 创建模板
  async function createTemplate(data: Partial<TemplateDto>) {
    loading.value = true
    error.value = null
    try {
      const created = await api.createTemplate(data)
      templates.value.unshift(created)
      return created
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 更新模板
  async function saveTemplate(id: number, data: Partial<TemplateDto>) {
    loading.value = true
    error.value = null
    try {
      const updated = await api.updateTemplate(id, data)
      const index = templates.value.findIndex(t => t.id === id)
      if (index !== -1) {
        templates.value[index] = updated
      }
      if (currentTemplate.value?.id === id) {
        currentTemplate.value = updated
      }
      return updated
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 删除模板
  async function removeTemplate(id: number) {
    loading.value = true
    error.value = null
    try {
      await api.deleteTemplate(id)
      templates.value = templates.value.filter(t => t.id !== id)
      if (currentTemplate.value?.id === id) {
        currentTemplate.value = null
      }
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 复制模板
  async function copyTemplate(id: number, newName?: string) {
    loading.value = true
    error.value = null
    try {
      const copied = await api.duplicateTemplate(id, newName)
      templates.value.unshift(copied)
      return copied
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 切换状态
  async function toggleActive(id: number) {
    loading.value = true
    error.value = null
    try {
      const updated = await api.toggleTemplateActive(id)
      const index = templates.value.findIndex(t => t.id === id)
      if (index !== -1) {
        templates.value[index] = updated
      }
      return updated
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取统计
  async function fetchStatistics() {
    try {
      statistics.value = await api.getTemplateStatistics()
    } catch (e: any) {
      error.value = e.message
    }
  }

  // 匹配模板
  async function matchTemplate(data: any) {
    loading.value = true
    error.value = null
    try {
      return await api.matchTemplate(data)
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    // 状态
    templates,
    currentTemplate,
    loading,
    error,
    statistics,
    // 计算属性
    totalCount,
    activeCount,
    // 方法
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    saveTemplate,
    removeTemplate,
    copyTemplate,
    toggleActive,
    fetchStatistics,
    matchTemplate,
  }
})
