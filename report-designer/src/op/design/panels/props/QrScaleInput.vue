<script setup lang="ts">
/**
 * QrScaleInput —— PR-D 二维码倍率输入控件(NSlider + NInputNumber 配对)
 *
 * 复用模式:参考 SignaturePadModal.vue:296-312 画笔粗细的 NSlider + NInputNumber 配对样式。
 * 单源常量:[qr-scale.ts](@op/core/layout-engine/qr-scale) 的 QR_SCALE_* / normalizeQrScale。
 *
 * 行为:
 * - v-model:value 传入当前 scaleFactor(可 undefined,视为 1)
 * - @change(scaleFactor):emit 标准化后的值,父组件写回 display.scaleFactor
 * - NSlider marks 显示「0.5×/1×/1.5×/.../3×」
 * - NInputNumber 精确输入(step 0.5,precision 1)
 *
 * 边界:
 * - 输入 < MIN 或 > MAX 时,normalizeQrScale 自动 clamp
 * - 输入非数字/NaN → 不 emit
 */
import { computed } from 'vue'
import { NInputNumber, NSlider } from 'naive-ui'
import {
  QR_SCALE_MAX,
  QR_SCALE_MIN,
  QR_SCALE_OPTIONS,
  QR_SCALE_STEP,
  normalizeQrScale,
} from '@op/core/layout-engine/qr-scale'

interface Props {
  /** 当前 scaleFactor(undefined 视为 1) */
  value?: number
  /** label 文本,默认「倍率」 */
  label?: string
}
const props = withDefaults(defineProps<Props>(), {
  label: '倍率',
})

const emit = defineEmits<{
  (e: 'change', v: number): void
}>()

/** 滑块 marks:{0.5: '0.5×', 1: '1×', ...} */
const sliderMarks = computed(() => {
  const m: Record<number, string> = {}
  for (const v of QR_SCALE_OPTIONS) {
    m[v] = `${v}×`
  }
  return m
})

/** 当前滑块值(undefined → 1×) */
const sliderValue = computed(() => normalizeQrScale(props.value) ?? 1)

function onSliderUpdate(v: number): void {
  const normalized = normalizeQrScale(v)
  if (normalized !== undefined) emit('change', normalized)
}

function onInputUpdate(v: number | null): void {
  if (v === null) return
  const normalized = normalizeQrScale(v)
  if (normalized !== undefined) emit('change', normalized)
}
</script>

<template>
  <div class="props-row props-row-slider">
    <span class="props-label">{{ label }}</span>
    <NSlider
      :value="sliderValue"
      :min="QR_SCALE_MIN"
      :max="QR_SCALE_MAX"
      :step="QR_SCALE_STEP"
      :marks="sliderMarks"
      style="flex: 1; margin-right: 12px"
      @update:value="onSliderUpdate"
    />
    <NInputNumber
      size="small"
      :value="sliderValue"
      :min="QR_SCALE_MIN"
      :max="QR_SCALE_MAX"
      :step="QR_SCALE_STEP"
      :precision="1"
      style="width: 88px"
      @update:value="onInputUpdate"
    />
  </div>
</template>

<style scoped>
.props-row-slider {
  align-items: center;
}
</style>