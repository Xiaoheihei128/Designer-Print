// 数据源结构

export interface DataSourceItem {
  AnaItem: string
  TestStandard: string
  FinalVal: string
  InspectionResultName: string
}

export interface DataSource {
  Header: {
    ReportNo: string
    ReportDate: string
    InspectionDate: string
    MaterialName: string
    MaterialCode: string
    BusinessBillNo: string
    OrderNo: string
    ContractNo: string
    ReqInspectionQty: number
    SupplierName: string
    BatchNo: string
    SrcLotNo: string
    Standard: string
    InspectionQty: number
    InspectionResult: string
    Inspector: string
    Auditor: string
  }
  ReportItems: DataSourceItem[]
}

// 数据源字段树（用于绑定面板）
export interface DataSourceField {
  name: string
  label?: string  // 显示名（从注释解析）
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  fields?: DataSourceField[]
}

let CUSTOM_DATA_SOURCE: DataSourceField | null = null

// 获取数据源字段树
export function getDataSourceFields(): DataSourceField {
  if (CUSTOM_DATA_SOURCE) return CUSTOM_DATA_SOURCE
  return getDefaultDataSourceFields()
}

// 设置自定义数据源
export function setCustomDataSource(fields: DataSourceField) {
  CUSTOM_DATA_SOURCE = fields
}

// 清空自定义数据源（恢复默认）
export function clearCustomDataSource() {
  CUSTOM_DATA_SOURCE = null
}

// 默认数据源
function getDefaultDataSourceFields(): DataSourceField {
  return {
    name: '数据源',
    type: 'object',
    fields: [
      {
        name: 'Header',
        type: 'object',
        fields: [
          { name: 'ReportNo', type: 'object' },
          { name: 'ReportDate', type: 'object' },
          { name: 'InspectionDate', type: 'object' },
          { name: 'MaterialName', type: 'object' },
          { name: 'MaterialCode', type: 'object' },
          { name: 'BusinessBillNo', type: 'object' },
          { name: 'OrderNo', type: 'object' },
          { name: 'ContractNo', type: 'object' },
          { name: 'ReqInspectionQty', type: 'object' },
          { name: 'SupplierName', type: 'object' },
          { name: 'BatchNo', type: 'object' },
          { name: 'SrcLotNo', type: 'object' },
          { name: 'Standard', type: 'object' },
          { name: 'InspectionQty', type: 'object' },
          { name: 'InspectionResult', type: 'object' },
          { name: 'Inspector', type: 'object' },
          { name: 'Auditor', type: 'object' },
        ],
      },
      {
        name: 'ReportItems',
        type: 'array',
        fields: [
          { name: 'AnaItem', type: 'object' },
          { name: 'TestStandard', type: 'object' },
          { name: 'FinalVal', type: 'object' },
          { name: 'InspectionResultName', type: 'object' },
        ],
      },
    ],
  }
}

// 解析粘贴的文本为字段树
// 支持的格式：
// 1. JSON: { "Header": { "ReportNo": "..." } }
// 2. TS Interface: interface Data { /** 报告编号 */ ReportNo: string; }
// 3. 对象字面量带类型: { /** 报告编号 */ ReportNo: "..." }
export function parseDataSourceText(text: string): DataSourceField | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  
  // 先尝试 JSON
  try {
    const parsed = JSON.parse(trimmed)
    return buildFieldTreeFromValue('数据源', parsed, new Map())
  } catch {
    // 不是 JSON，继续
  }
  
  // 尝试解析 TypeScript 接口或对象字面量
  return parseTypeLikeSyntax(trimmed)
}

