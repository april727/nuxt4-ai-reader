import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; marks?: number }>(event)
  if (!body?.id) return { ok: true }

  const db = await getDb()
  const stmt = db.prepare('SELECT readCount FROM stats WHERE textId=?')
  stmt.bind([body.id])
  let count = 0
  if (stmt.step()) count = stmt.getAsObject().readCount
  stmt.free()

  db.run('INSERT OR REPLACE INTO stats (textId,readCount,lastReadAt,markCount) VALUES (?,?,?,?)',
    [body.id, count + 1, new Date().toISOString(), body.marks || 0])
  await saveDb()
  return { ok: true }
})
