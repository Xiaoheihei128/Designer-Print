<script setup lang="ts">
/**
 * CellToolbar —— 单元格浮动工具栏（方案 A）
 *
 * 双击进入单元格后浮在其上方，提供 ERP 报表最常用的单元格级能力：
 * 字段绑定 / 字体族 / 字号 / 加粗斜体下划线 / 水平垂直对齐 / 文字色 / 填充色 / 横向合并 / 清除样式。
 *
 * 本组件**不直接改 store**：所有动作算出「新的表格控件」后 emit('apply')，
 * 由 TableViewLayer 统一写回并刷新 overlay —— 保持单一写入口，撤销栈干净。
 */
import { computed, watch } from 'vue'
import {
  NButton,
  NButtonGroup,
  NColorPicker,
  NDivider,
  NInput,
  NInputNumber,
  NSwitch,
  NSelect,
  NTooltip,
} from 'naive-ui'
import type { SelectOption, SelectGroupOption } from 'naive-ui'
import type { TableCell, TableCellStyle, TableControl, CellFormat, CellFormatKind, Segment as SegmentT } from '@op/types/control'
import {
  buildDesignGrid,
  insertTableColumn,
  insertTableRow,
  patchCell,
  patchCellStyle,
  removeTableColumn,
  removeTableRow,
  resolveCellStyle,
  rowRoleLabel,
  setCellRowSpan,
  setCellSpan,
} from '@op/core/layout-engine/table-cells'
import { FONT_CATALOG } from '@op/core/fonts/catalog'
import { useSystemFonts } from '@op/core/fonts/system'
import { useFieldCatalogStore } from '@op/design/stores/fieldCatalog'
import { useUiStore } from '@op/design/stores/ui'
import ContentValueEditor from '@op/design/panels/props/ContentValueEditor.vue'
import type { ContentMode } from '@op/design/panels/props/ContentValueEditor.vue'
import { rebuildSegmentsFromCell } from '@op/design/segments-migration'
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

const props = defineProps<{
  control: TableControl
  row: number
  col: number
  /** 行语义：header=表头 / data=数据样例行（影响整列）/ static=静态行 */
  rowKind: 'header' | 'data' | 'static'
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'apply', next: TableControl): void
  /**
   * lazy migration emit —— 仅添加 segments 字段、不动用户内容
   * TableViewLayer 收到后走 updateControlSilent（不进 undo 栈、不标 dirty）
   */
  (e: 'migrate', next: TableControl): void
  (e: 'close'): void
}>()

const ds = useFieldCatalogStore()
const uiStore = useUiStore()
/** 打开右侧"表格属性快速面板"，整个属性区会被替换为精简版 4-tab 面板 */
function openTableProps(): void {
  uiStore.openTableQuickPanel()
}
/**
 * × 关闭按钮：仅通知父组件关闭工具栏，**不联动**关闭快速面板。
 * 用户决策：CellToolbar 与快速面板关闭独立——关闭工具栏后用户仍可继续在
 * 快速面板上操作列配置 / 默认样式，避免点击右栏时误触发工具栏关闭。
 */
function closeToolbar(): void {
  emit('close')
}

const grid = computed(() => buildDesignGrid(props.control))
const cell = computed<TableCell>(() => grid.value.cells[props.row]?.[props.col] ?? {})
/**
 * 同步派生 cell.segments —— 老 schema 的 cell 只写了 field/expression，segments 是 undefined；
 * ensureSegments 是异步（emit migrate → store 写回 → 下一次响应才能读到），期间传给
 * ContentValueEditor 的 segments 是 undefined，segmentsToText 返回空 → textarea 空白，
 * 与画布 placeholderOf(cell.field) 显示的 {{item.X}} 不一致。
 *
 * 这里同步跑一次 rebuildSegmentsFromCell，把"应渲染的 segments"在本次渲染就交给编辑器，
 * 画布反向同步链路里的 watch(migrate) 继续负责把 segments 写回 store（保持单一数据源）。
 *
 * ★ Plan B 改造：rebuildSegmentsFromCell 与 ensureSegments 关键区别 —— 前者在
 *   segments 已存在时也按"最新 cell 字段"重新派生并清老字段。这是修复画布→三态输入框
 *   反向同步的核心：用户用 contentEditable 改完文本后，patchCellText 写了 cell.text
 *   但 segments 还是旧值，rebuildSegmentsFromCell 会在本次渲染就重派生，ContentValueEditor
 *   立即拿到新 segments prop。
 */
