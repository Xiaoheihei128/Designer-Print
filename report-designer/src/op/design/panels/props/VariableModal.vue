<script setup lang="ts">
/**
 * VariableModal —— 变量（字段绑定）选择弹窗
 * 按表分组展示数据源全部字段：字段名 / 路径 / 类型标签 / 示例值，
 * 点击选中后在底部预览绑定路径，确定后回写 binding。
 * 示例值取自 ds.previewData（合成/真实数据），暂无则回退 FieldDef.sample。
 *
 * ★ hostLabelGrid 上下文：当调用方传入所在 LabelGrid 时，弹窗顶部多展示一个
 *   「首卡行上下文（row）」分组,从 grid.dataSource 数组表派生 `row.<leaf>`
 *   字段选项,选中即回写裸 path(`row.Photo`)。运行期由 resolveBinding 在
 *   rowCtx 上下文里直接求值(`expression.ts:878`)。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NInput, NModal, NScrollbar } from 'naive-ui'
import type { FieldDef } from '@op/types/datasource'
import type { LabelGridControl } from '@op/types/control'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'
import { usePreviewDataStore } from '@op/design/stores/previewData'
import {
  deriveRowScopedFields,
  deriveRowScopedGroupLabel,
  type RowScopedField,
} from '@op/design/utils/row-binding-fields'

const props = defineProps<{
  show: boolean
  /** 当前绑定路径（用于弹窗内高亮） */
  binding?: string
  /**
   * 调用方所在的 LabelGrid（首卡子控件时传入）。传入后弹窗顶部多展示
   * 「首卡行上下文（row）」分组,选项从 grid.dataSource 数组表派生。
   * 传入 null/undefined 时该分组隐藏,行为与原先一致。
   */
  hostLabelGrid?: LabelGridControl | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [value: string]
}>()

const catalog = useFieldCatalogStore()
const previewDataStore = usePreviewDataStore()
const search = ref('')
const selectedPath = ref('')

/* ----------------------------- 类型元信息 ----------------------------- */
const TYPE_META: Record<string, { label: string; color: string }> = {
  string: { label: '文本', color: '#1677ff' },
  number: { label: '数字', color: '#18a058' },
  date: { label: '日期', color: '#9c27b0' },
  boolean: { label: '布尔', color: '#f59e0b' },
  image: { label: '图片', color: '#eb2f96' },
  array: { label: '数组', color: '#13c2c2' },
  object: { label: '对象', color: '#8c8c8c' },
}
function typeMeta(t: string): { label: string; color: string } {
  return TYPE_META[t] ?? { label: t, color: '#8c8c8c' }
}

/* ----------------------------- 按表分组（catalog.fieldTree） ----------------------------- */
const grouped = computed(() =>
  catalog.fieldTree.map((g) => ({
    table: g.table,
    fields: g.fields,
  })),
)

const totalCount = computed(() => catalog.flatFields.length)

/* ----------------------------- 首卡行上下文（row.*） ----------------------------- */

/**
 * 从 hostLabelGrid.dataSource(数组路径如 'ReportItems')对应明细表的
 * FieldDef 派生 row.* 选项。dataSource 缺失 / 对应表不是数组 / 无字段 → 返回 null
 * (弹窗整块隐藏分组)。
 *
 * 派生逻辑抽到 row-binding-fields.ts 以便纯函数测。
 */
const rowScopedFields = computed<RowScopedField[] | null>(() =>
  deriveRowScopedFields({
    hostLabelGrid: props.hostLabelGrid,
    activeSource: catalog.activeSource,
    flatFields: catalog.flatFields,
  }),
)

const rowScopedGroupLabel = computed<string | null>(() => {
  if (!rowScopedFields.value) return null
  return deriveRowScopedGroupLabel({
    hostLabelGrid: props.hostLabelGrid,
    activeSource: catalog.activeSource,
    flatFields: catalog.flatFields,
  })
})

