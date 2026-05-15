import initSqlJs from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const DB_DIR = path.resolve('server/data')
const DB_PATH = path.join(DB_DIR, 'reader.db')

let db: any = null
let initPromise: Promise<any> | null = null

// 获取数据库实例（单例）
export async function getDb(): Promise<any> {
  if (db) return db
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })

    const SQL = await initSqlJs()
    if (existsSync(DB_PATH)) {
      const buf = readFileSync(DB_PATH)
      db = new SQL.Database(buf)
      // 已有数据库也需要运行 createTables()，用 IF NOT EXISTS 补齐旧库缺失的表
      createTables()
      saveDb()
    } else {
      db = new SQL.Database()
      db.run('PRAGMA journal_mode=WAL')
      createTables()
      migrateFromJson()
      db.run('PRAGMA journal_mode=DELETE')
      saveDb()
    }
    return db
  })()

  return initPromise
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS texts (
    id TEXT PRIMARY KEY, title TEXT, text TEXT, source TEXT,
    folder TEXT DEFAULT 'default', excerpt TEXT, filePath TEXT,
    analysis TEXT, segments TEXT, explanations TEXT,
    marks TEXT, readingPosition TEXT, paragraphChats TEXT,
    createdAt TEXT, updatedAt TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, name TEXT, parent TEXT DEFAULT '', createdAt TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS stats (
    textId TEXT PRIMARY KEY, readCount INTEGER DEFAULT 0, lastReadAt TEXT,
    markCount INTEGER DEFAULT 0
  )`)
  // migration: add missing columns from older schema versions
  try { db.run('ALTER TABLE folders ADD COLUMN parent TEXT DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE texts ADD COLUMN paragraphChats TEXT DEFAULT \'\'') } catch {}
  // video fields (added 2026-05-14)
  try { db.run('ALTER TABLE texts ADD COLUMN videoMeta TEXT DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE texts ADD COLUMN videoSubtitles TEXT DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE texts ADD COLUMN subtitlePractice TEXT DEFAULT \'\'') } catch {}
}

function migrateFromJson() {
  try {
    const textsFile = path.join(DB_DIR, 'texts.json')
    if (existsSync(textsFile)) {
      const texts = JSON.parse(readFileSync(textsFile, 'utf-8'))
      for (const t of texts) {
        db.run(`INSERT OR REPLACE INTO texts (id,title,text,source,folder,excerpt,filePath,analysis,segments,explanations,marks,readingPosition,paragraphChats,createdAt,updatedAt,videoMeta,videoSubtitles,subtitlePractice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          t.id, t.title || '', t.text || '', t.source || '', t.folder || 'default',
          t.excerpt || '', t.filePath || '',
          t.analysis ? JSON.stringify(t.analysis) : '',
          t.segments ? JSON.stringify(t.segments) : '',
          t.explanations ? JSON.stringify(t.explanations) : '',
          t.marks ? JSON.stringify(t.marks) : '',
          t.readingPosition ? JSON.stringify(t.readingPosition) : '',
          t.paragraphChats ? JSON.stringify(t.paragraphChats) : '',
          t.createdAt || '', t.updatedAt || '',
          '', '', '',
        ])
      }
    }
    const foldersFile = path.join(DB_DIR, 'folders.json')
    if (existsSync(foldersFile)) {
      const folders = JSON.parse(readFileSync(foldersFile, 'utf-8'))
      for (const f of folders) {
        db.run('INSERT OR REPLACE INTO folders (id,name,parent,createdAt) VALUES (?,?,?,?)', [f.id, f.name, f.parent || '', f.createdAt])
      }
    }
    // 迁移后删除旧 JSON 文件
    try { require('fs').unlinkSync(path.join(DB_DIR, 'texts.json')) } catch {}
    try { require('fs').unlinkSync(path.join(DB_DIR, 'folders.json')) } catch {}
  } catch {}
}

const BACKUP_DIR = path.join(DB_DIR, 'backups')
const MAX_BACKUPS = 10

export async function saveDb() {
  const database = await getDb()
  const data = database.export()
  const buf = Buffer.from(data)
  // 写入前备份
  if (existsSync(DB_PATH)) {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
    const backupName = `reader-${Date.now()}.db`
    writeFileSync(path.join(BACKUP_DIR, backupName), readFileSync(DB_PATH))
    // 清理旧备份，保留最近 10 个
    try {
      const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('reader-')).sort()
      while (files.length > MAX_BACKUPS) {
        unlinkSync(path.join(BACKUP_DIR, files.shift()!))
      }
    } catch {}
  }
  writeFileSync(DB_PATH, buf)
}

// 方便在一次锁内读-改-写后统一保存
export async function runQuery(sql: string, params?: any[]): Promise<any> {
  const database = await getDb()
  return database.run(sql, params)
}

export async function queryAll(sql: string, params?: any[]): Promise<any[]> {
  const database = await getDb()
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
