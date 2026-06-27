import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; paragraphId: string; imageName: string }>(event)
  if (!body?.id || !body.paragraphId || !body.imageName) {
    throw createError({ statusCode: 400 })
  }

  const segRow = await queryOne('SELECT segments FROM texts WHERE id=?', [body.id])
  if (!segRow) throw createError({ statusCode: 404 })

  let segments: any[] = []
  try { segments = JSON.parse(segRow.segments || '[]') } catch {}

  const para = segments.find((s: any) => s.id === body.paragraphId)
  if (para?.images) {
    para.images = para.images.filter((n: string) => n !== body.imageName)
  }

  await runQuery('UPDATE texts SET segments=?,updatedAt=? WHERE id=?',
    [JSON.stringify(segments), new Date().toISOString(), body.id])

  return { ok: true }
})
