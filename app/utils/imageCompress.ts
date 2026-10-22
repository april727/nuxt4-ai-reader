/**
 * 客户端图片压缩
 *
 * 贴图多为截图：PNG、2–5MB、尺寸远超阅读所需。
 * 统一转 webp 并限制最长边，上传体积通常降到原来的 1/10 左右，
 * 同时减少 R2 存储与跨端同步成本。
 */

export interface CompressOptions {
  /** 最长边像素，默认 1600 */
  maxEdge?: number
  /** webp 质量，0–1 */
  quality?: number
  mime?: 'image/webp' | 'image/jpeg'
}

export async function compressImageFile(
  file: File | Blob,
  opts: CompressOptions = {},
): Promise<File | Blob> {
  if (!import.meta.client) return file

  const { maxEdge = 1600, quality = 0.82, mime = 'image/webp' } = opts
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

    const base = (file as File).name?.replace(/\.[^.]+$/, '') || 'image'
    const ext = mime === 'image/webp' ? '.webp' : '.jpg'
    return new File([blob], `${base}${ext}`, { type: mime })
  } catch {
    return file
  }
}

/** 人类可读体积，用于提示压缩收益 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
