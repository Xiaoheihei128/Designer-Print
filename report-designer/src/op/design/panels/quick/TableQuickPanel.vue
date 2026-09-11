<script setup lang="ts">
/**
 * TableQuickPanel —— 表格属性快速面板
 *
 * 由 CellToolbar 上的"表格属性"按钮触发，把右栏整个属性区替换为 4 个 tab：
 *   1. 列配置      — 单列选择器 + 该列精简字段（标题/字段/宽/对齐/参与合计/同值合并/数据格式）
 *   2. 默认单元格样式 — 整表 defaultCellStyle
 *   3. 高级选项    — 核心开关（repeatHeader/RepeatFooter/pageRows/fixBottomRows）+ 原 TableProps 高级选项区
 *   4. 通用        — 直接复用 <CommonProps />
 *
 * 与原 TableProps.vue 的关系：
 *   - 不 export / 不抽 composable：直接复制本组件需要的最小函数集，独立演进。
 *   - 字段同步源：复制自 TableProps.vue（706-790 / 872-942 / 946-1018 / 385-463）。
 */
import { computed, ref, watch } from 'vue'
import {
  NAutoComplete,
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NColorPicker,
  NCollapse,
  NCollapseItem,
  NTabs,
  NTabPane,
  NTag,
  NTooltip,
} from 'naive-ui'
import type {
  TableColumn,
  TableControl,
  TableOptions,
  TableCellStyle,
  CellFormat,
  CellFormatKind,
} from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'
import { useUiStore } from '@op/design/stores/ui'
import { removeTableColumn } from '@op/core/layout-engine/table-cells'
import {
  formatKindOptions,
  datePatternOptions,
  currencyCodeOptions,
  makeFormat,
  needsPattern,
  needsDigits,
  needsCode,
  supportsThousands,
} from '@op/design/format-options'
import CommonProps from '@op/design/panels/props/CommonProps.vue'

const store = useDesignerStore()
const uiStore = useUiStore()
const ds = useFieldCatalogStore()

const control = computed(() => store.selectedControl as TableControl | null)
const isData = computed(() => Boolean(control.value?.dataSource?.trim()))
/**
 * 多选检测：selectedIds 超过 1 个时标题旁加显眼提示，
 * 因为面板只能编辑第一个 table 类型控件（用户决策 #3）。
 */
const isMultiSelect = computed(() => store.selectedIds.length > 1)
const canDeleteActiveColumn = computed(() => (control.value?.columns?.length ?? 0) > 1)

/* ------------------------------ patch 工具 ------------------------------ */

function patch(p: Record<string, unknown>): void {
  if (control.value) store.updateControl(control.value.id, p)
}
function patchOptions(p: Partial<TableOptions>): void {
  if (!control.value) return
  const next: Record<string, unknown> = { ...control.value.options, ...p }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  patch({ options: next as unknown as TableOptions })
}
function patchColumn(index: number, p: Partial<TableColumn>): void {
  if (!control.value) return
  const columns = control.value.columns.map((c, i) =>
    i === index ? { ...c, ...p } : c,
  )
  patch({ columns })
}

function patchColumnFormat(index: number, fmt: CellFormat | undefined): void {
  patchColumn(index, { format: fmt && fmt.kind !== 'none' ? fmt : undefined })
}

function mergeClean(
  cur: Record<string, unknown>,
  p: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...cur, ...p }
  for (const k of Object.keys(next)) {
    if (next[k] === null || next[k] === '') delete next[k]
  }
  return next
}

function patchDefaultStyle(p: Record<string, unknown>): void {
  if (!control.value) return
  const cur = (control.value.options?.defaultCellStyle ?? {}) as Record<
    string,
    unknown
  >
  patchOptions({ defaultCellStyle: mergeClean(cur, p) as unknown as TableCellStyle })
}

/* ------------------------------ 列配置 tab ------------------------------ */

const activeColumnIndex = ref(0)

const columnIndexOptions = computed(() =>
  (control.value?.columns ?? []).map((c, i) => ({
    label: c.title?.trim() || c.field || `列 ${i + 1}`,
    value: i,
  })),
)

