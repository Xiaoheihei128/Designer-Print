<script setup lang="ts">
/**
 * CodeProps —— 条码 / 二维码控件属性（§5.7）
 * 内容三态与文本一致：固定值（直接输入编码）/ 变量（弹窗选字段）/ 表达式（弹窗插函数）。
 * v2 segments：已有 segments 时切到 textarea 模式（与 TextProps 一致）。
 */
import { computed, watch } from 'vue'
import { NSelect, NSwitch } from 'naive-ui'
import type { BarcodeControl, QrcodeControl, Segment as SegmentT } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import ContentValueEditor from './ContentValueEditor.vue'
import type { ContentMode } from './ContentValueEditor.vue'
import { ensureSegments } from '@op/design/segments-migration'

const store = useDesignerStore()
const control = computed(() => store.selectedControl as BarcodeControl | QrcodeControl | null)
const isBarcode = computed(() => control.value?.type === 'barcode')

function patch(p: Record<string, unknown>): void {
  if (control.value) store.updateControl(control.value.id, p)
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
      @update:mode="onModeChange"
      @update:value="patch({ value: $event || undefined })"
      @update:binding="patch({ binding: $event })"
      @update:expression="patch({ expression: $event || undefined })"
      @update:segments="onSegmentsChange"
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
  </div>
</template>
