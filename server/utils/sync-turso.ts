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
    let lStmt: any = null
    try {
      lStmt = localDb.prepare(`SELECT ${columns.join(',')} FROM ${name}`)
      const localRows: Map<string, any[]> = new Map()
      while (lStmt.step()) {
        const row = columns.map((_, i) => lStmt.getAsObject()[columns[i]] ?? null)
        localRows.set(String(row[pkIdx] ?? ''), row)
      }
      lStmt.free()
      lStmt = null

      if (localRows.size === 0) {
        tables[name] = { inserted: 0, updated: 0, skipped: 0 }
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

      tables[name] = { inserted: toInsert.length, updated: toUpdate.length, skipped }
      totalInserted += toInsert.length
      totalUpdated += toUpdate.length
      totalSkipped += skipped
    } catch (e: any) {
      console.error(`[sync-to-turso] 同步表 ${name} 失败: ${e.message}`)
      tables[name] = { inserted: 0, updated: 0, skipped: 0 }
    } finally {
      if (lStmt) lStmt.free()
    }
  }

  localDb.close()
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
