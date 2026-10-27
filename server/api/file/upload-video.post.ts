import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, LEGACY_UPLOADS } from '../../utils/storage'
import { useR2, r2Put } from '../../utils/r2'
import { queueFileSync } from '../../utils/file-sync'

const ALLOWED_VIDEO = ['.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a', '.mov']

export default defineEventHandler(async (event) => {
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null
  if (!file) throw createError({ statusCode: 400, message: '请选择视频/音频文件' })

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_VIDEO.includes(ext)) {
    throw createError({ statusCode: 400, message: `不支持的文件格式 ${ext}，支持: ${ALLOWED_VIDEO.join(', ')}` })
  }

  const MAX_SIZE = 200 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    throw createError({ statusCode: 400, message: '文件过大，限制 200MB' })
  }

  const timestamp = Date.now()
  const safeName = `vid_${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const buffer = Buffer.from(await file.arrayBuffer())

  // ── R2 模式 ──
  if (useR2()) {
    const key = `uploads/${safeName}`
    const contentType = mimeFromExt(ext)
    await r2Put(key, buffer, contentType)
    return {
      filePath: key,
      url: `/api/file/${key}`,
      originalName: file.name,
      size: file.size,
    }
  }

  // ── 本地模式 ──
  ensureDir(LEGACY_UPLOADS)
  const filePath = path.join(LEGACY_UPLOADS, safeName)
  await writeFile(filePath, buffer)
  queueFileSync(`uploads/${safeName}`, filePath, mimeFromExt(ext))

  return {
    filePath: safeName,
    url: `/api/file/${safeName}`,
    originalName: file.name,
    size: file.size,
  }
})

function mimeFromExt(ext: string): string {
  const m: Record<string, string> = {
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mov': 'video/quicktime',
  }
  return m[ext] || 'application/octet-stream'
}
