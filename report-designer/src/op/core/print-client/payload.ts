/**
 * 打印载荷构建 —— 模板 + 数据 → 推送给本地打印客户端的文档内容
 *
 * 推送格式规则（2026-08-13 最终定案）：
 * - **统一推 PDF（base64）**，不论单页或多页。
 *
 * 演进历程：
 * - 早期单页走 SVG 原文 → Qt `QSvgRenderer` 不解析 foreignObject/HTML/CSS，打不出内容（已废弃）。
 * - 中间试过单页走 JPG → 但 JPG 是单张位图、没有页面尺寸/DPI 元数据，不如 PDF 适合打印；
 *   且用户希望打印格式统一便于客户端处理。最终回到统一 PDF。
 *
 * 清晰度优先：PDF 内部位图底图默认 **PNG（无损·最高清）**，文字/线条边缘真正锐利，
 * 打印推荐。体积较大（纯文字页 ~10+ MB）；体积敏感场景可传 `imageType: 'jpeg'`。
 *
 * DPI 感知（2026-08-20）：传 `dpi`（打印机 defaultDpi / maxDpi 决策，见 ./dpi.ts）
 * 即按目标打印机实际分辨率栅格化（scale = dpi / 96），客户端打印不再二次重采样；
 * 超高 DPI 会被 canvas 面积护栏自动下调（页面 mm 尺寸不变，仅降分辨率）。
 */
import type { RenderRequest } from '@op/core/sdk'
import { renderDocument } from '@op/core/sdk'
import { documentToPdf } from '@op/core/export-engine'
import { blobToBase64 } from './client'

export interface PrintPayload {
  /** 载荷格式：恒为 pdf */
  format: 'pdf'
  /** 载荷编码：恒为 base64 */
  encoding: 'base64'
  /** PDF 的 base64 字符串（不含 data: 前缀） */
  content: string
  /** 总页数 */
  pages: number
  /** 页面物理宽（mm），与 PDF 页面一致，供客户端设置纸张尺寸 */
  width: number
  /** 页面物理高（mm） */
  height: number
  /** 载荷字符长度（UI 展示体积用） */
  bytes: number
}

export interface BuildPrintPayloadOptions {
  /**
   * 渲染分辨率（DPI）：按目标打印机实际分辨率栅格化 PDF（scale = dpi / 96），
   * 客户端不再二次重采样。通常取打印机 `defaultDpi`（弹窗可手动改，需 ≤ `maxDpi`）。
   * 与 `scale` 同时给出时 dpi 优先；两者都缺省回退 scale 3（288dpi）。
   */
  dpi?: number
  /** 位图倍率，默认 3（288dpi·最高清）；被 dpi 覆盖 */
  scale?: number
  /**
   * 多页 PDF 的位图底图压缩格式（默认 `'png'`，无损最清晰）：
   * - `'png'`：无损，文字/线条边缘锐利，打印推荐；
   * - `'jpeg'`：体积小，仅体积敏感场景。
   */
  imageType?: 'jpeg' | 'png'
  /**
   * 进度回调（0–100）。渲染+PDF 生成阶段会逐步推进：
   * 5（开始）→ 30（渲染完成）→ 30~80（逐页栅格化）→ 85（PDF 编码完成）。
   * 推送阶段由 `submitPrintJob` 的回调继续推进。
   */
  onProgress?: (pct: number) => void
}

/**
 * 构建推送载荷（统一 PDF-base64）。
 *
 * 不论单页或多页，都先 `renderDocument()` → `documentToPdf()`（浏览器内用 Chromium
 * 栅格化 foreignObject 内容成位图底图，默认 PNG 无损最高清）→ `blobToBase64()`。
 * 本地客户端拿到的就是可直接 `QPrinter` 打印的 PDF 字节流。
 */
export async function buildPrintPayload(
  request: RenderRequest,
  options: BuildPrintPayloadOptions = {},
): Promise<PrintPayload> {
  const onProgress = options.onProgress
  onProgress?.(5)

  const result = await renderDocument(request)
  const pages = result.pages.length
  const deco = request.output?.pageDecoration

  onProgress?.(30)
  const blob = await documentToPdf(result, {
    dpi: options.dpi,
    scale: options.scale,
    imageType: options.imageType ?? 'png',
    pageDecoration: deco,
    onPage: (current, total) => {
      // 逐页栅格化：30% → 80%
      onProgress?.(30 + Math.round((current / Math.max(total, 1)) * 50))
    },
  })
  onProgress?.(85)
  const base64 = await blobToBase64(blob)
  return {
    format: 'pdf',
    encoding: 'base64',
    content: base64,
    pages: Math.max(pages, 1),
    // 透传页面物理尺寸（mm），与生成 PDF 用的 format:[w,h] 同源（result.metrics 恒为 mm），
    // 供客户端直接设置纸张大小，避免依赖解析 PDF MediaBox 导致纸张不符/打不准。
    width: result.metrics.pageWidth,
    height: result.metrics.pageHeight,
    bytes: base64.length,
  }
}

/** 人类可读体积（UI 提示用） */
export function formatPayloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
