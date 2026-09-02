/**
 * useDragAdd —— 从控件库拖入画布生成控件 + 字段拖入编辑态文本框插入 {{path}}
 *
 * 交互：控件库卡片 draggable → dragstart 写入控件类型 →
 * 画布容器 dragover 允许放置 → drop 时把 client 坐标换算为
 * 相对页边距内容区（或页眉/页脚区域）的 mm 坐标，调用 store.addControlOfType。
 *
 * 字段绑定走"左键待绑态 + 点击左栏字段"路径（见 DataSourceTree.vue onFieldClick），
 * 但**画布上编辑态文本框**支持字段拖拽：drop 命中正在 fabric 编辑的 PrintText 时，
 * 把 {{path}} 插入到 hiddenTextarea 当前光标位置（segments 模式契约），而不是让浏览器
 * 把裸字段名插入 textarea 渲染层 resolveBinding 找不到路径 → 字段值静默丢失。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { ControlType } from '@op/types/control'
import { useDesignerStore } from '@op/design/stores/designer'
import { MM_TO_PX } from '@op/utils/constants'
import { insertFieldAt } from '@op/design/panels/props/content-value-insert'
import { PrintText } from '@op/design/canvas/controls/PrintText'

export const DRAG_TYPE_KEY = 'application/x-openprint-control'
/** 字段路径 mime */
export const DRAG_BINDING_KEY = 'application/x-openprint-binding'

/**
 * 字段 drop 是否应被画布层拦截（路由到 fabric hiddenTextarea 插入 {{path}}）。
 *
 * 拆分理由：useDragAdd 的 onDragOver 在真实 DOM 上跑，但落点是否在「编辑态 PrintText」
 * 这个判定是纯数据决策 —— 拆出来便于单测。返回 true 表示需要 preventDefault 允许 drop。
 */
export function shouldAcceptBindingDrop(active: unknown): boolean {
  return (
    !!active &&
    typeof active === 'object' &&
    (active as { isEditing?: boolean }).isEditing === true &&
    (active as { hiddenTextarea?: unknown }).hiddenTextarea != null
  )
}

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

  /**
   * 字段 drop 命中正在 fabric 编辑的 PrintText：
   * 把 {{path}} 插入到 hiddenTextarea 当前光标位置，触发 fabric 刷新 this.text，
   * 退出编辑时 editing:exited → store 把 raw 反向解析为 segments 写回。
   *
   * 注意：fabric hiddenTextarea 是 fabric 内部管理的，我们直接读写它的 selectionStart/End
   * 和 value。Fabric 的 IText 用 hiddenTextarea 作 IME 输入桥，不直接监听 input 之外的
   * 事件 —— 我们手动 set value + dispatch input 事件触发 fabric 的更新链路。
   */
  function insertFieldIntoActiveText(path: string): boolean {
    const canvas = store.designer?.canvas
    if (!canvas) return false
    const active = canvas.getActiveObject()
    if (!(active instanceof PrintText)) return false
    if (!active.isEditing) return false
    const ta = active.hiddenTextarea as HTMLTextAreaElement | null
    if (!ta) return false
    const cur = ta.value
    const start = ta.selectionStart ?? cur.length
    const end = ta.selectionEnd ?? cur.length
    const { next, caret } = insertFieldAt(cur, end, path, start)
    ta.value = next
    ta.setSelectionRange(caret, caret)
    // 触发 fabric 的 onInput 链路（hiddenTextarea value 改了 fabric 不知道）
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types
    if (!types) return
    // 控件拖入 OR 字段拖入画布上的编辑态文本框，都需要 preventDefault
    if (types.includes(DRAG_TYPE_KEY)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    if (types.includes(DRAG_BINDING_KEY)) {
      // 仅在编辑态 PrintText 上允许 drop（其它落点浏览器原生处理也无副作用）
      const canvas = store.designer?.canvas
      const active = canvas?.getActiveObject()
      if (active && shouldAcceptBindingDrop(active)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
  }

  const onDrop = (e: DragEvent) => {
    const bindingPath = e.dataTransfer?.getData(DRAG_BINDING_KEY)
    if (bindingPath) {
      // 字段 drop
      if (insertFieldIntoActiveText(bindingPath)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // 不在编辑态文本框：交给其它处理器（ContentValueEditor 等）兜底
      return
    }

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