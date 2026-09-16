<script setup lang="ts">
/**
 * LabelGridQuickPanel —— 标签网格属性快速面板（底部弹出，NTabs 导航版）
 *
 * 触发链：右键画布上的 labelgrid → CanvasDesigner mouse:down button=2 →
 *   onLabelGridEdit(controlId) → designer.ts onLabelGridEdit → uiStore.openLabelGridQuickPanel
 *   → 本组件 v-if 渲染。
 *
 * v2 重构 (2026-09-11)：
 *   - NTabs 顶部导航替代 NCollapse 折叠面板
 *     原因：折叠面板占纵向空间大，分类一眼看不到，要滚动才能找到对应分组；
 *     改为 NTabs 后单层可见，导航一眼到位。
 *   - 7 个 tab（standard 模式 6 个，appendix 模式 7 个），默认「卡片布局」
 *   - 每个 tab 内只放对应类别的字段，切换 tab 无需折叠/展开
 *
 * v3 重构 (2026-09-11)：
 *   - 改为画布内固定宽度居中浮窗（600px），不再横跨整页
 *   - 高度由内容驱动（max-height: 360px），不同 tab 高度自适应
 *   - 挂在 <main>（CanvasStage）容器内，绝对定位底部居中，左右栏不挤压
 *   - 圆角 + 阴影更接近「弹出 popover」语义，与 TableQuickPanel 视觉一致
 *
 * v4 重构 (2026-09-16)：
 *   - 高度改为固定 440px（用户决策：内容驱动会让面板忽高忽低，
 *     尤其「首卡内容（5）」和「卡片布局」切换时跳变明显；固定高度更稳）
 *   - grid-cols-4 行（卡宽/卡高/横间距/纵间距）输入框宽度统一 90px，
 *     之前不设 width → NInputNumber shrink-wrap 到数字宽度（58.0 vs 0.0），
 *     视觉错位；现在显式对齐与第一行「列数/行数」一致
 *
 * v4.1 调整 (2026-09-16)：
 *   - 高度固定改为 370px（用户决策再收紧，440 → 390 → 370）
 *   - 「卡片布局」tab 重排为 3 列对齐：
 *       第 1 行：列数 · 行数 · 横间距
 *       第 2 行：卡宽 · 卡高 · 纵间距
 *     之前 grid-cols-4 把横间距放在第二行与卡宽同列，与纵间距不对齐；
 *     现在横向/纵向间距放同行不同列，与卡宽/卡高位置一致，更易扫读
 */
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTabPane,
  NTabs,
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

/* ------------------------------ NTabs 导航 ------------------------------ */

/** 默认 tab = 卡片布局 */
type TabName = 'layout' | 'appearance' | 'data' | 'pagination' | 'title' | 'children' | 'advanced'
const activeTab = ref<TabName>('layout')

