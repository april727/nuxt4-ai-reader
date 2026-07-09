/**
 * 从 Turso 增量拉取数据到本地 sql.js
 *
 * 原则：
 * 1. 只增不删 — 删除不传播
 * 2. 冲突选晚 — 同一行两边都改了，比较 updatedAt，晚的胜出
 *
 * 查询策略：
 * - 有 updatedAt 的表 → WHERE updatedAt > lastPull   (增量，含新增+修改)
 * - 只有 createdAt 的表 → WHERE createdAt > lastPull   (增量，仅新增)
 * - 都无 → COUNT 对比，行数不等再全量
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

interface TableDef {
  name: string
  /** 可用于增量查询的时间列 */
  timeCol: 'updatedAt' | 'createdAt' | null
}

const TABLES: TableDef[] = [
  { name: 'texts', timeCol: 'updatedAt' },
  { name: 'folders', timeCol: 'createdAt' },
  { name: 'stats', timeCol: null },
  { name: 'knowledge_points', timeCol: 'updatedAt' },
  { name: 'wordbooks', timeCol: 'createdAt' },
  { name: 'words', timeCol: 'updatedAt' },
  { name: 'daily_insights', timeCol: 'createdAt' },
  { name: 'marks', timeCol: 'createdAt' },
  { name: 'knowledge_pages', timeCol: 'updatedAt' },
]

export interface PullResult {
  tables: Record<string, { inserted: number; updated: number; skipped: number }>
  totalInserted: number
  totalUpdated: number
  totalSkipped: number
  ok: boolean
  error?: string
}

let lastPullAt: string | null = null

/**
 * @param existingDb 可选：主应用的 sql.js 实例。传入时直接操作该实例，不写磁盘。
 */
export async function syncFromTurso(existingDb?: any): Promise<PullResult> {
  const url = process.env['TURSO_URL']
  const token = process.env['TURSO_AUTH_TOKEN']
  if (!url || !token) throw new Error('TURSO_URL / TURSO_AUTH_TOKEN 未配置')

  const DB_PATH = path.resolve('server/data/reader.db')
  const DB_DIR = path.dirname(DB_PATH)

  const turso = createClient({ url, authToken: token })

  const ownDb = !existingDb  // 是否自己加载的 DB（需要自己写盘）
  let localDb: any
  if (existingDb) {
    localDb = existingDb
  } else if (existsSync(DB_PATH)) {
    localDb = new (await initSqlJs()).Database(readFileSync(DB_PATH))
  } else {
    localDb = new (await initSqlJs()).Database()
    mkdirSync(DB_DIR, { recursive: true })
  }

  const now = new Date().toISOString()
  const since = lastPullAt
  let hasChanges = false

  const tables: PullResult['tables'] = {}
  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0

  for (const { name, timeCol } of TABLES) {
    let columns: string[] = []
    try {
      const colRes = await turso.execute(`SELECT * FROM ${name} LIMIT 1`)
      columns = colRes.columns
    } catch {
      tables[name] = { inserted: 0, updated: 0, skipped: 0 }
      continue
    }
    if (columns.length === 0) { tables[name] = { inserted: 0, updated: 0, skipped: 0 }; continue }

    const pkCol = columns[0]
    const updatedAtIdx = columns.indexOf('updatedAt')

    // ── 增量查询：按时间列过滤 ──
    let remoteRows: any[][] = []
    let usedIncremental = false

    if (timeCol && since && columns.includes(timeCol)) {
      try {
        const r = await turso.execute({
          sql: `SELECT * FROM ${name} WHERE ${timeCol} > ?`,
          args: [since],
        })
        remoteRows = rowsToArrays(r.rows, columns.length)
        usedIncremental = true
      } catch { /* 回退 */ }
    }

    if (!usedIncremental) {
      // ── 全量回退 ──
      if (since) {
        let remoteCount = 0, localCount = 0
        try {
          const cr = await turso.execute(`SELECT COUNT(*) as c FROM ${name}`)
          remoteCount = Number(cr.rows[0]?.[0] ?? 0)
        } catch {}
        try {
          const ls = localDb.prepare(`SELECT COUNT(*) as c FROM ${name}`)
          if (ls.step()) localCount = Number(ls.getAsObject().c ?? 0)
          ls.free()
        } catch {}
        if (remoteCount <= localCount && timeCol !== 'updatedAt') {
          tables[name] = { inserted: 0, updated: 0, skipped: 0 }
          continue
        }
      }

      const r = await turso.execute(`SELECT * FROM ${name}`)
      remoteRows = rowsToArrays(r.rows, columns.length)
    }

    if (remoteRows.length === 0) {
      tables[name] = { inserted: 0, updated: 0, skipped: 0 }
      continue
    }

    // ── 逐行处理：INSERT 新行 / UPDATE 晚的行 / SKIP 旧的行 ──
    const toInsert: any[][] = []
    const toUpdate: { pk: string; row: any[] }[] = []
    let skipped = 0

    const localPks = getLocalPks(localDb, name, pkCol)

    for (let ri = 0; ri < remoteRows.length; ri++) {
      const row = remoteRows[ri]
      const pk = String(row[0] ?? '')
      if (!localPks.has(pk)) {
        // 本地没有 → 补全
        toInsert.push(row)
      } else if (updatedAtIdx > -1) {
        // 两边都有 → 比较 updatedAt
        const remoteTime = String(row[updatedAtIdx] ?? '')
        const localTime = getLocalCell(localDb, name, pkCol, pk, columns[updatedAtIdx])
        if (remoteTime > localTime) {
          toUpdate.push({ pk, row })
        } else {
          skipped++
        }
      } else {
        // 无 updatedAt → 已有即跳过
        skipped++
      }
    }

    // 写入
    ensureTable(localDb, name, columns)
    insertRows(localDb, name, columns, toInsert)
    updateRows(localDb, name, columns, pkCol, toUpdate)

    tables[name] = { inserted: toInsert.length, updated: toUpdate.length, skipped }
    totalInserted += toInsert.length
    totalUpdated += toUpdate.length
    totalSkipped += skipped
    if (toInsert.length > 0 || toUpdate.length > 0) hasChanges = true
  }

  if (hasChanges && ownDb) {
    const buf = localDb.export()
    writeFileSync(DB_PATH, Buffer.from(buf))
  }
  if (ownDb) localDb.close()

  lastPullAt = now
  return { tables, totalInserted, totalUpdated, totalSkipped, ok: true }
}

