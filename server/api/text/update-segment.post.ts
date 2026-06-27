import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ textId: string; segmentId: string; text: string }>(event)
  if (!body?.textId || !body?.segmentId || !body?.text?.trim()) throw createError({ statusCode: 400 })

  const segRow = await queryOne('SELECT segments FROM texts WHERE id=?', [body.textId])
  if (!segRow) throw createError({ statusCode: 404 })

  let segs = []
  try { segs = JSON.parse(segRow.segments || '[]') } catch {}
  const seg = segs.find((s: any) => s.id === body.segmentId)
  if (!seg) throw createError({ statusCode: 404, message: '段落不存在' })
  seg.text = body.text.trim()

  await runQuery('UPDATE texts SET segments=?,updatedAt=? WHERE id=?', [JSON.stringify(segs), new Date().toISOString(), body.textId])
  return { ok: true }
})
