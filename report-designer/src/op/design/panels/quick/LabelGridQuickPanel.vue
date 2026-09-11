<script setup lang="ts">
/**
 * LabelGridQuickPanel —— 标签网格属性快速面板（底部弹出）
 *
 * 触发链：右键画布上的 labelgrid → CanvasDesigner mouse:down button=2 →
 *   onLabelGridEdit(controlId) → designer.ts onLabelGridEdit → uiStore.openLabelGridQuickPanel
 *   → 本组件 v-if 渲染。
 *
 * 设计决策（vs 原右栏 LabelGridProps）：
 *   - 字段多（30+）混在一个 flat 面板里查找效率差 → 按 NCollapse 折叠分组
 *   - 右栏常驻 CommonProps（X/Y/W/H/锁定/打印）无需每次重弹
 *   - 数据面板 NCollapse 默认全展开，用户按需折叠；预留「高级」折叠区
 *     后续塞新选项(对齐策略/换页节奏等)不污染主分组
 *   - targetId 显式记录而非读 selectedIds，切换选中控件不关闭面板
 *     （用户决策：跨控件切换编辑不丢数据）
 */
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTag,
  NText,
  NTooltip,
  NColorPicker,
} from 'naive-ui'
import type { LabelGridControl } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'
import { useUiStore } from '@op/design/stores/ui'
import { resolveGridGeometry, labelCardBounds } from '@op/core/layout-engine/label-grid'
import { CONTROL_TYPE_LABEL } from '@op/design/canvas/controls'

const store = useDesignerStore()
const uiStore = useUiStore()
const ds = useFieldCatalogStore()

/* --------------------------- target & 自愈 --------------------------- */

/**
 * 由 targetId 派生 LabelGridControl（不直接读 selectedIds，避免切换选中时面板内容跳走）。
 * targetId 找不到（控件被删）→ uiStore.syncLabelGridQuickPanelTarget 兜底关面板，
 * watch 立刻返回 null 让模板走空态分支。
 */
const target = computed<LabelGridControl | null>(() => {
  const id = uiStore.labelGridQuickPanelTargetId
  if (!id) return null
  return (store.controls.find((c) => c.id === id) as LabelGridControl | undefined) ?? null
})

/** 模式（缺失标签视为 standard） */
const currentMode = computed<'standard' | 'appendix'>(() => target.value?.mode ?? 'standard')

/* ------------------------------ 几何 / 容量 ------------------------------ */

const geo = computed(() =>
  target.value
    ? resolveGridGeometry(target.value)
    : { columns: 3, gapX: 2, gapY: 2, cardWidth: 0, cardHeight: 0 },
)
const visibleRows = computed(() => {
  const g = geo.value
  const step = g.cardHeight + g.gapY
  if (!target.value || step <= 0) return 1
  return Math.max(1, Math.floor((target.value.height + g.gapY) / step))
})
const contentWidth = computed(() => {
  const ps = store.pageSetup
  return Math.max(1, ps.width - ps.margin.left - ps.margin.right)
})
const maxColumns = computed(() =>
  Math.max(
    1,
    Math.floor((contentWidth.value + geo.value.gapX) / (geo.value.cardWidth + geo.value.gapX)),
  ),
)

/* ------------------------------ patch 工具 ------------------------------ */

function patch(p: Partial<LabelGridControl>): void {
  if (target.value) store.updateControl(target.value.id, p)
}
/** 几何 patch 后跟着重算 width / height，让包围盒 = 实际铺满（其他列同步） */
function patchGeometry(p: Partial<LabelGridControl>): void {
  const c = target.value
  if (!c) return
  const next = { ...c, ...p }
  const g = resolveGridGeometry(next)
  patch({
    ...p,
    width: Math.round((g.cardWidth * g.columns + g.gapX * (g.columns - 1)) * 10) / 10,
    height: Math.round((g.cardHeight * visibleRows.value + g.gapY * (visibleRows.value - 1)) * 10) / 10,
  })
}
function setRows(rows: number): void {
  const g = geo.value
  patch({ height: Math.round((g.cardHeight * rows + g.gapY * (rows - 1)) * 10) / 10 })
}
function fillColumns(): void {
  patchGeometry({ columns: maxColumns.value })
}
function fitCardToContent(): void {
  const c = target.value
  if (!c) return
  const b = labelCardBounds(c.children)
  patchGeometry({
    cardWidth: Math.max(1, Math.round(b.width * 10) / 10),
    cardHeight: Math.max(1, Math.round(b.height * 10) / 10),
  })
}

