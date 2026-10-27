/**
 * 客户端图片压缩
 *
 * 贴图多为截图：PNG、2–5MB、尺寸远超阅读所需。
 * 统一转 webp 并限制最长边，上传体积通常降到原来的 1/10 左右，
 * 同时减少 R2 存储与跨端同步成本。
 */

export interface CompressOptions {
  /** 最长边像素，默认 1280（阅读区实际显示宽度通常 < 900px） */
  maxEdge?: number
  /** webp 质量，0–1 */
  quality?: number
  mime?: 'image/webp' | 'image/jpeg'
  /** 目标体积上限（字节）。超过则自动降质/降尺寸重压，默认 320KB */
  maxBytes?: number
}

export async function compressImageFile(
  file: File | Blob,
  opts: CompressOptions = {},
): Promise<File | Blob> {
  if (!import.meta.client) return file

  const { maxEdge = 1280, quality = 0.74, mime = 'image/webp', maxBytes = 320 * 1024 } = opts
  const type = file.type || ''
  if (!type.startsWith('image/')) return file
  // 动图与矢量图缩放会丢帧或失真，直接原样上传
  if (type === 'image/gif' || type === 'image/svg+xml') return file

  try {
    const bitmap = await createImageBitmap(file)
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxEdge / longest)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return file }

    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality))
    if (!blob) return file
    // 压缩没有收益时保留原图
    if (scale === 1 && blob.size >= file.size) return file

    const baseRaw = (file as File).name || 'image'
    const baseName = String(baseRaw).replace(/\.[^.]+$/, '') || 'image'
    const ext = mime === 'image/webp' ? '.webp' : '.jpg'

    let out = blob
    // 体积自适应：上传带宽约 100KB/s，超过预算会明显拖慢交互，逐级降质再压
    if (out.size > maxBytes) {
      for (const q of [0.62, 0.5]) {
        const next = await new Promise<Blob | null>(r => canvas.toBlob(r, mime, q))
        if (!next) break
        out = next
        if (out.size <= maxBytes) break
      }
    }
    // 仍超预算则按比例缩小尺寸再压一次（兜底，避免极端大图）
    if (out.size > maxBytes * 2) {
      const s2 = Math.sqrt(maxBytes / out.size)
      canvas.width = Math.max(1, Math.round(width * s2))
      canvas.height = Math.max(1, Math.round(height * s2))
      const ctx2 = canvas.getContext('2d')
      if (ctx2) {
        ctx2.imageSmoothingQuality = 'high'
        const bmp2 = await createImageBitmap(out)
        ctx2.drawImage(bmp2, 0, 0, canvas.width, canvas.height)
        bmp2.close?.()
        const next = await new Promise<Blob | null>(r => canvas.toBlob(r, mime, 0.7))
        if (next) out = next
      }
    }

    return new File([out], `${baseName}${ext}`, { type: mime })
  } catch {
    return file
  }
}

/**
 * Worker 版压缩：解码/缩放/编码全部在子线程，主线程零卡顿。
 * 供"粘贴乐观反馈"使用 —— 插入预览后立刻调它，输入不会感到任何停顿。
 * 环境不支持（无 Worker / 无 OffscreenCanvas）时自动回退主线程版本。
 */
export function compressImageAsync(
  file: File | Blob,
  opts: CompressOptions = {},
): Promise<File | Blob> {
  return new Promise((resolve, reject) => {
    if (!import.meta.client) { resolve(file); return }
    const supportsWorker =
      typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    if (!supportsWorker) {
      compressImageFile(file, opts).then(resolve, reject)
      return
    }
    try {
      const worker = new Worker(
        new URL('./image-compress.worker.js', import.meta.url),
        { type: 'module' },
      )
      worker.onmessage = (ev: MessageEvent) => {
        const d = ev.data as { ok: boolean; blob?: Blob; name?: string; error?: string }
        worker.terminate()
        if (d.ok && d.blob) {
          resolve(new File([d.blob], d.name || 'image.webp', { type: d.blob.type }))
        } else {
          // Worker 内失败 → 回退主线程压缩
          compressImageFile(file, opts).then(resolve, reject)
        }
      }
      worker.onerror = () => {
        worker.terminate()
        compressImageFile(file, opts).then(resolve, reject)
      }
      worker.postMessage({ file, opts })
    } catch {
      compressImageFile(file, opts).then(resolve, reject)
    }
  })
}

/** 人类可读体积，用于提示压缩收益 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