// 提取注释（/** ... */ 或 // ...）
function extractComment(lines: string[], lineIndex: number): string | undefined {
  // 检查当前行前面的连续注释
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('/**') && line.endsWith('*/')) {
      return line.slice(3, -2).trim()
    }
    if (line.startsWith('//')) {
      const comment = line.slice(2).trim()
      // 查找更早的注释合并
      let fullComment = comment
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim()
        if (prev.startsWith('//')) {
          fullComment = prev.slice(2).trim() + ' ' + fullComment
        } else {
          break
        }
      }
      return fullComment
    }
    // 遇到非注释行，停止查找
    if (line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/**')) {
      // 检查是否是属性行（属性行可能跨多行）
      if (line.match(/^\w+\s*[:?]/)) break
    }
  }
  return undefined
}

// 从 JSON 值构建字段树
function buildFieldTreeFromValue(
  name: string,
  value: any,
  labelMap: Map<string, string>,
  parentKey: string = ''
): DataSourceField {
  let type: DataSourceField['type'] = 'object'
  let fields: DataSourceField[] | undefined = undefined
  
  if (Array.isArray(value)) {
    type = 'array'
    // 取第一个元素推断数组项结构
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      fields = buildFieldsFromObject(value[0], labelMap, parentKey)
    }
  } else if (typeof value === 'object' && value !== null) {
    type = 'object'
    fields = buildFieldsFromObject(value, labelMap, parentKey)
  } else if (typeof value === 'string') {
    type = 'string'
  } else if (typeof value === 'number') {
    type = 'number'
  } else if (typeof value === 'boolean') {
    type = 'boolean'
  }
  
  return {
    name,
    type,
    fields,
    label: labelMap.get(parentKey ? `${parentKey}.${name}` : name) || labelMap.get(name),
  }
}

// 从对象构建字段列表
function buildFieldsFromObject(obj: any, labelMap: Map<string, string>, parentPath: string = ''): DataSourceField[] {
  if (!obj || typeof obj !== 'object') return []
  
  return Object.entries(obj).map(([key, value]) => {
    const path = parentPath ? `${parentPath}.${key}` : key
    return buildFieldTreeFromValue(key, value, labelMap, parentPath)
  })
}

// 解析 TypeScript 接口语法或对象字面量
function parseTypeLikeSyntax(text: string): DataSourceField | null {
  // 提取注释（/** ... */ 和 // ...）
  const labelMap = new Map<string, string>()
  
  // 检测是否为 C# 语法（public class 或 List<T> 或 { get; set; }）
  const isCSharp = /(\bpublic\s+(class|partial\s+class)\b)|(\bList\s*<)|(\{\s*get;\s*set;\s*\})/.test(text)
  
  // 标准化文本
  let normalized = text
  
  if (isCSharp) {
    // C# 风格转换
    normalized = text
      // 移除 using 语句
      .replace(/^using\s+[\w.]+\s*;?\s*$/gm, '')
      // 移除 namespace {...}
      .replace(/namespace\s+[\w.]+\s*\{/g, '{')
      .replace(/^\}\s*$/gm, '')
      // 移除 public class Name { → {
      .replace(/(\bpublic\s+(partial\s+)?class\s+\w+)(\s*:\s*[^{]*)?\s*\{/g, '{')
      // 移除 public/private/protected/internal/static 修饰符
      .replace(/\b(public|private|protected|internal|static|readonly|virtual|override|new|sealed|abstract)\s+/g, '')
      // 移除 { get; set; } 访问器（保留属性名）
      .replace(/\{\s*get\s*;\s*(set\s*;\s*)?\}/g, '')
      // 移除 nullable 标记
      .replace(/\?/g, '')
      // 移除 readonly
      .replace(/\breadonly\s+/g, '')
      // List<T> → T[]
      .replace(/List<\s*(\w+)\s*>/g, '$1[]')
      .replace(/IEnumerable<\s*(\w+)\s*>/g, '$1[]')
      // 移除 [xxx] 特性标签
      .replace(/\[[\w.,\s()]+\]\s*/g, '')
      // 属性 type[] 转 []
      // public string[] Name; → Name
      .replace(/;\s*$/gm, ',')
      // 移除 using 后的空白行
      .replace(/\n\s*\n/g, '\n')
      // 移除尾部逗号
      .replace(/,\s*}/g, ' }')
  } else {
    // TypeScript/JavaScript 风格转换
    normalized = text
      .replace(/interface\s+\w+\s*\{/g, '{')
      .replace(/type\s+\w+\s*=\s*\{/g, '{')
      .replace(/^export\s+/gm, '')
      .replace(/;/g, ',')
      .replace(/,\s*}/g, ' }')
  }
  
  // 提取注释
  const lines = normalized.split('\n')
  let pendingComment: string | null = null
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // 单行 /** ... */ 注释
    const blockMatch = line.match(/^\/\*\*\s*(.+?)\s*\*\/\s*(.*)$/)
    if (blockMatch) {
      pendingComment = blockMatch[1].trim()
      const rest = blockMatch[2].trim()
      if (rest) {
        processLineForComment(rest, pendingComment, labelMap)
        pendingComment = null
      }
      continue
    }

    // // 单行注释
    const lineCommentMatch = line.match(/^\/\/\s*(.+)$/)
    if (lineCommentMatch) {
      pendingComment = lineCommentMatch[1].trim()
      continue
    }

    // 块注释 /**\n * line1\n * line2\n */
    if (line.startsWith('/**')) {
      let commentLines = [line.replace(/^\/\*\*\s*/, '')]
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j].trim()
        if (nextLine.endsWith('*/')) {
          commentLines.push(nextLine.replace(/\*\/\s*$/, ''))
          break
        }
        commentLines.push(nextLine.replace(/^\*\s?/, ''))
        j++
      }
      pendingComment = commentLines.filter(l => l.trim()).join(' ').trim()
      i = j
      continue
    }

    // 属性行
    if (line && !line.startsWith('*')) {
      if (pendingComment) {
        processLineForComment(line, pendingComment, labelMap)
        pendingComment = null
      } else {
        processLineForComment(line, '', labelMap)
      }
    }
  }
  
  // 尝试用 eval/Function 构造对象
  try {
    // 把 { key: type; } 转换为 { key: 'placeholder'; }
    let jsObject = normalized
      // 类型名 → 占位值
      .replace(/:\s*string\s*[,}]/g, ': ""$1')
      .replace(/:\s*number\s*[,}]/g, ': 0$1')
      .replace(/:\s*boolean\s*[,}]/g, ': false$1')
      .replace(/:\s*any\s*[,}]/g, ': null$1')
      .replace(/:\s*int\s*[,}]/g, ': 0$1')
      .replace(/:\s*long\s*[,}]/g, ': 0$1')
      .replace(/:\s*double\s*[,}]/g, ': 0$1')
      .replace(/:\s*float\s*[,}]/g, ': 0$1')
      .replace(/:\s*decimal\s*[,}]/g, ': 0$1')
      .replace(/:\s*bool\s*[,}]/g, ': false$1')
      .replace(/:\s*DateTime\s*[,}]/g, ': ""$1')
      .replace(/:\s*object\s*[,}]/g, ': null$1')
      // 数组类型
      .replace(/:\s*\w+\[\s*\]\s*[,}]/g, ': []$1')
      .replace(/:\s*Array<\w+>\s*[,}]/g, ': []$1')
      // 对象类型推断（递归难处理，这里用空对象）
      .replace(/:\s*\{[^}]*\}\s*[,}]/g, ': {}')

    // 处理 [1, 2, 3] 类型的数组
    jsObject = jsObject.replace(/^\s*\[.*\]\s*$/s, '[{}]')

    // 确保是合法表达式
    if (!jsObject.trim().startsWith('{')) {
      // 如果只是类型定义，包裹为对象
      jsObject = '{ ' + jsObject + ' }'
    }

    // eslint-disable-next-line no-new-func
    const parsed = new Function('return ' + jsObject)()

    if (parsed && typeof parsed === 'object') {
      return buildFieldTreeFromValue('数据源', parsed, labelMap)
    }
  } catch (e) {
    console.warn('解析 TypeScript/C# 风格失败:', e)
  }

  return null
}

