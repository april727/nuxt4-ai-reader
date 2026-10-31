import initSqlJs from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getLocalDb, asSqljsCompat } from './db-local'

/**
 * 数据库后端选择
 *
 *   USE_TURSO=true   → 全部读写直连云端（应急模式：断网/异地/换机时用）
 *   USE_TURSO=false  → 本地为主（默认）
 *
 * 本地为主时再分两级：
 *   1. node:sqlite（真 SQLite 文件 + WAL）—— 正常情况走这条，读写微秒级
 *   2. sql.js（WASM 内存库）—— Node < 22 的兜底，行为与历史版本一致
 *
 * 云端在这里只承担「异地备份」角色：写完异步镜像上去，不要求实时；
 * 本地永远不会为了等云端而阻塞请求。
 */
const USE_TURSO = process.env['USE_TURSO'] === 'true'

// ── 本地库的首次初始化钩子 ──────────────────────────────────
/**
 * 本地成为唯一真相源之后，必须有本地兜底快照：
 * 云端镜像最多滞后 10 分钟，而本地文件一旦损坏（断电、误删、磁盘故障）
 * 就只能退回云端重拉。每天留一份 91MB 的快照，恢复成本从「几分钟跨境拉取」
 * 降到「拷一个文件」。
 *
 * VACUUM INTO 实测 95MB 约 630ms，且生成的是整理过的独立文件，
 * 可以直接改名顶上主库，也可以被 sql.js / DB 工具直接打开。
 */
const SNAPSHOT_KEEP = Number(process.env['LOCAL_SNAPSHOT_KEEP'] || 3)

let housekeepingStarted = false
let localHandle: Promise<any> | null = null

/**
 * 本地主库补列清单。
 *
 * 本地（node:sqlite）根本不走 createTablesSqljs —— 历史列一直是由
 * sync-from-turso 的 ensureColumns 按**云端 pragma** 补的，也就是「云端有本地才有」。
 * 后果：给本地加一个新列时，如果云端还没部署，本地会直接报
 * `table texts has no column named grading`，而且报错点离原因很远（在写接口里）。
 *
 * 所以在这里补一道：拿到句柄就把本地缺的列加上，不依赖云端、也不依赖
 * 用户是不是刚好触发过一次同步。表还不存在（全新库）就跳过，交给建表逻辑。
 */
const LOCAL_ENSURE_COLUMNS: Array<[string, string, string]> = [
  // 试卷判分：整卷覆盖写，key 为 annotation id
  ['texts', 'grading', "TEXT DEFAULT '{}'"],
]

async function ensureLocalSchema(db: any) {
  for (const [table, col, def] of LOCAL_ENSURE_COLUMNS) {
    try {
      const info = db.all(`PRAGMA table_info(${table})`)
      if (!info || !info.length) continue
      if (info.some((c: any) => c.name === col)) continue
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
      console.log(`[db-local] 补列 ${table}.${col}`)
    } catch (e: any) {
      console.warn(`[db-local] 补列失败 ${table}.${col}: ${e.message}`)
    }
  }
}

/** 取本地主库句柄，并在首次取用时启动后台维护任务 */
function localDb(): Promise<any> {
  if (!localHandle) {
    localHandle = getLocalDb().then(async (db) => {
      if (db) await ensureLocalSchema(db)
      return db
    })
  }
  if (!housekeepingStarted) {
    housekeepingStarted = true
    localHandle.then((db) => { if (db) scheduleLocalHousekeeping() }).catch(() => { /* ignore */ })
  }
  return localHandle
}

function scheduleLocalHousekeeping() {
  if (USE_TURSO) return

  const snapshot = async () => {
    const db = await getLocalDb()
    if (!db) return
    const dir = path.resolve('server/data/backups')
    try {
      mkdirSync(dir, { recursive: true })
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      const file = path.join(dir, `reader-${stamp}.db`)
      if (existsSync(file)) return  // 今天已经备过

      const t0 = Date.now()
      db.exportTo(file)
      console.log(`[snapshot] 本地快照 reader-${stamp}.db ${(statSync(file).size / 1024 / 1024).toFixed(0)}MB ${Date.now() - t0}ms`)

      // 只保留最近 N 份，避免长期堆积把磁盘吃满
      const all = readdirSync(dir).filter(f => /^reader-\d{8}\.db$/.test(f)).sort()
      while (all.length > SNAPSHOT_KEEP) {
        const old = all.shift()!
        try { unlinkSync(path.join(dir, old)); console.log(`[snapshot] 清理旧快照 ${old}`) } catch { /* ignore */ }
      }
    } catch (e: any) {
      console.warn(`[snapshot] 本地快照失败: ${e.message}`)
    }
  }

  // 启动后 45 秒再跑：避开首屏请求高峰（VACUUM 期间主库读会被占住约 0.6 秒）
  setTimeout(() => { void snapshot() }, 45_000).unref?.()
  // 之后每 6 小时检查一次「今天备过没」，跨天自然补上
  setInterval(() => { void snapshot() }, 6 * 60 * 60_000).unref?.()

  // 启动后补一次云端镜像：距上次镜像超过 1 小时说明中间可能关过站，
  // 那次没来得及推送的改动在这里补上；另外只要有上次遗留的删除指令，
  // 不管隔了多久都立刻补推 —— 删除漏推会让云端永久留下一份本地已删的数据。
  setTimeout(() => {
    const last = mirrorState.lastAt ? Date.parse(mirrorState.lastAt) : 0
    if (pendingCloudOps.length || Date.now() - last > 60 * 60_000) void runMirror()
  }, 25_000).unref?.()
}

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
    scheduleTursoBackupPull()
    return tursoClient
  })()
  return tursoInitPromise
}

