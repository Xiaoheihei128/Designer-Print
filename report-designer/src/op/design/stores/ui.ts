/**
 * ui store —— 缩放 / 主题 / 面板开关 / 语言
 *
 * 主题闭环（主任定：一个主题源，同时控制 naive-ui darkTheme + CSS 变量 + body .dark 类）：
 *   themePreference = 'light' | 'dark' | 'system' | 'svip'（用户选择，持久化）
 *   effectiveTheme  = 'light' | 'dark' | 'svip'（解析 system 后的实际主题）
 *   toggleTheme()   = light <-> dark 一键切换（svip 视为深色系，点击回浅色）
 *   toggleSvip()    = 黑金主题开关（点击版本号触发；退出恢复进入前的 light/dark）
 *   applyTheme()    = document.documentElement 同步 .dark/.svip 类，body 颜色由 NGlobalStyle 管理
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'openprint:ui:theme'

type ThemePreference = 'light' | 'dark' | 'system' | 'svip'
export type EffectiveTheme = 'light' | 'dark' | 'svip'

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return (v === 'light' || v === 'dark' || v === 'system' || v === 'svip') ? v : 'system'
  } catch {
    return 'system'
  }
}

function writePreference(v: ThemePreference): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* noop */
  }
}

function systemIsDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useUiStore = defineStore('ui', () => {
  /** 用户偏好（持久化） */
  const themePreference = ref<ThemePreference>(readPreference())
  /** 系统暗色（只读实时值） */
  const systemDark = ref(systemIsDark())

  /** 左侧面板当前 Tab：components / layers / datasource */
  const leftTab = ref<'components' | 'layers' | 'datasource'>('components')
  /** 右侧面板开关 */
  const rightPanelVisible = ref(true)
  /** 打印预览弹窗开关（顶部工具栏与批量数据面板共用） */
  const previewOpen = ref(false)
  /** 导出弹窗开关（顶部工具栏与批量数据面板共用） */
  const exportOpen = ref(false)
  /** 语言 */
  const locale = ref<'zh-CN' | 'en-US'>('zh-CN')
  /** 画布上是否显示页边距内容区参考线（蓝色虚线） */
  const showMarginGuides = ref(true)
  function toggleMarginGuides(): void {
    showMarginGuides.value = !showMarginGuides.value
  }

  /** 画布平移模式：开启后任意拖动都平移画布（无需按空格）；再点一次按钮 / 按 Esc /
   *  选中控件即退出。空格 + 拖动作为熟手快捷方式始终可用，与本模式并存。 */
  const panMode = ref(false)
  function togglePanMode(): void {
    panMode.value = !panMode.value
  }
  function setPanMode(on: boolean): void {
    panMode.value = on
  }

  /* --------------------- 表格属性快速面板（替代 RightPanel） --------------------- */
  /**
   * 右栏属性面板模式：
   *   - 'normal'    → 原属性长列表（默认）
   *   - 'tableQuick'→ 表格属性快速面板，由 CellToolbar 上的"表格属性"按钮触发
   */
  const rightPanelMode = ref<'normal' | 'tableQuick'>('normal')
  /** 快速面板当前激活的 tab */
  const tableQuickPanelActiveTab = ref<'columns' | 'cellStyle' | 'advanced' | 'common'>(
    'columns',
  )
  function openTableQuickPanel(
    tab?: typeof tableQuickPanelActiveTab.value,
  ): void {
    rightPanelMode.value = 'tableQuick'
    if (tab) tableQuickPanelActiveTab.value = tab
  }
  function closeTableQuickPanel(): void {
    rightPanelMode.value = 'normal'
  }

  /** 实际生效主题（system 下解析出的 light/dark；svip 直通不解析） */
  const effectiveTheme = computed<EffectiveTheme>(() => {
    if (themePreference.value === 'svip') return 'svip'
    return themePreference.value === 'system'
      ? systemDark.value ? 'dark' : 'light'
      : themePreference.value
  })

  /** 兼容旧代码直接读 theme */
  const theme = computed<EffectiveTheme>(() => effectiveTheme.value)

  /** 进入 SVIP 前的主题（退出时恢复，避免浅色进入却退回深色的跳变） */
  const prevBeforeSvip = ref<Exclude<ThemePreference, 'system' | 'svip'>>('dark')

  function applyDomTheme(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const mode = effectiveTheme.value
    const isDark = mode !== 'light'
    root.classList.toggle('dark', isDark)
    root.classList.toggle('svip', mode === 'svip')
    root.style.colorScheme = isDark ? 'dark' : 'light'
  }

  function setPreference(v: ThemePreference): void {
    themePreference.value = v
    writePreference(v)
  }

  /** 一键切换：light <-> dark；svip 视为深色系点击回浅色；system 先解析再翻转 */
  function toggleTheme(): void {
    if (themePreference.value === 'system') {
      setPreference(systemDark.value ? 'light' : 'dark')
      return
    }
    // svip / dark → light；light → dark
    setPreference(themePreference.value === 'light' ? 'dark' : 'light')
  }

  /** SVIP 黑金主题开关：进入记录原主题，退出恢复（进浅色退回浅色、进深色退回深色） */
  function toggleSvip(): void {
    if (themePreference.value === 'svip') {
      setPreference(prevBeforeSvip.value)
      return
    }
    prevBeforeSvip.value = themePreference.value === 'system'
      ? (systemDark.value ? 'dark' : 'light')
      : themePreference.value
    setPreference('svip')
  }

  /* ------------------------------ 监听系统主题变化 ----------------------------- */

  let mql: MediaQueryList | null = null
  function onSystemChange(e: MediaQueryListEvent): void {
    systemDark.value = e.matches
  }
  function bindSystemListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (mql) return
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mql.matches
    mql.addEventListener?.('change', onSystemChange)
  }

  /* --------------------------------- 同步 DOM 类 -------------------------------- */

  watch(
    effectiveTheme,
    () => {
      applyDomTheme()
    },
    { immediate: true },
  )

  bindSystemListener()

  return {
    // theme
    themePreference,
    effectiveTheme,
    theme,
    setPreference,
    toggleTheme,
    toggleSvip,
    // others
    leftTab,
    rightPanelVisible,
    previewOpen,
    exportOpen,
    locale,
    showMarginGuides,
    toggleMarginGuides,
    // 平移画布模式
    panMode,
    togglePanMode,
    setPanMode,
    // 表格属性快速面板
    rightPanelMode,
    tableQuickPanelActiveTab,
    openTableQuickPanel,
    closeTableQuickPanel,
  }
})
