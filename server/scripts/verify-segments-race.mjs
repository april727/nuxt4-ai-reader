/**
 * 段落结构并发回归测试
 *
 * 复现的真实故障：用户连点「与下方段落合并」时，多个请求各自读到同一份旧 segments，
 * 各自合并后整份写回，后写的覆盖先写的 —— 结果是段落顺序错乱（内容 A 跑到 B 前面）、
 * 甚至内容丢失。另一条同样致命的路径：保存标记/阅读位置调用的 /api/text/update
 * 过去会把整行连 segments 一起写回，只要它在合并请求期间落地，合并就被回退。
 *
 * 本脚本验证三件事：
 * 1. 并发合并后，所有段落按原文顺序单调排列，内容不重不漏；
 * 2. 合并期间穿插 /api/text/update（只改 marks）不会回退合并结果；
 * 3. 结构版本一致（段落 index 连续、id 不重复）。
 *
 * 用法：node server/scripts/verify-segments-race.mjs [--keep]
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const BASE = process.env.TEST_BASE || 'http://localhost:3000'
const pw = env.SITE_PASSWORD || ''
const token = (await import('node:crypto')).createHash('sha256').update(pw).digest('hex')
const cookie = `auth_token=${token}`

// 数据库连接跟随 .env 的引擎：服务端改成「本地为主」后，
// 脚本若还写 Turso，接口就看不见测试数据（表现为莫名其妙的 404）。
const { q } = await import('./_testdb.mjs')

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`)
  return data
}

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

/** 建一篇测试文章并按自然段建立初始结构 */
async function createTestText(tag) {
  const id = `txt_test_race_${tag}_${Date.now()}`
  await q(
    `INSERT INTO texts (id,title,text,source,folder,segments,marks,explanations,paragraphChats,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, `__并发合并测试_${tag}__`, RAW, 'paste', 'default', '[]', '[]', '{}', '{}', new Date().toISOString(), new Date().toISOString()],
  )
  const segs = PARAS.map((t, i) => ({ id: `q-${i}`, index: i, text: t }))
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id, segments: segs }) })
  return id
}

const readSegs = async (id) => JSON.parse(String((await q('SELECT segments FROM texts WHERE id=?', [id]))[0].segments || '[]'))
const orderOf = (segs) => segs.map((s) => {
  const m = String(s.text).match(/^Paragraph (\d+) marker/)
  return m ? Number(m[1]) : NaN
})
const tryMerge = (id, upper, lower) =>
  api('/api/text/merge-segments', {
    method: 'POST',
    body: JSON.stringify({ textId: id, upperParagraphId: upper, lowerParagraphId: lower }),
  }).catch(e => ({ error: e.message }))

const created = []

// ── 构造测试文章：12 个自然段，段落文字带序号，便于校验顺序 ──
const PARAS = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} marker. ` + 'lorem ipsum dolor sit amet '.repeat(6).trim())
const RAW = PARAS.join('\n\n')
const textId = await createTestText('a')
created.push(textId)

try {
  // ── 1. 并发合并：一次性对全部 12 段两两发起合并（模拟连点） ──
  const pairs = [['q-0', 'q-1'], ['q-2', 'q-3'], ['q-4', 'q-5'], ['q-6', 'q-7'], ['q-8', 'q-9'], ['q-10', 'q-11']]
  await Promise.all(pairs.map(([u, l]) => tryMerge(textId, u, l)))

  const after = await readSegs(textId)

  check('并发合并后段数正确（12 → 6）', after.length === 6, `实际 ${after.length}`)
  check('段落 index 连续', after.every((s, i) => Number(s.index) === i))
  check('段落 id 无重复', new Set(after.map(s => s.id)).size === after.length)

  // 顺序校验：每段的起始标记序号必须递增
  const orders = orderOf(after)
  const monotonic = orders.every((v, i) => i === 0 || v > orders[i - 1])
  check('段落顺序单调（无错序）', monotonic, `顺序 ${orders.join(',')}`)

  // 内容校验：不重不漏
  const joined = after.map(s => s.text).join('\n')
  const lost = PARAS.filter(p => !joined.includes(p))
  check('内容无丢失', lost.length === 0, lost.length ? `丢失 ${lost.length} 段` : '')
  const extraCount = joined.split('Paragraph ').length - 1
  check('内容无重复', extraCount === 12, `出现 ${extraCount} 次`)

  // ── 2. 合并与 text/update（只改 marks）并发，验证合并不会被回退 ──
  await Promise.all([
    tryMerge(textId, 'q-0', 'q-2'),
    api('/api/text/update', {
      method: 'POST',
      body: JSON.stringify({ id: textId, marks: [{ id: 'm_test', paragraphId: 'q-0', text: 'marker', startOffset: 0, endOffset: 6 }] }),
    }).catch(e => ({ error: e.message })),
  ])
  const after2 = await readSegs(textId)
  check('text/update 并发不会回退合并结果', after2.length === 5, `实际 ${after2.length} 段`)

  // ── 3. 重复提交同一合并（幂等，不应产生第二份合并） ──
  await tryMerge(textId, 'q-4', 'q-6')
  const before = (await readSegs(textId)).length
  const again = await tryMerge(textId, 'q-4', 'q-6')
  const after3 = (await readSegs(textId)).length
  check('重复合并幂等（不重复拼接）', after3 === before, `${before} → ${after3}`)
  check('重复合并返回 applied=false', again.applied === false, again.error ? again.error.slice(0, 60) : '')

  // ── 4. 不相邻的两段不允许合并 ──
  const nonAdj = await tryMerge(textId, 'q-0', 'q-10')
  check('不相邻段落拒绝合并', nonAdj.applied === false && nonAdj.conflict === true, `reason=${nonAdj.reason || nonAdj.error}`)

  // ── 5. 同一段连点两次合并（真实最常见的乱序来源）──
  // 用户对第 1 段连点两下：两个请求同时在飞，旧实现里第二个请求会把 q-2 拼到
  // 仍含 q-1 的旧基线上，写出 [q0+q2, q1, ...] —— 内容顺序当场错乱。
  const textIdB = await createTestText('b')
  created.push(textIdB)
  await Promise.all([tryMerge(textIdB, 'q-0', 'q-1'), tryMerge(textIdB, 'q-0', 'q-2')])
  const segsB = await readSegs(textIdB)
  const ordersB = orderOf(segsB)
  const monoB = ordersB.every((v, i) => i === 0 || v > ordersB[i - 1])
  check('同一段连点合并后顺序仍单调', monoB, `顺序 ${ordersB.join(',')}`)
  const joinedB = segsB.map(s => s.text).join('\n')
  check('同一段连点后内容不重不漏',
    joinedB.split('Paragraph ').length - 1 === 12 && PARAS.every(p => joinedB.includes(p)),
    `出现 ${joinedB.split('Paragraph ').length - 1} 次`)
} finally {
  if (!process.argv.includes('--keep')) {
    for (const id of created) {
      await q('DELETE FROM texts_history WHERE textId=?', [id]).catch(() => {})
      await q('DELETE FROM texts WHERE id=?', [id]).catch(() => {})
    }
  } else {
    console.log(`\n（保留测试数据 ${created.join(', ')}）`)
  }
}

const failed = results.filter(r => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) process.exitCode = 1
