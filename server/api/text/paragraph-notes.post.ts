import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    paragraphNotes: any[]
  }>(event)

  if (!body?.textId) {
    throw createError({ statusCode: 400, message: '缺少 textId' })
  }

  const row = await queryOne('SELECT id FROM texts WHERE id=?', [body.textId])
  if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

  await runQuery(
    'UPDATE texts SET paragraphNotes=?, updatedAt=? WHERE id=?',
    [
      JSON.stringify(body.paragraphNotes || []),
      new Date().toISOString(),
      body.textId,
    ]
  )

  return { ok: true }
})
