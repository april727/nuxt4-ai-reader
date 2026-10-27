/**
 * 数据迁移脚本：本地 sql.js reader.db → Turso 云端
 *
 * 运行方式：
 *   npx tsx scripts/migrate-to-turso.ts
 *
 * 自动读取项目根目录的 .env
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_PATH = resolve('server/data/reader.db')
const BATCH_SIZE = 50

/** 手动加载 .env（无需 dotenv 依赖） */
function loadEnv() {
  const envPath = resolve('.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

async function main() {
  loadEnv()

  const url = process.env.TURSO_URL
  const token = process.env.TURSO_AUTH_TOKEN
  if (!url || !token) {
    console.error('❌ 请在 .env 中设置 TURSO_URL 和 TURSO_AUTH_TOKEN')
    process.exit(1)
  }

  console.log('📖 读取本地数据库...')
  const SQL = await initSqlJs()
  const buf = readFileSync(DB_PATH)
  const localDb = new SQL.Database(buf)

  console.log('☁️  连接 Turso...')
  const turso = createClient({ url, authToken: token })

  // 重建表（清空旧数据，用最新完整 schema）
  console.log('🔄 重建 Turso 表...')
  const tables = ['daily_insights', 'words', 'wordbooks', 'knowledge_points', 'stats', 'folders', 'texts']
  for (const t of tables) {
    try { await turso.execute(`DROP TABLE IF EXISTS ${t}`) } catch {}
  }
  await ensureTables(turso)

  // ── 迁移各表 ──
  await migrateTable(localDb, turso, 'folders', ['id', 'name', 'parent', 'isPrivate', 'passwordHash', 'createdAt'])
  await migrateTable(localDb, turso, 'texts', [
    'id', 'title', 'text', 'source', 'folder', 'excerpt', 'filePath',
    'analysis', 'segments', 'explanations', 'marks', 'readingPosition',
    'paragraphChats', 'videoMeta', 'videoSubtitles', 'subtitlePractice',
    'completedAt', 'notes', 'paragraphNotes', 'createdAt', 'updatedAt',
  ])
  await migrateTable(localDb, turso, 'stats', ['textId', 'readCount', 'lastReadAt', 'markCount'])
  await migrateTable(localDb, turso, 'knowledge_points', [
    'id', 'content', 'note', 'sourceId', 'sourceTitle', 'sourceType',
    'sourceContext', 'customGroup', 'tags', 'chatHistory', 'sortOrder',
    'createdAt', 'updatedAt',
  ])
  await migrateTable(localDb, turso, 'wordbooks', ['id', 'name', 'isDefault', 'sortOrder', 'createdAt'])
  await migrateTable(localDb, turso, 'words', [
    'id', 'bookId', 'word', 'phonetic', 'meaning', 'example', 'note',
    'phase', 'learnCorrect', 'learnTotal', 'learnWrong', 'ease',
    'interval', 'repetitions', 'nextReview', 'source', 'pos',
    'createdAt', 'updatedAt',
  ])
  await migrateTable(localDb, turso, 'daily_insights', ['date', 'content', 'createdAt'])

  localDb.close()
  console.log('\n✅ 迁移完成！重启 yarn dev 即可看到数据')
}

async function ensureTables(turso: ReturnType<typeof createClient>) {
  const db = turso
  await db.execute(`CREATE TABLE IF NOT EXISTS texts (
    id TEXT PRIMARY KEY, title TEXT, text TEXT, source TEXT,
    folder TEXT DEFAULT 'default', excerpt TEXT, filePath TEXT,
    analysis TEXT, segments TEXT, explanations TEXT,
    marks TEXT, readingPosition TEXT, paragraphChats TEXT DEFAULT '',
    videoMeta TEXT DEFAULT '', videoSubtitles TEXT DEFAULT '',
    subtitlePractice TEXT DEFAULT '', completedAt TEXT DEFAULT NULL,
    notes TEXT DEFAULT '', paragraphNotes TEXT DEFAULT '[]',
    createdAt TEXT, updatedAt TEXT
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, name TEXT, parent TEXT DEFAULT '',
    isPrivate INTEGER DEFAULT 0, passwordHash TEXT DEFAULT '',
    createdAt TEXT
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS stats (
    textId TEXT PRIMARY KEY, readCount INTEGER DEFAULT 0, lastReadAt TEXT,
    markCount INTEGER DEFAULT 0
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS knowledge_points (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, note TEXT DEFAULT '',
    sourceId TEXT DEFAULT '', sourceTitle TEXT DEFAULT '',
    sourceType TEXT DEFAULT 'selection', sourceContext TEXT DEFAULT '',
    customGroup TEXT DEFAULT '', tags TEXT DEFAULT '[]',
    chatHistory TEXT DEFAULT '[]', sortOrder INTEGER DEFAULT 0,
    createdAt TEXT, updatedAt TEXT
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS wordbooks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, isDefault INTEGER DEFAULT 0,
    sortOrder INTEGER DEFAULT 0, createdAt TEXT
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY, bookId TEXT NOT NULL, word TEXT NOT NULL,
    phonetic TEXT DEFAULT '', meaning TEXT DEFAULT '', example TEXT DEFAULT '',
    note TEXT DEFAULT '', phase TEXT DEFAULT 'learn',
    learnCorrect INTEGER DEFAULT 0, learnTotal INTEGER DEFAULT 0,
    learnWrong INTEGER DEFAULT 0, ease REAL DEFAULT 2.5,
    interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0,
    nextReview TEXT DEFAULT '', source TEXT DEFAULT '', pos TEXT DEFAULT '',
    createdAt TEXT, updatedAt TEXT
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS daily_insights (
    date TEXT PRIMARY KEY, content TEXT, createdAt TEXT
  )`)
  console.log('  ✅ 表已就绪')
}

async function migrateTable(
  localDb: any,
  turso: ReturnType<typeof createClient>,
  table: string,
  columns: string[],
) {
  // 检查本地表中是否有这个表
  let hasTable = false
  try {
    const checkStmt = localDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    checkStmt.bind([table])
    hasTable = checkStmt.step()
    checkStmt.free()
  } catch { hasTable = false }

  if (!hasTable) {
    console.log(`  📭 ${table}: 本地中不存在，跳过`)
    return
  }

  const stmt = localDb.prepare(`SELECT * FROM ${table}`)
  const rows: any[][] = []
  while (stmt.step()) {
    const obj = stmt.getAsObject()
    rows.push(columns.map(c => obj[c] ?? null))
  }
  stmt.free()

  if (rows.length === 0) {
    console.log(`  📭 ${table}: 0 行，跳过`)
    return
  }

  const placeholders = columns.map(() => '?').join(',')
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      await turso.execute({ sql, args: row })
      inserted++
    }
    process.stdout.write(`\r  📤 ${table}: ${inserted}/${rows.length}`)
  }
  console.log(`\n  ✅ ${table}: ${rows.length} 行已迁移`)
}

main().catch(err => {
  console.error('❌ 迁移失败:', err)
  process.exit(1)
})
