<script setup lang="ts">
/**
 * ContentValueEditor —— 通用「内容编辑器」（v2：3 态 + segments 多片段）
 *
 * 历史：v1 强制 3 选 1 互斥（fixed / variable / expression）—— 用户无法在同一控件里
 * 混搭字段与文字（如「12.5 kg」、「外观：{{AnalysisItem}}」）。
 *
 * v2：新增 segments 模式。当 control 上有 segments 字段时，整个 UI 切到 textarea +
 * [字段][函数]插入按钮模式；用户自由写"text + {{path}} + text"，blur 时按
 * `{{...}}` 解析为 Segment[] 发出。用户完全感知不到"3 态"概念。
 *
 * 引擎层（resolveSegments）保证老 schema 字段缺失 segments 时自动 fallback，
 * 所以 v1/v2 共存于同一渲染路径。父级 4 处共用此组件（TextProps / CodeProps /
 * CellToolbar 等），由 Properties Panel watch 时调 ensureSegments 触发 lazy 迁移。
 *
 * ★ Bug 修复：支持从左栏字段树直接拖到 textarea 插入 {{path}}。
 *   老实现没有 drop handler，浏览器原生 drop 把裸字段名（如 Header.SupplierName）
 *   插入 textarea，segments 模式 parse 失败 / 用户拿到裸字符串没 {{}} 包裹，
 *   渲染层 resolveBinding 找不到 → 字段值丢了。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NPopover, NRadioButton, NRadioGroup, NTag } from 'naive-ui'
import type { CellFormat, Segment } from '@op/types/control'
import { resolveSegments } from '@op/core/layout-engine/segments'
import { isAggToken } from '@op/core/layout-engine/aggregate'
import { EXPRESSION_CATALOG } from '@op/design/expression-catalog'
import { segmentsToText, textToSegments } from '@op/design/text-segments'
import VariableModal from './VariableModal.vue'
import ExpressionModal from './ExpressionModal.vue'
import { isAutoMigratedFieldOnly } from './content-value-helpers'
import { insertFieldAt } from './content-value-insert'
import { DRAG_BINDING_KEY } from '@op/design/hooks/useDragAdd'

export type ContentMode = 'fixed' | 'variable' | 'expression'

/** 表达式输入框占位（避免模板里出现字面 {{ 干扰 Vue 编译器，故用脚本常量） */
const exprPlaceholder = "{{order.total | currency:'CNY'}}"
const segmentsPlaceholder = '例如：外观：{{ReportItems[].AnalysisItem}} kg'

const props = withDefaults(
  defineProps<{
    /** 旧 3 态模式（v1 兼容） */
    mode?: ContentMode
    /** 固定值文本 */
    value?: string
    /** 变量字段路径 */
    binding?: string
    /** 表达式源码 */
    expression?: string
    /** v2：内容片段数组。提供时整个 UI 切到 segments 模式（textarea + 字段/函数插入） */
    segments?: Segment[]
    /** 控件级默认 format（segments 模式下，field 段未指定 format 时回退到此） */
    format?: CellFormat
    /** 固定值输入占位 */
    placeholder?: string
    /** 固定值单行输入（条码/二维码/单元格）；默认多行 textarea（文本） */
    singleLine?: boolean
    /** compact：radio 与输入并排一行（表格单元格浮动工具栏用） */
    compact?: boolean
    /** 切到「固定值」且值为空时自动填入 */
    fixedDefault?: string
    /** 切到「变量」且路径为空时自动填入 */
    bindingDefault?: string
    /** 切到「表达式」且为空时自动填入 */
    expressionDefault?: string
    /** segments 模式 textarea 行数（默认 3） */
    segmentsRows?: number
  }>(),
  {
    mode: undefined,
    value: '',
    binding: '',
    expression: '',
    segments: undefined,
    format: undefined,
    placeholder: '内容',
    singleLine: false,
    compact: false,
    fixedDefault: '',
    bindingDefault: '',
    expressionDefault: '',
    segmentsRows: 3,
  },
)

const emit = defineEmits<{
  (e: 'update:mode', v: ContentMode): void
  (e: 'update:value', v: string): void
  (e: 'update:binding', v: string): void
  (e: 'update:expression', v: string): void
  (e: 'update:segments', v: Segment[]): void
}>()

const varModalShow = ref(false)
const exprModalShow = ref(false)
const aggPopoverShow = ref(false)

/* ----------------------------- 聚合 token 入口 ----------------------------- */

