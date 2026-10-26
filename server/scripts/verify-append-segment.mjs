/**
 * 「并入段末」回归测试（POST /api/text/append-segment）
 *
 * 背景：用户先用「插入段落」补一段内容，再想把上下两段合并，结果插入段卡在中间、
 * 两段不再相邻，合并被拒绝。改为「并入段末」后段落数不变，相邻关系不被打断。
 *
 * 验证点：
 * 1. 追加后段落数不变、目标段文字以追加内容结尾；
 * 2. 已有标记的字符偏移不受影响（只在末尾追加）；
 * 3. 该段旧的讲解/翻译缓存被清掉（内容变了，旧解释不再适用）；
 * 4. 重复追加同一内容幂等（连点/重试不会叠两遍）；
 * 5. 目标段不存在时返回 conflict，不写库；
 * 6. 追加后上下两段仍相邻，merge 能成功（这是本需求的核心）。
 *
 * 用法：node server/scripts/verify-append-segment.mjs [--keep]
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const cookie = `auth_token=${createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')}`

const turso = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })
const q = async (sql, args = []) => (await turso.execute({ sql, args })).rows

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${String(text).slice(0, 200)}`)
  return data
}

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const textId = `txt_test_append_${Date.now()}`
const P1 = 'First paragraph with a marked phrase inside it.'
const P2 = 'Second paragraph stays untouched.'
const P3 = 'Third paragraph, next to the first one after appending.'
const APPEND = 'Extra content appended at the tail.\nSecond line of it.'

await q(
  `INSERT INTO texts (id,title,text,source,folder,segments,marks,explanations,paragraphChats,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  [
    textId, '__并入段末测试__', [P1, P2, P3].join('\n\n'), 'paste', 'default',
    JSON.stringify([
      { id: 'q-0', index: 0, text: P1 },
      { id: 'q-1', index: 1, text: P2 },
      { id: 'q-2', index: 2, text: P3 },
    ]),
    JSON.stringify([{ id: 'm1', paragraphId: 'q-0', text: 'marked', startOffset: 24, endOffset: 30 }]),
    JSON.stringify({ 'q-0:explain': '旧解释', 'q-1:explain': '另一段解释' }),
    '{}',
    new Date().toISOString(), new Date().toISOString(),
  ],
)

try {
  // ── 1. 追加到第 1 段末尾 ──
  const r1 = await api('/api/text/append-segment', {
    method: 'POST',
    body: JSON.stringify({ textId, paragraphId: 'q-0', text: APPEND }),
  })
  const segs1 = JSON.parse(String((await q('SELECT segments FROM texts WHERE id=?', [textId]))[0].segments || '[]'))

  check('段落数不变（3 段）', segs1.length === 3, `实际 ${segs1.length}`)
  check('返回 applied=true', r1.applied === true)
  check('文字接在段末', String(segs1[0].text).endsWith('Second line of it.'))
  check('原有文字未被改动', String(segs1[0].text).startsWith(P1.trim()))
  check('其它段落未受影响', segs1[1].text === P2 && segs1[2].text === P3)

  // ── 2. 标记偏移不受影响（末尾追加不改变前面的字符位置）──
  const marks = JSON.parse(String((await q('SELECT marks FROM texts WHERE id=?', [textId]))[0].marks || '[]'))
  const m1 = marks.find(m => m.id === 'm1')
  check('标记偏移未变', m1.startOffset === 24 && m1.endOffset === 30, `${m1.startOffset}-${m1.endOffset}`)
  check('标记指向的仍是第 1 段', m1.paragraphId === 'q-0')

  // ── 3. 该段旧解释缓存被清，其它段保留 ──
  const exp = JSON.parse(String((await q('SELECT explanations FROM texts WHERE id=?', [textId]))[0].explanations || '{}'))
  check('本段解释缓存已清', !exp['q-0:explain'])
  check('其它段解释缓存保留', exp['q-1:explain'] === '另一段解释')

  // ── 4. 重复追加同一内容幂等 ──
  const r2 = await api('/api/text/append-segment', {
    method: 'POST',
    body: JSON.stringify({ textId, paragraphId: 'q-0', text: APPEND }),
  })
  const segs2 = JSON.parse(String((await q('SELECT segments FROM texts WHERE id=?', [textId]))[0].segments || '[]'))
  const times = String(segs2[0].text).split('Second line of it.').length - 1
  check('重复追加不叠加', times === 1 && r2.applied === false, `出现 ${times} 次，applied=${r2.applied}`)

  // ── 5. 目标段不存在 → conflict，不写库 ──
  const r3 = await api('/api/text/append-segment', {
    method: 'POST',
    body: JSON.stringify({ textId, paragraphId: 'q-不存在', text: 'x' }),
  }).catch(e => ({ error: e.message }))
  check('目标段不存在时返回 conflict', r3.conflict === true && r3.reason === 'paragraph_missing', String(r3.reason || r3.error))

  // ── 6. 核心：追加后第 1、2 段仍相邻，可以直接合并 ──
  const r4 = await api('/api/text/merge-segments', {
    method: 'POST',
    body: JSON.stringify({ textId, upperParagraphId: 'q-0', lowerParagraphId: 'q-1' }),
  })
  const segs3 = JSON.parse(String((await q('SELECT segments FROM texts WHERE id=?', [textId]))[0].segments || '[]'))
  check('追加后相邻两段可合并', r4.applied === true && segs3.length === 2, `段数 ${segs3.length}`)
  check('合并结果包含追加内容', String(segs3[0].text).includes('Second line of it.') && String(segs3[0].text).includes(P2))

  // ── 7. 参数校验 ──
  const bad = await api('/api/text/append-segment', {
    method: 'POST',
    body: JSON.stringify({ textId, paragraphId: 'q-0', text: '   ' }),
  }).catch(e => ({ error: e.message }))
  check('空文字被拒绝', String(bad.error || '').includes('400'), String(bad.error || '').slice(0, 60))
} finally {
  if (!process.argv.includes('--keep')) {
    await q('DELETE FROM texts_history WHERE textId=?', [textId]).catch(() => {})
    await q('DELETE FROM texts WHERE id=?', [textId]).catch(() => {})
    console.log('\n（测试数据已清理）')
  } else {
    console.log(`\n（保留测试数据 ${textId}）`)
  }
}

const failed = results.filter(r => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) process.exitCode = 1
