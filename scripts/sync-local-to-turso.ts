/**
 * 增量同步：本地 reader.db → Turso（仅上传新增/变化的数据）
 * 运行: npx tsx scripts/sync-local-to-turso.ts
 */
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const envPath = resolve('.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
}

// 表定义：name, columns, primaryKeyIndex（columns 中的索引）
const TABLES: Array<{ name: string; columns: string[]; pkIdx: number }> = [
  { name: 'folders', pkIdx: 0, columns: ['id', 'name', 'parent', 'isPrivate', 'passwordHash', 'createdAt'] },
  { name: 'texts', pkIdx: 0, columns: ['id', 'title', 'text', 'source', 'folder', 'excerpt', 'filePath', 'analysis', 'segments', 'explanations', 'marks', 'readingPosition', 'paragraphChats', 'videoMeta', 'videoSubtitles', 'subtitlePractice', 'completedAt', 'notes', 'paragraphNotes', 'createdAt', 'updatedAt'] },
  { name: 'stats', pkIdx: 0, columns: ['textId', 'readCount', 'lastReadAt', 'markCount'] },
  { name: 'knowledge_points', pkIdx: 0, columns: ['id', 'content', 'note', 'sourceId', 'sourceTitle', 'sourceType', 'sourceContext', 'customGroup', 'tags', 'chatHistory', 'sortOrder', 'createdAt', 'updatedAt'] },
  { name: 'wordbooks', pkIdx: 0, columns: ['id', 'name', 'isDefault', 'sortOrder', 'createdAt'] },
  { name: 'words', pkIdx: 0, columns: ['id', 'bookId', 'word', 'phonetic', 'meaning', 'example', 'note', 'phase', 'learnCorrect', 'learnTotal', 'learnWrong', 'ease', 'interval', 'repetitions', 'nextReview', 'source', 'pos', 'enhancement', 'createdAt', 'updatedAt'] },
  { name: 'daily_insights', pkIdx: 0, columns: ['date', 'content', 'createdAt'] },
  { name: 'marks', pkIdx: 0, columns: ['id', 'textId', 'textTitle', 'textFolder', 'type', 'text', 'lemma', 'detail', 'note', 'createdAt'] },
  { name: 'knowledge_pages', pkIdx: 0, columns: ['id', 'groupId', 'title', 'content', 'createdAt', 'updatedAt'] },
]

async function main() {
  loadEnv()

  console.log('📖 读取本地数据库...')
  const SQL = await initSqlJs()
  const buf = readFileSync(resolve('server/data/reader.db'))
  const localDb = new SQL.Database(buf)

  console.log('☁️  连接 Turso...')
  const turso = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  })

  let totalInserted = 0
  let totalUpdated = 0
  let totalSkipped = 0

  for (const { name, columns, pkIdx } of TABLES) {
    // 读取本地数据
    const lStmt = localDb.prepare(`SELECT ${columns.join(',')} FROM ${name}`)
    const localRows: Map<string, any[]> = new Map()
    while (lStmt.step()) {
      const row = columns.map((_, i) => lStmt.getAsObject()[columns[i]] ?? null)
      const pk = String(row[pkIdx] ?? '')
      localRows.set(pk, row)
    }
    lStmt.free()

    if (localRows.size === 0) {
      console.log(`  ⏭️  ${name}: 本地无数据`)
      continue
    }

    // 读取 Turso 现有数据（只取需要的列做对比）
    let remoteRows: Map<string, any[]> = new Map()
    try {
      const rResult = await turso.execute(`SELECT ${columns.join(',')} FROM ${name}`)
      for (const r of rResult.rows) {
        const pk = String(r[pkIdx] ?? '')
        remoteRows.set(pk, r as any[])
      }
    } catch {
      // 表可能刚新建，为空
    }

    // 对比差异
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

    // 执行写入
    const cols = columns.join(',')
    const ph = columns.map(() => '?').join(',')

    for (const row of toInsert) {
      await turso.execute({ sql: `INSERT INTO ${name} (${cols}) VALUES (${ph})`, args: row })
    }

    if (toUpdate.length > 0) {
      // 逐行 UPDATE（Turso 不支持 ON CONFLICT DO UPDATE SET）
      const pkCol = columns[pkIdx]
      const setClause = columns.map(c => `${c}=?`).join(',')
      for (const { pk, row } of toUpdate) {
        await turso.execute({ sql: `UPDATE ${name} SET ${setClause} WHERE ${pkCol}=?`, args: [...row, pk] })
      }
    }

    const skipped = remoteRows.size - toUpdate.length - toInsert.length
    console.log(`  ✅ ${name}: +${toInsert.length} 新增, ~${toUpdate.length} 更新, =${skipped} 跳过`)
    totalInserted += toInsert.length
    totalUpdated += toUpdate.length
    totalSkipped += skipped
  }

  localDb.close()
  console.log(`\n✅ 完成: ${totalInserted} 新增, ${totalUpdated} 更新, ${totalSkipped} 跳过`)
}

function rowsEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (String(a[i] ?? '') !== String(b[i] ?? '')) return false
  }
  return true
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