/** 从目录里挑出聚合 token（带 # 的 8 个），供 segments 模式 toolbar 一键插入 */
const aggTokens = computed(() => {
  const cat = EXPRESSION_CATALOG.find((c) => c.key === 'aggregate-token')
  return cat?.items ?? []
})

/** 把聚合 token（如 `{{#totalCap}}`）插入到当前 segmentsText，并触发 blur 写回
 *
 * 关键语义：**聚合 token 一律替换**。理由：
 * - 聚合 token 单独成 cell，不与字面文字混搭（{{#pageSum}} 后缀「元」无意义）
 * - 旧 schema 残留（{{order.total}} 默认值）若不替换，会拼成
 *   `{{order.total}}{{#totalCap}}` —— 前段 resolveBinding('order.total') 返回空，
 *   渲染时画布看上去"没变"（用户视角 bug）
 * - segments 模式下若用户已手写文本，仍追加（用户明确写了前缀文字说明他要组合）
 */
function insertAggToken(snippet: string): void {
  aggPopoverShow.value = false
  if (isSegmentsMode.value) {
    // 已有手写文本 → 追加；空 → 填新
    segmentsText.value = segmentsText.value ? segmentsText.value + snippet : snippet
    onSegmentsBlur()
    return
  }
  // 3 态模式：始终替换为纯 token（不与旧 expression 字面量拼接）
  segmentsText.value = snippet
  onSegmentsBlur()
}

/* -------------------------------- segments 模式 -------------------------------- */

/** segmentsToText / textToSegments 由 @op/design/text-segments 提供（共享给画布反向同步用） */

/**
 * 是否在 segments 模式：segments 字段存在且非空数组。
 *
 * 判定：length > 0 优先（不要 Array.isArray）。理由：
 * - textToSegments('') 在 text-segments.ts 已统一返回 []（空白输入归零），
 *   legacyToSegments 在 segments.ts 对空/纯空白 text 也返回 null（不再生成 [{text:""}]）
 *   —— 因此 cell.segments 不会留下 [{text:""}] 这种脏数据，可以安全地让 length=0
 *   视为"已退出 segments 模式"。
 * - 旧版"Array.isArray 包含空数组"的判定会卡死用户：segments=[] 时 cellMode 永远返回
 *   undefined → 3 态 radio 不渲染 → 用户无法切回 fixed/variable/expression。
 *   这是 mode 切换死锁的真因。回退到 length > 0 让用户清空后能正常切回 3 态模式。
 *
 * 状态机：
 * - undefined → v1 老模板（未迁移到 v2），3 态模式
 * - [] → 用户刚清空，3 态模式（contentType 保留）
 * - [...] → v2 segments 模式
 */
const isSegmentsMode = computed(() => Array.isArray(props.segments) && props.segments.length > 0)

const segmentsText = ref('')
/**
 * 用户是否正在 textarea 里编辑。focus 时设 true，blur 时设 false。
 *
 * ★ v2 反向同步关键守卫：watch(() => props.segments) 只在"非编辑中"时回填
 * segmentsText。否则画布反向同步（fabric editing:exited → handleCanvasTextEdited
 * → store.updateControlSilent → props.segments 引用变 → watch 触发）会把用户
 * 正在键入但还没 blur 的字符覆盖回"权威值"，用户看到"输入即被覆盖"。
 *
 * blur 时 onSegmentsBlur 会正常 emit('update:segments') 把用户编辑结果写回
 * store；watch 顺序是：用户输入 → onSegmentsInput(v) → segmentsText 同步 →
 * 失焦 → onSegmentsBlur() → emit → 父组件 store.updateControl → store 替换
 * → props.segments 引用变 → isUserEditing 已 false → watch 回填 segmentsText
 * 为新权威值（与用户输入一致），闭环。
 */
const isUserEditing = ref(false)
function onSegmentsFocus(): void {
  isUserEditing.value = true
}
watch(
  () => props.segments,
  (segs) => {
    // 同步回填条件：segments 模式（非空数组）且非编辑中
    // 注：segments=[] 时 UI 走 3 态模式（radio 重新出现），textarea 不渲染，回填无意义
    if (Array.isArray(segs) && segs.length > 0 && !isUserEditing.value) {
      segmentsText.value = segmentsToText(segs)
    }
  },
  { immediate: true },
)

