/**
 * 标记 → 单词本 一致性巡检与修复
 *
 * 背景：单词本必须完全由文章标记驱动，不能出现「标记了但单词本里没有」。
 * 同步逻辑（server/utils/marksSync.ts）按「单词本 + 词形」去重，同一个词在多篇文章
 * 中被标记时只保留一条单词本条目 —— 所以**不能用 markId 判缺失**（会大量误报），
 * 必须按 (bookId, LOWER(word)) 判定。
 *
 * 用法：
 *   node server/scripts/repair-mark-words.mjs          仅巡检（只读）
 *   node server/scripts/repair-mark-words.mjs --fix    巡检并补齐缺失条目
 *
 * 字段解析与 marksSync.ts 保持一致（PHONETIC / POS / 基本释义 / LEMMA 标签）。
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FIX = process.argv.includes('--fix')
const MARK_TO_BOOK = { word: 'wb_default', phrase: 'wb_phrases', sentence: 'wb_sentences' }

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

function extractLemma(mark) {
  if (mark.lemma) return String(mark.lemma).trim()
  const m = /\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/.exec(mark.detail || '')
  return m?.[1]?.trim() || ''
}
function extractPhonetic(d) {
  const m = /\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/.exec(d || '')
  return m?.[1] || ''
}
function extractPos(d) {
  const m = /\[POS\]\s*(n\.|v\.|adj\.|adv\.|pron\.|prep\.|conj\.|interj\.|art\.|num\.|det\.|modal\.|aux\.|phr\.)\s*\[\/POS\]/i.exec(d || '')
  return m ? m[1].toLowerCase() : ''
}
function extractMeaning(d) {
  const m = /###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/.exec(d || '')
  if (!m) return ''
  return m[1]
    .replace(/^[-*]\s*/gm, '')
    .replace(/^\s*\d+[.、．)]\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n+/g, '；')
    .trim()
    .slice(0, 120)
}

loadEnv()
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const rows = async (sql, args = []) => (await db.execute({ sql, args })).rows

const BOOK_EXPR = `CASE m.type WHEN 'word' THEN 'wb_default' WHEN 'phrase' THEN 'wb_phrases' ELSE 'wb_sentences' END`
/** 标记在单词本中的实际词条：有 lemma 用 lemma，否则用原文 */
const TERM_EXPR = `TRIM(COALESCE(NULLIF(m.lemma,''), m.text))`

async function survey() {
  const out = {}
  const per = await rows(`
    SELECT m.type t, COUNT(*) total,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM words w WHERE w.bookId=${BOOK_EXPR} AND LOWER(w.word)=LOWER(${TERM_EXPR})) THEN 1 ELSE 0 END) found
    FROM marks m WHERE m.deletedAt IS NULL AND m.type IN ('word','phrase','sentence')
    GROUP BY m.type`)
  for (const r of per) out[r.t] = { total: Number(r.total), found: Number(r.found), missing: Number(r.total) - Number(r.found) }
  return out
}

async function missingMarks() {
  // 注意：marks 表只有 id/textId/textTitle/textFolder/type/text/lemma/detail/note/createdAt/deletedAt，
  // 没有 paragraphId / startOffset / endOffset（这些存在 texts.marks 的 JSON 里）。
  return rows(`
    SELECT m.id, m.textId, m.type, m.text, m.lemma, m.detail, m.note, m.createdAt, ${TERM_EXPR} AS term
    FROM marks m
    WHERE m.deletedAt IS NULL AND m.type IN ('word','phrase','sentence')
      AND NOT EXISTS (
        SELECT 1 FROM words w
        WHERE w.bookId=${BOOK_EXPR} AND LOWER(w.word)=LOWER(${TERM_EXPR})
      )
    ORDER BY m.createdAt`)
}

async function main() {
  const before = await survey()
  console.log('=== 巡检（按词形口径，排除 note）===')
  let totalMiss = 0
  for (const [t, v] of Object.entries(before)) {
    console.log(`  ${t}: 标记 ${v.total} / 命中 ${v.found} / 缺失 ${v.missing}`)
    totalMiss += v.missing
  }
  console.log(`  合计缺失: ${totalMiss}`)

  if (!totalMiss) { console.log('单词本与标记完全一致，无需修复'); return }
  if (!FIX) { console.log('\n（只读模式。加 --fix 补齐缺失条目）'); return }

  const books = new Set((await rows('SELECT id FROM wordbooks')).map(r => r.id))
  const list = await missingMarks()
  console.log(`\n=== 修复：待补 ${list.length} 条 ===`)

  const now = new Date().toISOString()
  const inserted = new Set()   // 同批次内同词只补一次（多篇标记同一词时只保留一条）
  let ok = 0, skipped = 0, dup = 0
  for (const m of list) {
    const bookId = MARK_TO_BOOK[m.type]
    if (!bookId || !books.has(bookId) || !m.term) { skipped++; continue }
    const key = `${bookId}|${String(m.term).toLowerCase()}`
    if (inserted.has(key)) { dup++; continue }
    inserted.add(key)
    const detail = m.detail || ''
    const lemma = extractLemma(m)
    const note = lemma && lemma !== String(m.text || '').trim()
      ? `原文: ${String(m.text).trim()}${m.note ? '\n' + m.note : ''}`
      : (m.note || '')
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    try {
      await db.execute({
        sql: `INSERT INTO words (id,bookId,word,phonetic,meaning,pos,note,source,markId,detail,context,image,type,paragraphId,startOffset,endOffset,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [id, bookId, m.term, extractPhonetic(detail), extractMeaning(detail), extractPos(detail),
          note, m.textId, m.id, detail, '', '', m.type, '', 0, 0, m.createdAt || now, now],
      })
      ok++
    } catch (e) {
      console.log(`  失败 ${m.id}: ${e.message}`)
      skipped++
    }
  }
  console.log(`  已补 ${ok} 条，跳过 ${skipped}，同批重复 ${dup}`)

  const after = await survey()
  console.log('\n=== 修复后 ===')
  let afterMiss = 0
  for (const [t, v] of Object.entries(after)) {
    console.log(`  ${t}: 标记 ${v.total} / 命中 ${v.found} / 缺失 ${v.missing}`)
    afterMiss += v.missing
  }
  console.log(`  合计缺失: ${afterMiss}${afterMiss === 0 ? '  ✔ 完全一致' : ''}`)
}

main().catch(e => { console.error('失败:', e.message); process.exit(1) })
