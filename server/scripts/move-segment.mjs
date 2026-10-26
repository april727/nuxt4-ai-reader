/**
 * 把某个段落移动到指定位置（默认：移到文末），段落 id 不变。
 *
 * 为什么用 id 保存而不是重建段落：marks / explanations / paragraphChats 都以
 * paragraphId 为键，重建会破坏这些引用；只调整数组顺序、保留原 id，标记自然跟着走。
 *
 * 用法：
 *   node server/scripts/move-segment.mjs <textId> <segmentId> [--to end|top|<n>] [--write]
 *
 * 不加 --write 只预演。
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { randomUUID } from 'node:crypto'

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .reduce((acc, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) acc[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    return acc
  }, {})

const client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows

const [textId, segmentId] = process.argv.slice(2, 4)
const toArg = (() => {
  const i = process.argv.indexOf('--to')
  return i > -1 ? process.argv[i + 1] : 'end'
})()
const write = process.argv.includes('--write')

if (!textId || !segmentId) {
  console.error('用法: node server/scripts/move-segment.mjs <textId> <segmentId> [--to end|top|<n>] [--write]')
  process.exit(1)
}

const [row] = await q('SELECT title,segments,marks,explanations,paragraphChats FROM texts WHERE id=?', [textId])
if (!row) {
  console.error('找不到文本', textId)
  process.exit(1)
}

const segs = JSON.parse(row.segments || '[]')
const marks = JSON.parse(row.marks || '[]')
const chats = JSON.parse(row.paragraphChats || '{}')

const from = segs.findIndex(s => s.id === segmentId)
if (from === -1) {
  console.error('找不到段落', segmentId)
  process.exit(1)
}

const target = toArg === 'end' ? segs.length - 1 : toArg === 'top' ? 0 : Number(toArg)
if (!Number.isFinite(target) || target < 0 || target > segs.length - 1) {
  console.error('目标位置超出范围：', toArg)
  process.exit(1)
}

const marksOnSeg = marks.filter(m => m.paragraphId === segmentId)
console.log(`《${row.title}》共 ${segs.length} 段`)
console.log(`移动段落: 第 ${from + 1} 段 → 第 ${target + 1} 段`)
console.log(`  内容: ${JSON.stringify(String(segs[from].text || '').replace(/\n/g, '⏎').slice(0, 60))}`)
console.log(`  该段标记: ${marksOnSeg.length} 个${marksOnSeg.length ? '（' + marksOnSeg.map(m => m.text).join(', ') + '）' : ''}`)
console.log(`  该段对话: ${(chats[segmentId] || []).length} 条`)

const next = [...segs]
const [moved] = next.splice(from, 1)
next.splice(target, 0, moved)
next.forEach((s, i) => { s.index = i })

// 校验：id 集合不变，标记引用不失效
const beforeIds = segs.map(s => s.id).join(',')
const afterIds = next.map(s => s.id).join(',')
const sameIds = beforeIds.split(',').sort().join(',') === afterIds.split(',').sort().join(',')
const ids = new Set(next.map(s => s.id))
const dangling = marks.filter(m => !ids.has(m.paragraphId))
console.log(`\nid 集合不变: ${sameIds ? '✓' : '✗'}  | 标记失效数: ${dangling.length}`)

if (!sameIds || dangling.length) {
  console.error('校验未通过，放弃写入')
  process.exit(1)
}

if (!write) {
  console.log('\n（预演，未写入。加 --write 生效）')
  process.exit(0)
}

// 先留快照
const histId = `h_${Date.now()}_${randomUUID().slice(0, 5)}`
await q(
  `INSERT INTO texts_history (id,textId,segments,marks,explanations,paragraphChats,note,segmentCount,createdAt)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [histId, textId, row.segments, row.marks, row.explanations, row.paragraphChats, '移动段落', segs.length, new Date().toISOString()],
)

await q('UPDATE texts SET segments=?,updatedAt=? WHERE id=?', [JSON.stringify(next), new Date().toISOString(), textId])
console.log(`\n✓ 已写入（快照 ${histId}）`)
console.log('新顺序末尾三段:')
next.slice(-3).forEach((s, i) => {
  console.log(`  第 ${next.length - 2 + i} 段 [${s.id}] ${JSON.stringify(String(s.text || '').replace(/\n/g, '⏎').slice(0, 40))}`)
})