/* ------------------------------ 数据源 / 模式 ------------------------------ */

const dataSourceOptions = computed(() => {
  const tables = ds.activeSource?.tables ?? []
  return tables
    .filter((t) => t.isArray)
    .map((t) => {
      const arrayPath = (t.pathPrefix ?? '').replace(/\[\]\.?,?$/, '')
      if (!arrayPath) return null
      return { label: `${t.name}（${arrayPath}）`, value: arrayPath }
    })
    .filter((o): o is { label: string; value: string } => o !== null)
})
function setMode(next: 'standard' | 'appendix'): void {
  const c = target.value
  if (!c) return
  if (c.mode === next || (c.mode === undefined && next === 'standard')) return
  store.updateControl(c.id, { mode: next })
}

/* ------------------------------ 标题文本 / style ------------------------------ */

function patchTitleText(text: string): void {
  const c = target.value
  if (!c) return
  patch({
    appendixTitle: {
      text,
      style: c.appendixTitle?.style,
    },
  })
}
function patchTitleStyle(p: Record<string, unknown>): void {
  const c = target.value
  if (!c) return
  const cur = c.appendixTitle
  patch({
    appendixTitle: {
      text: cur?.text ?? '',
      style: { ...cur?.style, ...p },
    },
  })
}

/* ------------------------------ 首卡 children ------------------------------ */

function childName(ch: { type: string; name?: string }): string {
  return ch.name ?? CONTROL_TYPE_LABEL[ch.type] ?? ch.type
}
function removeChild(id: string): void {
  if (target.value) store.removeLabelGridChild(target.value.id, id)
}
function clearChildren(): void {
  if (target.value) store.clearLabelGridChildren(target.value.id)
}

/* ------------------------------ NCollapse 默认展开项 ------------------------------ */

/**
 * 默认全展开：用户首见就看到完整能力；按需折叠节省纵向空间。
 * 「高级」项默认收起，预留给后续扩展（页边距策略/换页节奏等），暂用 NCollapse 内嵌分组实现，
 * 不破坏外层 6 分组的稳定键名。
 */
const expanded = ref<string[]>([
  'layout',
  'appearance',
  'data',
  'pagination',
  'title',
  'children',
  'advanced',
])
const advancedExpanded = ref<string[]>(['mode'])

/* ------------------------------ 自愈：控件不在则关 ------------------------------ */

watch(
  () => target.value,
  (v) => {
    if (!v && uiStore.labelGridQuickPanelOpen) uiStore.closeLabelGridQuickPanel()
  },
)

/** 同步 hook：用户删控件时 store 自己也能兜底关（不只是面板内 watch） */
watch(
  () => store.controls.map((c) => c.id),
  (ids) => uiStore.syncLabelGridQuickPanelTarget(new Set(ids)),
)

function close(): void {
  uiStore.closeLabelGridQuickPanel()
}

/** Esc 关闭由 useHotkey 统一调；这里暴露方法以便按钮也能触发 */
defineExpose({ close })
</script>

