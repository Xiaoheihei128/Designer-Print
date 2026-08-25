/**
 * rulerHighlight —— 标尺高亮带共享状态
 *
 * SmartGuides 在 object:moving / object:scaling / selection 事件里，
 * 把「当前选中/拖拽元素的包围盒（画布逻辑 px = 页面 px，未含缩放/平移）」
 * 写入这个模块级 ref；RulerOverlay 读取后按 viewport 映射成标尺上的彩色高亮带
 * （顶标尺带 = 元素宽度，左标尺带 = 元素高度），随组件移动丝滑滑动。
 *
 * 用模块级 ref 而非 Pinia store，是为了避免把画布引擎模块与组件 store 耦合。
 */
import { ref } from 'vue'

export interface RulerBand {
  /** 左边缘（画布逻辑 px） */
  left: number
  /** 上边缘（画布逻辑 px） */
  top: number
  /** 宽（画布逻辑 px） */
  width: number
  /** 高（画布逻辑 px） */
  height: number
}

export const rulerBand = ref<RulerBand | null>(null)
