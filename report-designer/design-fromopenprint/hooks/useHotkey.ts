/**
 * useHotkey —— 全局快捷键（删除/复制/撤销/重做/取消选中）
 * 安装在 CanvasStage，仅在画布可见时生效。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useDesignerStore } from '@/design/stores/designer'
import type { AnyControl } from '@/types/control'
import { genId } from '@/utils/id'

const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

export function useHotkey(): void {
  const store = useDesignerStore()

  function onKeyDown(e: KeyboardEvent): void {
    // 忽略输入框内按键
    if (
      (e.target as HTMLElement)?.tagName === 'INPUT' ||
      (e.target as HTMLElement)?.tagName === 'TEXTAREA' ||
      (e.target as HTMLElement)?.isContentEditable
    )
      return

    const mod = MAC ? e.metaKey : e.ctrlKey

    // Ctrl/Cmd + Z = 撤销
    if (mod && !e.shiftKey && e.key === 'z') {
      e.preventDefault()
      store.undo()
      return
    }
    // Ctrl/Cmd + Shift + Z or Ctrl+Y = 重做
    if ((mod && e.shiftKey && e.key === 'z') || (mod && e.key === 'y')) {
      e.preventDefault()
      store.redo()
      return
    }
    // Delete / Backspace = 删除选中控件
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedIds.length > 0) {
      e.preventDefault()
      for (const id of store.selectedIds) {
        store.removeControl(id)
      }
      return
    }
    // Ctrl/Cmd + D = 复制选中控件（偏右下 10mm）
    if (mod && e.key === 'd' && store.selectedIds.length > 0) {
      e.preventDefault()
      for (const id of store.selectedIds) {
        const src = store.controls.find((c) => c.id === id) ?? store.zones.find((z) => z.id === id || z.children.some((c) => c.id === id))
        if (!src || src.type === 'zone') continue // zone 不复制
        const clone: AnyControl = JSON.parse(JSON.stringify(src))
        clone.id = genId()
        clone.left += 10
        clone.top += 10
        store.controls.push(clone)
        store.designer?.addControl(clone)
      }
      return
    }
    // Escape = 取消选中
    if (e.key === 'Escape') {
      store.selectControl(null)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}
