/**
 * 字体嵌入工具 —— 让栅格化产物（PNG / JPG / PDF）与矢量 SVG / 无头打印 HTML 也能用上「自定义字体」。
 *
 * ## 为什么需要它
 * - 预览 / 浏览器打印：字体由主文档或 iframe 的 `@font-face` 提供，正常生效。
 * - 但 PNG/JPG/PDF 走 `SVG <foreignObject>` 光栅化，而 `<img>` 加载的 SVG 是**隔离上下文**，
 *   看不到父文档的 `@font-face`，只能用系统字体（PingFang SC / 系统 sans-serif 兜底）。
 *   若模板指定了「思源宋体」等自定义字体，栅格化产物会丢字体。
 * - 解法：把字体以 `@font-face(data-URI)` 直接写进 SVG / HTML 本身，隔离上下文也能用。
 *
 * 仅当 `fonts` 显式传入才做网络读取（同源本地字体），默认不联网，符合零网络铁律。
 */
export interface FontFaceDef {
  /** 字体族名，必须与模板 CSS 中的 font-family 一致 */
  family: string
  /** 同源字体文件 URL（.woff2 / .ttf / .otf / .woff） */
  src: string
  weight?: string | number
  style?: string
}

function fontFormat(src: string): string {
  const ext = (src.split('?')[0] ?? '').split('.').pop()?.toLowerCase()
  if (ext === 'ttf') return 'truetype'
  if (ext === 'otf') return 'opentype'
  if (ext === 'woff2') return 'woff2'
  if (ext === 'eot') return 'embedded-opentype'
  return 'woff'
}

function fontMime(src: string): string {
  const ext = (src.split('?')[0] ?? '').split('.').pop()?.toLowerCase()
  if (ext === 'ttf') return 'font/ttf'
  if (ext === 'otf') return 'font/otf'
  if (ext === 'eot') return 'application/vnd.ms-fontobject'
  if (ext === 'woff') return 'font/woff'
  return 'font/woff2'
}

async function fetchFontDataUri(src: string): Promise<string> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`字体加载失败 ${src}: ${res.status}`)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${fontMime(src)};base64,${btoa(bin)}`
}

function buildFontFaceCss(defs: FontFaceDef[], dataUris: string[]): string {
  return defs
    .map(
      (d, i) =>
        `@font-face{font-family:"${d.family}";src:url(${dataUris[i]}) format("${fontFormat(
          d.src,
        )}");font-weight:${d.weight ?? 'normal'};font-style:${d.style ?? 'normal'};}`,
    )
    .join('')
}

const XHTML_DIV = '<div xmlns="http://www.w3.org/1999/xhtml">'

/** 把字体以 data-URI @font-face 嵌进 SVG（每个 xhtml div 顶部）—— 供 rasterize / SVG 矢量导出使用
 * 单个字体加载失败（文件缺失 / 网络异常）时跳过该字体，走系统字体兜底，不阻塞导出。 */
export async function embedFontsInSvg(svg: string, defs: FontFaceDef[]): Promise<string> {
  if (!defs.length) return svg
  const pairs = await Promise.all(
    defs.map(async (d) => {
      try {
        return { d, uri: await fetchFontDataUri(d.src) }
      } catch {
        return null
      }
    }),
  )
  const ok = pairs.filter((p): p is { d: FontFaceDef; uri: string } => p !== null)
  if (!ok.length) return svg
  const css = `<style>${buildFontFaceCss(ok.map((p) => p.d), ok.map((p) => p.uri))}</style>`
  return svg.split(XHTML_DIV).join(`${XHTML_DIV}${css}`)
}

/** 把字体以 data-URI @font-face 嵌进 HTML <head> —— 供无头静默打印文档使用
 * 单个字体加载失败（文件缺失 / 网络异常）时跳过该字体，走系统字体兜底，不阻塞打印。 */
export async function embedFontsInHtml(html: string, defs: FontFaceDef[]): Promise<string> {
  if (!defs.length) return html
  const pairs = await Promise.all(
    defs.map(async (d) => {
      try {
        return { d, uri: await fetchFontDataUri(d.src) }
      } catch {
        return null
      }
    }),
  )
  const ok = pairs.filter((p): p is { d: FontFaceDef; uri: string } => p !== null)
  if (!ok.length) return html
  const style = `<style>${buildFontFaceCss(ok.map((p) => p.d), ok.map((p) => p.uri))}</style>`
  if (html.includes('</head>')) return html.replace('</head>', `${style}</head>`)
  return `${style}${html}`
}
