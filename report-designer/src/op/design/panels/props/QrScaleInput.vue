<script setup lang="ts">
/**
 * QrScaleInput —— PR-D 二维码倍率输入控件(NInputNumber 单控件版)
 *
 * 历史:v1 是 NSlider + NInputNumber 配对(参考 SignaturePadModal 画笔粗细)。
 * 2026-09-16 用户反馈:cell 段级工具栏空间紧张,slider 拇指 + 输入框 + marks 视觉上
 * 拥挤且重叠(拇指数字「1」与 NInputNumber「1.0」撞在一起),且 slider marks
 * 「0.5×/1×/1.5×/2×/2.5×/3×」在小尺寸工具栏里信息密度低,用户看不清。
 *
 * v2:简化为单 NInputNumber,与 cell 段级 barcode/image 工具栏节奏一致
 * (那两类也是单 NInputNumber,无 slider)。step=0.5 仍可通过 +/- 按钮
 * 跳到 0.5×/1×/1.5×/2×/2.5×/3× 离散档位,功能等价。
 *
 * 单源常量:[qr-scale.ts](@op/core/layout-engine/qr-scale) 的 QR_SCALE_* / normalizeQrScale。
 *
 * 行为:
 * - value 传入当前 scaleFactor(undefined 视为 1)
 * - @change(scaleFactor):emit 标准化后的值,父组件写回 display.scaleFactor
 *
 * 边界:
 * - 输入 < MIN 或 > MAX 时,normalizeQrScale 自动 clamp
 * - 输入非数字/NaN → 不 emit
 */
import { computed } from 'vue'
import { NInputNumber } from 'naive-ui'
import {
  QR_SCALE_MAX,
  QR_SCALE_MIN,
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

/** 当前输入框值(undefined → 1×) */
const inputValue = computed(() => normalizeQrScale(props.value) ?? 1)

function onInputUpdate(v: number | null): void {
  if (v === null) return
  const normalized = normalizeQrScale(v)
  if (normalized !== undefined) emit('change', normalized)
}
</script>

<template>
  <div class="props-row">
    <span class="props-label">{{ label }}</span>
    <NInputNumber
      size="small"
      :value="inputValue"
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
/* 简化为单 NInputNumber,不再需要 .props-row-slider 特殊样式 */
</style>