async function createTablesTurso() {
  const db = tursoClient!
  await db.execute(`CREATE TABLE IF NOT EXISTS texts (id TEXT PRIMARY KEY,title TEXT,text TEXT,source TEXT,folder TEXT DEFAULT 'default',excerpt TEXT,filePath TEXT,analysis TEXT,segments TEXT,explanations TEXT,marks TEXT,readingPosition TEXT,paragraphChats TEXT DEFAULT '',videoMeta TEXT DEFAULT '',videoSubtitles TEXT DEFAULT '',subtitlePractice TEXT DEFAULT '',completedAt TEXT DEFAULT NULL,notes TEXT DEFAULT '',paragraphNotes TEXT DEFAULT '[]',paragraphNotesMap TEXT DEFAULT '{}',chapters TEXT DEFAULT '[]',cover TEXT DEFAULT '',deletedAt TEXT DEFAULT NULL,contentKind TEXT DEFAULT 'text',annotations TEXT DEFAULT '[]',grading TEXT DEFAULT '{}',createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY,name TEXT,parent TEXT DEFAULT '',isPrivate INTEGER DEFAULT 0,passwordHash TEXT DEFAULT '',createdAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS stats (textId TEXT PRIMARY KEY,readCount INTEGER DEFAULT 0,lastReadAt TEXT,markCount INTEGER DEFAULT 0)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS knowledge_points (id TEXT PRIMARY KEY,content TEXT NOT NULL,note TEXT DEFAULT '',sourceId TEXT DEFAULT '',sourceTitle TEXT DEFAULT '',sourceType TEXT DEFAULT 'selection',sourceContext TEXT DEFAULT '',customGroup TEXT DEFAULT '',tags TEXT DEFAULT '[]',chatHistory TEXT DEFAULT '[]',sortOrder INTEGER DEFAULT 0,createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS wordbooks (id TEXT PRIMARY KEY,name TEXT NOT NULL,isDefault INTEGER DEFAULT 0,sortOrder INTEGER DEFAULT 0,createdAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY,bookId TEXT NOT NULL,word TEXT NOT NULL,phonetic TEXT DEFAULT '',meaning TEXT DEFAULT '',example TEXT DEFAULT '',note TEXT DEFAULT '',phase TEXT DEFAULT 'learn',learnCorrect INTEGER DEFAULT 0,learnTotal INTEGER DEFAULT 0,learnWrong INTEGER DEFAULT 0,ease REAL DEFAULT 2.5,interval INTEGER DEFAULT 0,repetitions INTEGER DEFAULT 0,nextReview TEXT DEFAULT '',source TEXT DEFAULT '',pos TEXT DEFAULT '',enhancement TEXT DEFAULT '',markId TEXT DEFAULT '',detail TEXT DEFAULT '',context TEXT DEFAULT '',image TEXT DEFAULT '',lastReviewedAt TEXT DEFAULT '',reviewCount INTEGER DEFAULT 0,lapses INTEGER DEFAULT 0,type TEXT DEFAULT '',paragraphId TEXT DEFAULT '',startOffset INTEGER DEFAULT 0,endOffset INTEGER DEFAULT 0,dismissedAt TEXT DEFAULT '',orphanedAt TEXT DEFAULT '',createdAt TEXT,updatedAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS daily_insights (date TEXT PRIMARY KEY,content TEXT,createdAt TEXT)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS marks (id TEXT PRIMARY KEY,textId TEXT NOT NULL,textTitle TEXT DEFAULT '',textFolder TEXT DEFAULT 'default',type TEXT NOT NULL,text TEXT NOT NULL,lemma TEXT DEFAULT '',detail TEXT DEFAULT '',note TEXT DEFAULT '',createdAt TEXT NOT NULL,deletedAt TEXT DEFAULT NULL)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS auth_logs (id TEXT PRIMARY KEY,time TEXT NOT NULL,ip TEXT DEFAULT '',ua TEXT DEFAULT '',ok INTEGER DEFAULT 1)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS knowledge_pages (id TEXT PRIMARY KEY,groupId TEXT NOT NULL,title TEXT NOT NULL,content TEXT DEFAULT '',createdAt TEXT,updatedAt TEXT)`)
  // 段落结构历史：任何段落整理（合并/删除/插入/重新分段）前留快照，便于回退
  await db.execute(`CREATE TABLE IF NOT EXISTS texts_history (id TEXT PRIMARY KEY,textId TEXT NOT NULL,segments TEXT DEFAULT '[]',marks TEXT DEFAULT '[]',explanations TEXT DEFAULT '{}',paragraphChats TEXT DEFAULT '{}',note TEXT DEFAULT '',segmentCount INTEGER DEFAULT 0,createdAt TEXT NOT NULL)`)
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_th_textId ON texts_history(textId, createdAt DESC)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_kp_groupId ON knowledge_pages(groupId)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_marks_createdAt ON marks(createdAt DESC)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_marks_textId ON marks(textId)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_marks_type ON marks(type)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_marks_date ON marks(date(createdAt))') } catch {}
  // words 列表/复习队列索引
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_words_bookId ON words(bookId)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_words_source ON words(source)') } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_words_phase_review ON words(phase, nextReview)') } catch {}

  // 迁移兜底列
  for (const [table, col, def] of [
    ['folders','parent',"TEXT DEFAULT ''"],['folders','isPrivate','INTEGER DEFAULT 0'],['folders','passwordHash',"TEXT DEFAULT ''"],
    ['texts','paragraphChats',"TEXT DEFAULT ''"],['texts','videoMeta',"TEXT DEFAULT ''"],['texts','videoSubtitles',"TEXT DEFAULT ''"],
    ['texts','subtitlePractice',"TEXT DEFAULT ''"],['texts','completedAt','TEXT DEFAULT NULL'],['texts','notes',"TEXT DEFAULT ''"],
    // 复习排程：完成阅读后按自评给出下次复习日期
    ['texts','reviewIntervalDays','INTEGER DEFAULT 7'],['texts','nextReviewAt','TEXT DEFAULT NULL'],
    ['texts','reviewCount','INTEGER DEFAULT 0'],['texts','lastReviewedAt','TEXT DEFAULT NULL'],
    ['texts','selfRating',"TEXT DEFAULT ''"],
    ['texts','paragraphNotes',"TEXT DEFAULT '[]'"],['texts','paragraphNotesMap',"TEXT DEFAULT '{}'"],['texts','chapters',"TEXT DEFAULT '[]'"],['texts','cover',"TEXT DEFAULT ''"],['words','pos',"TEXT DEFAULT ''"],['words','enhancement',"TEXT DEFAULT ''"],
    ['words','markId',"TEXT DEFAULT ''"],['words','detail',"TEXT DEFAULT ''"],['words','context',"TEXT DEFAULT ''"],['words','image',"TEXT DEFAULT ''"],
    ['words','lastReviewedAt',"TEXT DEFAULT ''"],['words','reviewCount',"INTEGER DEFAULT 0"],['words','lapses',"INTEGER DEFAULT 0"],
    ['words','type',"TEXT DEFAULT ''"],['words','paragraphId',"TEXT DEFAULT ''"],['words','startOffset',"INTEGER DEFAULT 0"],['words','endOffset',"INTEGER DEFAULT 0"],
    ['words','dismissedAt',"TEXT DEFAULT ''"],['words','orphanedAt',"TEXT DEFAULT ''"],['words','archivedAt','TEXT DEFAULT NULL'],
    ['knowledge_points','customGroup',"TEXT DEFAULT ''"],['knowledge_points','chatHistory',"TEXT DEFAULT '[]'"],
    ['marks','deletedAt','TEXT DEFAULT NULL'],
    ['texts','deletedAt','TEXT DEFAULT NULL'],
    // 内容形态：text=文字阅读（默认），sheet=图片试卷（画布 + 标注）
    ['texts','contentKind',"TEXT DEFAULT 'text'"],
    // 试卷标注：叠加层数据（bbox 归一化坐标 + kind），原图像素不修改
    ['texts','annotations',"TEXT DEFAULT '[]'"],
    // 试卷判分：整卷覆盖写，key 为 annotation id（对错 + 满分 + 实得）
    ['texts','grading',"TEXT DEFAULT '{}'"],
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

  // 迁移 marks 表数据（从 texts.marks JSON）
  try {
    const mr = await db.execute('SELECT COUNT(*) as c FROM marks')
    if (Number(mr.rows[0]?.[0] ?? 0) === 0) {
      const tr = await db.execute("SELECT id, title, folder, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'")
      let count = 0
      for (const row of tr.rows) {
        let marks: any[] = []
        try { marks = JSON.parse(row.marks) } catch { continue }
        for (const m of marks) {
          if (!m.id) continue
          const lemma = (m.lemma || '').trim()
          const type = m.type || 'word'
          const text = (m.text || '').trim()
          const createdAt = m.createdAt || now
          await db.execute({
            sql: 'INSERT OR IGNORE INTO marks (id,textId,textTitle,textFolder,type,text,lemma,detail,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
            args: [m.id, row.id, row.title || '', row.folder || 'default', type, text, lemma, m.detail || '', m.note || '', createdAt],
          })
          count++
        }
      }
      if (count > 0) console.log(`[migrate:turso] marks 表初始化完成，迁移 ${count} 条标记`)
    }
  } catch (e: any) {
    console.warn('[migrate:turso] marks 迁移跳过:', e.message)
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
      migrateMarksFromTexts()
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

    // 启动定时拉取：每 60 秒从 Turso 检查新数据
    schedulePullFromTurso()
  })

  return sqljsInitPromise
}