const activeColumn = computed<TableColumn | undefined>(
  () => control.value?.columns?.[activeColumnIndex.value],
)

// 切换控件时重置选中列
watch(
  () => control.value?.id,
  () => {
    activeColumnIndex.value = 0
  },
)

const columnFieldOptions = computed(() => {
  const list = ds.flatFields.filter((f) => f.path.includes('[]'))
  return [
    { label: '（不绑定）', value: '' },
    ...list.map((f) => ({
      label: `${f.label}  ·  ${f.path}`,
      value: f.path,
    })),
  ]
})

const fieldTypeMap = computed(() => {
  const m = new Map<string, string>()
  for (const f of ds.flatFields) m.set(f.path, f.type)
  return m
})
function fieldTypeOf(path?: string): string | undefined {
  return path ? fieldTypeMap.value.get(path) : undefined
}
function isPresetDatePattern(p?: string): boolean {
  return Boolean(
    p && datePatternOptions.some((o) => o.value !== '__custom__' && o.value === p),
  )
}

function setColumnAggregate(index: number, on: boolean): void {
  patchColumn(index, { aggregate: on ? true : false })
}
function isVMergeCol(index: number): boolean {
  const c = control.value?.columns?.[index]
  if (!c?.id) return false
  const vm = control.value?.options?.vMerge?.columns
  return Array.isArray(vm) && vm.includes(c.id)
}
function setVMergeCol(index: number, on: boolean): void {
  const c = control.value?.columns?.[index]
  if (!c?.id) return
  const opts = control.value?.options
  const current: string[] = opts?.vMerge?.columns ?? []
  const next = on
    ? current.includes(c.id)
      ? current
      : [...current, c.id]
    : current.filter((id) => id !== c.id)
  patchOptions({ vMerge: { ...opts?.vMerge, columns: next } })
}

const alignOptions = [
  { label: '左', value: 'left' },
  { label: '中', value: 'center' },
  { label: '右', value: 'right' },
]

/* ------------------------------ 默认单元格样式 tab ------------------------------ */

const valignOptions = [
  { label: '顶部', value: 'top' },
  { label: '居中', value: 'middle' },
  { label: '底部', value: 'bottom' },
]

/* ------------------------------ 高级选项 tab ------------------------------ */

const fixBottomModeOptions: Array<{ label: string; value: 'off' | 'fill' | 'count' }> = [
  { label: '关闭', value: 'off' },
  { label: '填满至页底（自动）', value: 'fill' },
  { label: '固定 N 行', value: 'count' },
]
const fixBottomMode = computed(() => {
  const v = control.value?.options?.fixBottomRows
  if (v === undefined || v === 'off') return 'off'
  if (v === 'fill') return 'fill'
  return 'count'
})
const fixBottomCount = computed(() => {
  const v = control.value?.options?.fixBottomRows
  return typeof v === 'object' ? v.count : 1
})
function onFixBottomModeChange(mode: 'off' | 'fill' | 'count'): void {
  if (mode === 'off') patchOptions({ fixBottomRows: 'off' })
  else if (mode === 'fill') patchOptions({ fixBottomRows: 'fill' })
  else patchOptions({ fixBottomRows: { count: fixBottomCount.value || 1 } })
}
function onFixBottomCountChange(n: number | null): void {
  patchOptions({ fixBottomRows: { count: Math.max(0, n ?? 1) } })
}

const fixBottomInputRef = ref<{ focus: () => void }>()
function focusFixBottomInput(): void {
  fixBottomInputRef.value?.focus()
}

/** 高级选项 NCollapse：默认展开（精简版与原版差异点） */
const advancedExpanded = ref<string[]>(['advanced'])

function closeQuick(): void {
  uiStore.closeTableQuickPanel()
}

/** 列配置 tab：跳转到"默认单元格样式" tab（用户决策 #1） */
function jumpToCellStyleTab(): void {
  uiStore.tableQuickPanelActiveTab = 'cellStyle'
}

