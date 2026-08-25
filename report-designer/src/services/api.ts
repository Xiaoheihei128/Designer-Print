// API 服务
// 与后端 API 通信

const API_BASE = 'http://localhost:5000/api'

interface ApiResponse<T> {
  data?: T
  error?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    // 204 No Content
    if (response.status === 204) {
      return {} as T
    }

    return response.json()
  } catch (e) {
    console.error('API Error:', e)
    throw e
  }
}

// ============ 模板 API ============

export interface TemplateDto {
  id: number
  version: number
  name: string
  category: 'RawMaterial' | 'FinishedProduct' | 'SemiFinished' | 'Package' | 'Other'
  description: string
  paper: {
    size: string
    width: number
    height: number
    unit: 'mm'
    orientation: 'portrait' | 'landscape'
    margins: { top: number; bottom: number; left: number; right: number }
  }
  controls: any[]
  pages: { id: number; background: string }[]
  isActive: boolean
  matchRules: { field: string; operator: string; value: string; priority: number }[]
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface TemplateListResponse {
  items: TemplateDto[]
  total: number
  pageIndex: number
  pageSize: number
}

export interface TemplateStatistics {
  totalCount: number
  activeCount: number
  inactiveCount: number
  categoryStats: { category: string; count: number }[]
}

export interface MatchResult {
  template: TemplateDto
  score: number
  matchedRules: {
    field: string
    operator: string
    value: string
    expectedValue: string
    actualValue: any
    matched: boolean
  }[]
}

/**
 * 获取模板列表
 */
export async function getTemplates(params?: {
  keyword?: string
  category?: string
  isActive?: boolean
  pageIndex?: number
  pageSize?: number
}): Promise<TemplateListResponse> {
  const searchParams = new URLSearchParams()
  if (params?.keyword) searchParams.set('keyword', params.keyword)
  if (params?.category) searchParams.set('category', params.category)
  if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive))
  if (params?.pageIndex) searchParams.set('pageIndex', String(params.pageIndex))
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize))

  const query = searchParams.toString()
  return request<TemplateListResponse>(`/templates${query ? `?${query}` : ''}`)
}

/**
 * 获取模板详情
 */
export async function getTemplate(id: number): Promise<TemplateDto> {
  return request<TemplateDto>(`/templates/${id}`)
}

/**
 * 创建模板
 */
export async function createTemplate(data: Partial<TemplateDto>): Promise<TemplateDto> {
  return request<TemplateDto>('/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/**
 * 更新模板
 */
export async function updateTemplate(id: number, data: Partial<TemplateDto>): Promise<TemplateDto> {
  return request<TemplateDto>(`/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

/**
 * 删除模板
 */
export async function deleteTemplate(id: number): Promise<void> {
  return request<void>(`/templates/${id}`, {
    method: 'DELETE',
  })
}

/**
 * 复制模板
 */
export async function duplicateTemplate(id: number, newName?: string): Promise<TemplateDto> {
  return request<TemplateDto>(`/templates/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ newName }),
  })
}

/**
 * 切换模板状态
 */
export async function toggleTemplateActive(id: number): Promise<TemplateDto> {
  return request<TemplateDto>(`/templates/${id}/toggle`, {
    method: 'POST',
  })
}

/**
 * 获取统计数据
 */
export async function getTemplateStatistics(): Promise<TemplateStatistics> {
  return request<TemplateStatistics>('/templates/statistics')
}

/**
 * 匹配模板
 */
export async function matchTemplate(data: any): Promise<MatchResult> {
  return request<MatchResult>('/templates/match', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
