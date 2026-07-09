import { getDb, queryOne } from '../utils/db'

export default defineEventHandler(async () => {
  const result: any = {
    useTurso: process.env['USE_TURSO'],
    hasUrl: !!process.env['TURSO_URL'],
    hasToken: !!process.env['TURSO_AUTH_TOKEN'],
    node: process.version,
    tables: {},
  }

  try {
    const db = await getDb()
    const tables = ['texts', 'words', 'wordbooks', 'marks', 'daily_insights', 'knowledge_points', 'knowledge_pages']
    for (const t of tables) {
      try {
        const row = await queryOne(`SELECT COUNT(*) as c FROM ${t}`)
        result.tables[t] = row?.c ?? 'query failed'
      } catch (e: any) {
        result.tables[t] = `error: ${e.message}`
      }
    }
    result.status = 'ok'
  } catch (e: any) {
    result.status = 'error'
    result.error = e.message
    result.stack = e.stack?.slice(0, 500)
  }

  return result
})