/** 列配置 tab：删除当前选中的列（用户决策 #2，至少保留 1 列） */
function removeActiveColumn(): void {
  const c = control.value
  if (!c) return
  if (c.columns.length <= 1) return // 至少保留 1 列
  store.updateControl(c.id, removeTableColumn(c, activeColumnIndex.value))
  // 删除后索引回退：保持选中"删除列原位置"的下一列，或最后一列
  const nextLen = (control.value?.columns?.length ?? 0)
  if (nextLen === 0) return
  if (activeColumnIndex.value >= nextLen) activeColumnIndex.value = nextLen - 1
}
</script>

<template>
  <div class="props-section">
    <!-- 顶部返回栏 -->
    <div class="props-row" style="margin-bottom: 8px">
      <NButton size="small" quaternary @click="closeQuick">
        <template #icon><span class="i-carbon-arrow-left" /></template>
        返回常规属性
      </NButton>
      <span class="text-12px text-gray-500 ml-2">
        {{ control?.name || control?.id || '表格' }} · 快速面板
      </span>
      <!-- 多选时显眼提示：面板只能编辑首个（用户决策 #3） -->
      <NTag
        v-if="isMultiSelect"
        type="warning"
        size="small"
        style="margin-left: 8px"
      >
        多选仅编辑首个
      </NTag>
    </div>

    <NTabs
      type="line"
      size="small"
      :value="uiStore.tableQuickPanelActiveTab"
      @update:value="(v) => (uiStore.tableQuickPanelActiveTab = v)"
    >
      <!-- ============================== 列配置 ============================== -->
      <NTabPane name="columns" tab="列配置">
        <div v-if="control" class="props-row">
          <span class="props-label">当前列</span>
          <NSelect
            :value="activeColumnIndex"
            :options="columnIndexOptions"
            style="flex: 1"
            @update:value="(v: number) => (activeColumnIndex = v)"
          />
          <span class="text-12px text-gray-500 ml-2">
            共 {{ control.columns.length }} 列
          </span>
        </div>

        <!-- 用户决策 #1：跳转到"默认单元格样式" tab，把所选列的样式对齐到整表默认 -->
        <div v-if="activeColumn" class="props-row" style="margin-top: 4px">
          <NButton
            size="tiny"
            quaternary
            type="primary"
            title="跳转到默认单元格样式 tab"
            @click="jumpToCellStyleTab"
          >
            <template #icon><span class="i-carbon-arrow-right" /></template>
            应用到所选列的样式 →
          </NButton>
        </div>

        <template v-if="activeColumn">
          <div class="props-row mt-2">
            <span class="props-label">标题</span>
            <NInput
              size="small"
              :value="activeColumn.title"
              @update:value="patchColumn(activeColumnIndex, { title: $event })"
            />
          </div>
          <div class="props-row">
            <span class="props-label">字段</span>
            <NAutoComplete
              size="small"
              class="flex-1"
              :value="activeColumn.field ?? ''"
              :options="columnFieldOptions"
              placeholder="选择或输入字段，如 ReportItems[].qty"
              @update:value="
                patchColumn(activeColumnIndex, {
                  field: $event || undefined,
                })
              "
            />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="props-row">
              <span class="props-label">宽</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="activeColumn.width"
                :min="5"
                @update:value="patchColumn(activeColumnIndex, { width: $event ?? 30 })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">对齐</span>
              <NSelect
                size="small"
                :value="activeColumn.align ?? 'left'"
                :options="alignOptions"
                @update:value="patchColumn(activeColumnIndex, { align: $event })"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 mt-1">
            <div class="props-row">
              <span class="props-label">参与合计</span>
              <NSwitch
                size="small"
                :value="
                  activeColumn.aggregate === true ||
                  activeColumn.aggregate === 'sum' ||
                  activeColumn.aggregate === 'avg' ||
                  activeColumn.aggregate === 'count'
                "
                @update:value="(v: boolean) => setColumnAggregate(activeColumnIndex, v)"
              />
            </div>
            <div class="props-row" v-if="isData">
              <span class="props-label">同值合并</span>
              <NSwitch
                size="small"
                :value="isVMergeCol(activeColumnIndex)"
                @update:value="(v: boolean) => setVMergeCol(activeColumnIndex, v)"
              />
            </div>
          </div>

          <!-- 数据格式 -->
          <div class="mt-2 border-t border-brand-border pt-2">
            <div class="mb-1 text-12px text-gray-500">数据格式</div>
            <div class="props-row">
              <span class="props-label">类型</span>
              <NSelect
                size="small"
                :value="activeColumn.format?.kind ?? 'none'"
                :options="formatKindOptions"
                @update:value="
                  (k: CellFormatKind) =>
                    patchColumnFormat(
                      activeColumnIndex,
                      k === 'none' ? undefined : makeFormat(k),
                    )
                "
              />
            </div>
            <template v-if="activeColumn.format && activeColumn.format.kind !== 'none'">
              <div v-if="needsPattern(activeColumn.format.kind)" class="props-row">
                <span class="props-label">日期模板</span>
                <NSelect
                  size="small"
                  :value="
                    isPresetDatePattern(activeColumn.format.pattern)
                      ? activeColumn.format.pattern
                      : '__custom__'
                  "
                  :options="datePatternOptions"
                  @update:value="
                    (v: string) => {
                      if (v !== '__custom__')
                        patchColumnFormat(activeColumnIndex, {
                          ...activeColumn.format!,
                          pattern: v,
                        })
                    }
                  "
                />
              </div>
              <div
                v-if="
                  needsPattern(activeColumn.format.kind) &&
                  !isPresetDatePattern(activeColumn.format.pattern)
                "
                class="props-row"
              >
                <span class="props-label">自定义</span>
                <NInput
                  size="small"
                  :value="activeColumn.format.pattern"
                  placeholder="如 YYYY年MM月DD日"
                  @update:value="
                    (v: string) =>
                      patchColumnFormat(activeColumnIndex, {
                        ...activeColumn.format!,
                        pattern: v || 'YYYY-MM-DD',
                      })
                  "
                />
              </div>
              <div v-if="needsDigits(activeColumn.format.kind)" class="props-row">
                <span class="props-label">小数位</span>
                <NInputNumber
                  size="small"
                  button-placement="both"
                  :value="
                    activeColumn.format.digits ??
                    (activeColumn.format.kind === 'int' ? 0 : 2)
                  "
                  :min="0"
                  :max="6"
                  @update:value="
                    (v: number | null) =>
                      patchColumnFormat(activeColumnIndex, {
                        ...activeColumn.format!,
                        digits: v ?? 0,
                      })
                  "
                />
              </div>
              <div v-if="needsCode(activeColumn.format.kind)" class="props-row">
                <span class="props-label">币种</span>
                <NSelect
                  size="small"
                  :value="activeColumn.format.code ?? 'CNY'"
                  :options="currencyCodeOptions"
                  @update:value="
                    (v: string) =>
                      patchColumnFormat(activeColumnIndex, {
                        ...activeColumn.format!,
                        code: v,
                      })
                  "
                />
              </div>
              <div v-if="supportsThousands(activeColumn.format.kind)" class="props-row">
                <span class="props-label">千分位</span>
                <NSwitch
                  size="small"
                  :value="activeColumn.format.thousands ?? true"
                  @update:value="
                    (v: boolean) =>
                      patchColumnFormat(activeColumnIndex, {
                        ...activeColumn.format!,
                        thousands: v,
                      })
                  "
                />
              </div>
              <div v-if="fieldTypeOf(activeColumn.field)" class="props-tip">
                绑定的字段类型为
                <b>{{ fieldTypeOf(activeColumn.field) === 'date' ? '日期' : '数值' }}</b
                >，建议相应选择日期 / 数值格式。
              </div>
            </template>
          </div>

          <!-- 用户决策 #2：删除本列（破坏性操作；至少保留 1 列） -->
          <div class="mt-2 border-t border-brand-border pt-2">
            <NButton
              size="tiny"
              type="error"
              quaternary
              :disabled="!canDeleteActiveColumn"
              :title="canDeleteActiveColumn ? '删除当前列（至少保留 1 列）' : '至少保留 1 列'"
              @click="removeActiveColumn"
            >
              <template #icon><span class="i-carbon-trash-can" /></template>
              删除本列
            </NButton>
          </div>
        </template>
      </NTabPane>

      <!-- ============================== 默认单元格样式 ============================== -->
      <NTabPane name="cellStyle" tab="默认单元格样式">
        <div v-if="control">
          <div class="props-tip">整表默认样式，可被列样式 / 单元格样式覆盖。</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="props-row">
              <span class="props-label">字号(pt)</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="control.options?.defaultCellStyle?.fontSize ?? null"
                :min="6"
                :max="72"
                placeholder="继承"
                clearable
                @update:value="patchDefaultStyle({ fontSize: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">对齐</span>
              <NSelect
                size="small"
                :value="control.options?.defaultCellStyle?.align ?? 'left'"
                :options="alignOptions"
                @update:value="patchDefaultStyle({ align: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">垂直对齐</span>
              <NSelect
                size="small"
                :value="control.options?.defaultCellStyle?.valign ?? 'middle'"
                :options="valignOptions"
                @update:value="patchDefaultStyle({ valign: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">字色</span>
              <NColorPicker
                size="small"
                :modes="['hex']"
                :value="control.options?.defaultCellStyle?.color"
                :show-alpha="false"
                @update:value="patchDefaultStyle({ color: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">背景</span>
              <NColorPicker
                size="small"
                :modes="['hex']"
                :value="control.options?.defaultCellStyle?.backgroundColor"
                :show-alpha="true"
                @update:value="patchDefaultStyle({ backgroundColor: $event })"
              />
            </div>
          </div>
          <div class="mt-1 grid grid-cols-3 gap-2">
            <div class="props-row">
              <span class="props-label">加粗</span>
              <NSwitch
                size="small"
                :value="control.options?.defaultCellStyle?.bold ?? false"
                @update:value="patchDefaultStyle({ bold: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">斜体</span>
              <NSwitch
                size="small"
                :value="control.options?.defaultCellStyle?.italic ?? false"
                @update:value="patchDefaultStyle({ italic: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label">下划线</span>
              <NSwitch
                size="small"
                :value="control.options?.defaultCellStyle?.underline ?? false"
                @update:value="patchDefaultStyle({ underline: $event })"
              />
            </div>
          </div>
        </div>
      </NTabPane>

      <!-- ============================== 高级选项 ============================== -->
      <NTabPane name="advanced" tab="高级选项">
        <div v-if="control">
          <!-- 核心开关：与原 TableProps.vue:385-463 等价 -->
          <div class="props-section" style="padding: 0">
            <div class="props-title" style="font-size: 12px">核心开关</div>
            <div class="props-row">
              <span class="props-label" style="min-width: 88px">每页打印标题行</span>
              <NSwitch
                size="small"
                :value="control.options?.repeatHeader ?? true"
                @update:value="patchOptions({ repeatHeader: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label" style="min-width: 88px">每页打印合计行</span>
              <NSwitch
                size="small"
                :value="control.options?.repeatFooter ?? true"
                @update:value="patchOptions({ repeatFooter: $event })"
              />
            </div>
            <div class="props-row">
              <span class="props-label" style="min-width: 88px">每页行数</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="
                  control.options?.pageRows === 'auto' ||
                  control.options?.pageRows === undefined
                    ? null
                    : control.options.pageRows
                "
                :min="1"
                placeholder="auto"
                clearable
                @update:value="patchOptions({ pageRows: $event ?? 'auto' })"
              />
            </div>
            <div class="props-row">
              <span class="props-label" style="min-width: 88px">按纸张补空</span>
              <NSelect
                size="small"
                :value="fixBottomMode"
                :options="fixBottomModeOptions"
                style="min-width: 140px"
                @update:value="onFixBottomModeChange"
              />
            </div>
            <div v-if="fixBottomMode === 'count'" class="props-row">
              <span class="props-label" style="min-width: 88px">&nbsp;</span>
              <NInputNumber
                ref="fixBottomInputRef"
                size="small"
                :value="fixBottomCount"
                :min="0"
                :show-button="false"
                placeholder="N 行数"
                style="width: 160px"
                @update:value="onFixBottomCountChange"
              >
                <template #prefix>
                  <span
                    style="font-size: 12px; color: var(--op-text-3, #999); cursor: pointer; user-select: none"
                    title="点击输入行数"
                    @mousedown.prevent
                    @click="focusFixBottomInput"
                  >N&nbsp;=</span>
                </template>
              </NInputNumber>
            </div>
            <div v-else-if="fixBottomMode === 'fill'" class="props-row">
              <span class="props-label" style="min-width: 88px">&nbsp;</span>
              <NInputNumber
                size="small"
                :value="control.options?.fixBottomMargin ?? 0"
                :min="0"
                placeholder="mm"
                style="width: 160px"
                @update:value="patchOptions({ fixBottomMargin: $event ?? 0 })"
              >
                <template #prefix>
                  <span style="font-size: 12px; color: var(--op-text-3, #999)">留白</span>
                </template>
              </NInputNumber>
            </div>
          </div>

          <!-- 高级选项折叠：默认展开（精简版与原版差异点） -->
          <NCollapse
            v-model:expanded-names="advancedExpanded"
            class="mt-2"
          >
            <NCollapseItem title="高级选项" name="advanced">
              <div class="props-row">
                <span class="props-label" style="min-width: 88px">整行跨页换页</span>
                <NSwitch
                  size="small"
                  :value="control.options?.keepTogether ?? false"
                  @update:value="patchOptions({ keepTogether: $event })"
                />
              </div>
              <div class="props-row">
                <span class="props-label" style="min-width: 88px">跳过空行</span>
                <NSwitch
                  size="small"
                  :value="control.options?.skipEmptyRows ?? false"
                  @update:value="patchOptions({ skipEmptyRows: $event })"
                />
              </div>
              <div class="props-row">
                <span class="props-label" style="min-width: 88px">斑马纹</span>
                <NSwitch
                  size="small"
                  :value="control.options?.striped ?? false"
                  @update:value="patchOptions({ striped: $event })"
                />
              </div>
              <div class="props-row">
                <span class="props-label" style="min-width: 88px">垂直对齐</span>
                <NSelect
                  size="small"
                  :value="control.options?.verticalAlign ?? 'middle'"
                  :options="valignOptions"
                  @update:value="patchOptions({ verticalAlign: $event })"
                />
              </div>
              <div class="props-row">
                <span class="props-label" style="min-width: 88px">边框</span>
                <NSelect
                  size="small"
                  :value="control.options?.borders ?? 'all'"
                  :options="[
                    { label: '全部', value: 'all' },
                    { label: '仅横线', value: 'horizontal' },
                    { label: '仅外框', value: 'outline' },
                    { label: '无', value: 'none' },
                  ]"
                  @update:value="patchOptions({ borders: $event })"
                />
              </div>
              <div
                class="props-row"
                v-if="isData && (control.options?.vMerge?.columns?.length ?? 0) > 0"
              >
                <span class="props-label" style="min-width: 88px">组头边界断开</span>
                <NSwitch
                  size="small"
                  :value="control.options?.vMerge?.breakOnGroup ?? true"
                  @update:value="
                    patchOptions({
                      vMerge: {
                        ...control.options?.vMerge,
                        breakOnGroup: $event,
                      },
                    })
                  "
                />
              </div>
              <div
                class="props-row"
                v-if="isData && (control.options?.vMerge?.columns?.length ?? 0) > 0"
              >
                <span class="props-label" style="min-width: 88px">跨页合并</span>
                <NTooltip>
                  <template #trigger>
                    <NSwitch size="small" :value="false" disabled />
                  </template>
                  v1 限定：vMerge 组必须完整落在同一页（避免 rowspan 跨页被 PDF 打印截断）
                </NTooltip>
              </div>
            </NCollapseItem>
          </NCollapse>
        </div>
      </NTabPane>

      <!-- ============================== 通用 ============================== -->
      <NTabPane name="common" tab="通用">
        <CommonProps />
      </NTabPane>
    </NTabs>
  </div>
</template>
