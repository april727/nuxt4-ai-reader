/**
 * 快速测试脚本：连接 Turso 并建表
 * 运行: npx tsx scripts/test-create-tables.ts
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 手动加载 .env
const envPath = resolve('.env')
const lines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of lines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
}

async function main() {
  const db = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  })

  console.log('Testing CREATE TABLE...')

  try {
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
    console.log('✅ texts table created')

    // Verify
    const r = await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='texts'")
    if (r.rows.length > 0) {
      console.log('Schema:', r.rows[0][0])
    }

    // Test ALTERs
    const alters = [
      ['paragraphChats', "TEXT DEFAULT ''"],
      ['completedAt', 'TEXT DEFAULT NULL'],
    ]
    for (const [col, def] of alters) {
      try {
        await db.execute(`ALTER TABLE texts ADD COLUMN ${col} ${def}`)
        console.log(`✅ ALTER texts ADD ${col} — OK`)
      } catch (e: any) {
        console.log(`⚠️  ALTER texts ADD ${col} — ${e.message}`)
      }
    }

    // Test query
    const q = await db.execute('SELECT * FROM texts LIMIT 0')
    console.log('✅ SELECT * FROM texts — OK, columns:', q.columns.join(', '))

  } catch (e: any) {
    console.error('❌ Error:', e.message)
  }
}

main()