/** textarea 内容变更：暂存本地，blur 时再 parse → emit update:segments */
function onSegmentsInput(v: string): void {
  segmentsText.value = v
}
function onSegmentsBlur(): void {
  isUserEditing.value = false // ★ 守卫解除，下次 props.segments 变化允许 watch 回填
  const next = textToSegments(segmentsText.value)
  emit('update:segments', next)
  // v1 老 schema 字段（value/binding/expression）的清空由各父组件在自己的
  // onSegmentsChange / onCellSegments 中根据 segments 是否为空决定（合并到
  // 同一份 patch 中），避免 ContentValueEditor 在一次 blur 内连发多次独立
  // emit（segments + value + binding + expression），后者在 CellToolbar 中
  // 会因为 props.control 是上一次响应式快照而被后续 emit 用旧 segments
  // 覆盖，导致"清空 textarea 不生效"。
}

/* ----------------------------- 字段 drop 入口 ----------------------------- */

/**
 * 从左栏字段树拖到 segments textarea 的处理：识别 binding mime 后把 {{path}} 插入
 * 当前光标位置（不是简单 append），保留光标位置让用户继续输入。
 *
 * 不影响"非 segments 模式"：v1 行为下用户的 binding 字段是单独的 input，dragstart
 * 自带 select-list 拖出行为不进入此 textarea。
 *
 * 纯逻辑拆出到 ./content-value-insert.ts 便于测试；本函数负责 DOM 副作用：
 * preventDefault、读写 textarea selectionStart/End、emit 写回 store。
 *
 * ★ Bug 修复：监听器挂在 wrap `<div class="segments-drop-host">` 上（@drop 冒泡），
 *   `e.currentTarget` 是 div，没有 selectionStart/End —— 旧版 `?? segmentsText.value.length`
 *   fallback 让 start/end 永远是字符串末尾，drop 字段总被 append 而不是插入光标位置。
 *   修复：从 `e.target` 反查最近的 `<textarea>` DOM 节点（drop event 实际落点是 textarea）；
 *   找不到时退回 `document.activeElement`（drop 命中时焦点元素通常就是 textarea）。
 */
function findTextarea(e: DragEvent): HTMLTextAreaElement | null {
  const target = e.target as HTMLElement | null
  // 1) 从 drop event target 向上找
  if (target) {
    const ta = target.closest?.('textarea') as HTMLTextAreaElement | null
    if (ta) return ta
  }
  // 2) 回退到 document.activeElement（drag-and-drop 时焦点通常在 textarea 上）
  const active = document.activeElement
  if (active && active.tagName === 'TEXTAREA') return active as HTMLTextAreaElement
  return null
}
function onSegmentsTextareaDrop(e: DragEvent): void {
  const path = e.dataTransfer?.getData(DRAG_BINDING_KEY)
  if (!path) return // 不是字段拖拽，让浏览器原生处理（其他应用文本拖入场景）
  e.preventDefault()
  const ta = findTextarea(e)
  if (!ta) return // 没有 textarea 目标 → 不处理
  isUserEditing.value = true // 防止 watch 在 drop→blur 之间把权威值回填覆盖
  const start = ta.selectionStart ?? segmentsText.value.length
  const end = ta.selectionEnd ?? segmentsText.value.length
  const { next, caret } = insertFieldAt(segmentsText.value, end, path, start)
  segmentsText.value = next
  // 失焦后回写到 store
  onSegmentsBlur()
  // 焦点留给用户（drop 后焦点仍在 textarea 上），调整光标到插入末尾
  // 注意：下一帧执行，避免 textarea.value 还没 commit 的潜在时序问题
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(caret, caret)
  })
}

/** dragover 必须 preventDefault 才能允许 drop，否则浏览器显示禁止"光标 */
function onSegmentsTextareaDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes(DRAG_BINDING_KEY)) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}

/** 实时预览：用 sample ctx 调 resolveSegments。空字段段解为空是预期的。 */
const segmentsPreview = computed(() => {
  if (!isSegmentsMode.value) return ''
  const r = resolveSegments(props.segments, { data: { _: '预览' } })
  return r.text || '(空)'
})

/* -------------------------------- 旧 3 态模式 -------------------------------- */

/** 用户点「类型」radio：通知父级切模式，并给新模式填充默认值（仅当该字段为空） */
function onModeChange(m: ContentMode): void {
  // ★ 不再自动 emit 默认值：用户主动切 mode 时不强制填第一个字段。
  //   老的「自动回填 bindingDefault」会让用户删了 binding 后又被默认填回，
  //   也让"右键表格左键单元格选变量"立刻绑上字段树第一个字段。改为只 emit mode，
  //   由用户主动从字段树 / VariableModal 选字段。
  emit('update:mode', m)
}

/**
 * 当前 segments 是否处于「legacy field 自动迁移」状态（Bug8 修复）：
 * - 仅 1 个 field 段，且 cell.field 与之匹配
 * - cell.text / cell.expression 为空（用户没有手写文本）
 *
 * 这种状态下用户重选字段的意图是**换绑**而不是「在原字段后再追加」。
 * 如果走 segments 追加路径，cell.field 不变，画布仍显示旧字段占位符
 * （典型症状：「固定尾行绑了字段，画布一直显示 item.order.orderNo」）。
 */
