/**
 * 电脑系统字体运行时注册中心
 *
 * 数据源：连接到本机或局域网的打印客户端（LocalHttpServer GET /api/fonts）。
 * 与项目预设字体（FONT_CATALOG，来自 public/fonts/ 同源静态资源）**完全分离**：
 * - 客户端未连接 → 系统字体清单为空、相关字体下拉不展示该分组；
 * - 客户端已连接 → 拉取字体清单，按需注册到 document.fonts；
 * - @font-face 的 src 指向 `http://<client>/api/fonts/data?path=…`，
 *   导出端（位图 PDF / SVG 栅格化）会把字体以原始 URL 喂给栅格化器（客户端在线时可加载）。
 *
 * 主任铁律：客户端不可达时所有字体相关功能仍可用（回落到 FONT_CATALOG 预设字体）。
 */
import { ref, computed, type ComputedRef, type Ref } from 'vue'
import {
  listSystemFonts,
  systemFontDataUrl,
  fontFormatToCss,
  type SystemFontEntry,
} from '@op/core/print-client'
import { resolvePrinterBaseUrl } from '@op/config/printer'
import type { FontFamilyDef } from './catalog'

/* ------------------------------ 运行时状态（模块级单例） ------------------------------ */

export type SystemFontState = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

const state = ref<SystemFontState>('idle')
const fonts = ref<SystemFontEntry[]>([])
const errorText = ref('')
const baseUrl = ref(resolvePrinterBaseUrl())
const checkedAt = ref(0)

let inflight: Promise<boolean> | null = null

/** 同一个 family 可能有多张脸（Regular/Bold/Italic…），这里按 family 聚合成下拉选项 */
interface SystemFontGroup {
  family: string
  entries: SystemFontEntry[]
}
const grouped = computed<SystemFontGroup[]>(() => {
  const map = new Map<string, SystemFontEntry[]>()
  for (const f of fonts.value) {
    if (!f.family || !f.path) continue
    const arr = map.get(f.family) ?? []
    arr.push(f)
    map.set(f.family, arr)
  }
  return Array.from(map, ([family, entries]) => ({ family, entries }))
})

const count = computed(() => grouped.value.length)

/** 是否已连接客户端且字体清单就绪 */
const ready = computed(() => state.value === 'ready' && grouped.value.length > 0)

