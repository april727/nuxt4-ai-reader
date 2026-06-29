/**
 * 从 Turso 拉取数据到本地 reader.db
 * 运行: npx tsx scripts/pull-from-turso.ts
 *
 * 增量拉取：只导入本地没有的行，本地已有则不覆盖
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { readFileSync as readEnv } from 'node:fs'

function loadEnv() {
  const p = resolve('.env')
  if (!existsSync(p)) return
  for (const line of readEnv(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
}

const TABLES = [
  'texts',
  'folders',
  'stats',
  'knowledge_points',
  'wordbooks',
  'words',
  'daily_insights',
]

async function main() {
  loadEnv()

  const DB_PATH = resolve('server/data/reader.db')

  console.log('☁️  连接 Turso...')
  const turso = createClient({
    url: process.env['TURSO_URL']!,
    authToken: process.env['TURSO_AUTH_TOKEN']!,
  })

  console.log('📖 读取本地数据库...')
  const SQL = await initSqlJs()
  let localDb: any
  if (existsSync(DB_PATH)) {
    localDb = new SQL.Database(readFileSync(DB_PATH))
  } else {
    localDb = new SQL.Database()
    mkdirSync(dirname(DB_PATH), { recursive: true })
  }

  let total = 0
  let skipped = 0

  for (const table of TABLES) {
    // 获取 Turso 表结构
    let columns: string[] = []
    try {
      const colRes = await turso.execute(`SELECT * FROM ${table} LIMIT 1`)
      columns = colRes.columns
    } catch { console.log(`  ⏭️  ${table}: Turso 中不存在`); continue }

    if (columns.length === 0) { console.log(`  ⏭️  ${table}: 空表`); continue }

    // 获取本地已有主键列（第一列）
    let localPks = new Set<string>()
    try {
      const pkStmt = localDb.prepare(`SELECT ${columns[0]} FROM ${table}`)
      while (pkStmt.step()) localPks.add(String(pkStmt.getAsObject()[columns[0]] ?? ''))
      pkStmt.free()
    } catch { /* 本地表不存在 */ }

    // 从 Turso 拉取全部行
    const remote = await turso.execute(`SELECT * FROM ${table}`)
    const newRows: any[][] = []

    for (const row of remote.rows) {
      const pk = String(row[0] ?? '')
      if (!localPks.has(pk)) {
        newRows.push(row as any[])
      } else {
        skipped++
      }
    }

    if (newRows.length === 0) {
      console.log(`  ✅ ${table}: 0 新增 (${skipped} 跳过)`)
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
    total += newRows.length
    console.log(`  ✅ ${table}: ${newRows.length} 新行`)
  }

  // 保存
  const buf = localDb.export()
  writeFileSync(DB_PATH, Buffer.from(buf))
  localDb.close()
  console.log(`\n✅ 完成: ${total} 行已导入本地, ${skipped} 已跳过`)
}

main().catch(err => { console.error('❌', err.message); process.exit(1) })
