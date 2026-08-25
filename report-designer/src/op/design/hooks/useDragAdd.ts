/**
 * useDragAdd —— 从控件库拖入画布生成控件
 *
 * 交互：控件库卡片 draggable → dragstart 写入控件类型 →
 * 画布容器 dragover 允许放置 → drop 时把 client 坐标换算为
 * 相对页边距内容区（或页眉/页脚区域）的 mm 坐标，调用 store.addControlOfType。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { AnyControl, ControlType } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import { MM_TO_PX } from '@op/utils/constants'

export const DRAG_TYPE_KEY = 'application/x-openprint-control'

/** 拖拽时携带的额外初始属性（如圆形 shape），同标签页内拖拽为同步过程，用模块级变量传递 */
let pendingInit: Partial<AnyControl> | undefined

/** 控件库侧：卡片 dragstart 调用；init 允许注入额外初始属性 */
export function startControlDrag(e: DragEvent, type: ControlType, init?: Partial<AnyControl>): void {
  e.dataTransfer?.setData(DRAG_TYPE_KEY, type)
  pendingInit = init
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

/** 画布侧：挂载到画布容器，处理 drop */
export function useDragAdd(stageRef: Ref<HTMLElement | null>): void {
  const store = useDesignerStore()

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE_KEY)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer?.getData(DRAG_TYPE_KEY) as ControlType | ''
    if (!type || !stageRef.value) return
    e.preventDefault()

    const init = pendingInit
    pendingInit = undefined

    const rect = stageRef.value.getBoundingClientRect()
    const vp = store.viewport
    const d = store.designer
    if (!d) return

    // client px → 画布 mm（相对页面左上角）
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top
    const pageMmX = (canvasX - vp.offsetX) / (MM_TO_PX * vp.zoom)
    const pageMmY = (canvasY - vp.offsetY) / (MM_TO_PX * vp.zoom)

    // 检测是否拖入页眉/页脚区域
    let zoneHostId: string | undefined
    // 默认正文区原点 = 内容区左上角 + 页眉高（与渲染端 .op_body 起算点一致）
    let origin = { x: d.contentOriginPx.x / MM_TO_PX, y: d.contentOriginPx.y / MM_TO_PX }

    // 落点（相对内容区 mm）——既用于区域命中，也用于标签网格首卡命中
    const dropLeft = pageMmX - origin.x
    const dropTop = pageMmY - origin.y

    // 拖入标签网格容器：作为「首卡子组件」加入，渲染 / 导出时由引擎自动复制（容器即模板）
    const gridId = store.hitLabelGridContainer(dropLeft, dropTop)
    if (gridId && type !== 'signature') {
      store.addControlIntoLabelGrid(gridId, type, { leftMm: dropLeft, topMm: dropTop }, init)
      return
    }

    for (const z of d.getZones()) {
      const b = z.getBoundingRect()
      // 将 zone 画布坐标转为 stage-container px
      const zLeft = b.left * vp.zoom + vp.offsetX
      const zRight = (b.left + b.width) * vp.zoom + vp.offsetX
      const zTop = b.top * vp.zoom + vp.offsetY
      const zBottom = (b.top + b.height) * vp.zoom + vp.offsetY
      if (canvasX >= zLeft && canvasX <= zRight && canvasY >= zTop && canvasY <= zBottom) {
        zoneHostId = z.controlId
        // 相对色带左上角（mm）
        origin = { x: b.left / MM_TO_PX, y: b.top / MM_TO_PX }
        break
      }
    }

    // 签名：不直接落控件，而是弹出手写画板，确认后按落点插入（UX 与 WPS 一致）
    if (type === 'signature') {
      store.pendingSignatureDrop = {
        leftMm: Math.max(0, pageMmX - origin.x),
        topMm: Math.max(0, pageMmY - origin.y),
      }
      store.openSignaturePad()
      return
    }

    store.addControlOfType(
      type,
      {
        leftMm: pageMmX - origin.x,
        topMm: pageMmY - origin.y,
      },
      init,
      zoneHostId,
    )
  }

  onMounted(() => {
    stageRef.value?.addEventListener('dragover', onDragOver)
    stageRef.value?.addEventListener('drop', onDrop)
  })

  onBeforeUnmount(() => {
    stageRef.value?.removeEventListener('dragover', onDragOver)
    stageRef.value?.removeEventListener('drop', onDrop)
  })
}