/** 搜索过滤：字段名 / 路径 / 类型 / 示例值 */
const filteredGroups = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return grouped.value
  return grouped.value
    .map((g) => ({
      ...g,
      fields: g.fields.filter(
        (f) =>
          f.label.toLowerCase().includes(kw) ||
          f.path.toLowerCase().includes(kw) ||
          typeMeta(f.type).label.includes(kw) ||
          String(sampleAt(f.path, f.sample)).toLowerCase().includes(kw),
      ),
    }))
    .filter((g) => g.fields.length > 0)
})

const filteredRowFields = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const list = rowScopedFields.value ?? []
  if (!kw) return list
  return list.filter(
    (f) =>
      f.label.toLowerCase().includes(kw) ||
      f.path.toLowerCase().includes(kw) ||
      typeMeta(f.type).label.includes(kw) ||
      String(sampleAt(f.samplePath, f.sample)).toLowerCase().includes(kw),
  )
})

/* ----------------------------- 示例值提取 ----------------------------- */
function resolvePath(target: unknown, path: string): unknown {
  let cur = target
  for (const k of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function formatSample(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（无示例值）'
  if (Array.isArray(v)) return `数组（${v.length} 项）`
  if (typeof v === 'object') return '对象'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/**
 * 在 previewData 里按 path 解析示例值。path 形如 'items[].qty' / 'order.total'。
 * 解析失败时回退 fallback。供 global / row 两组共用。
 */
function sampleAt(path: string, fallback: unknown): string {
  const data = (previewDataStore.data ?? {}) as Record<string, unknown>
  const marker = path.indexOf('[]')
  if (marker >= 0) {
    // items[].qty → data.items[0].qty
    const arrPath = path.slice(0, marker)
    const leaf = path.slice(marker + 2).replace(/^\./, '')
    const arr = resolvePath(data, arrPath)
    if (Array.isArray(arr) && arr.length > 0) {
      const row = arr[0] as Record<string, unknown>
      if (leaf) return formatSample(row[leaf])
      return formatSample(arr)
    }
    return formatSample(fallback)
  }
  const v = resolvePath(data, path)
  if (v === undefined || v === null) return formatSample(fallback)
  return formatSample(v)
}

function sampleOf(f: FieldDef): string {
  return sampleAt(f.path, f.sample)
}

function sampleRowOf(f: RowScopedField): string {
  return sampleAt(f.samplePath, f.sample)
}

/* ----------------------------- 选中与确认 ----------------------------- */
function selectField(f: FieldDef): void {
  selectedPath.value = f.path
}
function selectRowField(f: RowScopedField): void {
  selectedPath.value = f.path
}

function onConfirm(): void {
  if (selectedPath.value) emit('confirm', selectedPath.value)
  emit('update:show', false)
}
function onCancel(): void {
  emit('update:show', false)
}

/** 展示绑定字面量（避免模板直接写 {{ }}） */
function bindLiteral(path: string): string {
  return `{{${path}}}`
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      search.value = ''
      selectedPath.value = props.binding ?? ''
      // 弹窗独立可用：数据源未初始化（未打开过「数据源」面板）时主动加载字段
      void catalog.init()
    }
  },
)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="选择字段"
    style="width: 640px; max-width: 92vw"
    :bordered="false"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="var-modal">
      <div class="var-top">
        <NInput
          v-model:value="search"
          size="small"
          placeholder="搜索字段名 / 路径 / 类型 / 示例值"
          clearable
          class="var-search"
        />
        <span class="var-count">共 {{ totalCount }} 个字段</span>
      </div>

      <NScrollbar class="var-list">
        <!-- ★ 首卡行上下文（row.*）：仅当 hostLabelGrid 配 dataSource 时显示 -->
        <div v-if="rowScopedFields && filteredRowFields.length" class="var-group var-group--row">
          <div class="var-group-label">
            {{ rowScopedGroupLabel }}
            <span class="var-group-hint">运行期按当前卡数据求值</span>
          </div>
          <button
            v-for="f in filteredRowFields"
            :key="f.path"
            type="button"
            class="var-fn"
            :class="{ 'var-fn--active': selectedPath === f.path }"
            @click="selectRowField(f)"
          >
            <div class="var-fn-head">
              <span class="var-fn-name">{{ f.label }}</span>
              <span class="var-fn-type" :style="{ color: typeMeta(f.type).color }">{{ typeMeta(f.type).label }}</span>
              <code class="var-fn-path">{{ f.path }}</code>
            </div>
            <div class="var-fn-sample">示例：{{ sampleRowOf(f) }}</div>
          </button>
        </div>

        <div v-for="g in filteredGroups" :key="g.table.id" class="var-group">
          <div class="var-group-label">{{ g.table.name }}</div>
          <button
            v-for="f in g.fields"
            :key="f.path"
            type="button"
            class="var-fn"
            :class="{ 'var-fn--active': selectedPath === f.path }"
            @click="selectField(f)"
          >
            <div class="var-fn-head">
              <span class="var-fn-name">{{ f.label }}</span>
              <span class="var-fn-type" :style="{ color: typeMeta(f.type).color }">{{ typeMeta(f.type).label }}</span>
              <code class="var-fn-path">{{ f.path }}</code>
            </div>
            <div class="var-fn-sample">示例：{{ sampleOf(f) }}</div>
          </button>
        </div>
        <NEmpty
          v-if="filteredGroups.length === 0 && filteredRowFields.length === 0"
          :description="catalog.loading ? '字段加载中…' : search ? '无匹配字段' : '暂无数据源字段'"
          class="var-empty"
        />
      </NScrollbar>

      <div class="var-foot">
        <span class="var-foot-label">已选</span>
        <code class="var-foot-path">{{ selectedPath ? bindLiteral(selectedPath) : '（未选择）' }}</code>
      </div>
    </div>

    <template #footer>
      <div class="var-footer">
        <NButton size="small" @click="onCancel">取消</NButton>
        <NButton size="small" type="primary" :disabled="!selectedPath" @click="onConfirm">确定</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.var-modal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 460px;
}
.var-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.var-search {
  flex: 1 1 auto;
}
.var-count {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--n-text-color-3, #888);
}
.var-list {
  flex: 1 1 auto;
  min-height: 0;
}
.var-group {
  margin-bottom: 10px;
}
.var-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3, #888);
  margin: 6px 2px;
}
/* ★ 首卡行上下文（row）—— 标签网格场景,运行时按当前卡数据求值 */
.var-group--row .var-group-label {
  color: var(--brand-primary, #2563eb);
}
.var-group-hint {
  margin-left: 6px;
  font-size: 11px;
  font-weight: normal;
  color: var(--n-text-color-3, #999);
  opacity: 0.85;
}
.var-group--row .var-fn {
  background: color-mix(in srgb, var(--brand-primary, #2563eb) 4%, transparent);
}
.var-fn {
  display: block;
  width: 100%;
  text-align: left;
  background: var(--brand-surface);
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  padding: 7px 9px;
  margin-bottom: 6px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.var-fn:hover {
  border-color: var(--brand-primary);
  background: color-mix(in srgb, var(--brand-primary) 6%, transparent);
}
.var-fn--active {
  border-color: var(--brand-primary);
  background: color-mix(in srgb, var(--brand-primary) 10%, transparent);
  box-shadow: inset 2px 0 0 var(--brand-primary);
}
.var-fn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.var-fn-name {
  font-weight: 600;
  font-size: 13px;
}
.var-fn-type {
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 1.5;
  opacity: 0.85;
}
.var-fn-path {
  font-size: 11px;
  color: var(--n-text-color-3, #888);
  background: rgba(127, 127, 127, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.var-fn-sample {
  font-size: 12px;
  color: var(--n-text-color-2, #aaa);
  margin-top: 3px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.var-empty {
  padding-top: 24px;
}
.var-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--brand-border);
  padding-top: 8px;
}
.var-foot-label {
  font-size: 12px;
  color: var(--n-text-color-3, #888);
}
.var-foot-path {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.var-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
