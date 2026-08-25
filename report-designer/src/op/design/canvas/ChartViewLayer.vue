<script setup lang="ts">
/**
 * ChartViewLayer —— 图表 HTML/SVG overlay（方案 A 的载体）
 *
 * 与 TableViewLayer 同构：设计期图表**不**由 Fabric 画位图，而是用 chartkit 生成的
 * 原生 SVG 绝对定位覆盖在画布上，transform 与 Fabric 节点 + 视口实时同步。
 * SVG 字符串由 chartkit 生成，设计期与运行期导出共用同一份产物（设计即打印）。
 *
 * 图表数据由右侧属性面板编辑（而非单元格内联编辑），所以本层：
 * - 平时整层 `pointer-events:none`，点击照旧落到 Fabric（选中 / 拖拽 / 缩放不受影响）
 * - 不做 contenteditable / 工具栏，只负责把 SVG 画到位
 */
import { computed, ref } from 'vue'
import { useDesignerStore } from '@op/design/stores/designer'
import { PrintChart } from './controls/PrintChart'
import { renderChartControl } from '@op/core/chartkit'
import type { AnyControl, ChartControl } from '@op/types/control'
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
  svg: string
}

/** 从 store 模型里取图表控件（overlay 渲染的数据真相源） */
function controlById(id: string): ChartControl | undefined {
  const flat: AnyControl[] = [...store.controls, ...store.zones.flatMap((z) => z.children)]
  const hit = flat.find((c) => c.id === id)
  return hit?.type === 'chart' ? (hit as ChartControl) : undefined
}

/**
 * 每个图表一项：几何取自 Fabric 对象（拖拽/缩放实时），内容取自 store 模型。
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
    if (!(obj instanceof PrintChart)) continue
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
      svg: renderChartControl(control),
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
  <div ref="layerRef" class="op-chart-overlay absolute inset-0 overflow-hidden">
    <div
      v-for="it in items"
      :key="it.id"
      class="op-chart-overlay__item"
      :data-chart-id="it.id"
      :style="itemStyle(it)"
      v-html="it.svg"
    />
  </div>
</template>

<style scoped>
.op-chart-overlay {
  /* 平时完全透明于鼠标：所有交互照旧交给 Fabric */
  pointer-events: none;
}

.op-chart-overlay__item {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
}

/* SVG 填满宿主框，矢量随容器缩放清晰 */
.op-chart-overlay__item :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
