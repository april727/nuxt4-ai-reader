import { writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LEGACY_UPLOADS, ensureDir } from '../../utils/storage'
import { useR2, r2Put } from '../../utils/r2'
import { queueFileSync } from '../../utils/file-sync'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.[0]) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form[0]
  const ext = extname(file.filename || '.jpg') || '.jpg'
  const name = `thumb_${randomUUID().slice(0, 8)}${ext}`

  // ── R2 模式 ──
  if (useR2()) {
    const key = `uploads/${name}`
    const ct = ext === '.png' ? 'image/png' : 'image/jpeg'
    await r2Put(key, file.data, ct)
    return { url: `/api/file/${key}`, path: key, size: file.data?.length || 0 }
  }

  // ── 本地模式 ──
  ensureDir(LEGACY_UPLOADS)
  const filePath = join(LEGACY_UPLOADS, name)
  writeFileSync(filePath, file.data)
  const ct = ext === '.png' ? 'image/png' : 'image/jpeg'
  queueFileSync(`uploads/${name}`, filePath, ct)

  return { url: `/api/file/${name}`, path: name, size: file.data?.length || 0 }
})
