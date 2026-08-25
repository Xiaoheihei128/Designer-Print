<script setup lang="ts">
/**
 * MathViewLayer —— 公式 HTML overlay（方案 A 的载体，类比 ChartViewLayer）
 *
 * 设计期公式**不**由 Fabric 画位图，而是用 mathkit 渲染的 KaTeX HTML
 * 绝对定位覆盖在画布上，transform 与 Fabric 节点 + 视口实时同步。
 * 公式数据由右侧属性面板编辑（latex 源码 + 字号 / 颜色）。
 *
 * 本层：
 * - 平时整层 `pointer-events:none`，点击照旧落到 Fabric（选中 / 拖拽 / 缩放不受影响）
 */
import { computed, ref } from 'vue'
import { useDesignerStore } from '@op/design/stores/designer'
import { PrintMath } from './controls/PrintMath'
import { renderMathControl } from '@op/core/mathkit'
import type { AnyControl, MathControl } from '@op/types/control'
import { MM_TO_PX } from '@op/utils/constants'

const store = useDesignerStore()
const layerRef = ref<HTMLElement | null>(null)

interface OverlayItem {
  id: string
  x: number
  y: number
  zoom: number
  angle: number
  widthMm: number
  heightMm: number
  html: string
}

/** 从 store 模型里取公式控件（overlay 渲染的数据真相源） */
function controlById(id: string): MathControl | undefined {
  const flat: AnyControl[] = [...store.controls, ...store.zones.flatMap((z) => z.children)]
  const hit = flat.find((c) => c.id === id)
  return hit?.type === 'math' ? (hit as MathControl) : undefined
}

/**
 * 每个公式一项：几何取自 Fabric 对象（拖拽/缩放实时），内容取自 store 模型。
 * canvasTick 是显式依赖 —— Fabric 对象不是响应式的，靠画布事件驱动重算。
 */
const items = computed<OverlayItem[]>(() => {
  void store.canvasTick
  void store.controls
  void store.zones
  const d = store.designer
  if (!d?.canvas) return []
  const vt = d.canvas.viewportTransform
  const zoom = vt[0] ?? 1
  const offsetX = vt[4] ?? 0
  const offsetY = vt[5] ?? 0
  const out: OverlayItem[] = []
  for (const obj of d.canvas.getObjects()) {
    if (!(obj instanceof PrintMath)) continue
    if (obj.visible === false) continue
    const control = controlById(obj.controlId) ?? obj.toControl()
    out.push({
      id: obj.controlId,
      x: (obj.left ?? 0) * zoom + offsetX,
      y: (obj.top ?? 0) * zoom + offsetY,
      zoom,
      angle: obj.angle ?? 0,
      widthMm: obj.getScaledWidth() / MM_TO_PX,
      heightMm: obj.getScaledHeight() / MM_TO_PX,
      html: renderMathControl(control),
    })
  }
  return out
})

function itemStyle(it: OverlayItem): Record<string, string> {
  return {
    transform: `translate(${it.x}px, ${it.y}px) rotate(${it.angle}deg) scale(${it.zoom})`,
    width: `${it.widthMm}mm`,
    height: `${it.heightMm}mm`,
  }
}
</script>

<template>
  <div ref="layerRef" class="op-math-overlay absolute inset-0 overflow-hidden">
    <div
      v-for="it in items"
      :key="it.id"
      class="op-math-overlay__item"
      :data-math-id="it.id"
      :style="itemStyle(it)"
      v-html="it.html"
    />
  </div>
</template>

<style scoped>
.op-math-overlay {
  /* 平时完全透明于鼠标：所有交互照旧交给 Fabric */
  pointer-events: none;
}

.op-math-overlay__item {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
