import initSqlJs from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const USE_TURSO = process.env['USE_TURSO'] === 'true'

// ==========================================================
//  Turso 分支（云端）
// ==========================================================
let tursoClient: ReturnType<typeof import('@libsql/client').createClient> | null = null
let tursoInitPromise: Promise<any> | null = null

async function getTursoDb(): Promise<any> {
  if (tursoClient) return tursoClient
  if (tursoInitPromise) return tursoInitPromise

  tursoInitPromise = (async () => {
    const { createClient } = await import('@libsql/client')
    const url = process.env['TURSO_URL']
    const token = process.env['TURSO_AUTH_TOKEN']
    if (!url || !token) throw new Error('TURSO_URL / TURSO_AUTH_TOKEN 未配置')
    tursoClient = createClient({ url, authToken: token })
    await createTablesTurso()
    return tursoClient
  })()
  return tursoInitPromise
}

async function createTablesTurso() {
  const db = tursoClient!
  await db.execute(`CREATE TABLE IF NOT EXISTS texts (id TEXT PRIMARY KEY,title TEXT,text TEXT,source TEXT,folder TEXT DEFAULT 'default',excerpt TEXT,filePath TEXT,analysis TEXT,segments TEXT,explanations TEXT,marks TEXT,readingPosition TEXT,paragraphChats TEXT DEFAULT '',videoMeta TEXT DEFAULT '',videoSubtitles TEXT DEFAULT '',subtitlePractice TEXT DEFAULT '',completedAt TEXT DEFAULT NULL,notes TEXT DEFAULT '',paragraphNotes TEXT DEFAULT '[]',createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY,name TEXT,parent TEXT DEFAULT '',isPrivate INTEGER DEFAULT 0,passwordHash TEXT DEFAULT '',createdAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS stats (textId TEXT PRIMARY KEY,readCount INTEGER DEFAULT 0,lastReadAt TEXT,markCount INTEGER DEFAULT 0)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS knowledge_points (id TEXT PRIMARY KEY,content TEXT NOT NULL,note TEXT DEFAULT '',sourceId TEXT DEFAULT '',sourceTitle TEXT DEFAULT '',sourceType TEXT DEFAULT 'selection',sourceContext TEXT DEFAULT '',customGroup TEXT DEFAULT '',tags TEXT DEFAULT '[]',chatHistory TEXT DEFAULT '[]',sortOrder INTEGER DEFAULT 0,createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS wordbooks (id TEXT PRIMARY KEY,name TEXT NOT NULL,isDefault INTEGER DEFAULT 0,sortOrder INTEGER DEFAULT 0,createdAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY,bookId TEXT NOT NULL,word TEXT NOT NULL,phonetic TEXT DEFAULT '',meaning TEXT DEFAULT '',example TEXT DEFAULT '',note TEXT DEFAULT '',phase TEXT DEFAULT 'learn',learnCorrect INTEGER DEFAULT 0,learnTotal INTEGER DEFAULT 0,learnWrong INTEGER DEFAULT 0,ease REAL DEFAULT 2.5,interval INTEGER DEFAULT 0,repetitions INTEGER DEFAULT 0,nextReview TEXT DEFAULT '',source TEXT DEFAULT '',pos TEXT DEFAULT '',createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS daily_insights (date TEXT PRIMARY KEY,content TEXT,createdAt TEXT)`)

  // 迁移兜底列
  for (const [table, col, def] of [
    ['folders','parent',"TEXT DEFAULT ''"],['folders','isPrivate','INTEGER DEFAULT 0'],['folders','passwordHash',"TEXT DEFAULT ''"],
    ['texts','paragraphChats',"TEXT DEFAULT ''"],['texts','videoMeta',"TEXT DEFAULT ''"],['texts','videoSubtitles',"TEXT DEFAULT ''"],
    ['texts','subtitlePractice',"TEXT DEFAULT ''"],['texts','completedAt','TEXT DEFAULT NULL'],['texts','notes',"TEXT DEFAULT ''"],
    ['texts','paragraphNotes',"TEXT DEFAULT '[]'"],['words','pos',"TEXT DEFAULT ''"],
    ['knowledge_points','customGroup',"TEXT DEFAULT ''"],['knowledge_points','chatHistory',"TEXT DEFAULT '[]'"],
  ]) {
    try { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`) } catch {}
  }

  // 默认单词本
  const r = await db.execute('SELECT id FROM wordbooks WHERE isDefault=1')
  const ids = new Set(r.rows.map((x: any) => x[0] as string))
  const now = new Date().toISOString()
  for (const [id, name, o] of [['wb_default','默认单词本',0],['wb_phrases','默认短语本',1],['wb_sentences','默认句子本',2]]) {
    if (!ids.has(id)) await db.execute({sql:'INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,?,?)',args:[id,name,o,now]})
  }
}

// ==========================================================
//  sql.js 分支（本地）
// ==========================================================
const DB_DIR = path.resolve('server/data')
const DB_PATH = path.join(DB_DIR, 'reader.db')
let sqljsDb: any = null
let sqljsInitPromise: Promise<any> | null = null

async function getSqljsDb(): Promise<any> {
  if (sqljsDb) return sqljsDb
  if (sqljsInitPromise) return sqljsInitPromise

  sqljsInitPromise = (async () => {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })
    const SQL = await initSqlJs()
    if (existsSync(DB_PATH)) {
      const buf = readFileSync(DB_PATH)
      sqljsDb = new SQL.Database(buf)
      createTablesSqljs()
      saveDbSqljs()
    } else {
      sqljsDb = new SQL.Database()
      sqljsDb.run('PRAGMA journal_mode=WAL')
      createTablesSqljs()
      migrateFromJson()
      sqljsDb.run('PRAGMA journal_mode=DELETE')
      saveDbSqljs()
    }
    return sqljsDb
  })()

  // 启动健康检查：本地空但 Turso 有数据时提示
  sqljsInitPromise.then(async () => {
    const localStmt = sqljsDb.prepare('SELECT COUNT(*) as c FROM texts')
    let localCount = 0
    if (localStmt.step()) localCount = localStmt.getAsObject().c as number
    localStmt.free()

    if (localCount === 0 && process.env['TURSO_URL'] && process.env['TURSO_AUTH_TOKEN']) {
      try {
        const { createClient } = await import('@libsql/client')
        const turso = createClient({ url: process.env['TURSO_URL'], authToken: process.env['TURSO_AUTH_TOKEN'] })
        const r = await turso.execute('SELECT COUNT(*) as c FROM texts')
        const remoteCount = Number(r.rows[0]?.[0] ?? 0)
        if (remoteCount > 0) {
          console.log(`[health] ⚠️  本地数据为空，Turso 有 ${remoteCount} 条记录。点击书架「同步到云端」可双向同步数据。`)
        }
      } catch { /* Turso 不可达，跳过 */ }
    }
  })

  return sqljsInitPromise
}

function createTablesSqljs() {
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS texts (id TEXT PRIMARY KEY, title TEXT, text TEXT, source TEXT, folder TEXT DEFAULT 'default', excerpt TEXT, filePath TEXT, analysis TEXT, segments TEXT, explanations TEXT, marks TEXT, readingPosition TEXT, paragraphChats TEXT, createdAt TEXT, updatedAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT, parent TEXT DEFAULT '', createdAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS stats (textId TEXT PRIMARY KEY, readCount INTEGER DEFAULT 0, lastReadAt TEXT, markCount INTEGER DEFAULT 0)`)
  try { sqljsDb.run("ALTER TABLE folders ADD COLUMN parent TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE folders ADD COLUMN isPrivate INTEGER DEFAULT 0') } catch {}
  try { sqljsDb.run("ALTER TABLE folders ADD COLUMN passwordHash TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN paragraphChats TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN videoMeta TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN videoSubtitles TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN subtitlePractice TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE texts ADD COLUMN completedAt TEXT DEFAULT NULL') } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN notes TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN paragraphNotes TEXT DEFAULT '[]'") } catch {}
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS knowledge_points (id TEXT PRIMARY KEY, content TEXT NOT NULL, note TEXT DEFAULT '', sourceId TEXT DEFAULT '', sourceTitle TEXT DEFAULT '', sourceType TEXT DEFAULT 'selection', sourceContext TEXT DEFAULT '', customGroup TEXT DEFAULT '', tags TEXT DEFAULT '[]', sortOrder INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)`)
  try { sqljsDb.run("ALTER TABLE knowledge_points ADD COLUMN customGroup TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE knowledge_points ADD COLUMN chatHistory TEXT DEFAULT '[]'") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN pos TEXT DEFAULT ''") } catch {}
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS wordbooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, isDefault INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, createdAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, word TEXT NOT NULL, phonetic TEXT DEFAULT '', meaning TEXT DEFAULT '', example TEXT DEFAULT '', note TEXT DEFAULT '', phase TEXT DEFAULT 'learn', learnCorrect INTEGER DEFAULT 0, learnTotal INTEGER DEFAULT 0, learnWrong INTEGER DEFAULT 0, ease REAL DEFAULT 2.5, interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0, nextReview TEXT DEFAULT '', source TEXT DEFAULT '', pos TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)`)
  const stmt = sqljsDb.prepare('SELECT id FROM wordbooks WHERE isDefault=1')
  const existingIds = new Set<string>()
  while (stmt.step()) existingIds.add(stmt.getAsObject().id as string)
  stmt.free()
  const now = new Date().toISOString()
  if (!existingIds.has('wb_default')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,0,?)', ['wb_default','默认单词本',now])
  if (!existingIds.has('wb_phrases')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,1,?)', ['wb_phrases','默认短语本',now])
  if (!existingIds.has('wb_sentences')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,2,?)', ['wb_sentences','默认句子本',now])
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS daily_insights (date TEXT PRIMARY KEY, content TEXT, createdAt TEXT)`)
}

function migrateFromJson() {
  try {
    const textsFile = path.join(DB_DIR, 'texts.json')
    if (existsSync(textsFile)) {
      const texts = JSON.parse(readFileSync(textsFile, 'utf-8'))
      for (const t of texts) {
        sqljsDb.run('INSERT OR REPLACE INTO texts (id,title,text,source,folder,excerpt,filePath,analysis,segments,explanations,marks,readingPosition,paragraphChats,createdAt,updatedAt,videoMeta,videoSubtitles,subtitlePractice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
          t.id, t.title||'', t.text||'', t.source||'', t.folder||'default', t.excerpt||'', t.filePath||'',
          t.analysis?JSON.stringify(t.analysis):'', t.segments?JSON.stringify(t.segments):'',
          t.explanations?JSON.stringify(t.explanations):'', t.marks?JSON.stringify(t.marks):'',
          t.readingPosition?JSON.stringify(t.readingPosition):'', t.paragraphChats?JSON.stringify(t.paragraphChats):'',
          t.createdAt||'', t.updatedAt||'', '', '', '',
        ])
      }
    }
    const foldersFile = path.join(DB_DIR, 'folders.json')
    if (existsSync(foldersFile)) {
      const folders = JSON.parse(readFileSync(foldersFile, 'utf-8'))
      for (const f of folders) sqljsDb.run('INSERT OR REPLACE INTO folders (id,name,parent,createdAt) VALUES (?,?,?,?)', [f.id, f.name, f.parent||'', f.createdAt])
    }
    try { require('fs').unlinkSync(path.join(DB_DIR, 'texts.json')) } catch {}
    try { require('fs').unlinkSync(path.join(DB_DIR, 'folders.json')) } catch {}
  } catch {}
}

const BACKUP_DIR = path.join(DB_DIR, 'backups')
const MAX_BACKUPS = 10

let syncTimer: ReturnType<typeof setTimeout> | null = null

/** 写入后 30 秒自动同步到 Turso（多次写入合并为一次） */
function scheduleSyncToTurso() {
  if (USE_TURSO) return  // Turso 模式下不需要这个
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      const { syncToTurso } = await import('./sync-turso')
      const result = await syncToTurso()
      if (result.totalInserted > 0 || result.totalUpdated > 0) {
        console.log(`[auto-sync] +${result.totalInserted} ~${result.totalUpdated}`)
      }
    } catch (e: any) {
      // 同步失败不阻塞主流程（可能 Turso 未配置或网络不通）
    }
  }, 30_000)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function saveDbSqljs() {
  // 防抖：5 秒内多次写入合并为一次落盘
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data = sqljsDb.export()
    if (existsSync(DB_PATH)) {
      if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
      writeFileSync(path.join(BACKUP_DIR, `reader-${Date.now()}.db`), readFileSync(DB_PATH))
      try {
        const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('reader-')).sort()
        while (files.length > MAX_BACKUPS) unlinkSync(path.join(BACKUP_DIR, files.shift()!))
      } catch {}
    }
    writeFileSync(DB_PATH, Buffer.from(data))
    scheduleSyncToTurso()
  }, 5_000)
}

// ==========================================================
//  统一导出（接口不变）
// ==========================================================
export async function getDb() {
  return USE_TURSO ? getTursoDb() : getSqljsDb()
}

export async function saveDb() {
  if (!USE_TURSO) saveDbSqljs()
}

export async function runQuery(sql: string, params?: any[]) {
  if (USE_TURSO) {
    const db = await getTursoDb()
    return db.execute({ sql, args: params || [] })
  }
  const result = (await getSqljsDb()).run(sql, params)
  saveDbSqljs()  // 每次写操作后立即持久化到磁盘
  return result
}

export async function queryAll(sql: string, params?: any[]): Promise<any[]> {
  if (USE_TURSO) {
    const db = await getTursoDb()
    const result = await db.execute({ sql, args: params || [] })
    return result.rows.map((row: any[]) => {
      const obj: any = {}
      result.columns.forEach((col: string, i: number) => { obj[col] = row[i] })
      return obj
    })
  }
  const database = await getSqljsDb()
  const stmt = database.prepare(sql)
  if (params) stmt.bind(params)
  const rows: any[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export async function queryOne(sql: string, params?: any[]): Promise<any | null> {
  const rows = await queryAll(sql, params)
  return rows[0] || null
}
