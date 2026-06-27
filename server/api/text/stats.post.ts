import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; marks?: number }>(event)
  if (!body?.id) return { ok: true }

  const statRow = await queryOne('SELECT readCount FROM stats WHERE textId=?', [body.id])
  const count = statRow?.readCount || 0

  await runQuery('INSERT OR REPLACE INTO stats (textId,readCount,lastReadAt,markCount) VALUES (?,?,?,?)',
    [body.id, Number(count) + 1, new Date().toISOString(), body.marks || 0])
  return { ok: true }
})
