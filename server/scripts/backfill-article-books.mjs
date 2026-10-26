/**
 * 回填「文章专属单词本」
 *
 * 规则（用户确认）：
 *  - 一篇文章一个单词本，id = wb_t_<textId>，名称取文章标题
 *  - 三个默认本（wb_default / wb_phrases / wb_sentences）继续保留，用于按类型汇总
 *  - 同一个本内同词只保留一行（同篇重复标记不产生多行）
 *  - 重复次数不做存库，一律从 marks 表实时聚合（唯一事实来源）
 *
 * 用法：
 *   node server/scripts/backfill-article-books.mjs          只统计，不写库
 *   node server/scripts/backfill-article-books.mjs --fix    创建缺失的本并写入词条
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FIX = process.argv.includes('--fix')
const BATCH = 80

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

const extractLemma = (mk) => {
  if (mk.lemma) return String(mk.lemma).trim()
  const m = /\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/.exec(mk.detail || '')
  return m ? m[1].trim() : ''
}
const extractPhonetic = (d) => (/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/.exec(d || '') || [])[1] || ''
const extractPos = (d) => { const m = /\[POS\]\s*(n\.|v\.|adj\.|adv\.|pron\.|prep\.|conj\.|interj\.|art\.|num\.|det\.|modal\.|aux\.|phr\.)\s*\[\/POS\]/i.exec(d || ''); return m ? m[1].toLowerCase() : '' }
const extractMeaning = (d) => {
  const m = /###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/.exec(d || '')
  if (!m) return ''
  return m[1].replace(/^[-*]\s*/gm, '').replace(/^\s*\d+[.、．)]\s*/gm, '').replace(/\*\*/g, '').replace(/\n+/g, '；').trim().slice(0, 120)
}

loadEnv()
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const rows = async (sql, args = []) => (await db.execute({ sql, args })).rows

async function main() {
  const texts = await rows(`
    SELECT t.id, t.title FROM texts t
    WHERE t.deletedAt IS NULL AND EXISTS (SELECT 1 FROM marks m WHERE m.textId=t.id AND m.deletedAt IS NULL)`)
  const books = new Set((await rows("SELECT id FROM wordbooks WHERE id LIKE 'wb_t_%'")).map(r => r.id))
  console.log(`有标记的文章: ${texts.length}，已存在的文章本: ${books.size}`)

  const marks = await rows(`
    SELECT id,textId,type,text,lemma,detail,note,createdAt FROM marks
    WHERE deletedAt IS NULL ORDER BY createdAt`)
  console.log(`有效标记: ${marks.length}`)

  // 按 (textId, 词形) 去重，保留最早一条作为代表
  const seen = new Map()
  for (const m of marks) {
    const term = (extractLemma(m) || String(m.text || '')).trim()
    if (!term) continue
    const key = `${m.textId}|${term.toLowerCase()}`
    if (!seen.has(key)) seen.set(key, { ...m, term })
  }
  console.log(`去重后需写入的文章本词条: ${seen.size}`)

  if (!FIX) { console.log('\n（只读模式。加 --fix 创建本并写入）'); return }

  // 1) 建本
  let created = 0
  for (const t of texts) {
    const id = `wb_t_${t.id}`
    if (books.has(id)) continue
    await db.execute({
      sql: 'INSERT OR IGNORE INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,0,1000,?)',
      args: [id, String(t.title || '未命名文章').slice(0, 40), new Date().toISOString()],
    })
    books.add(id)
    created++
  }
  console.log(`新建文章本: ${created}`)

  // 2) 已存在的 (bookId, 词形) 跳过
  const existing = new Set()
  for (const r of await rows("SELECT bookId, LOWER(word) w FROM words WHERE bookId LIKE 'wb_t_%'"))
    existing.add(`${r.bookId}|${r.w}`)

  // 3) 批量写入
  const pending = []
  for (const m of seen.values()) {
    const bookId = `wb_t_${m.textId}`
    const key = `${bookId}|${m.term.toLowerCase()}`
    if (existing.has(key)) continue
    existing.add(key)
    pending.push({ ...m, bookId })
  }
  console.log(`待写入词条: ${pending.length}`)

  const now = new Date().toISOString()
  let done = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH)
    const values = []
    const args = []
    for (const p of slice) {
      const lemma = extractLemma(p)
      const note = lemma && lemma !== String(p.text).trim()
        ? `原文: ${String(p.text).trim()}${p.note ? '\n' + p.note : ''}`
        : (p.note || '')
      values.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      args.push(
        `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        p.bookId, p.term, extractPhonetic(p.detail), extractMeaning(p.detail), extractPos(p.detail),
        note, p.textId, p.id, p.detail || '', p.type, p.createdAt || now, now, '', '', '',
      )
    }
    await db.execute({
      sql: `INSERT INTO words (id,bookId,word,phonetic,meaning,pos,note,source,markId,detail,type,createdAt,updatedAt,context,image,paragraphId)
            VALUES ${values.join(',')}`,
      args,
    })
    done += slice.length
    if (done % 800 === 0) console.log(`  已写入 ${done}/${pending.length}`)
  }
  console.log(`完成：写入 ${done} 条`)

  // 4) 校验
  const check = await rows(`
    SELECT COUNT(*) c FROM (
      SELECT textId, LOWER(TRIM(COALESCE(NULLIF(lemma,''), text))) t
      FROM marks WHERE deletedAt IS NULL GROUP BY textId, t)`)
  const inBooks = await rows(`
    SELECT COUNT(*) c FROM (
      SELECT textId, LOWER(word) t FROM words WHERE bookId LIKE 'wb_t_%' GROUP BY textId, t)`)
  console.log(`校验：标记侧去重词条 ${check[0].c} / 文章本侧去重词条 ${inBooks[0].c}`)
}

main().catch(e => { console.error('失败:', e.message); process.exit(1) })
