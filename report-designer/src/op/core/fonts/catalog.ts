/**
 * 字体注册中心（《设计方案》§11.6 @open-print/fonts registry）
 *
 * 内置字体清单：font-family 名 → 字体文件（public/fonts/ 同源静态资源，零网络铁律）。
 * 命名与 `参考资料/fonts/fonts.txt` 一致：
 * - HedvigLettersSans-Regular.woff2 → Hedvig Letters Sans
 * - LiberationSerif-{Regular,Bold,Italic}.woff2 → Liberation Serif（一个族，三种字重/字形）
 * - SourceHanSansCN-Normal.woff2 → 思源黑体
 * - SourceHanSerifCN-Regular.ttf → 思源宋体
 * - ChillKai.woff2 → 寒蝉正楷体
 */

export interface FontFaceEntry {
  /** 同源字体文件 URL（相对 public 根；浏览器/位图栅格化用，woff2 优先） */
  src: string
  weight?: number
  style?: 'normal' | 'italic'
}

export interface FontFamilyDef {
  /** 字体族名（模板 style.fontFamily / CSS font-family 用这个名字） */
  family: string
  /** 展示名（属性面板下拉用） */
  label: string
  /**
   * 别名（同一字体可被多个 font-family 引用，常见于中英别名）。
   * builtinFontFaceCss 会为每个别名额外输出一份 @font-face，
   * 让 css-generator / 旧模板里的英文引用（如 "Source Han Sans CN"）也能命中内置字体。
   * 不传则只用 family 名注册。
   */
  aliases?: string[]
  /** 优先级（属性面板排序） */
  order: number
  faces: FontFaceEntry[]
}

/** 内置字体清单（顺序即面板展示顺序；woff2 供浏览器显示与位图 PDF 栅格化内联） */
export const FONT_CATALOG: FontFamilyDef[] = [
  {
    family: '思源黑体',
    label: '思源黑体',
    // 别名覆盖三处引用：
    //   - css-generator.TEXT_DEFAULT_FONT_FAMILY = '"Source Han Sans CN", ...'
    //   - measure.ts = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", ...'
    //   - 旧模板直接写 "Source Han Sans CN"/"Source Han Sans SC"
    // 这两个英文名其实是同一字体的不同发行版命名，CSS 引用都被同一 woff2 服务。
    aliases: ['Source Han Sans CN', 'Source Han Sans SC'],
    order: 1,
    faces: [{ src: '/fonts/SourceHanSansCN-Normal.woff2', weight: 400 }],
  },
  {
    family: '思源宋体',
    label: '思源宋体',
    aliases: ['Source Han Serif CN'],
    order: 2,
    faces: [{ src: '/fonts/SourceHanSerifCN-Regular.ttf', weight: 400 }],
  },
  {
    family: '寒蝉正楷体',
    label: '寒蝉正楷体',
    // 寒蝉无标准英文别名,留空
    order: 3,
    faces: [{ src: '/fonts/ChillKai.woff2', weight: 400 }],
  },
  {
    family: 'Liberation Serif',
    label: 'Liberation Serif',
    order: 4,
    faces: [
      { src: '/fonts/LiberationSerif-Regular.woff2', weight: 400 },
      { src: '/fonts/LiberationSerif-Bold.woff2', weight: 700 },
      { src: '/fonts/LiberationSerif-Italic.woff2', weight: 400, style: 'italic' },
    ],
  },
  {
    family: 'Hedvig Letters Sans',
    label: 'Hedvig Letters Sans',
    order: 5,
    faces: [{ src: '/fonts/HedvigLettersSans-Regular.woff2', weight: 400 }],
  },
]

/** 按字体族名查找（模板 style.fontFamily 可能存家族名，如 "思源黑体"） */
export function findFontFamily(family: string | undefined): FontFamilyDef | undefined {
  if (!family) return undefined
  const name = (family.replace(/^"|"$/g, '').split(',')[0] ?? '').trim()
  return FONT_CATALOG.find((f) => f.family === name)
}

/** 字体文件相对 public 根 → 绝对 URL（预览 iframe 注入用；浏览器环境） */
export function fontUrl(src: string): string {
  if (typeof window === 'undefined') return src
  return new URL(src, window.location.origin).href
}
