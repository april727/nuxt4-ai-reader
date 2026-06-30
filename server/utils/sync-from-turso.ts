/**
 * 从 Turso 拉取数据到本地 sql.js
 * 增量拉取：只导入本地没有的行，本地已有则不覆盖
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const TABLES = [
  'texts', 'folders', 'stats', 'knowledge_points',
  'wordbooks', 'words', 'daily_insights',
]

export interface PullResult {
  tables: Record<string, { inserted: number; skipped: number }>
  totalInserted: number
  totalSkipped: number
  ok: boolean
  error?: string
}

export async function syncFromTurso(): Promise<PullResult> {
  const url = process.env['TURSO_URL']
  const token = process.env['TURSO_AUTH_TOKEN']
  if (!url || !token) throw new Error('TURSO_URL / TURSO_AUTH_TOKEN 未配置')

  const DB_PATH = path.resolve('server/data/reader.db')
  const DB_DIR = path.dirname(DB_PATH)

  const turso = createClient({ url, authToken: token })

  const SQL = await initSqlJs()
  let localDb: any
  if (existsSync(DB_PATH)) {
    localDb = new SQL.Database(readFileSync(DB_PATH))
  } else {
    localDb = new SQL.Database()
    mkdirSync(DB_DIR, { recursive: true })
  }

  const tables: PullResult['tables'] = {}
  let totalInserted = 0
  let totalSkipped = 0

  for (const table of TABLES) {
    let columns: string[] = []
    try {
      const colRes = await turso.execute(`SELECT * FROM ${table} LIMIT 1`)
      columns = colRes.columns
    } catch {
      tables[table] = { inserted: 0, skipped: 0 }
      continue
    }

    if (columns.length === 0) {
      tables[table] = { inserted: 0, skipped: 0 }
      continue
    }

    // 获取本地已有主键
    const localPks = new Set<string>()
    try {
      const pkStmt = localDb.prepare(`SELECT ${columns[0]} FROM ${table}`)
      while (pkStmt.step()) {
        localPks.add(String(pkStmt.getAsObject()[columns[0]] ?? ''))
      }
      pkStmt.free()
    } catch { /* 本地表不存在 */ }

    // 从 Turso 拉取全部行
    const remote = await turso.execute(`SELECT * FROM ${table}`)
    const newRows: any[][] = []
    let skipped = 0

    for (const row of remote.rows) {
      const pk = String(row[0] ?? '')
      if (!localPks.has(pk)) {
        newRows.push(row as any[])
      } else {
        skipped++
      }
    }

    if (newRows.length === 0) {
      tables[table] = { inserted: 0, skipped }
      totalSkipped += skipped
      continue
    }

    // 确保本地表存在
    try {
      const colDefs = columns.map(c => `${c} TEXT`).join(',')
      localDb.run(`CREATE TABLE IF NOT EXISTS ${table} (${colDefs})`)
    } catch {}

    const ph = columns.map(() => '?').join(',')
    const cols = columns.join(',')
    const insertSql = `INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${ph})`

    for (const row of newRows) {
      localDb.run(insertSql, row)
    }

    tables[table] = { inserted: newRows.length, skipped }
    totalInserted += newRows.length
    totalSkipped += skipped
  }

  // 保存
  const buf = localDb.export()
  writeFileSync(DB_PATH, Buffer.from(buf))
  localDb.close()

  return { tables, totalInserted, totalSkipped, ok: true }
}