const isAutoMigratedField = computed(() =>
  isAutoMigratedFieldOnly({
    segments: props.segments,
    field: props.binding,
    value: props.value,
    expression: props.expression,
  }),
)

/** [字段] 按钮：在 textarea 末尾插入 {{path}}（shim：VariableModal emit 裸 path）
 *  v2 改进：当前控件已存在非空 value/expression 时，自动切到 segments 模式，
 *  把遗留字面文本作为 text 段保留 + 新字段追加 —— 用户输入"文本"后拖字段，
 *  直接得到 segments=[{text,'文本'},{field,'xxx'}]，渲染为"文本字段值"。
 *  否则按 v1 行为：写入 binding 字段（变量模式覆盖式）。
 *
 *  Bug8 修复：检测到 segments 是从 legacy field 自动迁移的「单 field 段 + field 匹配」
 *  状态时（用户尚未主动编辑文本），走覆盖路径——同步更新 cell.field 与 segments，
 *  避免新字段被追加到老 field 之后、画布仍显示旧占位符的问题。
 */
function onVarConfirm(path: string): void {
  // Bug8：自动迁移态 → 直接覆盖 cell.field，不走 segments 追加
  if (isAutoMigratedField.value) {
    const segs: Segment[] = [{ kind: 'field', path }]
    emit('update:mode', 'variable')
    emit('update:binding', path)
    emit('update:segments', segs)
    return
  }

  // 已是 segments 模式 → 追加
  if (isSegmentsMode.value) {
    segmentsText.value = segmentsText.value + `{{${path}}}`
    onSegmentsBlur()
    return
  }

  // 检测遗留字面文本（fixed-value 或 expression）
  const leftover = ((props.value ?? '') || (props.expression ?? '')).trim()
  if (leftover && leftover !== path) {
    // 切到 segments 模式：保留旧内容为 text 段 + 新字段段
    const segs: Segment[] = [{ kind: 'text', value: leftover }, { kind: 'field', path }]
    emit('update:segments', segs)
    return
  }

  // 默认：v1 行为（变量模式覆盖式）
  emit('update:mode', 'variable')
  emit('update:binding', path)
}

/** [函数] 按钮：插入 snippet（shim：ExpressionModal emit 已 {{ }} 包裹或裸字符串） */
function onExprConfirm(snippet: string): void {
  if (isSegmentsMode.value) {
    const wrapped = snippet.startsWith('{{') && snippet.endsWith('}}') ? snippet : `{{${snippet}}}`
    segmentsText.value = segmentsText.value + wrapped
    onSegmentsBlur()
    return
  }
  emit('update:mode', 'expression')
  emit('update:expression', snippet)
}

/* -------------------------------- 模板 -------------------------------- */
</script>

