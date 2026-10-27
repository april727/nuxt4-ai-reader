/**
 * 段落结构修复工具
 *
 * 用途：某篇文章的段落已经被"合并错乱"破坏（内容顺序错乱 / 大段丢失）时，
 * 按原文自然段重建结构，同时尽量保住用户后来手动插入的段落与标记。
 *
 * 什么时候能用：只对「结构 id 是 q-N 形式」的文章有效，也就是按原文自然段
 * 建立的结构（打开文章时自动生成的那种）。如果这篇是 AI 分段（p-N）或手动
 * 上传的分段，重建会破坏原有划分，脚本会直接拒绝。
 *
 * 用法：
 *   node server/scripts/repair-segments.mjs <textId>            # 预演，只报告不写
 *   node server/scripts/repair-segments.mjs <textId> --write     # 真正写入
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const textId = process.argv[2]
const write = process.argv.includes('--write')
if (!textId) {
  console.error('用法: node server/scripts/repair-segments.mjs <textId> [--write]')
  process.exit(1)
}

const db = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows

const row = (await q('SELECT title,text,segments,marks,explanations,paragraphChats FROM texts WHERE id=?', [textId]))[0]
if (!row) {
  console.error('文本不存在:', textId)
  process.exit(1)
}

const raw = String(row.text || '')
const cur = JSON.parse(String(row.segments || '[]'))
const marks = JSON.parse(String(row.marks || '[]'))
const explanations = JSON.parse(String(row.explanations || '{}'))

console.log(`文章：${row.title}`)
console.log(`原文字数：${raw.length}　当前段数：${cur.length}`)

const natural = cur.filter((s) => /^q-\d+$/.test(String(s.id)))
if (natural.length !== cur.length && natural.length === 0) {
  console.error('该文章不是按原文自然段建的结构（无 q-N id），拒绝重建')
  process.exit(1)
}

// ── 按原文自然段重建 ──
const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
const rebuilt = blocks.map((text, i) => ({ id: `q-${i}`, index: i, text }))

// ── 保留用户手动插入的段落（id 不是 q-N），按它前面的自然段定位 ──
const inserted = cur
  .map((s, i) => ({ seg: s, i }))
  .filter(({ seg }) => !/^q-\d+$/.test(String(seg.id)))

for (const { seg, i } of inserted) {
  let anchorIdx = -1
  for (let k = i - 1; k >= 0; k--) {
    const m = String(cur[k].id).match(/^q-(\d+)$/)
    if (m) { anchorIdx = Number(m[1]); break }
  }
  const at = anchorIdx >= 0 ? Math.min(anchorIdx + 1, rebuilt.length) : 0
  rebuilt.splice(at, 0, { ...seg })
  console.log(`保留手动插入的段落 ${seg.id}（${String(seg.text).length} 字），插到第 ${at + 1} 段位置`)
}

rebuilt.forEach((s, i) => { s.index = i })

// ── 标记：能定位的重算偏移，定位不到的原样保留在原段落（若仍存在） ──
const idSet = new Set(rebuilt.map((s) => s.id))
let relocated = 0
const keptMarks = []
for (const m of marks) {
  const same = rebuilt.find((s) => s.id === m.paragraphId)
  if (same) { keptMarks.push(m); continue }
  // 段落没了（被合并过）：在新结构里按标记原文找回去
  const needle = String(m.text || '').trim()
  const hit = needle
    ? rebuilt.find((s) => String(s.text).includes(needle))
    : null
  if (hit) {
    const at = String(hit.text).indexOf(needle)
    keptMarks.push({ ...m, paragraphId: hit.id, startOffset: at, endOffset: at + needle.length })
    relocated++
  } else {
    console.log(`⚠ 标记「${needle.slice(0, 20)}」在新结构里找不到，已丢弃`)
  }
}

// ── 解释缓存：段落文本变了的旧讲解不再准确，直接丢弃（保留手动插入段的缓存） ──
const keptExp = {}
for (const [key, val] of Object.entries(explanations)) {
  const pid = key.split(':')[0]
  const seg = rebuilt.find((s) => s.id === pid)
  if (!seg) continue
  const isInserted = !/^q-\d+$/.test(String(pid))
  const sameTextBefore = cur.find((s) => s.id === pid)?.text === seg.text
  if (isInserted || sameTextBefore) keptExp[key] = val
}

console.log(`段落：${cur.length} → ${rebuilt.length}　标记：${marks.length} → ${keptMarks.length}（重新定位 ${relocated}）　解释缓存：${Object.keys(explanations).length} → ${Object.keys(keptExp).length}`)

if (!write) {
  console.log('\n（预演模式，未写入。加 --write 执行）')
  process.exit(0)
}

// 写入前留快照，出错可回退
await q(
  `INSERT INTO texts_history (id,textId,segments,marks,explanations,paragraphChats,note,segmentCount,createdAt)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [`h_${Date.now()}_${randomUUID().slice(0, 5)}`, textId, JSON.stringify(cur), JSON.stringify(marks), JSON.stringify(explanations),
    String(row.paragraphChats || '{}'), '修复段落顺序前', cur.length, new Date().toISOString()],
)

await q(
  'UPDATE texts SET segments=?,marks=?,explanations=?,updatedAt=? WHERE id=?',
  [JSON.stringify(rebuilt), JSON.stringify(keptMarks), JSON.stringify(keptExp), new Date().toISOString(), textId],
)

console.log('✓ 已写入')