const effectiveCell = computed<TableCell>(() => rebuildSegmentsFromCell(cell.value))
const column = computed(() => props.control.columns[props.col])
const style = computed<TableCellStyle>(() => resolveCellStyle(props.control, column.value, effectiveCell.value))

const sysFonts = useSystemFonts()

const fontOptions = computed<(SelectOption | SelectGroupOption)[]>(() => {
  const builtin: SelectOption[] = [
    { label: '默认', value: '' },
    ...FONT_CATALOG.map((f) => ({ label: f.label, value: f.family })),
  ]
  if (!sysFonts.ready.value) return builtin
  const sysOpts: SelectOption[] = sysFonts.grouped.value.map((g) => ({ label: g.family, value: g.family }))
  return [
    { type: 'group', label: '预设字体', key: 'builtin', children: builtin.filter((o) => o.value !== '') },
    { type: 'group', label: `电脑系统字体（${sysFonts.count.value}）`, key: 'system', children: sysOpts },
    { label: '默认', value: '' },
  ]
})

/**
 * 可绑定字段（用于变量模式默认值）：
 * - 数据样例行 → 明细表（数组）字段，运行期按行迭代
 * - 表头 / 静态行 → 主表标量字段
 */
const detailFields = computed(() => {
  const isDetail = props.rowKind === 'data'
  const tables = ds.activeSource?.tables ?? []
  const arrayTableIds = new Set(tables.filter((t) => t.isArray).map((t) => t.id))
  return ds.flatFields.filter((f) => {
    const inArray = f.tableId ? arrayTableIds.has(f.tableId) : f.path.includes('[]')
    return isDetail ? inArray : !inArray
  })
})

/** 变量模式默认路径：取该行语义下的第一个字段（数据行=明细字段，其余=标量字段）。
 * fallback 也跟随当前数据源走（首个明细/标量字段），不再硬编码"ReportItems[].AnalysisItem"/
 * "order.orderNo"——切换数据源（销售订单、采购单等）时 fallback 不再产生误导路径。 */
const bindingDefault = computed(() => {
  const first = detailFields.value[0]?.path
  if (first) return first
  // 无字段目录注入时，flatFields 也为空；此时用 props.rowKind 推导的语义化默认值，
  // 至少与原行为一致，等真正有字段注入后用户即可在面板下拉里换正确路径。
  if (props.rowKind === 'data') {
    return ds.flatFields.find((f) => f.path.includes('[]'))?.path ?? ''
  }
  return ds.flatFields.find((f) => !f.path.includes('[]'))?.path ?? ''
})

/** 表达式模式默认值
 * - 数据行保留 {{rowIndex + 1}}（序号列的双击便利）
 * - 静态行不再硬塞 {{order.total}}：用户切到「表达式」模式时往往是想要聚合 token（#pageSum/#totalCap 等），
 *   自动注入 {{order.total}} 会让画布立刻显示一行无意义字面，掩盖用户真正意图（Bug4 修复）。
 *   留空让用户主动从「函数 / 聚合」按钮插入 snippet。
 */
const expressionDefault = computed(() =>
  props.rowKind === 'data' ? '{{rowIndex + 1}}' : '',
)

/** 单元格内容三态：固定值 / 变量（字段绑定） / 表达式（显式 contentType，老模板启发式回退）
 *  v2: 已有 segments 时返回 undefined，让 ContentValueEditor 切到 segments 模式
 */
