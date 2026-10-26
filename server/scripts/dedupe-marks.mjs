/**
 * marks 表去重 + 补唯一索引
 *
 * 根因（已确证）：Turso 上 marks 表的真实建表语句**没有 PRIMARY KEY**——
 *   CREATE TABLE marks (id TEXT, textId TEXT, ... deletedAt TEXT DEFAULT NULL)
 * 导致同步逻辑里的 `INSERT OR REPLACE INTO marks` 退化为普通 INSERT：
 * 每次保存都把整批标记再追加一份。实测 10,425 行里只有 7,834 个不同 id，
 * 且同 id 的多行 createdAt 精确到毫秒相同（如 scrawny 一瞬间 6 份）。
 *
 * 处理：
 *   1. 同 id 只保留一行（优先 detail 最长的，其次 createdAt 最新）
 *   2. 其余行按 rowid 删除（不能按 id 删，会把整组删掉）
 *   3. 建 UNIQUE INDEX marks(id)，让 INSERT OR REPLACE 恢复原有语义
 *   4. knowledge_pages 同样缺主键，一并补唯一索引
 *
 * 用法：
 *   node server/scripts/dedupe-marks.mjs                 只读巡检 + 导出备份
 *   node server/scripts/dedupe-marks.mjs --fix           执行删除并建索引
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FIX = process.argv.includes('--fix')

function loadEnv() {
  for (const p of ['.env', '../deploy-ai-reader/.env']) {
    const f = join(process.cwd(), p)
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return
  }
}

loadEnv()
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function run(sql, args = [], tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return (await db.execute({ sql, args })).rows } catch (e) {
      if (i === tries - 1) throw e
      await sleep(1000 * (i + 1))
    }
  }
}

async function main() {
  const total = (await run('SELECT COUNT(*) c FROM marks'))[0].c
  const uniq = (await run('SELECT COUNT(DISTINCT id) c FROM marks'))[0].c
  console.log(`marks 总行数 ${total} / 唯一 id ${uniq} / 同 id 冗余 ${total - uniq}`)

  const dupIds = await run(`
    SELECT id, COUNT(*) n FROM marks GROUP BY id HAVING COUNT(*) > 1 ORDER BY n DESC`)
  console.log(`同 id 重复的 id 数: ${dupIds.length}，涉及行数: ${dupIds.reduce((s, r) => s + Number(r.n), 0)}`)

  if (!dupIds.length) { console.log('无需去重'); return }

  // 一次性取回所有重复 id 的行，再在本地分组（逐组查询会有上千次远程往返）
  const allRows = await run(`
    SELECT rowid, id, textId, type, text, lemma, detail, note, createdAt, deletedAt
    FROM marks
    WHERE id IN (SELECT id FROM marks GROUP BY id HAVING COUNT(*) > 1)`)
  console.log(`重复 id 对应行数: ${allRows.length}`)

  const byId = new Map()
  for (const r of allRows) {
    const list = byId.get(r.id) || []
    list.push(r)
    byId.set(r.id, list)
  }

  const victims = []
  const backup = []
  for (const [id, rows] of byId) {
    const sorted = [...rows].sort((a, b) => {
      const la = String(a.detail || '').length
      const lb = String(b.detail || '').length
      if (lb !== la) return lb - la
      const ta = String(a.createdAt || '')
      const tb = String(b.createdAt || '')
      if (tb !== ta) return tb < ta ? -1 : 1
      return Number(a.rowid) - Number(b.rowid)
    })
    backup.push({ id, keepRowid: sorted[0].rowid, rows })
    for (const r of sorted.slice(1)) victims.push(r.rowid)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(process.cwd(), `marks-dedupe-backup-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8')
  console.log(`已导出备份: ${backupPath}（${(JSON.stringify(backup).length / 1024 / 1024).toFixed(1)}MB）`)
  console.log(`待删除冗余行: ${victims.length}`)

  if (!FIX) { console.log('\n（只读模式。加 --fix 执行删除并建唯一索引）'); return }

  let deleted = 0
  const BATCH = 200
  for (let i = 0; i < victims.length; i += BATCH) {
    const slice = victims.slice(i, i + BATCH)
    await run(`DELETE FROM marks WHERE rowid IN (${slice.map(() => '?').join(',')})`, slice)
    deleted += slice.length
    if (deleted % 1000 === 0) console.log(`  已删除 ${deleted}/${victims.length}`)
  }
  console.log(`已删除冗余行: ${deleted}`)

  // 补唯一索引：恢复 INSERT OR REPLACE 的语义
  try {
    await run('CREATE UNIQUE INDEX IF NOT EXISTS uq_marks_id ON marks(id)')
    console.log('已创建 UNIQUE INDEX uq_marks_id')
  } catch (e) {
    console.log('创建 marks 唯一索引失败:', e.message)
  }
  try {
    await run('CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_pages_id ON knowledge_pages(id)')
    console.log('已创建 UNIQUE INDEX uq_knowledge_pages_id')
  } catch (e) {
    console.log('创建 knowledge_pages 唯一索引失败:', e.message)
  }

  const t2 = (await run('SELECT COUNT(*) c FROM marks'))[0].c
  const u2 = (await run('SELECT COUNT(DISTINCT id) c FROM marks'))[0].c
  console.log(`\n处理结果：行数 ${t2} / 唯一 id ${u2} → ${t2 === u2 ? '✔ 一致' : '✗ 仍有冗余'}`)
}

main().catch(e => { console.error('失败:', e.message); process.exit(1) })
