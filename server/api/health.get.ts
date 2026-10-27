import { getDb, queryOne } from '../utils/db'
import { hasNodeSqlite } from '../utils/db-local'

export default defineEventHandler(async () => {
  const result: any = {
    useTurso: process.env['USE_TURSO'],
    // 实际生效的存储引擎：turso=全部跨境 / node:sqlite=本地主库 / sql.js=兜底
    dbEngine: process.env['USE_TURSO'] === 'true' ? 'turso' : (hasNodeSqlite() ? 'node:sqlite' : 'sql.js'),
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