const cellMode = computed<ContentMode | undefined>(() => {
  const c = effectiveCell.value
  // segments 模式（非空数组）→ 返回 undefined，让 ContentValueEditor 走 segments UI 分支
  // 注：segments=[] 视为"用户刚清空"——回退到 3 态模式让 radio 重新可见，
  // 否则用户永远困在 segments=[] 死锁状态无法切回 fixed/variable/expression。
  if (Array.isArray(c?.segments) && c.segments.length > 0) return undefined
  if (c?.contentType) return c.contentType
  return c?.expression ? 'expression' : c?.field ? 'variable' : 'fixed'
})

/** 模式切换：写 contentType + 清空其它两个字段（默认值由编辑器按 bindingDefault 注入） */
function onCellMode(m: ContentMode): void {
  const p: Partial<TableCell> = { contentType: m }
  if (m === 'fixed') {
    p.field = undefined
    p.expression = undefined
  } else if (m === 'variable') {
    p.expression = undefined
  } else {
    p.field = undefined
  }
  emit('apply', patchCell(props.control, props.row, props.col, p))
}

function onCellValue(v: string): void {
  emit('apply', patchCell(props.control, props.row, props.col, { text: v }))
}

/**
 * 变量模式：写 field 并清空 text/expression。
 * ★ 清空场景（path 为空）不写 contentType：让 segments 走自己的逻辑决定
 *   contentType，老字段不被强制覆写成 'variable' 留下脏数据。
 */
function onCellBinding(path: string): void {
  if (!path) {
    emit(
      'apply',
      patchCell(props.control, props.row, props.col, {
        field: undefined,
        text: undefined,
        expression: undefined,
      }),
    )
    return
  }
  emit(
    'apply',
    patchCell(props.control, props.row, props.col, {
      contentType: 'variable',
      field: path,
      text: undefined,
      expression: undefined,
    }),
  )
}

function onCellExpression(v: string): void {
  if (!v) {
    emit(
      'apply',
      patchCell(props.control, props.row, props.col, {
        expression: undefined,
        text: undefined,
        field: undefined,
      }),
    )
    return
  }
  emit(
    'apply',
    patchCell(props.control, props.row, props.col, {
      contentType: 'expression',
      expression: v,
      text: undefined,
      field: undefined,
    }),
  )
}

/** v2: segments 模式 textarea 内容变更时回写
 *
 * ★ 关键修复：segments 清空（length=0 或全部为空 text 段）时同步清除 v1 老字段
 *   （field/text/expression），合并到同一份 patchCell —— 避免之前由
 *   ContentValueEditor blur 连续 emit update:segments + update:value 等多次
 *   事件，在 CellToolbar 内部因 props.control 是上一次响应式快照，导致后续
 *   patchCell(props.control, ..., { text: undefined }) 用「旧 segments」覆盖
 *   刚写入的「segments=[]」，表现为「清空 textarea 后字段又冒出来」。
 *
 *   把清理放在单一 patchCell 里同时清 v1 字段，后续 update:value 等 emit 即便
 *   触发也只是把已是 undefined 的字段再次写为 undefined，不会回滚 segments。
 */
function onCellSegments(s: SegmentT[]): void {
  const segsIsEmpty =
    s.length === 0 || s.every((seg) => seg.kind === 'text' && !seg.value)
  if (segsIsEmpty) {
    emit(
      'apply',
      patchCell(props.control, props.row, props.col, {
        segments: s,
        field: undefined,
        text: undefined,
        expression: undefined,
      }),
    )
    return
  }
  emit('apply', patchCell(props.control, props.row, props.col, { segments: s }))
}

/** 工具栏打开/控件变化时调 rebuildSegmentsFromCell —— 一次写回 segments 并清老字段
 *
 * ★ Plan B 改造：原 ensureSegments 只在 segments 缺失时迁移；现 rebuildSegmentsFromCell
 *   在 segments 与老字段漂移时也会重新派生并 emit migrate，保证 store 在任何编辑入口
 *   （含画布 contentEditable 改文本）后都收敛到 v2 segments 单源。
 *
 *   emit 路径走 TableViewLayer 的 updateControlSilent（不进 undo 栈、不标 dirty），
 *   同时 segments 写回后会触发表格重排、cellMode 切换等链式响应。
 */
