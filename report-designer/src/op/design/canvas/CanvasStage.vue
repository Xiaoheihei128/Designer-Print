<script setup lang="ts">
/**
 * CanvasStage —— 画布舞台：Fabric canvas + 标尺覆盖层 + 拖放接收
 * DOM 结构遵循《标尺与辅助系统》§3.2：根元素 .canvas-stage，
 * Fabric canvas 与 RulerOverlay 同级，标尺层 pointer-events:none。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDesignerStore } from '@op/design/stores/designer'
import { useUiStore } from '@op/design/stores/ui'
import { useRoute } from 'vue-router'
import { useDragAdd } from '@op/design/hooks/useDragAdd'
import { useHotkey } from '@op/design/hooks/useHotkey'
import { loadBuiltinFonts } from '@op/core/fonts/loader'
import RulerOverlay from './rulers/RulerOverlay.vue'
import TableViewLayer from './TableViewLayer.vue'
import ChartViewLayer from './ChartViewLayer.vue'
import MathViewLayer from './MathViewLayer.vue'
import { RULER_THICK } from '@op/utils/constants'

const store = useDesignerStore()
const uiStore = useUiStore()
const route = useRoute()

const stageRef = ref<HTMLElement | null>(null)
const canvasHostRef = ref<HTMLElement | null>(null)
const canvasElRef = ref<HTMLCanvasElement | null>(null)
const stageWidth = ref(0)
const stageHeight = ref(0)
/** 画布内核挂载就绪后再渲染表格 HTML overlay，避免 attachCanvas 前 getObjects() 取不到对象 */
const canvasReady = ref(false)

useDragAdd(canvasHostRef)
// 字段绑定走"左键待绑态 + 点击左栏字段"路径（DataSourceTree.onFieldClick），
// 不再需要 binding drag detector。
useHotkey()

// 页边距参考线显隐随 ui 开关联动（画布挂载后才生效）
watch(
  () => uiStore.showMarginGuides,
  (v) => store.designer?.setMarginGuidesVisible(v),
)

// 网格显隐/间距/颜色随 gridConfig 联动（仅视觉参考，不吸附元素）
watch(
  () => store.gridConfig.visible,
  (visible) => store.designer?.setGridVisible(visible),
)
watch(
  () => store.gridConfig.sizeMm,
  (sizeMm) => store.designer?.setGridSize(sizeMm),
)
watch(
  () => store.gridConfig.color,
  (color) => store.designer?.setGridColor(color),
)

let resizeObserver: ResizeObserver | null = null

/**
 * 画布内统一屏蔽浏览器原生右键菜单（表情符号 / 拼写检查 / 书写方向 等）。
 * 仅对画布区域 preventDefault，不影响左侧面板/顶栏的右键操作。
 * 之前仅在 Fabric upperCanvasEl 上挂，导致命中 contenteditable td 时仍弹出。
 */
function onCanvasContextMenu(e: MouseEvent): void {
  const stage = stageRef.value
  if (!stage) return
  const target = e.target as Node | null
  if (!target || !stage.contains(target)) return
  e.preventDefault()
}

onMounted(() => {
  if (!canvasElRef.value || !canvasHostRef.value || !stageRef.value) return
  const host = canvasHostRef.value
  stageWidth.value = host.clientWidth
  stageHeight.value = host.clientHeight
  store.attachCanvas(canvasElRef.value, host)
  canvasReady.value = true
  // 画布区右键屏蔽（document 级捕获，避免 contenteditable td 内右键泄漏）
  document.addEventListener('contextmenu', onCanvasContextMenu, true)
  // 初始同步页边距参考线显隐开关
  store.designer?.setMarginGuidesVisible(uiStore.showMarginGuides)
  // 初始同步网格（视觉 + 间距 + 颜色；网格不吸附元素）
  store.designer?.setGridVisible(store.gridConfig.visible)
  store.designer?.setGridSize(store.gridConfig.sizeMm)
  store.designer?.setGridColor(store.gridConfig.color)
  // 内置字体（思源黑体/宋体/楷体等）注册到 document.fonts，加载完成后刷新画布让 Fabric 生效
  void loadBuiltinFonts().then(() => {
    document.fonts?.ready.then(() => store.designer?.canvas.requestRenderAll()).catch(() => undefined)
  })
  // 启动初始化：每次进入设计器都从一张「空白 3×4 表格」开始，
  // 不再自动恢复上次保存的模板（避免误打开历史模板）。
  // 路由带 ?id= 时由壳组件(OpenPrint shell)负责加载指定模板, 这里跳过避免覆盖。
  if (route.query.id) return
  store.newBlankWith3x4Table()
  // dev 调试句柄
  if (import.meta.env.DEV) {
    ;(window as unknown as { __op: unknown }).__op = store
  }

  resizeObserver = new ResizeObserver(() => {
    stageWidth.value = host.clientWidth
    stageHeight.value = host.clientHeight
  })
  resizeObserver.observe(host)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('contextmenu', onCanvasContextMenu, true)
  store.detachCanvas()
})
</script>

<template>
  <div ref="stageRef" class="canvas-stage relative h-full w-full overflow-hidden bg-[#e8eaed]">
    <!-- Fabric canvas 宿主（留出标尺厚度） -->
    <div
      ref="canvasHostRef"
      class="absolute"
      :style="{ top: `${RULER_THICK}px`, left: `${RULER_THICK}px`, right: '0', bottom: '0' }"
    >
      <canvas ref="canvasElRef" />
      <!-- 表格 HTML overlay（方案 A）：与 Fabric 节点同步，平时不拦截指针 -->
      <TableViewLayer v-if="canvasReady" />
      <!-- 图表 SVG overlay（方案 A）：同上，原生 SVG 矢量覆盖 -->
      <ChartViewLayer v-if="canvasReady" />
      <!-- 公式 KaTeX HTML overlay（方案 A）：同上，KaTeX 矢量字体覆盖 -->
      <MathViewLayer v-if="canvasReady" />
    </div>

    <!-- 标尺覆盖层（只看不拦截事件） -->
    <RulerOverlay v-if="stageWidth > 0" :stage-width="stageWidth" :stage-height="stageHeight" />
  </div>
</template>
