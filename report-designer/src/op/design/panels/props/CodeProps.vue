<script setup lang="ts">
/**
 * CodeProps —— 条码 / 二维码控件属性（§5.7）
 * 内容三态与文本一致：固定值（直接输入编码）/ 变量（弹窗选字段）/ 表达式（弹窗插函数）。
 * v2 segments：已有 segments 时切到 textarea 模式（与 TextProps 一致）。
 *
 * PR-A 扩展：cell 内尺寸可调 —— barcode 面板暴露 display.widthMm / heightMm / lockRatio
 * PR-D 改：二维码 改用「倍率」(scaleFactor) 控制 —— 因为 QR 永远 1:1,调宽高不直观
 *   单源模块 [qr-scale.ts](@op/core/layout-engine/qr-scale)
 *   UI 控件 [QrScaleInput.vue](./QrScaleInput) —— NSlider + NInputNumber 配对(8 档 0.5/1/.../3)
 */
import { computed, watch } from 'vue'
import { NButton, NInputNumber, NSelect, NSwitch } from 'naive-ui'
import type { BarcodeControl, QrcodeControl, Segment as SegmentT, CellFormat, SegmentDisplayOpts } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import ContentValueEditor from './ContentValueEditor.vue'
import type { ContentMode } from './ContentValueEditor.vue'
import { ensureSegments } from '@op/design/segments-migration'
import { QR_BASE_MM, normalizeQrScale } from '@op/core/layout-engine/qr-scale'
import QrScaleInput from './QrScaleInput.vue'

const store = useDesignerStore()
const control = computed(() => store.selectedControl as BarcodeControl | QrcodeControl | null)
const isBarcode = computed(() => control.value?.type === 'barcode')

/** 首卡行上下文：当本控件在 LabelGrid 内时,弹窗顶部多展示 row.* 分组 */
const hostLabelGrid = computed(() =>
  control.value ? store.findAncestorLabelGrid(control.value.id) : null,
)

function patch(p: Record<string, unknown>): void {
  if (control.value) store.updateControl(control.value.id, p)
}

/**
 * 写回 display 字段的 helper。display 可能不存在(undefined),首次写入时建空对象。
 * patchDisplay({widthMm: 40}) → c.display = { ...c.display, widthMm: 40 }
 * patchDisplay({widthMm: undefined}) → 删除 widthMm 字段(走默认兜底)
 *
 * ★ PR-D:支持 scaleFactor(QR 倍率),仅 QR 形态有意义
 */
function patchDisplay(p: {
  widthMm?: number | undefined
  heightMm?: number | undefined
  lockRatio?: boolean | undefined
  scaleFactor?: number | undefined
}): void {
  const c = control.value
  if (!c) return
  const cur: SegmentDisplayOpts = c.display ?? {}
  const next: SegmentDisplayOpts = { ...cur }
  if ('widthMm' in p) {
    if (p.widthMm === undefined) delete next.widthMm
    else next.widthMm = p.widthMm
  }
  if ('heightMm' in p) {
    if (p.heightMm === undefined) delete next.heightMm
    else next.heightMm = p.heightMm
  }
  if ('lockRatio' in p) {
    if (p.lockRatio === undefined) delete next.lockRatio
    else next.lockRatio = p.lockRatio
  }
  if ('scaleFactor' in p) {
    if (p.scaleFactor === undefined) delete next.scaleFactor
    else next.scaleFactor = p.scaleFactor
  }
  patch({ display: next })
}

const contentMode = computed<ContentMode | undefined>(() => {
  const c = control.value
  if (!c) return undefined
  // v2: 已有非空 segments → 返回 undefined 让 ContentValueEditor 切到 segments 模式
  // 注：segments=[] 视为"用户刚清空"——回退到 3 态模式让 radio 重新可见
  if (Array.isArray(c.segments) && c.segments.length > 0) return undefined
  if (c.contentType) return c.contentType
  // barcode/qrcode 三态不对称：不识别 expression 字段（与 legacyToSegments 对齐）
  return c.binding ? 'variable' : 'fixed'
})

/** 模式切换：写 contentType + 清空其它两个字段（默认值由 ContentValueEditor 注入） */
function onModeChange(m: ContentMode): void {
  if (!control.value) return
  if (m === 'fixed') patch({ contentType: 'fixed', binding: undefined, expression: undefined })
  else if (m === 'variable') patch({ contentType: 'variable', expression: undefined })
  else patch({ contentType: 'expression', binding: undefined })
}