watch(
  () => cell.value,
  (c) => {
    if (!c) return
    const rebuilt = rebuildSegmentsFromCell(c)
    if (rebuilt === c) return // 幂等：segments 已是 cell 字段的精确表达
    emit(
      'migrate',
      patchCell(props.control, props.row, props.col, {
        segments: rebuilt.segments,
        text: undefined,
        field: undefined,
        expression: undefined,
        binding: undefined,
        value: undefined,
      }),
    )
  },
  { immediate: true },
)

/** 仅绑定了字段/表达式（或显式 variable/expression 模式）的单元格才需要格式（纯静态文字格式无意义） */
const canFormat = computed(
  () =>
    effectiveCell.value.contentType === 'variable' ||
    effectiveCell.value.contentType === 'expression' ||
    Boolean(effectiveCell.value.field || effectiveCell.value.expression) ||
    (props.rowKind === 'data' && Boolean(column.value?.field || column.value?.expression)),
)

/** 生效中的格式（单元格优先，回落列默认） */
const cellFormat = computed<CellFormat | undefined>(() => effectiveCell.value.format ?? column.value?.format)

/* --------------------------------- 动作 -------------------------------- */

function applyStyle(patch: TableCellStyle): void {
  emit('apply', patchCellStyle(props.control, props.row, props.col, patch))
}

function toggle(key: 'bold' | 'italic' | 'underline'): void {
  applyStyle({ [key]: !style.value[key] } as TableCellStyle)
}

const spanMax = computed(() => grid.value.colCount - props.col)
const currentSpan = computed(() => Math.min(effectiveCell.value.colSpan ?? 1, spanMax.value))

function setSpan(n: number | null): void {
  emit('apply', setCellSpan(props.control, props.row, props.col, n ?? 1))
}

/**
 * 纵向合并（rowSpan）。
 * 仅表头 / 静态 / 布局网格行生效：数据行由运行期逐条生成，跨行会跨越不同记录，语义不成立，
 * 故数据样例行（rowKind==='data'）禁用该项，与表格引擎的"模板行强制 rowSpan=1"一致。
 */
const canRowSpan = computed(() => props.rowKind !== 'data')
const rowSpanMax = computed(() => grid.value.rowCount - props.row)
const currentRowSpan = computed(() => Math.min(effectiveCell.value.rowSpan ?? 1, rowSpanMax.value))

function setRowSpan(n: number | null): void {
  if (!canRowSpan.value) return
  emit('apply', setCellRowSpan(props.control, props.row, props.col, n ?? 1))
}

function clearStyle(): void {
  emit('apply', patchCell(props.control, props.row, props.col, { style: undefined }))
}

/** 单元格斜线（课表角标等）：无 / 左上→右下 / 左下→右上 */
const diagOptions = [
  { label: '无', value: 'none' },
  { label: '↘ 右下', value: 'down' },
  { label: '↗ 右上', value: 'up' },
]
const currentDiagonal = computed<'none' | 'down' | 'up'>(() => effectiveCell.value.style?.diagonal ?? 'none')
function setDiagonal(v: 'none' | 'down' | 'up'): void {
  applyStyle({ diagonal: v === 'none' ? undefined : v })
}

function applyFormat(fmt: CellFormat | undefined): void {
  // kind='none' 视为清除，避免脏字段
  emit('apply', patchCell(props.control, props.row, props.col, { format: fmt && fmt.kind !== 'none' ? fmt : undefined }))
}

function isPresetDatePattern(p?: string): boolean {
  return Boolean(p && datePatternOptions.some((o) => o.value !== '__custom__' && o.value === p))
}

/** 行角色名（标题行 / 数据行 / 本页合计行 / 总计行 / 大写金额行），用于工具栏标签 */
const roleLabel = computed(() => {
  if (props.rowKind === 'data') return '数据行（影响整列）'
  return rowRoleLabel(buildDesignGrid(props.control), props.row)
})

/* --------------------------------- 行列插入 -------------------------------- */

