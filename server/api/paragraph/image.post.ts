import { queryOne, runQuery } from '../../utils/db'
import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getImagesDir, ensureDir } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form.find(f => f.name === 'file')
  const textId = form.find(f => f.name === 'id')?.data.toString()
  const paraId = form.find(f => f.name === 'paragraphId')?.data.toString()

  if (!file || !textId || !paraId) {
    throw createError({ statusCode: 400, message: '缺少 file/id/paragraphId' })
  }

  // 获取该内容所属的 folder
  let folderId = 'default'
  const folderRow = await queryOne('SELECT folder FROM texts WHERE id=?', [textId])
  if (folderRow) folderId = folderRow.folder || 'default'

  const ext = file.filename ? (file.filename.includes('.') ? '.' + file.filename.split('.').pop() : '.png') : '.png'
  const hash = randomUUID().slice(0, 8)
  const dir = getImagesDir(folderId, textId)
  ensureDir(dir)

  const filename = `img_${hash}${ext}`
  const filePath = `${folderId}/${textId}/images/${filename}`
  writeFileSync(dir + '/' + filename, file.data)

  // 更新 segments JSON
  const segRow = await queryOne('SELECT segments FROM texts WHERE id=?', [textId])
  if (!segRow) throw createError({ statusCode: 404 })

  let segments: any[] = []
  try { segments = JSON.parse(segRow.segments || '[]') } catch {}

  if (!segments.length) {
    const textRow = await queryOne('SELECT text FROM texts WHERE id=?', [textId])
    if (textRow) {
      const text = textRow.text || ''
      const blocks = text.split(/\n\s*\n/).filter((b: string) => b.trim())
      if (blocks.length) {
        segments = blocks.map((b: string, i: number) => ({
          id: `q-${i}`, index: i, text: b.trim(),
        }))
      }
    }
  }

  const para = segments.find((s: any) => s.id === paraId)
  if (para) {
    if (!para.images) para.images = []
    para.images.push(filePath)
  }

  await runQuery('UPDATE texts SET segments=?,updatedAt=? WHERE id=?',
    [JSON.stringify(segments), new Date().toISOString(), textId])

  return { url: `/api/file/${encodeURIComponent(filePath)}`, name: filePath, paragraphId: paraId }
})
