/**
 * useDragAdd —— 从控件库拖入画布生成控件 + 字段树拖入画布绑定文本控件
 *
 * 两种 drag 路径在 onDrop 内分流：
 *
 * 1) 控件库拖入（DRAG_TYPE_KEY）
 *    控件库卡片 draggable → dragstart 写入控件类型 →
 *    画布容器 dragover 允许放置 → drop 时把 client 坐标换算为
 *    相对页边距内容区（或页眉/页脚区域）的 mm 坐标，调用 store.addControlOfType。
 *
 * 2) 字段树拖入（DRAG_BINDING_KEY）
 *    DataSourceTree.vue:dragstart 写入 application/x-openprint-binding = 字段路径 →
 *    onDrop 时命中已有文本控件 → 调 store.applyFieldBindingToTextControl 把字段以
 *    segments=[{kind:'field', path}] 形式绑进去（避免 fabric.Textbox contenteditable
 *    默认行为把 text/plain 兜底 mime 直接插入导致画布出现裸字段名）；
 *    未命中则当作"新建文本控件"的请求，落到落点位置。
 *
 * 不再依赖 text/plain 兜底 mime，因为 fabric.Textbox 的 contenteditable 会把它
 * 原生插入到 fabric text 字段里（与 store 模型不一致），而 preventDefault + 业务
 * handler 接管才能保证数据流一致。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { ControlType } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import { MM_TO_PX } from '@op/utils/constants'

export const DRAG_TYPE_KEY = 'application/x-openprint-control'
/** 字段路径 mime（与 DataSourceTree.vue:dragstart 配对） */
export const DRAG_BINDING_KEY = 'application/x-openprint-binding'

/** 拖拽时携带的额外初始属性（如圆形 shape），同标签页内拖拽为同步过程，用模块级变量传递 */
let pendingInit: Partial<unknown> | undefined

/** 控件库侧：卡片 dragstart 调用；init 允许注入额外初始属性 */
export function startControlDrag(e: DragEvent, type: ControlType, init?: Partial<unknown>): void {
  e.dataTransfer?.setData(DRAG_TYPE_KEY, type)
  pendingInit = init
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

/** 画布侧：挂载到画布容器，处理 drop */
export function useDragAdd(stageRef: Ref<HTMLElement | null>): void {
  const store = useDesignerStore()

  const onDragOver = (e: DragEvent) => {
    // 同时允许控件库 mime 与字段 mime 进入画布 —— HTML5 spec 要求 drop 目标在
    // dragover 内 preventDefault 才能在该处 drop；不 preventDefault 浏览器会
    // 拒绝 drop 并触发默认行为（fabric.Textbox contenteditable 把 text/plain
    // 字段路径直接插入文本框，导致"裸字段名出现在画布"的 bug）
    const types = e.dataTransfer?.types
    if (
      types?.includes(DRAG_TYPE_KEY) ||
      types?.includes(DRAG_BINDING_KEY)
    ) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: DragEvent) => {
    if (!stageRef.value) return

    // 路径 2：字段拖入 → 命中已有文本控件 或 新建文本控件
    const fieldPath = e.dataTransfer?.getData(DRAG_BINDING_KEY)
    if (fieldPath) {
      e.preventDefault()
      const hit = store.hitTestTextControl(e.clientX, e.clientY, stageRef.value)
      if (hit && store.applyFieldBindingToTextControl(hit, fieldPath)) {
        return
      }
      // 未命中已有文本控件 → 在落点新建一个文本控件，segments=[{kind:'field', path}]
      // 坐标换算逻辑复用下方控件库路径，落到内容区或 zone
      dropNewTextControl(e, fieldPath)
      return
    }

    // 路径 1：控件库拖入
    const type = e.dataTransfer?.getData(DRAG_TYPE_KEY) as ControlType | ''
    if (!type) return
    e.preventDefault()
    dropNewControlOfType(e, type)
  }

  /**
   * 在落点新建一个文本控件并预绑字段（segments 模式）。
   * 坐标换算：client → 画布 mm，落点 = 内容区/zone 原点 + dropLeftMm/dropTopMm。
   * 落到 zone（页眉/页脚）内时把控件加到 zone.children。
   */
  function dropNewTextControl(e: DragEvent, fieldPath: string): void {
    if (!stageRef.value) return
    const d = store.designer
    if (!d) return
    const rect = stageRef.value.getBoundingClientRect()
    const vp = store.viewport
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top
    const pageMmX = (canvasX - vp.offsetX) / (MM_TO_PX * vp.zoom)
    const pageMmY = (canvasY - vp.offsetY) / (MM_TO_PX * vp.zoom)
    let origin = { x: d.contentOriginPx.x / MM_TO_PX, y: d.contentOriginPx.y / MM_TO_PX }
    let zoneHostId: string | undefined
    for (const z of d.getZones()) {
      const b = z.getBoundingRect()
      const zLeft = b.left * vp.zoom + vp.offsetX
      const zRight = (b.left + b.width) * vp.zoom + vp.offsetX
      const zTop = b.top * vp.zoom + vp.offsetY
      const zBottom = (b.top + b.height) * vp.zoom + vp.offsetY
      if (canvasX >= zLeft && canvasX <= zRight && canvasY >= zTop && canvasY <= zBottom) {
        zoneHostId = z.controlId
        origin = { x: b.left / MM_TO_PX, y: b.top / MM_TO_PX }
        break
      }
    }
    store.addControlOfType(
      'text',
      {
        leftMm: pageMmX - origin.x,
        topMm: pageMmY - origin.y,
      },
      {
        segments: [{ kind: 'field', path: fieldPath }],
        contentType: 'variable',
        binding: fieldPath,
        value: undefined,
      },
      zoneHostId,
    )
  }

  /** 控件库拖入落点：把 client 坐标换算为相对内容区 / zone 的 mm，调用 store.addControlOfType */
  function dropNewControlOfType(e: DragEvent, type: ControlType): void {
    if (!stageRef.value) return
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