function insertRowAbove(): void {
  emit('apply', insertTableRow(props.control, props.row))
}

function insertRowBelow(): void {
  emit('apply', insertTableRow(props.control, props.row + 1))
}

function insertColLeft(): void {
  emit('apply', insertTableColumn(props.control, props.col))
}

function insertColRight(): void {
  emit('apply', insertTableColumn(props.control, props.col + 1))
}

/** 删除本行 / 本列（数据表的数据样例行不可删，由 canDeleteRow 收敛） */
const canDeleteRow = computed(
  () => props.rowKind !== 'data' && grid.value.rowCount > 1,
)
const canDeleteCol = computed(() => grid.value.colCount > 1)

function deleteRow(): void {
  emit('apply', removeTableRow(props.control, props.row))
}

function deleteCol(): void {
  emit('apply', removeTableColumn(props.control, props.col))
}
</script>

<template>
  <div
    class="op-cell-toolbar"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @mousedown.stop
    @dblclick.stop
  >
    <div class="op-cell-toolbar__inner">
      <!-- 第 0 行：内容三态（固定值 / 变量 / 表达式），与文本组件完全一致 -->
      <div class="op-cell-toolbar__row">
        <span class="op-cell-toolbar__tag">内容</span>
        <ContentValueEditor
          class="op-cell-content"
          compact
          :mode="cellMode"
          :value="effectiveCell.text ?? ''"
          :binding="effectiveCell.field ?? ''"
          :expression="effectiveCell.expression ?? ''"
          :segments="effectiveCell.segments"
          :format="effectiveCell.format"
          placeholder="单元格内容"
          :binding-default="bindingDefault"
          :expression-default="expressionDefault"
          @update:mode="onCellMode"
          @update:value="onCellValue"
          @update:binding="onCellBinding"
          @update:expression="onCellExpression"
          @update:segments="onCellSegments"
        />
      </div>

      <!-- 第一行：行角色 / 字体 / 字形 / 对齐 -->
      <div class="op-cell-toolbar__row">
        <span class="op-cell-toolbar__tag">{{ roleLabel }}</span>

        <NDivider vertical />

        <NSelect
          size="tiny"
          class="w-24"
          :value="style.fontFamily ?? ''"
          :options="fontOptions"
          filterable
          @update:value="(v: string) => applyStyle({ fontFamily: v || undefined })"
        />
        <NInputNumber
          size="tiny"
          class="w-18"
          button-placement="both"
          :value="style.fontSize ?? null"
          :min="5"
          :max="72"
          :step="1"
          placeholder="9"
          @update:value="(v: number | null) => applyStyle({ fontSize: v ?? undefined })"
        />

        <NButtonGroup size="tiny">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton :type="style.bold ? 'primary' : 'default'" @click="toggle('bold')">
                <span class="font-bold">B</span>
              </NButton>
            </template>
            加粗
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton :type="style.italic ? 'primary' : 'default'" @click="toggle('italic')">
                <span class="italic font-serif">I</span>
              </NButton>
            </template>
            斜体
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton :type="style.underline ? 'primary' : 'default'" @click="toggle('underline')">
                <span class="underline">U</span>
              </NButton>
            </template>
            下划线
          </NTooltip>
        </NButtonGroup>

        <NButtonGroup size="tiny">
          <NTooltip
            v-for="a in (['left', 'center', 'right'] as const)"
            :key="a"
            trigger="hover"
          >
            <template #trigger>
              <NButton
                :type="style.align === a ? 'primary' : 'default'"
                @click="applyStyle({ align: a })"
              >
                <span :class="`i-carbon-text-align-${a}`" />
              </NButton>
            </template>
            {{ { left: '左对齐', center: '居中', right: '右对齐' }[a] }}
          </NTooltip>
        </NButtonGroup>

        <NButtonGroup size="tiny">
          <NTooltip
            v-for="v in (['top', 'middle', 'bottom'] as const)"
            :key="v"
            trigger="hover"
          >
            <template #trigger>
              <NButton
                :type="style.valign === v ? 'primary' : 'default'"
                @click="applyStyle({ valign: v })"
              >
                <span :class="`i-carbon-align-vertical-${v === 'middle' ? 'center' : v}`" />
              </NButton>
            </template>
            {{ { top: '顶端对齐', middle: '垂直居中', bottom: '底端对齐' }[v] }}
          </NTooltip>
        </NButtonGroup>
      </div>

      <!-- 第二行：文字色 / 填充色 / 合并 / 清除 -->
      <div class="op-cell-toolbar__row">
        <!-- 文字颜色：自定义触发器 + to=false 让面板留在工具栏内，避免点选时工具栏被收起 -->
        <NColorPicker
          :value="style.color ?? '#1f2329'"
          :show-alpha="false"
          :modes="['hex']"
          :to="false"
          size="small"
          @update:value="(v: string) => applyStyle({ color: v || undefined })"
        >
          <template #trigger="{ value, onClick, ref: triggerRef }">
            <NButton :ref="triggerRef" size="tiny" quaternary title="文字颜色" @click="onClick">
              <span class="i-carbon-text-color" />
              <span class="op-cell-toolbar__swatch" :style="{ background: value || '#1f2329' }" />
            </NButton>
          </template>
        </NColorPicker>

        <!-- 填充颜色（含清除） -->
        <NColorPicker
          :value="style.backgroundColor ?? '#ffffff'"
          :show-alpha="false"
          :modes="['hex']"
          :to="false"
          size="small"
          @update:value="(v: string) => applyStyle({ backgroundColor: v || undefined })"
        >
          <template #trigger="{ value, onClick, ref: triggerRef }">
            <NButton :ref="triggerRef" size="tiny" quaternary title="填充颜色" @click="onClick">
              <span class="i-carbon-paint-brush" />
              <span
                class="op-cell-toolbar__swatch"
                :style="{ background: value || 'transparent' }"
              />
            </NButton>
          </template>
        </NColorPicker>
        <NButton size="tiny" quaternary title="清除填充" @click="applyStyle({ backgroundColor: undefined })">
          <span class="i-carbon-clean" />
        </NButton>

        <NTooltip trigger="hover">
          <template #trigger>
            <NSelect
              size="tiny"
              style="width: 92px"
              :value="currentDiagonal"
              :options="diagOptions"
              @update:value="setDiagonal"
            />
          </template>
          单元格斜线（课表角标）：无 / ↘左上→右下 / ↗左下→右上
        </NTooltip>

        <NDivider vertical />

        <NTooltip trigger="hover">
          <template #trigger>
            <NInputNumber
              size="tiny"
              class="w-20"
              button-placement="both"
              :value="currentSpan"
              :min="1"
              :max="spanMax"
              :step="1"
              @update:value="setSpan"
            />
          </template>
          横向合并列数
        </NTooltip>

        <NTooltip trigger="hover">
          <template #trigger>
            <NInputNumber
              size="tiny"
              class="w-20"
              :value="currentRowSpan"
              button-placement="both"
              :min="1"
              :max="rowSpanMax"
              :step="1"
              :disabled="!canRowSpan"
              @update:value="setRowSpan"
            />
          </template>
          纵向合并行数（数据行不跨行）
        </NTooltip>

        <NDivider vertical />

        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary @click="clearStyle">
              <span class="i-carbon-clean" />
            </NButton>
          </template>
          清除本格样式
        </NTooltip>

        <NDivider vertical />

        <span class="op-cell-toolbar__tag">行列</span>
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary title="上方插入行" @click="insertRowAbove">
              <span class="i-carbon-arrow-up" />
            </NButton>
          </template>
          上方插入行
        </NTooltip>
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary title="下方插入行" @click="insertRowBelow">
              <span class="i-carbon-arrow-down" />
            </NButton>
          </template>
          下方插入行
        </NTooltip>
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary title="左侧插入列" @click="insertColLeft">
              <span class="i-carbon-arrow-left" />
            </NButton>
          </template>
          左侧插入列
        </NTooltip>
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary title="右侧插入列" @click="insertColRight">
              <span class="i-carbon-arrow-right" />
            </NButton>
          </template>
          右侧插入列
        </NTooltip>

        <NDivider vertical />

        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary :disabled="!canDeleteRow" title="删除本行" @click="deleteRow">
              <span class="i-carbon-trash-can" />
            </NButton>
          </template>
          删除本行
        </NTooltip>
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton size="tiny" quaternary :disabled="!canDeleteCol" title="删除本列" @click="deleteCol">
              <span class="i-carbon-trash-can" />
            </NButton>
          </template>
          删除本列
        </NTooltip>

        <NButton size="tiny" quaternary @click="closeToolbar">
          <span class="i-carbon-close" />
        </NButton>
      </div>

      <!-- 第三行：数据格式（仅绑定字段的单元格） -->
      <div v-if="canFormat" class="op-cell-toolbar__row op-cell-toolbar__format">
        <span class="op-cell-toolbar__tag">格式</span>
        <NSelect
          size="tiny"
          class="w-24"
          :value="cellFormat?.kind ?? 'none'"
          :options="formatKindOptions"
          @update:value="(k: CellFormatKind) => applyFormat(k === 'none' ? undefined : makeFormat(k))"
        />
        <template v-if="cellFormat && cellFormat.kind !== 'none'">
          <NSelect
            v-if="needsPattern(cellFormat.kind)"
            size="tiny"
            class="w-30"
            :value="isPresetDatePattern(cellFormat.pattern) ? cellFormat.pattern : '__custom__'"
            :options="datePatternOptions"
            @update:value="(v: string) => { if (v !== '__custom__') applyFormat({ ...cellFormat!, pattern: v }) }"
          />
          <NInput
            v-if="needsPattern(cellFormat.kind) && !isPresetDatePattern(cellFormat.pattern)"
            size="tiny"
            class="w-30"
            :value="cellFormat.pattern"
            placeholder="如 YYYY年MM月DD日"
            @update:value="(v: string) => applyFormat({ ...cellFormat!, pattern: v || 'YYYY-MM-DD' })"
          />
          <NInputNumber
            v-if="needsDigits(cellFormat.kind)"
            size="tiny"
            class="w-16"
            button-placement="both"
            :value="cellFormat.digits ?? (cellFormat.kind === 'int' ? 0 : 2)"
            :min="0"
            :max="6"
            @update:value="(v: number | null) => applyFormat({ ...cellFormat!, digits: v ?? 0 })"
          />
          <NSelect
            v-if="needsCode(cellFormat.kind)"
            size="tiny"
            class="w-20"
            :value="cellFormat.code ?? 'CNY'"
            :options="currencyCodeOptions"
            @update:value="(v: string) => applyFormat({ ...cellFormat!, code: v })"
          />
          <NSwitch
            v-if="supportsThousands(cellFormat.kind)"
            size="small"
            :value="cellFormat.thousands ?? true"
            @update:value="(v: boolean) => applyFormat({ ...cellFormat!, thousands: v })"
          />
        </template>
      </div>

      <!-- 顶部新加一行：表格属性快速面板入口（独立 row 不挤占格式操作） -->
      <div class="op-cell-toolbar__row">
        <span class="op-cell-toolbar__tag">表格</span>
        <NButton size="tiny" quaternary title="打开表格属性快速面板" @click="openTableProps">
          <template #icon><span class="i-carbon-settings" /></template>
          表格属性
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.op-cell-toolbar {
  position: absolute;
  transform: translateY(-100%) translateY(-8px);
  pointer-events: auto;
  z-index: 30;
}

.op-cell-toolbar__inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--brand-surface, #ffffff);
  border: 1px solid var(--brand-border, #e5e6eb);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  max-width: 92vw;
}

.op-cell-toolbar__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.op-cell-toolbar__tag {
  font-size: 11px;
  color: var(--brand-text-secondary, #86909c);
  padding-right: 2px;
}

.op-cell-toolbar__swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  vertical-align: middle;
}
</style>