/** v2: segments 回写
 *
 * ★ 关键修复：segments 清空（length=0 或全部为空 text 段）时同步清除 v1 老字段
 *   （value/binding/expression），合并到同一份 patch —— 避免之前由
 *   ContentValueEditor blur 连续 emit update:segments + update:value 等多次
 *   事件造成的多次独立 patch 之间出现「segments 已清但 v1 字段未清」的不一致
 *   状态，legacy fallback 又把旧字段渲染出来。
 *
 *   注：barcode/qrcode 不识别 expression 字段（与 legacyToSegments 对齐），
 *   但 patch 仍可写 expression:undefined 作为兜底，避免将来扩展时遗漏。
 */
function onSegmentsChange(s: SegmentT[]): void {
  const segsIsEmpty =
    s.length === 0 || s.every((seg) => seg.kind === 'text' && !seg.value)
  if (segsIsEmpty) {
    patch({
      segments: s,
      value: undefined,
      binding: undefined,
      expression: undefined,
    })
    return
  }
  patch({ segments: s })
}

/**
 * ★ Commit 7:段级 format 写回 —— 控件级 CodeProps 接形态段不太常用(顶层控件本身就有 format 字段),
 * 但 segments 内 field 段仍可附加形态(如混排「前缀 text + 字段 qrcode 段」)。
 * 写回逻辑与 TextProps 一致:map segments,在 segIdx 字段段上合并 format。
 */
function onSegmentFormatChange(segIdx: number, format: CellFormat | undefined): void {
  const cur = control.value?.segments
  if (!cur) return
  const next = cur.map((s, i) =>
    i === segIdx && s.kind === 'field' ? { ...s, format } : s,
  )
  patch({ segments: next })
}

/** Properties Panel 打开/控件变化时调 ensureSegments —— 老 schema lazy 迁移（不进 undo 栈） */
watch(
  () => control.value,
  (c) => {
    if (!c) return
    const next = ensureSegments(c)
    if (next !== c) {
      store.updateControlSilent(c.id, next as unknown as Record<string, unknown>)
    }
  },
  { immediate: true },
)

const barcodeFormats = [
  { label: 'CODE128', value: 'CODE128' },
  { label: 'EAN-13', value: 'EAN13' },
  { label: 'EAN-8', value: 'EAN8' },
  { label: 'CODE39', value: 'CODE39' },
  { label: 'ITF-14', value: 'ITF14' },
  { label: 'UPC-A', value: 'UPCA' },
]

/* ============================== PR-A/D 尺寸控件 ============================== */

/** 当前 display 字段（可能 undefined —— 老控件没设过） */
const currentDisplay = computed<SegmentDisplayOpts | undefined>(() => control.value?.display)

/** 控件自身的 width/height（来自 Box，用于"适应控件宽度"按钮） */
const controlBox = computed(() => {
  const c = control.value
  return c ? { width: (c as any).width, height: (c as any).height } : null
})

/** "适应控件宽度"按钮(barcode) —— 把 display.widthMm 设为控件宽度,heightMm 按 lockRatio 同步
 *  顶层面板无 cell 列宽上下文,这是 PR-A 的兜底(精准的"适应列宽"留作后续)
 */
function fitControlWidth(): void {
  const box = controlBox.value
  if (!box) return
  const lock = currentDisplay.value?.lockRatio ?? false
  const curH = currentDisplay.value?.heightMm
  let nextH = curH
  if (lock && typeof curH === 'number' && box.width) {
    // 按当前宽高比例缩放
    nextH = Math.round((curH / (currentDisplay.value?.widthMm ?? curH ?? 1)) * box.width * 10) / 10
  }
  patchDisplay({ widthMm: box.width, heightMm: nextH })
}

/** ★ PR-D:"适应控件宽度"按钮(QR) —— 反推 scaleFactor = box.width / QR_BASE_MM */
function fitQrToControlWidth(): void {
  const box = controlBox.value
  if (!box?.width) return
  const sf = normalizeQrScale(box.width / QR_BASE_MM)
  if (sf !== undefined) patchDisplay({ scaleFactor: sf })
}

/** "重置尺寸"按钮(barcode) —— 清空 widthMm/heightMm,renderer 回退到默认撑满 cell 行为 */
function resetDisplay(): void {
  patchDisplay({ widthMm: undefined, heightMm: undefined })
}

/** ★ PR-D:"重置尺寸"按钮(QR) —— 清空 scaleFactor,renderer 回退到默认撑满 */
function resetQrDisplay(): void {
  patchDisplay({ scaleFactor: undefined })
}
</script>

