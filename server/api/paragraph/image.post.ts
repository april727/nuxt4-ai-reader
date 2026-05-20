import { getDb, saveDb } from '../../utils/db'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form.find(f => f.name === 'file')
  const textId = form.find(f => f.name === 'id')?.data.toString()
  const paraId = form.find(f => f.name === 'paragraphId')?.data.toString()

  if (!file || !textId || !paraId) {
    throw createError({ statusCode: 400, message: '缺少 file/id/paragraphId' })
  }

  const ext = extname(file.filename || '.png') || '.png'
  const name = `img_${randomUUID().slice(0, 8)}${ext}`

  const dir = join(process.cwd(), 'server', 'data', 'uploads')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), file.data)

  // 更新 segments JSON
  const db = await getDb()
  const stmt = db.prepare('SELECT segments FROM texts WHERE id=?')
  stmt.bind([textId])
  if (!stmt.step()) { stmt.free(); throw createError({ statusCode: 404 }) }
  const row = stmt.getAsObject()
  stmt.free()

  let segments: any[] = []
  try { segments = JSON.parse(row.segments || '[]') } catch {}

  // 如果 DB 中没有 segments，从文本字段生成基本段落
  if (!segments.length) {
    const textRows = db.prepare('SELECT text FROM texts WHERE id=?')
    textRows.bind([textId])
    if (textRows.step()) {
      const textRow = textRows.getAsObject()
      textRows.free()
      const text = textRow.text || ''
      const blocks = text.split(/\n\s*\n/).filter((b: string) => b.trim())
      if (blocks.length) {
        segments = blocks.map((b: string, i: number) => ({
          id: `q-${i}`, index: i, text: b.trim(),
        }))
      }
    } else {
      textRows.free()
    }
  }

  const para = segments.find((s: any) => s.id === paraId)
  if (para) {
    if (!para.images) para.images = []
    para.images.push(name)
  }

  db.run('UPDATE texts SET segments=?,updatedAt=? WHERE id=?',
    [JSON.stringify(segments), new Date().toISOString(), textId])
  await saveDb()

  return { url: `/api/file/${name}`, name, paragraphId: paraId }
})