function createTablesSqljs() {
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS texts (id TEXT PRIMARY KEY, title TEXT, text TEXT, source TEXT, folder TEXT DEFAULT 'default', excerpt TEXT, filePath TEXT, analysis TEXT, segments TEXT, explanations TEXT, marks TEXT, readingPosition TEXT, paragraphChats TEXT, createdAt TEXT, updatedAt TEXT, chapters TEXT DEFAULT '[]', cover TEXT DEFAULT '', deletedAt TEXT DEFAULT NULL, contentKind TEXT DEFAULT 'text', annotations TEXT DEFAULT '[]', grading TEXT DEFAULT '{}', reviewIntervalDays INTEGER DEFAULT 7, nextReviewAt TEXT DEFAULT NULL, reviewCount INTEGER DEFAULT 0, lastReviewedAt TEXT DEFAULT NULL, selfRating TEXT DEFAULT '')`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT, parent TEXT DEFAULT '', createdAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS stats (textId TEXT PRIMARY KEY, readCount INTEGER DEFAULT 0, lastReadAt TEXT, markCount INTEGER DEFAULT 0)`)
  // 段落结构历史（与 Turso 分支保持一致）
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS texts_history (id TEXT PRIMARY KEY, textId TEXT NOT NULL, segments TEXT DEFAULT '[]', marks TEXT DEFAULT '[]', explanations TEXT DEFAULT '{}', paragraphChats TEXT DEFAULT '{}', note TEXT DEFAULT '', segmentCount INTEGER DEFAULT 0, createdAt TEXT NOT NULL)`)
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
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN paragraphNotesMap TEXT DEFAULT '{}'") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN chapters TEXT DEFAULT '[]'") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN cover TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE texts ADD COLUMN deletedAt TEXT DEFAULT NULL') } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN contentKind TEXT DEFAULT 'text'") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN annotations TEXT DEFAULT '[]'") } catch {}
  try { sqljsDb.run("ALTER TABLE texts ADD COLUMN grading TEXT DEFAULT '{}'") } catch {}
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS knowledge_points (id TEXT PRIMARY KEY, content TEXT NOT NULL, note TEXT DEFAULT '', sourceId TEXT DEFAULT '', sourceTitle TEXT DEFAULT '', sourceType TEXT DEFAULT 'selection', sourceContext TEXT DEFAULT '', customGroup TEXT DEFAULT '', tags TEXT DEFAULT '[]', sortOrder INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)`)
  try { sqljsDb.run("ALTER TABLE knowledge_points ADD COLUMN customGroup TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE knowledge_points ADD COLUMN chatHistory TEXT DEFAULT '[]'") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN pos TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN enhancement TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN markId TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN detail TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN context TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN image TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN lastReviewedAt TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN reviewCount INTEGER DEFAULT 0') } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN lapses INTEGER DEFAULT 0') } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN type TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN paragraphId TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN startOffset INTEGER DEFAULT 0') } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN endOffset INTEGER DEFAULT 0') } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN dismissedAt TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run("ALTER TABLE words ADD COLUMN orphanedAt TEXT DEFAULT ''") } catch {}
  try { sqljsDb.run('ALTER TABLE words ADD COLUMN archivedAt TEXT DEFAULT NULL') } catch {}
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS wordbooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, isDefault INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, createdAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS words (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, word TEXT NOT NULL, phonetic TEXT DEFAULT '', meaning TEXT DEFAULT '', example TEXT DEFAULT '', note TEXT DEFAULT '', phase TEXT DEFAULT 'learn', learnCorrect INTEGER DEFAULT 0, learnTotal INTEGER DEFAULT 0, learnWrong INTEGER DEFAULT 0, ease REAL DEFAULT 2.5, interval INTEGER DEFAULT 0, repetitions INTEGER DEFAULT 0, nextReview TEXT DEFAULT '', source TEXT DEFAULT '', pos TEXT DEFAULT '', enhancement TEXT DEFAULT '', markId TEXT DEFAULT '', detail TEXT DEFAULT '', context TEXT DEFAULT '', image TEXT DEFAULT '', lastReviewedAt TEXT DEFAULT '', reviewCount INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0, type TEXT DEFAULT '',paragraphId TEXT DEFAULT '',startOffset INTEGER DEFAULT 0,endOffset INTEGER DEFAULT 0,dismissedAt TEXT DEFAULT '',orphanedAt TEXT DEFAULT '',archivedAt TEXT DEFAULT NULL,createdAt TEXT, updatedAt TEXT)`)
  const stmt = sqljsDb.prepare('SELECT id FROM wordbooks WHERE isDefault=1')
  const existingIds = new Set<string>()
  while (stmt.step()) existingIds.add(stmt.getAsObject().id as string)
  stmt.free()
  const now = new Date().toISOString()
  if (!existingIds.has('wb_default')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,0,?)', ['wb_default','默认单词本',now])
  if (!existingIds.has('wb_phrases')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,1,?)', ['wb_phrases','默认短语本',now])
  if (!existingIds.has('wb_sentences')) sqljsDb.run('INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,1,2,?)', ['wb_sentences','默认句子本',now])
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS daily_insights (date TEXT PRIMARY KEY, content TEXT, createdAt TEXT)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS marks (id TEXT PRIMARY KEY, textId TEXT NOT NULL, textTitle TEXT DEFAULT '', textFolder TEXT DEFAULT 'default', type TEXT NOT NULL, text TEXT NOT NULL, lemma TEXT DEFAULT '', detail TEXT DEFAULT '', note TEXT DEFAULT '', createdAt TEXT NOT NULL, deletedAt TEXT DEFAULT NULL)`)
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS auth_logs (id TEXT PRIMARY KEY, time TEXT NOT NULL, ip TEXT DEFAULT '', ua TEXT DEFAULT '', ok INTEGER DEFAULT 1)`)
  try { sqljsDb.run("ALTER TABLE marks ADD COLUMN deletedAt TEXT DEFAULT NULL") } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_marks_createdAt ON marks(createdAt DESC)') } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_marks_textId ON marks(textId)') } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_marks_type ON marks(type)') } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_words_bookId ON words(bookId)') } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_words_source ON words(source)') } catch {}
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_words_phase_review ON words(phase, nextReview)') } catch {}
  sqljsDb.run(`CREATE TABLE IF NOT EXISTS knowledge_pages (id TEXT PRIMARY KEY, groupId TEXT NOT NULL, title TEXT NOT NULL, content TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)`)
  try { sqljsDb.run('CREATE INDEX IF NOT EXISTS idx_kp_groupId ON knowledge_pages(groupId)') } catch {}
}

function migrateMarksFromTexts() {
  try {
    const countStmt = sqljsDb.prepare('SELECT COUNT(*) as c FROM marks')
    if (countStmt.step() && (countStmt.getAsObject().c as number) > 0) {
      countStmt.free()
      return
    }
    countStmt.free()

    const stmt = sqljsDb.prepare("SELECT id, title, folder, marks FROM texts WHERE marks IS NOT NULL AND marks != '' AND marks != '[]'")
    const insertStmt = sqljsDb.prepare('INSERT OR IGNORE INTO marks (id,textId,textTitle,textFolder,type,text,lemma,detail,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    let count = 0
    while (stmt.step()) {
      const row = stmt.getAsObject()
      let marks: any[] = []
      try { marks = JSON.parse(row.marks) } catch { continue }
      for (const m of marks) {
        if (!m.id) continue
        const lemma = (m.lemma || '').trim()
        const type = m.type || 'word'
        const text = (m.text || '').trim()
        const createdAt = m.createdAt || new Date().toISOString()
        insertStmt.run([m.id, row.id, row.title || '', row.folder || 'default', type, text, lemma, m.detail || '', m.note || '', createdAt])
        count++
      }
    }
    stmt.free()
    insertStmt.free()
    if (count > 0) console.log(`[migrate] marks 表初始化完成，迁移 ${count} 条标记`)
  } catch (e: any) {
    console.warn('[migrate] marks 迁移跳过:', e.message)
  }
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

let syncTimer: ReturnType<typeof setTimeout> | null = null

/** 写入后 30 秒自动同步到 Turso（多次写入合并为一次） */
function scheduleSyncToTurso() {
  if (USE_TURSO) return  // Turso 模式下不需要这个
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      const { syncToTurso } = await import('./sync-turso')
      const result = await syncToTurso()
      if (result.totalInserted > 0 || result.totalUpdated > 0) {
        const parts = Object.entries(result.tables)
          .filter(([, v]) => v.inserted > 0 || v.updated > 0)
          .map(([t, v]) => `${t}(+${v.inserted} ~${v.updated})`)
          .join(', ')
        console.log(`[auto-sync] 总计 +${result.totalInserted} ~${result.totalUpdated} | ${parts}`)
      }
    } catch (e: any) {
      console.error(`[auto-sync] 同步失败: ${e.message}`)
    }
  }, 30_000)
}

// ── 本地主库 → Turso 的异步镜像 ─────────────────────────────
/**
 * 定位是「异地备份」，不是「双写」：
 *   - 本地写完立刻返回，不等云端（等一等就是几百毫秒到几秒的跨境往返）
 *   - 多次写合并成一次推送，防抖 90 秒
 *   - 串行执行，绝不并发 batch 打云端
 *   - 另有一轮 10 分钟兜底，避免「一直有零星写入 → 防抖永不触发」导致云端长期落后
 *
 * 代价：云端最多滞后约 10 分钟。本地是唯一真相源，这个滞后无所谓。
 */
const MIRROR_DEBOUNCE_MS = 90_000
const MIRROR_FALLBACK_MS = 10 * 60_000
/** 每隔这么久强制做一次全量比对，兜住「时间列没被更新」导致的漏推 */
const MIRROR_FULL_INTERVAL_MS = 24 * 60 * 60_000

const MIRROR_STATE_PATH = path.resolve('server/data/.mirror-state.json')
interface MirrorState { lastAt?: string; lastFullAt?: string }
let mirrorState: MirrorState = (() => {
  try { return JSON.parse(readFileSync(MIRROR_STATE_PATH, 'utf-8')) } catch { return {} }
})()
function saveMirrorState() {
  try { writeFileSync(MIRROR_STATE_PATH, JSON.stringify(mirrorState)) } catch { /* 状态文件丢了顶多退化成全量，不影响正确性 */ }
}

let mirrorTimer: ReturnType<typeof setTimeout> | null = null
let mirrorHourly: ReturnType<typeof setInterval> | null = null
let mirrorRunning = false
let mirrorPending = false

export function scheduleMirrorToTurso() {
  if (USE_TURSO) return
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return
  mirrorPending = true
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = setTimeout(() => { void runMirror() }, MIRROR_DEBOUNCE_MS)

  if (!mirrorHourly) {
    mirrorHourly = setInterval(() => {
      if (mirrorPending) void runMirror()
    }, MIRROR_FALLBACK_MS)
    // 定时器不该拖住进程退出
    mirrorHourly.unref?.()
  }
}

/** 立即执行一次镜像（同步按钮 / 关站前调用）。forceFull=true 时做全量比对 */
export async function runMirrorNow(forceFull = false): Promise<{ ok: boolean; inserted: number; updated: number; error?: string }> {
  if (USE_TURSO) return { ok: true, inserted: 0, updated: 0 }
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) {
    return { ok: false, inserted: 0, updated: 0, error: 'Turso 未配置' }
  }
  if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null }
  return runMirror(forceFull)
}

async function runMirror(forceFull = false): Promise<{ ok: boolean; inserted: number; updated: number; error?: string }> {
  if (mirrorRunning) return { ok: false, inserted: 0, updated: 0, error: '镜像进行中' }
  mirrorRunning = true
  mirrorPending = false
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  // 首次没有状态、或距上次全量超过 24 小时 → 本次走全量
  const lastFull = mirrorState.lastFullAt ? Date.parse(mirrorState.lastFullAt) : 0
  const needFull = forceFull || !mirrorState.lastAt || (Date.now() - lastFull > MIRROR_FULL_INTERVAL_MS)
  const since = needFull ? null : mirrorState.lastAt

  try {
    const { syncToTurso } = await import('./sync-turso')
    // 先传播删除（syncToTurso 只增不删），再推新增/变更
    if (pendingCloudOps.length) await flushCloudOps()
    const local = await localDb()
    const result = local
      ? await syncToTurso(asSqljsCompat(local), { since })
      : await syncToTurso(undefined, { since })

    // 用「开始时间」而非结束时间：镜像期间新写入的行会在下一轮被重新推送（重复推送无害），
    // 用结束时间则会把这些行永久漏掉。
    mirrorState.lastAt = startedAt
    if (needFull) mirrorState.lastFullAt = startedAt
    saveMirrorState()

    if (result.totalInserted > 0 || result.totalUpdated > 0) {
      const parts = Object.entries(result.tables)
        .filter(([, v]) => v.inserted > 0 || v.updated > 0)
        .map(([t, v]) => `${t}(+${v.inserted} ~${v.updated})`)
        .join(', ')
      console.log(`[mirror] 云端镜像完成 ${Date.now() - t0}ms (${needFull ? '全量' : '增量'}) | +${result.totalInserted} ~${result.totalUpdated} | ${parts}`)
    } else {
      console.log(`[mirror] 云端镜像完成 ${Date.now() - t0}ms (${needFull ? '全量' : '增量'}) | 无变化`)
    }
    return { ok: true, inserted: result.totalInserted, updated: result.totalUpdated }
  } catch (e: any) {
    mirrorPending = true  // 失败留待下次重试
    console.error(`[mirror] 云端镜像失败: ${e.message}`)
    return { ok: false, inserted: 0, updated: 0, error: e.message }
  } finally {
    mirrorRunning = false
  }
}

let pullTimer: ReturnType<typeof setInterval> | null = null

/**
 * 定时从 Turso 拉取。
 *
 * 本地为主之后**默认关闭**：每 60 秒做一次全表比对本身就是纯浪费
 * （本地才是真相源，云端只会比本地旧），而且 95MB 数据的比对会抢磁盘 IO。
 * 需要「换机/在别处改过」时手动点同步（POST /api/sync/from-turso）。
 */
function schedulePullFromTurso() {
  if (USE_TURSO) return
  if (process.env['AUTO_PULL_FROM_TURSO'] !== 'true') return
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return
  if (pullTimer) return

  pullTimer = setInterval(async () => {
    try {
      const mainDb = await getSqljsDb()
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      if (existsSync(DB_PATH)) {
        const data = mainDb.export()
        writeFileSync(DB_PATH, Buffer.from(data))
      }
      const { syncFromTurso } = await import('./sync-from-turso')
      const result = await syncFromTurso(mainDb)
      if (result.totalInserted > 0 || result.totalUpdated > 0) {
        const data = mainDb.export()
        writeFileSync(DB_PATH, Buffer.from(data))
        console.log(`[auto-pull] +${result.totalInserted} ~${result.totalUpdated}`)
      }
    } catch (e: any) {
      console.error(`[auto-pull] 拉取失败: ${e.message}`)
    }
  }, 60_000)
}

let backupPullTimer: ReturnType<typeof setInterval> | null = null
let backupRunning = false

/**
 * Turso 模式下的本地快照：把云端整库拉取到 reader-cloud.db。
 * 与 reader.db（本地直连模式的活数据）分开，作为云端数据的最后一道本地屏障。
 * 每次都是「空库 + 全量拉取」的完整快照，不做增量比较，保证与云端逐字段一致。
 */
function scheduleTursoBackupPull() {
  if (backupPullTimer) return
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return

  const run = async () => {
    if (backupRunning) return
    backupRunning = true
    const SQL = await initSqlJs()
    const prev = sqljsDb
    sqljsDb = new SQL.Database()
    try {
      createTablesSqljs()
      const { syncFromTurso } = await import('./sync-from-turso')
      await syncFromTurso(sqljsDb)
      const data = sqljsDb.export()
      const file = path.join(DB_DIR, 'reader-cloud.db')
      writeFileSync(file + '.tmp', Buffer.from(data))
      // 先写临时文件再改名，避免写一半断电损坏快照
      try { unlinkSync(file) } catch {}
      renameSync(file + '.tmp', file)
      console.log(`[backup] 云端快照已写入 reader-cloud.db (${(data.length / 1024 / 1024).toFixed(1)}MB)`)
    } catch (e: any) {
      console.error(`[backup] 云端快照失败: ${e.message}`)
      try { unlinkSync(path.join(DB_DIR, 'reader-cloud.db.tmp')) } catch {}
    } finally {
      sqljsDb = prev
      backupRunning = false
    }
  }

  // 启动 15 秒后做第一次快照，之后每 6 小时刷新一次
  setTimeout(run, 15_000)
  backupPullTimer = setInterval(run, 6 * 60 * 60_000)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function saveDbSqljs() {
  // 防抖：8 秒内多次写入合并为一次落盘（不创建备份——有 Turso 作为云备份）
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data = sqljsDb.export()
    writeFileSync(DB_PATH, Buffer.from(data))
  }, 8_000)
}

// ==========================================================
//  统一导出（接口不变）
// ==========================================================
export async function getDb() {
  if (USE_TURSO) return getTursoDb()
  const local = await localDb()
  if (local) return local
  return getSqljsDb()
}

export async function saveDb() {
  // node:sqlite 是 WAL，写入即持久化，无需整库 dump
  if (USE_TURSO) return
  if (await localDb()) return
  saveDbSqljs()
}

export async function runQuery(sql: string, params?: any[]) {
  if (USE_TURSO) {
    const db = await getTursoDb()
    return db.execute({ sql, args: params || [] })
  }
  const local = await localDb()
  if (local) {
    const r = local.run(sql, params)
    scheduleMirrorToTurso()
    return r
  }
  const result = (await getSqljsDb()).run(sql, params)
  saveDbSqljs()  // 每次写操作后立即持久化到磁盘
  scheduleSyncToTurso()  // 每次写操作后安排云端同步（独立于存盘防抖）
  return result
}

/**
 * 执行写操作并返回受影响行数。
 * 用于「乐观并发」：带条件的 UPDATE 若未命中（行数为 0），说明数据已被他人改动。
 */
export async function runQueryCount(sql: string, params?: any[]): Promise<number> {
  if (USE_TURSO) {
    const db = await getTursoDb()
    const r = await db.execute({ sql, args: params || [] })
    return Number(r?.rowsAffected || 0)
  }
  const local = await localDb()
  if (local) {
    const r = local.run(sql, params)
    scheduleMirrorToTurso()
    return r.changes
  }
  const db = await getSqljsDb()
  db.run(sql, params)
  const n = Number(db.getRowsModified?.() || 0)
  saveDbSqljs()
  scheduleSyncToTurso()
  return n
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
  const local = await localDb()
  if (local) return local.all(sql, params)
  const database = await getSqljsDb()
  const stmt = database.prepare(sql)
  if (params) stmt.bind(params)
  const rows: any[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export async function queryOne(sql: string, params?: any[]): Promise<any | null> {
  if (!USE_TURSO) {
    const local = await localDb()
    if (local) return local.get(sql, params)
  }
  const rows = await queryAll(sql, params)
  return rows[0] || null
}

/**
 * 待推送到云端的删除指令。
 *
 * syncToTurso 的原则是「只增不删」，删除必须单独传播，
 * 否则下次从云端拉取会把已删行原样拉回来。
 * 这里不立刻发请求（一次跨境往返几百毫秒，还会卡住接口），
 * 而是攒进队列，交给异步镜像统一 flush。
 */
const pendingCloudOps: Array<{ sql: string; args: any[] }> = []

/**
 * 删除指令必须落盘。
 *
 * 镜像有 90 秒防抖，队列原本只在内存里 —— 只要在这 90 秒内重启服务
 * （改代码、关站、崩溃都算），删除指令就永久蒸发。
 * 表现是：本地已经删掉的文章，云端还在；哪天用云端恢复，删掉的东西又全回来。
 * 实测就是这么漏掉 4 条测试数据（含一条 id 为 NULL 的坏行）。
 */
const PENDING_OPS_FILE = path.join(DB_DIR, '.pending-cloud-ops.json')

function savePendingOps() {
  try {
    if (!pendingCloudOps.length) {
      if (existsSync(PENDING_OPS_FILE)) unlinkSync(PENDING_OPS_FILE)
      return
    }
    writeFileSync(PENDING_OPS_FILE, JSON.stringify(pendingCloudOps))
  } catch (e: any) {
    console.warn(`[mirror] 删除指令落盘失败: ${e.message}`)
  }
}

function loadPendingOps() {
  try {
    if (!existsSync(PENDING_OPS_FILE)) return
    const arr = JSON.parse(readFileSync(PENDING_OPS_FILE, 'utf-8'))
    if (Array.isArray(arr) && arr.length) {
      pendingCloudOps.push(...arr)
      console.log(`[mirror] 恢复 ${arr.length} 条上次没推完的云端指令`)
    }
  } catch (e: any) {
    console.warn(`[mirror] 读取待推送队列失败: ${e.message}`)
  }
}

// 启动即接管上次遗留的删除指令（本地模式才有云端镜像）
if (!USE_TURSO) loadPendingOps()

/**
 * 从 Turso 删除行（本地模式删除时调用）。
 * 入队异步执行，不阻塞当前请求。
 */
export async function deleteRowsFromTurso(table: string, pkCol: string, values: string[]) {
  if (USE_TURSO) return
  if (!values.length) return
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return
  for (const v of values) {
    pendingCloudOps.push({ sql: `DELETE FROM ${table} WHERE ${pkCol}=?`, args: [v] })
  }
  savePendingOps()
  scheduleMirrorToTurso()
}

/**
 * 在 Turso 上执行任意 SQL（本地模式需要把写操作同步到云端时用）。
 * 同样入队，不阻塞。
 */
export async function runOnTurso(sql: string, params: any[] = []) {
  if (USE_TURSO) return
  if (!process.env['TURSO_URL'] || !process.env['TURSO_AUTH_TOKEN']) return
  pendingCloudOps.push({ sql, args: params })
  savePendingOps()
  scheduleMirrorToTurso()
}

/** 把队列里的删除/写指令推送到云端；失败则留在队列里下次重试 */
export async function flushCloudOps(): Promise<{ ok: number; failed: number }> {
  if (!pendingCloudOps.length) return { ok: 0, failed: 0 }
  const url = process.env['TURSO_URL']
  const token = process.env['TURSO_AUTH_TOKEN']
  if (!url || !token) return { ok: 0, failed: pendingCloudOps.length }

  const batch = pendingCloudOps.splice(0, pendingCloudOps.length)
  let ok = 0
  let failed = 0
  try {
    const { createClient } = await import('@libsql/client')
    const turso = createClient({ url, authToken: token })
    const r = await turso.batch(batch.map(op => ({ sql: op.sql, args: op.args })), 'write')
    ok = r.length
  } catch (e: any) {
    // 整批失败就整批回队，避免删一半
    pendingCloudOps.unshift(...batch)
    failed = batch.length
    console.warn(`[mirror] 删除指令推送失败（${failed} 条，稍后重试）: ${e.message}`)
  }
  // 成功则文件被清掉；失败则把回队后的完整内容重新落盘
  savePendingOps()
  return { ok, failed }
}

/** 获取本地数据库句柄（供同步模块直连用） */
export async function getSqljsHandle(): Promise<any> {
  const local = await localDb()
  if (local) return asSqljsCompat(local)
  return getSqljsDb()
}

/** 本地主库是否为 node:sqlite（true 时不能再用「整库 dump 覆盖文件」的方式持久化） */
export async function isNativeLocal(): Promise<boolean> {
  return (await localDb()) !== null
}

/** 强制主应用下次查询时从磁盘重新加载数据库 */
export function reloadSqljsDb() {
  sqljsDb = null
  sqljsInitPromise = null
}