<template>
  <div v-if="target" class="lgq-panel">
    <!-- 顶栏：标题 + 模式标识 + 关闭按钮 -->
    <div class="lgq-header">
      <div class="lgq-title">
        <span class="i-carbon-grid text-14px text-brand-primary" />
        <span class="text-13px font-medium">标签网格属性</span>
        <NTag size="tiny" :type="currentMode === 'appendix' ? 'primary' : 'default'" style="margin-left: 8px">
          {{ currentMode === 'appendix' ? '附录图片墙' : '标准标签网格' }}
        </NTag>
      </div>
      <div class="lgq-actions">
        <NButton size="tiny" quaternary @click="close" title="关闭（Esc）">
          <template #icon><span class="i-carbon-close text-12px" /></template>
          关闭
        </NButton>
      </div>
    </div>

    <!-- 6 个主分组 + 高级折叠：NCollapse 默认全展开；分组键名稳定，便于扩展 -->
    <NCollapse
      v-model:expanded-names="expanded"
      :trigger-areas="['main', 'arrow']"
      class="lgq-collapse"
    >
      <!-- 1. 卡片布局：列/行/卡宽/卡高/间距 -->
      <NCollapseItem name="layout" title="卡片布局">
        <div class="lgq-row">
          <span class="lgq-label">列数</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="target.columns ?? 3"
            :min="1"
            :max="50"
            :step="1"
            style="width: 96px"
            @update:value="patchGeometry({ columns: $event ?? 1 })"
          />
          <NTooltip>
            <template #trigger>
              <NButton size="tiny" quaternary style="margin-left: 6px" @click="fillColumns">
                铺满
              </NButton>
            </template>
            按卡片宽度把列数拉到内容区上限（{{ maxColumns }} 列）
          </NTooltip>
          <span class="lgq-label" style="margin-left: 16px">行数</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="visibleRows"
            :min="1"
            :max="200"
            :step="1"
            style="width: 96px"
            @update:value="setRows($event ?? 1)"
          />
          <NText depth="3" style="font-size: 12px; margin-left: 6px">多行自动跨页</NText>
        </div>

        <div class="grid grid-cols-4 gap-2 mt-1">
          <div class="lgq-row">
            <span class="lgq-label">卡宽</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="geo.cardWidth"
              :min="1"
              :step="0.5"
              :precision="1"
              @update:value="patchGeometry({ cardWidth: $event ?? 1 })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">卡高</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="geo.cardHeight"
              :min="1"
              :step="0.5"
              :precision="1"
              @update:value="patchGeometry({ cardHeight: $event ?? 1 })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">横间距</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="geo.gapX"
              :min="0"
              :step="0.5"
              :precision="1"
              @update:value="patchGeometry({ gapX: $event ?? 0 })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">纵间距</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="geo.gapY"
              :min="0"
              :step="0.5"
              :precision="1"
              @update:value="patchGeometry({ gapY: $event ?? 0 })"
            />
          </div>
        </div>

        <div class="lgq-row" style="margin-top: 6px; gap: 6px">
          <NButton size="tiny" secondary @click="fitCardToContent">卡片贴合内容</NButton>
          <NText depth="3" style="font-size: 12px">
            每页 {{ geo.columns * visibleRows }} 张 · 模板含 {{ target.children.length }} 个元素
          </NText>
        </div>
      </NCollapseItem>

      <!-- 2. 网格外观：网格线 / 线型 / 卡片边框 / 圆角 -->
      <NCollapseItem name="appearance" title="网格外观">
        <div class="grid grid-cols-4 gap-2">
          <div class="lgq-row">
            <span class="lgq-label">显示网格线</span>
            <NSwitch
              size="small"
              :value="target.showLines ?? true"
              @update:value="patch({ showLines: $event })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">线型</span>
            <NSelect
              size="small"
              :value="target.lineStyle ?? 'solid'"
              :disabled="!(target.showLines ?? true)"
              :options="[
                { label: '实线', value: 'solid' },
                { label: '虚线', value: 'dashed' },
              ]"
              style="width: 96px"
              @update:value="patch({ lineStyle: $event })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">卡片边框</span>
            <NSwitch
              size="small"
              :value="target.cardBorder ?? true"
              @update:value="patch({ cardBorder: $event })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">圆角(mm)</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="target.cornerRadius ?? 0"
              :min="0"
              :max="20"
              :step="0.5"
              :precision="1"
              :disabled="!(target.cardBorder ?? true)"
              style="width: 96px"
              @update:value="patch({ cornerRadius: $event ?? 0 })"
            />
          </div>
        </div>
      </NCollapseItem>

      <!-- 3. 数据：数据源 + 最大卡片数 -->
      <NCollapseItem name="data" title="数据">
        <div class="lgq-row">
          <span class="lgq-label">
            数据源
            <span v-if="currentMode === 'appendix'" style="color: var(--brand-error, #d03050)">*</span>
          </span>
          <NSelect
            size="small"
            :value="target.dataSource ?? null"
            :options="dataSourceOptions"
            :placeholder="
              currentMode === 'appendix' ? '附录模式必填（请选择明细表）' : '选择明细表数组路径（留空 = 纯布局）'
            "
            :disabled="currentMode === 'appendix' && dataSourceOptions.length === 0"
            filterable
            tag
            clearable
            style="width: 280px"
            @update:value="(v: string | null) => patch({ dataSource: (v ?? '').trim() || undefined })"
          />
        </div>
        <div class="lgq-row" style="margin-top: 4px">
          <span class="lgq-label">最大卡片数</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="target.maxItems ?? null"
            :min="1"
            :max="9999"
            :step="1"
            placeholder="不限"
            style="width: 120px"
            @update:value="patch({ maxItems: $event ?? undefined })"
          />
          <NText depth="3" style="font-size: 11px; margin-left: 6px">仅配数据源时生效</NText>
        </div>
      </NCollapseItem>

      <!-- 4. 分页策略 -->
      <NCollapseItem name="pagination" title="分页">
        <div class="lgq-row">
          <span class="lgq-label">分页策略</span>
          <NSelect
            size="small"
            :value="target.pageBreak ?? (target.forceNewPage ? 'always' : 'auto')"
            :options="[
              { label: '自适应(放得下就跟末页)', value: 'auto' },
              { label: '强制新页(整组推到下一页)', value: 'always' },
              { label: '始终紧跟末页(超出裁切)', value: 'never' },
            ]"
            style="width: 240px"
            @update:value="
              (v: 'auto' | 'always' | 'never') =>
                patch({ pageBreak: v, forceNewPage: v === 'always' })
            "
          />
        </div>
      </NCollapseItem>

      <!-- 5. 附录标题（仅 appendix） -->
      <NCollapseItem
        v-if="currentMode === 'appendix'"
        name="title"
        title="附录标题"
      >
        <div class="lgq-row" style="align-items: flex-start">
          <span class="lgq-label">文本</span>
          <NInput
            type="textarea"
            size="small"
            :value="target.appendixTitle?.text ?? ''"
            placeholder="留空则不渲染。例如:附录:样本照片"
            :autosize="{ minRows: 2, maxRows: 4 }"
            style="flex: 1; margin-left: 8px"
            @update:value="(v: string) => patchTitleText(v)"
          />
        </div>

        <div class="grid grid-cols-4 gap-2 mt-2">
          <div class="lgq-row">
            <span class="lgq-label">字号(pt)</span>
            <NInputNumber
              size="small"
              button-placement="both"
              :value="target.appendixTitle?.style?.fontSize ?? 12"
              :min="6"
              :max="120"
              :step="1"
              style="width: 96px"
              @update:value="patchTitleStyle({ fontSize: $event ?? 12 })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">加粗</span>
            <NSwitch
              size="small"
              :value="(target.appendixTitle?.style?.fontWeight ?? 'normal') === 'bold'"
              @update:value="
                (v: boolean) => patchTitleStyle({ fontWeight: v ? 'bold' : 'normal' })
              "
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">颜色</span>
            <NColorPicker
              size="small"
              :modes="['hex']"
              :show-alpha="false"
              style="width: 96px"
              :value="target.appendixTitle?.style?.fill ?? '#000000'"
              @update:value="patchTitleStyle({ fill: $event })"
            />
          </div>
          <div class="lgq-row">
            <span class="lgq-label">对齐</span>
            <NSelect
              size="small"
              style="width: 96px"
              :value="target.appendixTitle?.style?.textAlign ?? 'left'"
              :options="[
                { label: '左', value: 'left' },
                { label: '居中', value: 'center' },
                { label: '右', value: 'right' },
              ]"
              @update:value="patchTitleStyle({ textAlign: $event })"
            />
          </div>
        </div>

        <div class="lgq-row" style="margin-top: 6px">
          <span class="lgq-label">每页重复</span>
          <NSwitch
            size="small"
            :value="target.titleRepeat !== false"
            @update:value="patch({ titleRepeat: $event })"
          />
          <NText depth="3" style="font-size: 11px; margin-left: 6px">
            关闭则仅 grid 起始页显示标题
          </NText>
        </div>
      </NCollapseItem>

      <!-- 6. 首卡内容：children 列表 + 删除 + 清空（两 mode 共用） -->
      <NCollapseItem name="children" :title="`首卡内容（${target.children.length}）`">
        <template v-if="target.children.length">
          <div class="lgq-child-list">
            <div v-for="ch in target.children" :key="ch.id" class="lgq-child-item">
              <span class="truncate text-12px" style="flex: 1">{{ childName(ch) }}</span>
              <NButton text size="tiny" class="child-del" @click.stop="removeChild(ch.id)">
                <span class="i-carbon-close text-12px text-brand-text-3" />
              </NButton>
            </div>
          </div>
          <NButton size="tiny" tertiary type="error" style="margin-top: 6px" @click="clearChildren">
            清空首卡
          </NButton>
        </template>
        <NText v-else depth="3" style="font-size: 12px">
          模板为空：从控件库拖入组件即可（自动复制到每张卡）。appendix 模式可拖入图/编号/标题三件套。
        </NText>
      </NCollapseItem>

      <!-- 7. 高级（默认折叠，预留扩展位） -->
      <NCollapseItem name="advanced" title="高级">
        <NCollapse v-model:expanded-names="advancedExpanded">
          <NCollapseItem name="mode" title="模式切换">
            <div class="lgq-row">
              <span class="lgq-label">模式</span>
              <NRadioGroup
                :value="currentMode"
                size="small"
                @update:value="(v: 'standard' | 'appendix') => setMode(v)"
              >
                <NRadioButton value="standard">标准</NRadioButton>
                <NRadioButton value="appendix">附录图片墙</NRadioButton>
              </NRadioGroup>
            </div>
            <NText depth="3" style="font-size: 12px; line-height: 1.5; margin-top: 4px">
              切换模式不替换 children。两 mode 都用本面板，差异仅在「附录标题」分组是否显示。
            </NText>
          </NCollapseItem>
          <NCollapseItem name="compat" title="兼容字段">
            <div class="lgq-row">
              <span class="lgq-label">appendixHeader</span>
              <NInput
                size="small"
                :value="target.appendixHeader ?? ''"
                placeholder="旧版一次性标题文本（不再渲染）"
                style="width: 280px"
                @update:value="(v: string) => patch({ appendixHeader: v || undefined })"
              />
            </div>
            <NText depth="3" style="font-size: 12px; line-height: 1.5">
              旧字段保留以便向后兼容 JSON 模板；不再用作渲染源，标题请改用上方「附录标题」分组。
            </NText>
          </NCollapseItem>
        </NCollapse>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.lgq-panel {
  display: flex;
  flex-direction: column;
  height: 320px;
  background: var(--brand-surface, #fff);
  border-top: 1px solid var(--brand-border, #e5e7eb);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}
.lgq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--brand-border, #e5e7eb);
  background: var(--brand-fill-1, #f7f8fa);
  flex: 0 0 auto;
}
.lgq-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lgq-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lgq-collapse {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.lgq-collapse :deep(.n-collapse-item__header-main) {
  font-size: 13px;
  font-weight: 500;
}
.lgq-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.lgq-label {
  display: inline-block;
  min-width: 64px;
  font-size: 12px;
  color: var(--brand-text-2, #666);
}
.lgq-child-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lgq-child-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--brand-fill, rgba(120, 130, 145, 0.1));
}
.child-del:hover {
  color: var(--brand-error, #d03050) !important;
}
</style>