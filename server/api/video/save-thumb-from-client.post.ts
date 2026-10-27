import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { queryOne, runQuery } from '../../utils/db'
import { getThumbsDir, ensureDir } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  const idField = form?.find(f => f.name === 'id')
  const fileField = form?.find(f => f.name === 'file')
  if (!idField || !fileField?.data) throw createError({ statusCode: 400 })

  const videoId = idField.data.toString()
  const row = await queryOne('SELECT folder, videoMeta FROM texts WHERE id=?', [videoId])
  if (!row) throw createError({ statusCode: 404 })

  let meta: any = {}
  try { meta = JSON.parse(row.videoMeta || '{}') } catch {}
  const folderId = row.folder || 'default'

  const ext = fileField.filename?.includes('.') ? '.' + fileField.filename.split('.').pop() : '.jpg'
  const thumbDir = getThumbsDir(folderId, videoId)
  ensureDir(thumbDir)
  const filename = `cover${ext}`
  writeFileSync(path.join(thumbDir, filename), fileField.data)

  meta.thumbnail = `${folderId}/${videoId}/thumbs/${filename}`
  await runQuery('UPDATE texts SET videoMeta=? WHERE id=?', [JSON.stringify(meta), videoId])

  return { ok: true }
})
