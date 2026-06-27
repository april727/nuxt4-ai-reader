/**
 * 增量同步：本地 sql.js → Turso（仅新增/变化行）
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const TABLES: Array<{ name: string; columns: string[]; pkIdx: number }> = [
  { name: 'folders', pkIdx: 0, columns: ['id', 'name', 'parent', 'isPrivate', 'passwordHash', 'createdAt'] },
  { name: 'texts', pkIdx: 0, columns: ['id', 'title', 'text', 'source', 'folder', 'excerpt', 'filePath', 'analysis', 'segments', 'explanations', 'marks', 'readingPosition', 'paragraphChats', 'videoMeta', 'videoSubtitles', 'subtitlePractice', 'completedAt', 'notes', 'paragraphNotes', 'createdAt', 'updatedAt'] },
  { name: 'stats', pkIdx: 0, columns: ['textId', 'readCount', 'lastReadAt', 'markCount'] },
  { name: 'knowledge_points', pkIdx: 0, columns: ['id', 'content', 'note', 'sourceId', 'sourceTitle', 'sourceType', 'sourceContext', 'customGroup', 'tags', 'chatHistory', 'sortOrder', 'createdAt', 'updatedAt'] },
  { name: 'wordbooks', pkIdx: 0, columns: ['id', 'name', 'isDefault', 'sortOrder', 'createdAt'] },
  { name: 'words', pkIdx: 0, columns: ['id', 'bookId', 'word', 'phonetic', 'meaning', 'example', 'note', 'phase', 'learnCorrect', 'learnTotal', 'learnWrong', 'ease', 'interval', 'repetitions', 'nextReview', 'source', 'pos', 'createdAt', 'updatedAt'] },
  { name: 'daily_insights', pkIdx: 0, columns: ['date', 'content', 'createdAt'] },
]

export interface SyncResult {
  tables: Record<string, { inserted: number; updated: number; skipped: number }>
  totalInserted: number
  totalUpdated: number
  totalSkipped: number
  ok: boolean
  error?: string
}

export async function syncToTurso(): Promise<SyncResult> {
  const url = process.env.TURSO_URL
  const token = process.env.TURSO_AUTH_TOKEN
  if (!url || !token) throw new Error('Turso 环境变量未配置')

  const DB_PATH = path.resolve('server/data/reader.db')
  const SQL = await initSqlJs()
  const buf = readFileSync(DB_PATH)
  const localDb = new SQL.Database(buf)

  const turso = createClient({ url, authToken: token })

  const tables: SyncResult['tables'] = {}
  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0

  for (const { name, columns, pkIdx } of TABLES) {
    const lStmt = localDb.prepare(`SELECT ${columns.join(',')} FROM ${name}`)
    const localRows: Map<string, any[]> = new Map()
    while (lStmt.step()) {
      const row = columns.map((_, i) => lStmt.getAsObject()[columns[i]] ?? null)
      localRows.set(String(row[pkIdx] ?? ''), row)
    }
    lStmt.free()

    if (localRows.size === 0) {
      tables[name] = { inserted: 0, updated: 0, skipped: 0 }
      continue
    }

    let remoteRows: Map<string, any[]> = new Map()
    try {
      const rResult = await turso.execute(`SELECT ${columns.join(',')} FROM ${name}`)
      for (const r of rResult.rows) remoteRows.set(String(r[pkIdx] ?? ''), r as any[])
    } catch {}

    const toInsert: any[][] = []
    const toUpdate: { pk: string; row: any[] }[] = []

    for (const [pk, localRow] of localRows) {
      const remoteRow = remoteRows.get(pk)
      if (!remoteRow) {
        toInsert.push(localRow)
      } else if (!rowsEqual(localRow, remoteRow)) {
        toUpdate.push({ pk, row: localRow })
      }
    }

    const cols = columns.join(',')
    const ph = columns.map(() => '?').join(',')

    for (const row of toInsert) {
      await turso.execute({ sql: `INSERT INTO ${name} (${cols}) VALUES (${ph})`, args: row })
    }

    if (toUpdate.length > 0) {
      const pkCol = columns[pkIdx]
      const setClause = columns.map(c => `${c}=?`).join(',')
      for (const { pk, row } of toUpdate) {
        await turso.execute({ sql: `UPDATE ${name} SET ${setClause} WHERE ${pkCol}=?`, args: [...row, pk] })
      }
    }

    const skipped = remoteRows.size - toUpdate.length - toInsert.length
    tables[name] = { inserted: toInsert.length, updated: toUpdate.length, skipped }
    totalInserted += toInsert.length
    totalUpdated += toUpdate.length
    totalSkipped += skipped
  }

  localDb.close()
  return { tables, totalInserted, totalUpdated, totalSkipped, ok: true }
}

function rowsEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (String(a[i] ?? '') !== String(b[i] ?? '')) return false
  }
  return true
}