// 处理单行属性，提取注释并关联
function processLineForComment(line: string, comment: string, labelMap: Map<string, string>) {
  // 匹配 key: type  或 key?: type
  const match = line.match(/^\s*['"]?(\w+)['"]?\s*\??\s*:/)
  if (match) {
    const key = match[1]
    if (comment) {
      labelMap.set(key, comment)
    }
  }
}

// 从 TypeScript 类型字符串推断类型
function inferTypeFromTs(typeStr: string): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  typeStr = typeStr.trim().replace(/\?$/, '')
  if (typeStr === 'string') return 'string'
  if (typeStr === 'number') return 'number'
  if (typeStr === 'boolean') return 'boolean'
  if (typeStr.endsWith('[]') || typeStr.startsWith('Array<')) return 'array'
  if (typeStr.startsWith('{')) return 'object'
  return 'object'
}

// 模拟数据源
export const MOCK_DATA_SOURCE: DataSource = {
  Header: {
    ReportNo: 'QRPT-2607240001',
    ReportDate: '2026-07-24',
    InspectionDate: '2026-07-24',
    MaterialName: '油醇 EO 40 (Emulgin® CO 40)',
    MaterialCode: 'R116-200001',
    BusinessBillNo: 'CGRN-20001828',
    OrderNo: 'CSC-200058',
    ContractNo: 'CPO-201060',
    ReqInspectionQty: 20.0,
    SupplierName: '麓柏',
    BatchNo: 'R200514007',
    SrcLotNo: '96645316K0',
    Standard: 'QAL-III级',
    InspectionQty: 50.0,
    InspectionResult: '合格',
    Inspector: '胆永测试账号',
    Auditor: '',
  },
  ReportItems: [
    {
      AnaItem: '外观',
      TestStandard: '与标样一致',
      FinalVal: '—',
      InspectionResultName: '合格',
    },
    {
      AnaItem: '气味',
      TestStandard: '与标样一致',
      FinalVal: '—',
      InspectionResultName: '合格',
    },
    {
      AnaItem: '颜色 (Gardner)',
      TestStandard: '≤5',
      FinalVal: '2',
      InspectionResultName: '合格',
    },
    {
      AnaItem: '羟值 (mgKOH/g)',
      TestStandard: '142-152',
      FinalVal: '147',
      InspectionResultName: '合格',
    },
  ],
}