<template>
  <div v-if="control" class="props-section">
    <div class="props-title">{{ isBarcode ? '条码设置' : '二维码设置' }}</div>

    <ContentValueEditor
      :mode="contentMode"
      :value="control.value ?? ''"
      :binding="control.binding ?? ''"
      :expression="(control as BarcodeControl | QrcodeControl).expression ?? ''"
      :segments="control.segments"
      placeholder="编码内容"
      single-line
      binding-default="order.orderNo"
      :expression-default="'{{order.orderNo}}'"
      format-scope="code"
      :host-label-grid="hostLabelGrid"
      @update:mode="onModeChange"
      @update:value="patch({ value: $event || undefined })"
      @update:binding="patch({ binding: $event })"
      @update:expression="patch({ expression: $event || undefined })"
      @update:segments="onSegmentsChange"
      @update:segmentFormat="onSegmentFormatChange"
    />

    <template v-if="isBarcode">
      <div class="props-row">
        <span class="props-label">格式</span>
        <NSelect
          size="small"
          :value="(control as BarcodeControl).format ?? 'CODE128'"
          :options="barcodeFormats"
          @update:value="patch({ format: $event })"
        />
      </div>
      <div class="props-row">
        <span class="props-label">显示文字</span>
        <NSwitch
          size="small"
          :value="(control as BarcodeControl).showText ?? true"
          @update:value="patch({ showText: $event })"
        />
      </div>
    </template>

    <div v-else class="props-row">
      <span class="props-label">纠错级</span>
      <NSelect
        size="small"
        :value="(control as QrcodeControl).errorLevel ?? 'M'"
        :options="[
          { label: 'L（7%）', value: 'L' },
          { label: 'M（15%）', value: 'M' },
          { label: 'Q（25%）', value: 'Q' },
          { label: 'H（30%）', value: 'H' },
        ]"
        @update:value="patch({ errorLevel: $event })"
      />
    </div>

    <!-- ★ PR-A/D:尺寸可调 —— 在 cell 约束内调整条码/二维码渲染尺寸 -->
    <!-- PR-D:QR 改用「倍率」(scaleFactor),barcode 维持 widthMm/heightMm/lockRatio -->
    <div class="display-section">
      <div class="props-subtitle">尺寸（cell 内可调）</div>

      <!-- ★ PR-D:QR 倍率(NSlider + NInputNumber 配对) -->
      <template v-if="!isBarcode">
        <QrScaleInput
          :value="currentDisplay?.scaleFactor"
          @change="(v) => patchDisplay({ scaleFactor: v })"
        />
        <div class="props-row props-row-buttons">
          <NButton size="small" @click="fitQrToControlWidth">适配控件宽度</NButton>
          <NButton size="small" quaternary @click="resetQrDisplay">重置</NButton>
        </div>
        <div class="props-tip">
          基准 1× = 30mm。设为 0.5× 即 15mm，3× 即 90mm。扫码距离与可读性取折中。
        </div>
      </template>

      <!-- PR-A:barcode 宽/高/锁定比例 -->
      <template v-else>
        <div class="props-row">
          <span class="props-label">宽度</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="currentDisplay?.widthMm"
            :min="0"
            :step="1"
            placeholder="自动"
            @update:value="(v) => patchDisplay({ widthMm: v ?? undefined })"
          />
          <span class="props-unit">mm</span>
        </div>
        <div class="props-row">
          <span class="props-label">高度</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="currentDisplay?.heightMm"
            :min="0"
            :step="1"
            placeholder="自动"
            @update:value="(v) => patchDisplay({ heightMm: v ?? undefined })"
          />
          <span class="props-unit">mm</span>
        </div>
        <div class="props-row">
          <span class="props-label">锁定比例</span>
          <NSwitch
            size="small"
            :value="currentDisplay?.lockRatio ?? false"
            @update:value="patchDisplay({ lockRatio: $event })"
          />
        </div>
        <div class="props-row props-row-buttons">
          <NButton size="small" @click="fitControlWidth">适应控件宽度</NButton>
          <NButton size="small" quaternary @click="resetDisplay">重置</NButton>
        </div>
        <div class="props-tip">
          留空则按 cell 内容区自动撑满。锁定比例后只设一维,另一维按自然比例自动算。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.display-section {
  border-top: 1px dashed rgba(127, 127, 127, 0.2);
  padding-top: 8px;
  margin-top: 8px;
}
.props-subtitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text-color-3, #888);
  margin-bottom: 6px;
}
.props-row-buttons {
  gap: 6px;
}
.props-unit {
  font-size: 11px;
  color: var(--n-text-color-3, #888);
  min-width: 24px;
  text-align: left;
}
.props-tip {
  font-size: 11px;
  color: var(--n-text-color-3, #888);
  line-height: 1.5;
  padding: 4px 0;
}
</style>