<template>
  <div class="content-value-editor" :class="{ compact }">
    <!-- segments 模式（v2）：textarea + 字段/函数插入按钮 + 实时预览 -->
    <template v-if="isSegmentsMode">
      <div class="props-row">
        <!--
          ★ 拖字段插入 {{path}}：包一层让 dragover/drop 事件冒泡到当前节点
          （naive-ui 内部 textarea 不暴露 ref；包 div 拦截更可靠）。
          @dragover.prevent 是关键 —— 不 preventDefault 浏览器显示"禁止"光标、
          drop 事件压根不会触发。普通文本拖入仍走原生 textarea 行为。
        -->
        <div
          class="segments-drop-host"
          @dragover="onSegmentsTextareaDragOver"
          @drop="onSegmentsTextareaDrop"
        >
          <NInput
            type="textarea"
            size="small"
            :autosize="{ minRows: segmentsRows, maxRows: segmentsRows + 3 }"
            :value="segmentsText"
            :placeholder="placeholder || segmentsPlaceholder"
            @update:value="onSegmentsInput"
            @focus="onSegmentsFocus"
            @blur="onSegmentsBlur"
          />
        </div>
      </div>
      <div class="props-row content-value-row mt-1">
        <NTag :bordered="false" size="small" type="info">
          {{ props.segments!.length }} 个片段
        </NTag>
        <NButton size="small" @click="varModalShow = true">
          <template #icon><span class="i-carbon-list-dropdown" /></template>
          字段
        </NButton>
        <NButton size="small" @click="exprModalShow = true">
          <template #icon><span class="i-carbon-function" /></template>
          函数
        </NButton>
        <!-- 聚合 token：合计行专用，免手敲 #（Bug3 修复：用户漏打 # 找不到聚合函数） -->
        <NPopover
          v-model:show="aggPopoverShow"
          trigger="manual"
          placement="bottom-start"
          :show-arrow="false"
          style="padding: 8px 4px"
        >
          <template #trigger>
            <NButton size="small" type="warning" ghost @click="aggPopoverShow = !aggPopoverShow">
              <template #icon><span class="i-carbon-sigma" /></template>
              聚合
            </NButton>
          </template>
          <div class="agg-popover">
            <div class="agg-popover-title">合计行 token（带 # 前缀）</div>
            <div class="agg-popover-grid">
              <button
                v-for="t in aggTokens"
                :key="t.id"
                type="button"
                class="agg-chip"
                :title="t.description + (t.note ? '\n' + t.note : '')"
                @click="insertAggToken(t.snippet)"
              >
                {{ t.label }}
              </button>
            </div>
            <div class="agg-popover-tip">点击即插入；大写 token 须紧跟 sum 行</div>
          </div>
        </NPopover>
        <span class="props-tip" v-if="segmentsPreview">预览：{{ segmentsPreview }}</span>
      </div>
    </template>

    <!-- 旧 3 态模式（v1 兼容，老模板走这里） -->
    <template v-else>
      <!-- 独立类型行（非 compact） -->
      <div v-if="!compact" class="props-row">
        <span class="props-label">类型</span>
        <NRadioGroup size="small" :value="mode" @update:value="onModeChange">
          <NRadioButton value="fixed">固定值</NRadioButton>
          <NRadioButton value="variable">变量</NRadioButton>
          <NRadioButton value="expression">表达式</NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 值行：compact 时 radio 并排，否则仅输入 + 按钮 -->
      <div class="props-row content-value-row" :class="{ 'mt-1': !compact }">
        <NRadioGroup v-if="compact" size="small" :value="mode" @update:value="onModeChange">
          <NRadioButton value="fixed">固定值</NRadioButton>
          <NRadioButton value="variable">变量</NRadioButton>
          <NRadioButton value="expression">表达式</NRadioButton>
        </NRadioGroup>

        <NInput
          v-if="mode === 'fixed'"
          :type="singleLine ? 'text' : 'textarea'"
          size="small"
          :autosize="singleLine ? undefined : { minRows: 3, maxRows: 4 }"
          :value="value"
          :placeholder="placeholder"
          @update:value="emit('update:value', $event)"
        />
        <NInput
          v-else-if="mode === 'variable'"
          size="small"
          :value="binding"
          placeholder="字段路径，如 order.orderNo"
          @update:value="emit('update:binding', $event)"
        />
        <NInput
          v-else
          size="small"
          :value="expression"
          :placeholder="exprPlaceholder"
          @update:value="emit('update:expression', $event)"
        />

        <NButton v-if="mode === 'variable'" size="small" @click="varModalShow = true">
          <template #icon><span class="i-carbon-list-dropdown" /></template>
          选择字段
        </NButton>
        <NButton v-else-if="mode === 'expression'" size="small" @click="exprModalShow = true">
          <template #icon><span class="i-carbon-function" /></template>
          插入函数
        </NButton>
      </div>
    </template>

    <VariableModal v-model:show="varModalShow" :binding="binding ?? ''" @confirm="onVarConfirm" />
    <ExpressionModal v-model:show="exprModalShow" :expression="expression ?? ''" @confirm="onExprConfirm" />
  </div>
</template>

<style scoped>
.content-value-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.content-value-row :deep(.n-input) {
  flex: 1 1 auto;
  min-width: 0;
}
.compact .content-value-row {
  margin-bottom: 0;
}
/* 拖拽宿主机：包一层让 dragover/drop 拦截生效，不影响内部 textarea 布局 */
.segments-drop-host {
  display: contents;
}
.props-tip {
  font-size: 12px;
  color: var(--n-text-color-3, #666);
}
.agg-popover {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
}
.agg-popover-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3, #888);
}
.agg-popover-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.agg-chip {
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 4px;
  background: rgba(255, 167, 0, 0.06);
  color: inherit;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.15s, border-color 0.15s;
}
.agg-chip:hover {
  background: rgba(255, 167, 0, 0.18);
  border-color: var(--brand-primary, #ffa500);
}
.agg-popover-tip {
  font-size: 11px;
  color: var(--n-text-color-3, #888);
  border-top: 1px dashed rgba(127, 127, 127, 0.2);
  padding-top: 4px;
}
</style>