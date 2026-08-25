<script setup lang="ts">
/**
 * ShapeProps —— 矩形 / 圆形 / 线条控件属性
 */
import { computed } from 'vue'
import { NInputNumber, NColorPicker, NSwitch, NSelect, NButton } from 'naive-ui'
import type { LineControl, RectControl } from '@/types/control'
import { useDesignerStore } from '@/design/stores/designer'

const store = useDesignerStore()
const control = computed(() => store.selectedControl as RectControl | LineControl | null)
const isRect = computed(() => control.value?.type === 'rect')
const isCircle = computed(() => isRect.value && (control.value as RectControl)?.shape === 'circle')

function patch(p: Record<string, unknown>): void {
  if (control.value) store.updateControl(control.value.id, p)
}

const dashed = computed({
  get: () => !!((control.value as LineControl | RectControl | null)?.strokeDashArray?.length),
  set: (v: boolean) => patch({ strokeDashArray: v ? [6, 4] : undefined }),
})

/* ----------------------------- 圆角（四角独立） ----------------------------- */

const baseRadius = computed(() => (control.value as RectControl)?.cornerRadius ?? 0)
const radiusTL = computed(() => (control.value as RectControl)?.cornerRadiusTL ?? baseRadius.value)
const radiusTR = computed(() => (control.value as RectControl)?.cornerRadiusTR ?? baseRadius.value)
const radiusBR = computed(() => (control.value as RectControl)?.cornerRadiusBR ?? baseRadius.value)
const radiusBL = computed(() => (control.value as RectControl)?.cornerRadiusBL ?? baseRadius.value)

/** 统一圆角：设定后清空四角独立覆盖，使其回落到统一值 */
function onUnifiedRadius(v: number | null): void {
  patch({
    cornerRadius: v ?? 0,
    cornerRadiusTL: undefined,
    cornerRadiusTR: undefined,
    cornerRadiusBR: undefined,
    cornerRadiusBL: undefined,
  })
}

function onCornerRadius(side: 'TL' | 'TR' | 'BR' | 'BL', v: number | null): void {
  patch({ [`cornerRadius${side}`]: v ?? 0 })
}

/** 矩形⇄圆形切换：切到圆形时强制正方形（正圆），切回矩形保留尺寸 */
function onShapeChange(v: 'rect' | 'circle'): void {
  const c = control.value as RectControl
  if (v === 'circle') {
    const size = Math.max(c.width ?? 0, c.height ?? 0)
    patch({ shape: 'circle', cornerRadius: 0, width: size, height: size })
  } else {
    patch({ shape: 'rect', cornerRadius: c.cornerRadius ?? 0 })
  }
}

/** 圆形：一键还原为正圆（取当前长边为直径） */
function makePerfectCircle(): void {
  const c = control.value as RectControl
  const size = Math.max(c.width ?? 0, c.height ?? 0)
  patch({ width: size, height: size })
}
</script>

<template>
  <div v-if="control" class="props-section">
    <div class="props-title">{{ isCircle ? '圆形样式' : isRect ? '矩形样式' : '线条样式' }}</div>

    <!-- 形状切换（仅 rect 类型可切换矩形/圆形） -->
    <div v-if="isRect" class="props-row">
      <span class="props-label">形状</span>
      <NSelect
        size="small"
        :value="(control as RectControl).shape ?? 'rect'"
        :options="[
          { label: '矩形', value: 'rect' },
          { label: '圆形', value: 'circle' },
        ]"
        @update:value="onShapeChange"
      />
    </div>

    <div v-if="isRect" class="props-row">
      <span class="props-label">填充</span>
      <NColorPicker
        size="small"
        :modes="['hex']"
        :value="(control as RectControl).fill ?? ''"
        :swatches="['transparent', '#FFFFFF', '#F5F7FA', '#1677FF', '#000000']"
        @update:value="patch({ fill: $event })"
      />
    </div>

    <div class="props-row">
      <span class="props-label">描边</span>
      <NColorPicker
        size="small"
        :modes="['hex']"
        :value="control.stroke ?? '#000000'"
        :swatches="['#000000', '#333333', '#999999', '#E5E7EB', '#1677FF', '#F5222D']"
        @update:value="patch({ stroke: $event })"
      />
    </div>

    <div class="props-row">
      <span class="props-label">线宽</span>
      <NInputNumber
        size="small"
        button-placement="both"
        :value="control.strokeWidth ?? 1"
        :min="0"
        :max="20"
        :precision="1"
        @update:value="patch({ strokeWidth: $event ?? 1 })"
      />
    </div>

    <!-- 统一圆角（仅矩形；圆形本身为正圆/椭圆，无圆角概念） -->
    <div v-if="isRect && !isCircle" class="props-row">
      <span class="props-label">圆角</span>
      <NInputNumber
        size="small"
        button-placement="both"
        :value="(control as RectControl).cornerRadius ?? 0"
        :min="0"
        @update:value="onUnifiedRadius"
      />
    </div>

    <!-- 四角独立弧度（仅矩形） -->
    <div v-if="isRect && !isCircle" class="props-sub">
      <div class="props-sub-title">四角弧度（px）</div>
      <div class="grid grid-cols-2 gap-2">
        <div class="props-row">
          <span class="props-label">左上</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="radiusTL"
            :min="0"
            @update:value="(v: number | null) => onCornerRadius('TL', v)"
          />
        </div>
        <div class="props-row">
          <span class="props-label">右上</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="radiusTR"
            :min="0"
            @update:value="(v: number | null) => onCornerRadius('TR', v)"
          />
        </div>
        <div class="props-row">
          <span class="props-label">左下</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="radiusBL"
            :min="0"
            @update:value="(v: number | null) => onCornerRadius('BL', v)"
          />
        </div>
        <div class="props-row">
          <span class="props-label">右下</span>
          <NInputNumber
            size="small"
            button-placement="both"
            :value="radiusBR"
            :min="0"
            @update:value="(v: number | null) => onCornerRadius('BR', v)"
          />
        </div>
      </div>
    </div>

    <!-- 圆形：一键还原正圆 -->
    <div v-if="isCircle" class="props-row">
      <span class="props-label">正圆</span>
      <NButton size="small" @click="makePerfectCircle">还原为正圆</NButton>
    </div>

    <!-- 虚线开关（矩形、圆形、线条都支持） -->
    <div class="props-row">
      <span class="props-label">虚线</span>
      <NSwitch size="small" :value="dashed" @update:value="dashed = $event" />
    </div>
  </div>
</template>

<style scoped>
.props-sub {
  margin: 4px 0 8px;
}
.props-sub-title {
  font-size: 11px;
  color: var(--brand-text-3);
  margin-bottom: 6px;
}
</style>
