/**
 * 字体本地加载（《设计方案》§11.6 @open-print/fonts loader）
 *
 * - `loadBuiltinFonts()`：用 FontFace API 把内置字体注册到浏览器（设计期画布/预览生效），
 *   字体文件来自 public/fonts/ 同源静态资源，零网络依赖。
 * - `builtinFontFaceCss(baseUrl)`：生成 @font-face CSS（预览 iframe 注入用）。
 * - `templateUsedFonts(template)`：提取模板文本控件实际用到的字体族（供导出内联）。
 */
import { FONT_CATALOG, findFontFamily, type FontFamilyDef } from './catalog'
import type { TemplateData } from '@op/types/template'
import type { AnyControl, TextControl } from '@op/types/control'
import type { FontFaceDef } from '@op/core/export-engine/fonts'

/** 浏览器环境是否可用 FontFace API */
function canUseFontFace(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { FontFace?: unknown }).FontFace !== 'undefined'
}

/** 把内置字体注册到 document.fonts（浏览器）；resolve 后返回已加载的族名列表 */
export async function loadBuiltinFonts(defs: FontFamilyDef[] = FONT_CATALOG): Promise<string[]> {
  if (!canUseFontFace() || typeof document === 'undefined' || typeof window === 'undefined') return []
  const FontFaceCtor = (
    window as unknown as {
      FontFace?: new (family: string, source: string | ArrayBuffer, descriptors?: FontFaceDescriptors) => FontFace
    }
  ).FontFace
  if (!FontFaceCtor) return []
  const loaded: string[] = []
  const tasks: Promise<void>[] = []
  for (const def of defs) {
    for (const face of def.faces) {
      try {
        const fontFace = new FontFaceCtor(
          def.family,
          `url(${new URL(face.src, window.location.origin).href})`,
          {
            weight: String(face.weight ?? 'normal'),
            style: face.style ?? 'normal',
          },
        )
        tasks.push(
          fontFace.load().then(() => {
            document.fonts.add(fontFace)
            if (!loaded.includes(def.family)) loaded.push(def.family)
          }),
        )
      } catch {
        /* 单字体失败不阻塞整体 */
      }
    }
  }
  await Promise.allSettled(tasks)
  return loaded
}

/** 生成内置字体的 @font-face CSS 块（baseUrl 用于拼字体绝对/相对路径）
 *
 * ★ 每个 face 输出 N 份 @font-face —— family 名 + 所有别名(aliases)。
 * 原因：css-generator.TEXT_DEFAULT_FONT_FAMILY 写的是英文 "Source Han Sans CN"，
 * 而 catalog family 是中文 "思源黑体"，两者不匹配时 @font-face 不生效，
 * 浏览器回落系统字体 —— 沙箱 iframe 里 print() 又取不到系统字体，PDF 退化到
 * Type3 空字形，整个 PDF 变成空白页（用户反馈的核心 bug）。别名让英文引用也命中内置 woff2。
 */
export function builtinFontFaceCss(baseUrl: string): string {
  return FONT_CATALOG.map((def) =>
    def.faces
      .flatMap((face) => {
        const src = face.src.startsWith('/') ? `${baseUrl.replace(/\/+$/, '')}${face.src}` : face.src
        const ext = src.split('?')[0]?.split('.').pop()?.toLowerCase()
        const format = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext === 'woff' ? 'woff' : 'woff2'
        const weight = face.weight ?? 'normal'
        const style = face.style ?? 'normal'
        // 同一字体可被多个 font-family 名引用,每个名各发一份 @font-face
        const names = [def.family, ...(def.aliases ?? [])]
        return names.map(
          (name) =>
            `@font-face{font-family:"${name}";` +
            `src:url(${src}) format("${format}");` +
            `font-weight:${weight};font-style:${style};}`,
        )
      })
      .join(''),
  ).join('')
}

/** 提取模板中实际用到的内置字体族（供导出/无头打印内联，避免全量内联） */
export function templateUsedFonts(template: TemplateData<AnyControl>): FontFamilyDef[] {
  const used = new Set<string>()
  const walk = (comps: AnyControl[]): void => {
    for (const c of comps) {
      if (c.type === 'text') {
        const family = (c as TextControl).style?.fontFamily
        const def = findFontFamily(family)
        if (def) used.add(def.family)
      }
      if (c.type === 'zone') walk(c.children)
    }
  }
  for (const section of template.document.sections) walk(section.components as AnyControl[])
  return FONT_CATALOG.filter((f) => used.has(f.family))
}

/** 转为导出引擎的 FontFaceDef（data-URI 内联用） */
export function toExportFontDefs(defs: FontFamilyDef[]): FontFaceDef[] {
  return defs.flatMap((def) =>
    def.faces.map((face) => ({
      family: def.family,
      src: face.src,
      weight: face.weight,
      style: face.style,
    })),
  )
}