/** 切换控件时回到「卡片布局」tab —— 用户决策：进入面板先看到最重要（布局）的字段 */
watch(
  () => target.value?.id,
  () => {
    activeTab.value = 'layout'
  },
)

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
  <div v-if="target" class="lgq-wrap">
    <div class="lgq-panel">
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

      <!-- NTabs 顶部条 + 内容区 -->
      <NTabs
        v-model:value="activeTab"
        type="line"
        size="small"
        :tabs-padding="4"
        class="lgq-tabs"
      >
        <!-- 1. 卡片布局：列/行/卡宽/卡高/间距 -->
        <NTabPane name="layout" tab="卡片布局" display-directive="show">
          <div class="lgq-pane">
            <!--
              布局：3 列对齐
                第 1 行  列数  铺满  行数  横间距        多行自动跨页
                第 2 行  卡宽       卡高  纵间距
                第 3 行  [卡片贴合内容]   info text
              同一列的 label-input 同 x 起点；行间用 14px 留白（lgq-row margin-bottom）
            -->
            <div class="lgq-row">
              <span class="lgq-label">列数</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="target.columns ?? 3"
                :min="1"
                :max="50"
                :step="1"
                style="width: 90px"
                @update:value="patchGeometry({ columns: $event ?? 1 })"
              />
              <NTooltip>
                <template #trigger>
                  <NButton size="tiny" quaternary style="margin-left: 4px" @click="fillColumns">
                    铺满
                  </NButton>
                </template>
                按卡片宽度把列数拉到内容区上限（{{ maxColumns }} 列）
              </NTooltip>
              <span class="lgq-label lgq-col">行数</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="visibleRows"
                :min="1"
                :max="200"
                :step="1"
                style="width: 90px"
                @update:value="setRows($event ?? 1)"
              />
              <span class="lgq-label lgq-col">横间距</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="geo.gapX"
                :min="0"
                :step="0.5"
                :precision="1"
                style="width: 90px"
                @update:value="patchGeometry({ gapX: $event ?? 0 })"
              />
              <NText depth="3" style="font-size: 12px; margin-left: 6px">多行自动跨页</NText>
            </div>

            <div class="lgq-row">
              <span class="lgq-label">卡宽</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="geo.cardWidth"
                :min="1"
                :step="0.5"
                :precision="1"
                style="width: 90px"
                @update:value="patchGeometry({ cardWidth: $event ?? 1 })"
              />
              <span class="lgq-label lgq-col">卡高</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="geo.cardHeight"
                :min="1"
                :step="0.5"
                :precision="1"
                style="width: 90px"
                @update:value="patchGeometry({ cardHeight: $event ?? 1 })"
              />
              <span class="lgq-label lgq-col">纵间距</span>
              <NInputNumber
                size="small"
                button-placement="both"
                :value="geo.gapY"
                :min="0"
                :step="0.5"
                :precision="1"
                style="width: 90px"
                @update:value="patchGeometry({ gapY: $event ?? 0 })"
              />
            </div>

            <div class="lgq-row" style="margin-top: 6px; gap: 6px">
              <NButton size="tiny" secondary @click="fitCardToContent">卡片贴合内容</NButton>
              <NText depth="3" style="font-size: 12px">
                每页 {{ geo.columns * visibleRows }} 张 · 模板含 {{ target.children.length }} 个元素
              </NText>
            </div>
          </div>
        </NTabPane>

        <!-- 2. 网格外观：网格线 / 线型 / 卡片边框 / 圆角 -->
        <NTabPane name="appearance" tab="网格外观" display-directive="show">
          <div class="lgq-pane">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
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
                  style="width: 100px"
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
                  style="width: 100px"
                  @update:value="patch({ cornerRadius: $event ?? 0 })"
                />
              </div>
            </div>
          </div>
        </NTabPane>

        <!-- 3. 数据：数据源 + 最大卡片数 -->
        <NTabPane name="data" tab="数据" display-directive="show">
          <div class="lgq-pane">
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
                style="width: 340px"
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
          </div>
        </NTabPane>

        <!-- 4. 分页策略 -->
        <NTabPane name="pagination" tab="分页" display-directive="show">
          <div class="lgq-pane">
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
                style="width: 300px"
                @update:value="
                  (v: 'auto' | 'always' | 'never') =>
                    patch({ pageBreak: v, forceNewPage: v === 'always' })
                "
              />
            </div>
          </div>
        </NTabPane>

        <!-- 5. 附录标题（仅 appendix） -->
        <NTabPane
          v-if="currentMode === 'appendix'"
          name="title"
          tab="附录标题"
          display-directive="show"
        >
          <div class="lgq-pane">
            <div class="lgq-row" style="align-items: flex-start">
              <span class="lgq-label">文本</span>
              <NInput
                type="textarea"
                size="small"
                :value="target.appendixTitle?.text ?? ''"
                placeholder="留空则不渲染。例如:附录:样本照片"
                :autosize="{ minRows: 1, maxRows: 2 }"
                style="flex: 1; margin-left: 8px"
                @update:value="(v: string) => patchTitleText(v)"
              />
            </div>

            <div class="grid grid-cols-4 gap-2" style="margin-top: 6px">
              <div class="lgq-row">
                <span class="lgq-label">字号(pt)</span>
                <NInputNumber
                  size="small"
                  button-placement="both"
                  :value="target.appendixTitle?.style?.fontSize ?? 12"
                  :min="6"
                  :max="120"
                  :step="1"
                  style="width: 86px"
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
                  style="width: 86px"
                  :value="target.appendixTitle?.style?.fill ?? '#000000'"
                  @update:value="patchTitleStyle({ fill: $event })"
                />
              </div>
              <div class="lgq-row">
                <span class="lgq-label">对齐</span>
                <NSelect
                  size="small"
                  style="width: 86px"
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
          </div>
        </NTabPane>

        <!-- 6. 首卡内容：children 列表 + 删除 + 清空（两 mode 共用） -->
        <NTabPane
          :name="'children'"
          :tab="`首卡内容（${target.children.length}）`"
          display-directive="show"
        >
          <div class="lgq-pane">
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
          </div>
        </NTabPane>

        <!-- 7. 高级：模式切换 + 兼容字段 -->
        <NTabPane name="advanced" tab="高级" display-directive="show">
          <div class="lgq-pane">
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
              <NText depth="3" style="font-size: 12px; margin-left: 6px">
                切换模式不替换 children
              </NText>
            </div>

            <div class="lgq-row" style="margin-top: 8px">
              <span class="lgq-label">appendixHeader</span>
              <NInput
                size="small"
                :value="target.appendixHeader ?? ''"
                placeholder="旧版一次性标题文本（不再渲染）"
                style="width: 340px"
                @update:value="(v: string) => patch({ appendixHeader: v || undefined })"
              />
            </div>
            <NText depth="3" style="font-size: 11px; line-height: 1.5; margin-top: 4px">
              旧字段保留以便向后兼容 JSON 模板；不再用作渲染源，标题请改用「附录标题」分组。
            </NText>
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
/* 外层 wrapper：相对 main 容器，底部居中浮动 */
.lgq-wrap {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  /* 1440px 视口：main=890px,留左右各 100px → 690px；窄屏自动收窄至不溢出 main */
  width: 690px;
  max-width: calc(100% - 200px);
  z-index: 50;
  /* 让 wrap 之外区域（画布）还能接收点击/拖动，wrap 自身内仍交互 */
  pointer-events: none;
}
.lgq-panel {
  /* wrap 范围内恢复交互 */
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  /* 固定高度（用户决策 2026-09-16，最新 370px）：内容驱动会让面板忽高忽低，
     切 tab 时跳变明显；固定 370px 视觉稳，panes 内部仍 overflow-y: auto 可滚 */
  height: 370px;
  background: var(--brand-surface, #fff);
  border: 1px solid var(--brand-border, #e5e7eb);
  border-radius: 8px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.lgq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
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
/* NTabs 容器：标签条贴顶，panes 在 flex 中占满剩余空间 */
.lgq-tabs {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* naive-ui 默认 tabs-nav 高度 42px,改成 32px 让面板更紧凑 */
.lgq-tabs :deep(.n-tabs-nav) {
  padding: 0 12px;
}
.lgq-tabs :deep(.n-tabs-tab) {
  font-size: 12px;
  padding: 6px 10px;
}
.lgq-tabs :deep(.n-tabs-tab-label) {
  font-size: 12px;
}
/* panes 容器：占满 tabs 剩余空间,允许内部溢出滚动 */
.lgq-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1 1 auto;
  min-height: 0;
}
.lgq-tabs :deep(.n-tab-pane) {
  padding: 0 !important;
  height: 100%;
  overflow-y: auto;
}
/* pane 内 padding */
.lgq-pane {
  padding: 8px 12px 10px;
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
/* 同一行的第 2/3 列 label 加左间距，与第 1 列 label 起点错开但保持 14px 节奏 */
.lgq-col {
  margin-left: 14px;
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