// ── 工具 ──

/** 将 @libsql/client Row[] 转为普通 any[][]，避免 Row 对象不可迭代的问题 */
function rowsToArrays(rows: any, colCount: number): any[][] {
  const result: any[][] = []
  for (let i = 0; i < rows.length; i++) {
    const src = rows[i]
    const arr = new Array(colCount)
    for (let j = 0; j < colCount; j++) arr[j] = src[j]
    result.push(arr)
  }
  return result
}

function getLocalPks(localDb: any, table: string, pkCol: string): Set<string> {
  const pks = new Set<string>()
  try {
    const stmt = localDb.prepare(`SELECT ${pkCol} FROM ${table}`)
    while (stmt.step()) pks.add(String(stmt.getAsObject()[pkCol] ?? ''))
    stmt.free()
  } catch {}
  return pks
}

function getLocalCell(localDb: any, table: string, pkCol: string, pk: string, col: string): string {
  let stmt: any = null
  try {
    stmt = localDb.prepare(`SELECT ${col} FROM ${table} WHERE ${pkCol}=?`)
    stmt.bind([pk])
    if (stmt.step()) return String(stmt.getAsObject()[col] ?? '')
  } catch {}
  finally { if (stmt) stmt.free() }
  return ''
}

function ensureTable(localDb: any, table: string, columns: string[]) {
  try {
    const colDefs = columns.map(c => `${c} TEXT`).join(',')
    localDb.run(`CREATE TABLE IF NOT EXISTS ${table} (${colDefs})`)
  } catch {}
}

function insertRows(localDb: any, table: string, columns: string[], rows: any[][]) {
  if (rows.length === 0) return
  const ph = columns.map(() => '?').join(',')
  const cols = columns.join(',')
  for (const row of rows) {
    localDb.run(`INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${ph})`, row)
  }
}

function updateRows(localDb: any, table: string, columns: string[], pkCol: string, rows: { pk: string; row: any[] }[]) {
  if (rows.length === 0) return
  const setClause = columns.map(c => `${c}=?`).join(',')
  for (const { pk, row } of rows) {
    const params = new Array(row.length + 1)
    for (let i = 0; i < row.length; i++) params[i] = row[i]
    params[row.length] = pk
    localDb.run(`UPDATE ${table} SET ${setClause} WHERE ${pkCol}=?`, params)
  }
}
