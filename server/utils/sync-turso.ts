/**
 * 增量同步：本地 sql.js → Turso（仅新增/变化行）
 *
 * 原则：
 * 1. 只增不删 — 本地有云端无 → INSERT；云端有本地无 → 不动
 * 2. 冲突选晚 — 两边都有且不同 → 比较 updatedAt，晚的胜出
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 表清单。
 *
 * noPk：云端这些表建的时候没加 PRIMARY KEY（历史遗留），
 * 所以不能对它们用 INSERT OR REPLACE —— 那会插入重复行。
 *
 * timeCol：显式指定增量用的时间列。不写则按 updatedAt → createdAt 顺序推断。
 * marks 没有 updatedAt，用 createdAt 捕获新增；改 note 这类不刷新时间列的操作
 * 靠每 24 小时一次的全量兜底。
 *
 * auth_logs 不在清单里：登录记录属于本机运行痕迹，没有异地备份价值，
 * 而它每次同步要白跑一次跨境查询。
 */
const TABLES: Array<{ name: string; columns: string[]; pkIdx: number; noPk?: boolean; timeCol?: string }> = [
  { name: 'folders', pkIdx: 0, columns: ['id', 'name', 'parent', 'isPrivate', 'passwordHash', 'createdAt'] },
  { name: 'texts', pkIdx: 0, columns: ['id', 'title', 'text', 'source', 'folder', 'excerpt', 'filePath', 'analysis', 'segments', 'explanations', 'marks', 'readingPosition', 'paragraphChats', 'videoMeta', 'videoSubtitles', 'subtitlePractice', 'completedAt', 'notes', 'paragraphNotes', 'paragraphNotesMap', 'chapters', 'cover', 'deletedAt', 'contentKind', 'annotations', 'createdAt', 'updatedAt'] },
  { name: 'stats', pkIdx: 0, timeCol: 'lastReadAt', columns: ['textId', 'readCount', 'lastReadAt', 'markCount'] },
  { name: 'knowledge_points', pkIdx: 0, columns: ['id', 'content', 'note', 'sourceId', 'sourceTitle', 'sourceType', 'sourceContext', 'customGroup', 'tags', 'chatHistory', 'sortOrder', 'createdAt', 'updatedAt'] },
  { name: 'wordbooks', pkIdx: 0, columns: ['id', 'name', 'isDefault', 'sortOrder', 'createdAt'] },
  { name: 'words', pkIdx: 0, columns: ['id', 'bookId', 'word', 'phonetic', 'meaning', 'example', 'note', 'phase', 'learnCorrect', 'learnTotal', 'learnWrong', 'ease', 'interval', 'repetitions', 'nextReview', 'source', 'pos', 'enhancement', 'markId', 'detail', 'context', 'image', 'lastReviewedAt', 'reviewCount', 'lapses', 'type', 'paragraphId', 'startOffset', 'endOffset', 'dismissedAt', 'orphanedAt', 'archivedAt', 'createdAt', 'updatedAt'] },
  { name: 'daily_insights', pkIdx: 0, columns: ['date', 'content', 'createdAt'] },
  { name: 'marks', pkIdx: 0, noPk: true, timeCol: 'createdAt', columns: ['id', 'textId', 'textTitle', 'textFolder', 'type', 'text', 'lemma', 'detail', 'note', 'createdAt', 'deletedAt'] },
  { name: 'knowledge_pages', pkIdx: 0, noPk: true, columns: ['id', 'groupId', 'title', 'content', 'createdAt', 'updatedAt'] },
  { name: 'texts_history', pkIdx: 0, columns: ['id', 'textId', 'segments', 'marks', 'explanations', 'paragraphChats', 'note', 'segmentCount', 'createdAt'] },
]

export interface SyncResult {
  tables: Record<string, { inserted: number; updated: number; skipped: number }>
  totalInserted: number
  totalUpdated: number
  totalSkipped: number
  ok: boolean
  error?: string
}