/** 按字体族名查找（兼容带引号 / 逗号 fallback 写法） */
export function findSystemFontFamily(family: string | undefined): FontFamilyDef | undefined {
  if (!family) return undefined
  // 取首个逗号前的部分作为主族名，去掉所有引号与空白
  const raw = family.split(',')[0] ?? ''
  const name = raw.replace(/["']/g, '').trim()
  const grp = grouped.value.find((g) => g.family === name)
  if (!grp) return undefined
  return systemGroupToCatalogDef(grp)
}

/** 把系统字体分组转为导出/加载通用 FontFamilyDef */
function systemGroupToCatalogDef(grp: SystemFontGroup): FontFamilyDef {
  // 粗略权重推断：family 含 Bold → 700，含 Italic → 标 italic
  const inferWeight = (e: SystemFontEntry): number => (/bold/i.test(e.family) ? 700 : 400)
  const inferStyle = (e: SystemFontEntry): 'normal' | 'italic' =>
    /italic|oblique/i.test(e.family) ? 'italic' : 'normal'
  const base = resolvePrinterBaseUrl()
  return {
    family: grp.family,
    label: grp.family,
    order: 999,
    faces: grp.entries.map((e) => ({
      src: systemFontDataUrl(e, base),
      weight: inferWeight(e),
      style: inferStyle(e),
    })),
  }
}

/* ------------------------------ 拉取 + 注册 ------------------------------ */

/** 浏览器 FontFace API 可用性 */
function canUseFontFace(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { FontFace?: unknown }).FontFace !== 'undefined'
}

/**
 * 拉取系统字体清单并注册到 document.fonts（设计期画布/预览生效）。
 * 并发调用合并为同一个 inflight Promise；客户端不可达时回落到 offline。
 */
async function load(): Promise<boolean> {
  if (inflight) return inflight
  state.value = 'loading'
  errorText.value = ''
  const base = resolvePrinterBaseUrl()
  baseUrl.value = base

  inflight = (async () => {
    try {
      const list = await listSystemFonts(base)
      fonts.value = list
      state.value = 'ready'
      // 异步注册到 document.fonts（不阻塞 load 返回；失败只是画布显示不出该字体）
      void registerInDocument(list, base)
      return true
    } catch {
      fonts.value = []
      state.value = 'offline'
      return false
    } finally {
      checkedAt.value = Date.now()
      inflight = null
    }
  })()
  return inflight
}

/** 判断某个 family+weight+style 的 FontFace 是否已注册（避免重复 add 导致 FontFaceSet 无限累积） */
function isFontRegistered(family: string, weight: string, style: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return false
  for (const f of document.fonts) {
    if (f.family === family && String(f.weight) === weight && f.style === style) return true
  }
  return false
}

/** 把系统字体按需注册到 document.fonts（浏览器 FontFace API） */
async function registerInDocument(list: SystemFontEntry[], base: string): Promise<void> {
  if (!canUseFontFace() || typeof document === 'undefined') return
  const FontFaceCtor = (
    window as unknown as {
      FontFace?: new (family: string, source: string, descriptors?: FontFaceDescriptors) => FontFace
    }
  ).FontFace
  if (!FontFaceCtor) return
  // 同 family 多脸分别注册；单文件失败不阻塞其它
  const tasks: Promise<void>[] = []
  for (const e of list) {
    if (!e.family || !e.path) continue
    const weight = /bold/i.test(e.family) ? 'bold' : 'normal'
    const style = /italic|oblique/i.test(e.family) ? 'italic' : 'normal'
    // 修复：打印客户端连通时，每次打开打印窗口都会 loadIfStale → 重新注册全部系统字体。
    // 旧的 document.fonts.add 不去重，FontFaceSet 会随每次打开累积，内存只增不减。
    // 这里跳过已注册的 (family+weight+style)，让集合稳定。
    if (isFontRegistered(e.family, weight, style)) continue
    try {
      const ff = new FontFaceCtor(e.family, `url(${systemFontDataUrl(e, base)})`, {
        weight,
        style,
      })
      tasks.push(
        ff.load().then(
          () => {
            document.fonts.add(ff)
          },
          () => {
            /* 单字体加载失败忽略 */
          },
        ),
      )
    } catch {
      /* 构造失败忽略 */
    }
  }
  await Promise.allSettled(tasks)
}

/** 距上次拉取超过 ttl（默认 60s）才重新拉取 */
async function loadIfStale(ttlMs = 60000): Promise<boolean> {
  if (state.value === 'ready' && Date.now() - checkedAt.value < ttlMs) return true
  if (state.value === 'loading' && inflight) return inflight
  return load()
}

/** 强制清空（客户端断开时调用，回落到只用预设字体） */
function clear(): void {
  fonts.value = []
  state.value = 'idle'
  errorText.value = ''
}

/* ------------------------------ 预览 / 导出 CSS ------------------------------ */

/**
 * 生成系统字体的 @font-face CSS（预览 iframe / 导出注入用）。
 * src 直接指向客户端 `/api/fonts/data?path=…`，要求客户端可达。
 * @param usedFamilies 只输出这些 family（未指定的不输出，避免给 iframe 喂几千行 CSS）
 */
function systemFontFaceCss(usedFamilies: string[] = []): string {
  const want = new Set(usedFamilies.map((f) => f.replace(/^"|"$/g, '').trim()))
  const groups = want.size > 0 ? grouped.value.filter((g) => want.has(g.family)) : grouped.value
  const base = baseUrl.value
  return groups
    .flatMap((grp) =>
      grp.entries.map((e) => {
        const url = systemFontDataUrl(e, base)
        const fmt = fontFormatToCss(e.format)
        const w = /bold/i.test(e.family) ? 'bold' : 'normal'
        const s = /italic|oblique/i.test(e.family) ? 'italic' : 'normal'
        return `@font-face{font-family:"${grp.family}";src:url(${url}) format("${fmt}");font-weight:${w};font-style:${s};}`
      }),
    )
    .join('')
}

/** 导出用：给定 family 列表，返回对应 FontFamilyDef（来自系统字体） */
function systemFontDefs(usedFamilies: string[]): FontFamilyDef[] {
  const want = new Set(usedFamilies.map((f) => f.replace(/^"|"$/g, '').trim()))
  return grouped.value.filter((g) => want.has(g.family)).map(systemGroupToCatalogDef)
}

/** 模块级只读快照（供非响应式上下文使用） */
function snapshot(): SystemFontEntry[] {
  return fonts.value.slice()
}

/* ------------------------------ 对外 composable ------------------------------ */

export interface UseSystemFonts {
  state: Ref<SystemFontState>
  fonts: Ref<SystemFontEntry[]>
  grouped: ComputedRef<SystemFontGroup[]>
  count: ComputedRef<number>
  ready: ComputedRef<boolean>
  errorText: Ref<string>
  baseUrl: Ref<string>
  checkedAt: Ref<number>
  load: () => Promise<boolean>
  loadIfStale: (ttlMs?: number) => Promise<boolean>
  clear: () => void
  systemFontFaceCss: (usedFamilies?: string[]) => string
  systemFontDefs: (usedFamilies: string[]) => FontFamilyDef[]
  snapshot: () => SystemFontEntry[]
  findSystemFontFamily: (family: string | undefined) => FontFamilyDef | undefined
}

export function useSystemFonts(): UseSystemFonts {
  return {
    state,
    fonts,
    grouped,
    count,
    ready,
    errorText,
    baseUrl,
    checkedAt,
    load,
    loadIfStale,
    clear,
    systemFontFaceCss,
    systemFontDefs,
    snapshot,
    findSystemFontFamily,
  }
}
