// 模板匹配引擎
// 根据数据自动选择最合适的报表模板

import type { ReportTemplate, MatchRule } from '@/types/template'

/**
 * 匹配结果
 */
export interface MatchResult {
  template: ReportTemplate
  score: number
  matchedRules: MatchedRule[]
}

/**
 * 匹配的规则
 */
export interface MatchedRule {
  rule: MatchRule
  fieldValue: any
  matched: boolean
}

/**
 * 匹配操作符
 */
type MatchOperator = 'Equals' | 'NotEquals' | 'Contains' | 'StartsWith' | 'EndsWith' | 'Empty' | 'NotEmpty' | 'GreaterThan' | 'LessThan'

/**
 * 评估单个规则
 */
function evaluateRule(rule: MatchRule, data: any): MatchedRule {
  const { field, operator, value } = rule
  
  // 获取字段值
  const fieldValue = getFieldValue(data, field)
  
  let matched = false
  
  switch (operator as MatchOperator) {
    case 'Equals':
      matched = String(fieldValue) === String(value)
      break
    
    case 'NotEquals':
      matched = String(fieldValue) !== String(value)
      break
    
    case 'Contains':
      matched = String(fieldValue).includes(String(value))
      break
    
    case 'StartsWith':
      matched = String(fieldValue).startsWith(String(value))
      break
    
    case 'EndsWith':
      matched = String(fieldValue).endsWith(String(value))
      break
    
    case 'Empty':
      matched = fieldValue === null || fieldValue === undefined || fieldValue === ''
      break
    
    case 'NotEmpty':
      matched = fieldValue !== null && fieldValue !== undefined && fieldValue !== ''
      break
    
    case 'GreaterThan':
      matched = Number(fieldValue) > Number(value)
      break
    
    case 'LessThan':
      matched = Number(fieldValue) < Number(value)
      break
    
    default:
      matched = false
  }
  
  return { rule, fieldValue, matched }
}

/**
 * 从数据中获取字段值（支持嵌套路径）
 */
function getFieldValue(data: any, path: string): any {
  if (!path || !data) return undefined
  
  const segments = path.split('.').filter(s => s.length > 0)
  let current = data
  
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  
  return current
}

/**
 * 计算模板匹配得分
 * 得分规则：
 * - 每条匹配的规则 +10 分
 * - 优先级权重：priority * 1 分
 * - 全部匹配才返回该模板
 */
function calculateMatchScore(matchedRules: MatchedRule[], priority: number): number {
  const matchedCount = matchedRules.filter(r => r.matched).length
  const totalCount = matchedRules.length
  
  // 如果有规则但没有全部匹配，得分为 0
  if (totalCount > 0 && matchedCount < totalCount) {
    return 0
  }
  
  // 匹配数 * 10 + 优先级权重
  return matchedCount * 10 + priority
}

/**
 * 匹配单个模板
 */
function matchTemplate(template: ReportTemplate, data: any): MatchResult | null {
  const rules = template.matchRules || []
  
  if (rules.length === 0) {
    // 没有规则的模板，使用默认模板（最低优先级）
    return {
      template,
      score: 1, // 最低分
      matchedRules: []
    }
  }
  
  // 评估所有规则
  const matchedRules = rules.map(rule => evaluateRule(rule, data))
  
  // 计算得分
  const score = calculateMatchScore(matchedRules, template.matchRules[0]?.priority || 0)
  
  if (score === 0 && rules.length > 0) {
    // 有规则但没全部匹配，不返回该模板
    return null
  }
  
  return {
    template,
    score,
    matchedRules
  }
}

/**
 * 从模板列表中找到最佳匹配的模板
 */
export function findBestMatch(templates: ReportTemplate[], data: any): ReportTemplate | null {
  if (!templates || templates.length === 0) return null
  
  // 只匹配启用状态的模板
  const activeTemplates = templates.filter(t => t.isActive !== false)
  
  if (activeTemplates.length === 0) return null
  
  // 对每个模板进行匹配
  const matchResults: MatchResult[] = []
  
  for (const template of activeTemplates) {
    const result = matchTemplate(template, data)
    if (result) {
      matchResults.push(result)
    }
  }
  
  if (matchResults.length === 0) {
    // 没有模板匹配，返回第一个启用状态的模板作为默认
    return activeTemplates[0]
  }
  
  // 按得分排序
  matchResults.sort((a, b) => b.score - a.score)
  
  // 返回得分最高的
  return matchResults[0].template
}

/**
 * 获取所有模板的匹配结果（用于调试或展示）
 */
export function getAllMatchResults(templates: ReportTemplate[], data: any): MatchResult[] {
  if (!templates || templates.length === 0) return []
  
  const activeTemplates = templates.filter(t => t.isActive !== false)
  const results: MatchResult[] = []
  
  for (const template of activeTemplates) {
    const result = matchTemplate(template, data)
    if (result) {
      results.push(result)
    }
  }
  
  // 按得分排序
  results.sort((a, b) => b.score - a.score)
  
  return results
}

/**
 * 检查数据是否完全匹配某个模板
 */
export function isExactMatch(template: ReportTemplate, data: any): boolean {
  const rules = template.matchRules || []
  
  if (rules.length === 0) {
    return false // 没有规则的模板不算完全匹配
  }
  
  for (const rule of rules) {
    const matchedRule = evaluateRule(rule, data)
    if (!matchedRule.matched) {
      return false
    }
  }
  
  return true
}

/**
 * 获取模板匹配诊断信息
 */
export function getMatchDiagnosis(template: ReportTemplate, data: any): {
  templateName: string
  rules: Array<{
    field: string
    operator: string
    expectedValue: string
    actualValue: any
    matched: boolean
  }>
  overallScore: number
  isMatch: boolean
} {
  const rules = template.matchRules || []
  
  const ruleDiagnostics = rules.map(rule => {
    const matched = evaluateRule(rule, data)
    return {
      field: rule.field,
      operator: rule.operator,
      expectedValue: rule.value,
      actualValue: matched.fieldValue,
      matched: matched.matched
    }
  })
  
  const allMatched = ruleDiagnostics.every(r => r.matched)
  const score = calculateMatchScore(
    ruleDiagnostics.map(r => ({ rule: { field: r.field, operator: r.operator, value: r.expectedValue, priority: 0 } as MatchRule, fieldValue: r.actualValue, matched: r.matched })),
    template.matchRules[0]?.priority || 0
  )
  
  return {
    templateName: template.name,
    rules: ruleDiagnostics,
    overallScore: score,
    isMatch: allMatched
  }
}