export interface SyncOptions {
  /**
   * 增量起点（ISO 时间字符串）。传入时只推送该时间之后变化过的行。
   *
   * 必要性：全量模式要从云端 SELECT * 拉回整库（95MB）跟本地逐行比对，
   * 实测一次 6 分钟。本地为主之后云端只会比本地旧，比对毫无意义，
   * 直接「本地有变化就 upsert」即可，耗时降到几秒。
   *
   * 不传 = 全量模式（首次迁移、定期兜底时用）。
   */
  since?: string | null
  /** 强制走全量的表（例如 marks 没有 updatedAt，修改 note 无法被增量捕获） */
  fullTables?: Iterable<string>
}

/**
 * @param existingDb 可选：本地主库句柄（node:sqlite 的 sql.js 兼容层）。
 *   传入时直接读该句柄，不重新打开文件 —— WAL 模式下文件里可能还缺最新写入，
 *   而且主库正被占用时再打开一份容易读到旧快照。
 */
export async function syncToTurso(existingDb?: any, opts: SyncOptions = {}): Promise<SyncResult> {
  const url = process.env.TURSO_URL
  const token = process.env.TURSO_AUTH_TOKEN
  if (!url || !token) throw new Error('Turso 环境变量未配置')

  const since = opts.since || null
  const forceFull = new Set(opts.fullTables || [])

  const DB_PATH = path.resolve('server/data/reader.db')
  const ownDb = !existingDb
  let localDb: any
  if (existingDb) {
    localDb = existingDb
  } else {
    const SQL = await initSqlJs()
    const buf = readFileSync(DB_PATH)
    localDb = new SQL.Database(buf)
  }

  const turso = createClient({ url, authToken: token })

  /**
   * 建表 / 补列只在全量模式执行。
   *
   * 这里 11 条 CREATE + 21 条 ALTER，每一条都是一次跨境往返（实测约 7 秒），
   * 加起来 3 分钟以上 —— 而表结构在正常运行中根本不会变。
   * 之前「同步一次要好几分钟」的主要原因就是每次同步都把这些重复跑一遍。
   */
  if (!since) {
  // 确保 Turso 表存在（本地模式新增表时，Turso 侧可能尚未创建）
  for (const { name, columns } of TABLES) {
    const colDefs = columns.map(c => `${c} TEXT`).join(',')
    try { await turso.execute(`CREATE TABLE IF NOT EXISTS ${name} (${colDefs})`) } catch {}
  }

  // 确保 Turso 表新增列存在（ALTER TABLE 补全）
  try { await turso.execute("ALTER TABLE words ADD COLUMN enhancement TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN markId TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN detail TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN context TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN image TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN lastReviewedAt TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN reviewCount INTEGER DEFAULT 0") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN lapses INTEGER DEFAULT 0") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN type TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN paragraphId TEXT DEFAULT ''") } catch {}
  try { await turso.execute('ALTER TABLE words ADD COLUMN startOffset INTEGER DEFAULT 0') } catch {}
  try { await turso.execute('ALTER TABLE words ADD COLUMN endOffset INTEGER DEFAULT 0') } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN dismissedAt TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE words ADD COLUMN orphanedAt TEXT DEFAULT ''") } catch {}
  try { await turso.execute('ALTER TABLE words ADD COLUMN archivedAt TEXT DEFAULT NULL') } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN paragraphNotesMap TEXT DEFAULT '{}'") } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN chapters TEXT DEFAULT '[]'") } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN cover TEXT DEFAULT ''") } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN deletedAt TEXT DEFAULT NULL") } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN contentKind TEXT DEFAULT 'text'") } catch {}
  try { await turso.execute("ALTER TABLE texts ADD COLUMN annotations TEXT DEFAULT '[]'") } catch {}
  try { await turso.execute("ALTER TABLE marks ADD COLUMN deletedAt TEXT DEFAULT NULL") } catch {}
  }

  const tables: SyncResult['tables'] = {}
  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0

  for (const { name, columns, pkIdx, noPk, timeCol: explicitTimeCol } of TABLES) {
    let lStmt: any = null
    const tableT0 = Date.now()
    try {
      /**
       * 增量判断：
       *  - 优先用表上显式配置的 timeCol，否则 updatedAt → createdAt 顺序推断
       *  - noPk 表也能增量（走「查存在性再插入」），不再被迫每次拉全表
       */
      const timeCol = explicitTimeCol
        ?? (columns.includes('updatedAt')
          ? 'updatedAt'
          : columns.includes('createdAt') ? 'createdAt' : null)
      const incremental = !!since && !!timeCol && !forceFull.has(name)

      const selectSql = incremental
        ? `SELECT ${columns.join(',')} FROM ${name} WHERE ${timeCol} >= ?`
        : `SELECT ${columns.join(',')} FROM ${name}`
      lStmt = localDb.prepare(selectSql)
      if (incremental) lStmt.bind([since])

      const localRows: Map<string, any[]> = new Map()
      while (lStmt.step()) {
        const o = lStmt.getAsObject()
        const row = columns.map(c => o[c] ?? null)
        localRows.set(String(row[pkIdx] ?? ''), row)
      }
      lStmt.free()
      lStmt = null

      if (localRows.size === 0) {
        tables[name] = { inserted: 0, updated: 0, skipped: 0 }
        continue
      }

      // ── 增量路径：本地改过的行直接推上去，不回头查云端 ──
      if (incremental) {
        const cols = columns.join(',')
        const ph = columns.map(() => '?').join(',')
        const rows = [...localRows.values()]
        const BATCH = 50

        if (noPk) {
          /**
           * 云端无主键时 INSERT 会重复，必须先查这些 id 是否已存在。
           * 只查最近变化的几十个 id（而不是整表 7811 行），
           * 单次请求携带的数据量从 2MB 降到几 KB —— 这是 marks 表从 20 秒降到几秒的关键。
           */
          const pkCol = columns[pkIdx]
          const existing = new Set<string>()
          const ids = [...localRows.keys()]
          const ID_CHUNK = 200
          for (let i = 0; i < ids.length; i += ID_CHUNK) {
            const chunk = ids.slice(i, i + ID_CHUNK)
            try {
              const r = await turso.execute({
                sql: `SELECT ${pkCol} FROM ${name} WHERE ${pkCol} IN (${chunk.map(() => '?').join(',')})`,
                args: chunk,
              })
              for (const rr of r.rows) existing.add(String(rr[0]))
            } catch (e: any) {
              console.warn(`[sync-to-turso] ${name} 存在性查询失败: ${e.message}`)
            }
          }
          const missing = rows.filter(r => !existing.has(String(r[pkIdx] ?? '')))
          const present = rows.filter(r => existing.has(String(r[pkIdx] ?? '')))

          for (let i = 0; i < missing.length; i += BATCH) {
            const stmts = missing.slice(i, i + BATCH).map(row => ({
              sql: `INSERT INTO ${name} (${cols}) VALUES (${ph})`,
              args: row,
            }))
            await turso.batch(stmts, 'write')
          }

          // 已存在的行做 UPDATE（knowledge_pages 改内容、marks 改 note 都靠这条）
          if (present.length) {
            const setClause = columns.map(c => `${c}=?`).join(',')
            const pkCol2 = columns[pkIdx]
            for (let i = 0; i < present.length; i += BATCH) {
              const stmts = present.slice(i, i + BATCH).map(row => ({
                sql: `UPDATE ${name} SET ${setClause} WHERE ${pkCol2}=?`,
                args: [...row, row[pkIdx]],
              }))
              await turso.batch(stmts, 'write')
            }
          }

          tables[name] = { inserted: missing.length, updated: present.length, skipped: 0 }
          totalInserted += missing.length
          totalUpdated += present.length
          continue
        }

        for (let i = 0; i < rows.length; i += BATCH) {
          const stmts = rows.slice(i, i + BATCH).map(row => ({
            sql: `INSERT OR REPLACE INTO ${name} (${cols}) VALUES (${ph})`,
            args: row,
          }))
          await turso.batch(stmts, 'write')
        }
        tables[name] = { inserted: rows.length, updated: 0, skipped: 0 }
        totalInserted += rows.length
        continue
      }

      let remoteRows: Map<string, any[]> = new Map()
      try {
        const rResult = await turso.execute(`SELECT ${columns.join(',')} FROM ${name}`)
        const rows = rResult.rows
        for (let ri = 0; ri < rows.length; ri++) {
          const r = rows[ri]
          remoteRows.set(String(r[pkIdx] ?? ''), r as any[])
        }
      } catch (e: any) {
        console.warn(`[sync-to-turso] 读取 Turso 表 ${name} 失败: ${e.message}`)
        tables[name] = { inserted: 0, updated: 0, skipped: 0 }
        continue
      }

      const toInsert: any[][] = []
      const toUpdate: { pk: string; row: any[] }[] = []
      let skipped = 0

      const updatedAtIdx = columns.indexOf('updatedAt')

      for (const [pk, localRow] of localRows) {
        const remoteRow = remoteRows.get(pk)
        if (!remoteRow) {
          // 本地有，云端无 → 补全到云端
          toInsert.push(localRow)
        } else if (!rowsEqual(localRow, remoteRow)) {
          // 两边都有且不同 → 比较 updatedAt，晚的胜出
          if (updatedAtIdx > -1) {
            const localTime = String(localRow[updatedAtIdx] ?? '')
            const remoteTime = String(remoteRow[updatedAtIdx] ?? '')
            if (localTime > remoteTime) {
              toUpdate.push({ pk, row: localRow })
            } else {
              skipped++  // 本地时间 ≤ 远端 → 不推送
            }
          } else {
            // 无 updatedAt → 本地无条件推送
            toUpdate.push({ pk, row: localRow })
          }
        } else {
          skipped++  // 内容相同 → 跳过
        }
      }

      const cols = columns.join(',')
      const ph = columns.map(() => '?').join(',')

      // 批量写入：逐行 execute 在远程库上会因网络往返拖慢全量同步
      const BATCH = 50
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const stmts = toInsert.slice(i, i + BATCH).map(row => ({
            sql: `INSERT INTO ${name} (${cols}) VALUES (${ph})`,
            args: row,
          }))
          await turso.batch(stmts, 'write')
        }
      }

      if (toUpdate.length > 0) {
        const pkCol = columns[pkIdx]
        const setClause = columns.map(c => `${c}=?`).join(',')
        for (let i = 0; i < toUpdate.length; i += BATCH) {
          const stmts = toUpdate.slice(i, i + BATCH).map(({ pk, row }) => ({
            sql: `UPDATE ${name} SET ${setClause} WHERE ${pkCol}=?`,
            args: [...row, pk],
          }))
          await turso.batch(stmts, 'write')
        }
      }

      tables[name] = { inserted: toInsert.length, updated: toUpdate.length, skipped }
      totalInserted += toInsert.length
      totalUpdated += toUpdate.length
      totalSkipped += skipped
    } catch (e: any) {
      console.error(`[sync-to-turso] 同步表 ${name} 失败: ${e.message}`)
      tables[name] = { inserted: 0, updated: 0, skipped: 0 }
    } finally {
      if (lStmt) lStmt.free()
      const ms = Date.now() - tableT0
      // 只报慢表：本地毫秒级的表刷屏没意义，跨境慢的才需要盯
      if (ms > 300) {
        const t = tables[name] || { inserted: 0, updated: 0, skipped: 0 }
        console.log(`[mirror] ${name} ${ms}ms +${t.inserted} ~${t.updated} skip${t.skipped}`)
      }
    }
  }

  if (ownDb) localDb.close()
  return { tables, totalInserted, totalUpdated, totalSkipped, ok: true }
}

/**
 * 比较两行数据是否相等。
 * 统一转为字符串比较，null 和空串均视为空。
 */
function rowsEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const va = String(a[i] ?? '')
    const vb = String(b[i] ?? '')
    // null 和空串视为等价（Turso 和 sql.js 可能用不同方式表示空值）
    if (va !== vb && !(va === '' && vb === 'null') && !(va === 'null' && vb === '')) return false
  }
  return true
}
