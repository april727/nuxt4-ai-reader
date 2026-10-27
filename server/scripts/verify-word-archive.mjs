/**
 * 回收站归档流程验证（可重复运行）
 *
 * 覆盖：
 * 1. 新建测试文章 + 标记一个词 → 词条出现在默认本与文章本
 * 2. 给词条写入学习进度（learnCorrect/learnTotal）
 * 3. 标记软删除（进回收站）→ 词条在列表/复习队列/总览/统计中全部消失，DB 里 archivedAt 置位
 * 4. 从回收站恢复 → 词条重新出现，且 words.id 与学习进度不变
 * 5. 彻底删除标记 → 词条行真正消失
 * 6. 清理测试文章
 *
 * 用法：node server/scripts/verify-word-archive.mjs
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@libsql/client'

const BASE = process.env.BASE || 'http://localhost:3000'

// ── 读取 .env（不覆盖已有环境变量）──
const envText = readFileSync('.env', 'utf-8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const TOKEN = createHash('sha256').update(process.env.SITE_PASSWORD || '').digest('hex')

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie: `auth_token=${TOKEN}`, ...(opts.headers || {}) },
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

// 数据库连接跟随 .env 的引擎（服务端本地为主时脚本也必须改本地库）
async function dbAll(sql, args = []) {
  const { q } = await import('./_testdb.mjs')
  return q(sql, args)
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const stamp = Date.now()
const WORD = `zeppelin${String(stamp).slice(-5)}`
const MARK_ID = `mk_test_${stamp}`
let textId = ''

async function articleBookWords(bookId) {
  const r = await api(`/api/wordbooks/${bookId}/words?pageSize=200&phase=all`)
  return r.words || []
}

async function main() {
  // ── 1. 建测试文章 ──
  const saved = await api('/api/text/save', {
    method: 'POST',
    body: JSON.stringify({
      text: `A ${WORD} drifted above the quiet harbour while the town slept.`,
      source: 'paste',
      title: `__归档验证__ ${stamp}`,
    }),
  })
  textId = saved.id || saved.textId
  if (!textId) throw new Error(`未能取得测试文章 id: ${JSON.stringify(saved)}`)
  console.log(`测试文章: ${textId}  测试词: ${WORD}`)

  // ── 2. 打标记 ──
  const mark = {
    id: MARK_ID,
    type: 'word',
    text: WORD,
    lemma: '',
    detail: '[PHONETIC]/ˈzepəlɪn/[/PHONETIC]\n### 基本释义\n齐柏林飞艇（测试）',
    context: `A ${WORD} drifted above the quiet harbour`,
    paragraphId: 'p-0',
    startOffset: 2,
    endOffset: 2 + WORD.length,
    createdAt: new Date().toISOString(),
  }
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: textId, marks: [mark] }) })

  const articleBookId = `wb_t_${textId}`
  let inDefault = await articleBookWords('wb_default')
  let inArticle = await articleBookWords(articleBookId)
  const defaultRow = inDefault.find(w => w.word.toLowerCase() === WORD.toLowerCase())
  const articleRow = inArticle.find(w => w.word.toLowerCase() === WORD.toLowerCase())
  check('标记后出现在默认本', !!defaultRow)
  check('标记后出现在文章本', !!articleRow)

  if (!defaultRow || !articleRow) throw new Error('词条未生成，后续验证无法进行')

  // ── 3. 写入学习进度（用于验证恢复后不丢进度）──
  await api(`/api/wordbooks/wb_default/words/${defaultRow.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ learnCorrect: 3, learnTotal: 5, phase: 'review', nextReview: '2020-01-01T00:00:00.000Z' }),
  })
  const beforeRows = await dbAll('SELECT id,bookId,learnCorrect,learnTotal,archivedAt FROM words WHERE markId=?', [MARK_ID])
  check('进度已写入', beforeRows.length === 2, `${beforeRows.length} 行`)

  const reviewBefore = await api('/api/wordbooks/wb_default/review-queue?newLimit=100&reviewLimit=200')
  check('软删前在复习队列', reviewBefore.words.some(w => w.word === WORD))

  const booksBefore = await api('/api/wordbooks/books')
  const bookBefore = booksBefore.find(b => b.id === textId)
  check('软删前资源总览含该篇', Number(bookBefore?.totalCount || 0) >= 1, `totalCount=${bookBefore?.totalCount}`)

  const statsBefore = await api('/api/words/stats')
  const statsWordsBefore = statsBefore.overview.total

  // ── 4. 软删除（进回收站）──
  await api('/api/text/update', {
    method: 'POST',
    body: JSON.stringify({ id: textId, marks: [{ ...mark, deletedAt: new Date().toISOString() }] }),
  })

  inDefault = await articleBookWords('wb_default')
  inArticle = await articleBookWords(articleBookId)
  check('软删后默认本不出现', !inDefault.some(w => w.word.toLowerCase() === WORD.toLowerCase()))
  check('软删后文章本不出现', !inArticle.some(w => w.word.toLowerCase() === WORD.toLowerCase()))

  const reviewAfter = await api('/api/wordbooks/wb_default/review-queue?newLimit=100&reviewLimit=200')
  check('软删后不在复习队列', !reviewAfter.words.some(w => w.word === WORD))

  const booksAfter = await api('/api/wordbooks/books')
  check('软删后资源总览不含该篇', !booksAfter.some(b => b.id === textId))

  const statsAfter = await api('/api/words/stats')
  check('软删后统计不再计入', statsAfter.overview.total === statsWordsBefore - 1,
    `${statsWordsBefore} → ${statsAfter.overview.total}`)

  const archivedRows = await dbAll('SELECT id,bookId,archivedAt,learnCorrect FROM words WHERE markId=?', [MARK_ID])
  check('归档位已置（词条未删除）', archivedRows.length === 2 && archivedRows.every(r => r.archivedAt),
    archivedRows.map(r => `${r.bookId}:${r.archivedAt}`).join(' | '))

  // ── 5. 恢复 ──
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: textId, marks: [mark] }) })
  inDefault = await articleBookWords('wb_default')
  inArticle = await articleBookWords(articleBookId)
  const restoredDefault = inDefault.find(w => w.word.toLowerCase() === WORD.toLowerCase())
  const restoredArticle = inArticle.find(w => w.word.toLowerCase() === WORD.toLowerCase())
  check('恢复后重新出现在默认本', !!restoredDefault)
  check('恢复后重新出现在文章本', !!restoredArticle)
  check('恢复后词条 id 不变', restoredDefault?.id === defaultRow.id,
    `${defaultRow.id} → ${restoredDefault?.id}`)
  check('恢复后学习进度保留', Number(restoredDefault?.learnCorrect) === 3 && Number(restoredDefault?.learnTotal) === 5,
    `learnCorrect=${restoredDefault?.learnCorrect}/${restoredDefault?.learnTotal}`)

  const archivedCleared = await dbAll('SELECT archivedAt FROM words WHERE markId=?', [MARK_ID])
  check('归档位已清除', archivedCleared.every(r => !r.archivedAt))

  // ── 6. 彻底删除 ──
  await api('/api/recycle/permanent', { method: 'POST', body: JSON.stringify({ id: MARK_ID, kind: 'mark' }) })
  const afterPurge = await dbAll('SELECT id FROM words WHERE markId=?', [MARK_ID])
  check('彻底删除后词条行消失', afterPurge.length === 0, `${afterPurge.length} 行`)

  // ── 7. 清理测试文章 ──
  await api('/api/text/delete', { method: 'POST', body: JSON.stringify({ id: textId }) })
  await api('/api/recycle/permanent', { method: 'POST', body: JSON.stringify({ id: textId, kind: 'text' }) })
  const leftText = await dbAll('SELECT id FROM texts WHERE id=?', [textId])
  check('测试文章已清理', leftText.length === 0)
  // 文章本清空后不应再出现在单词本列表（书本体作为历史记录保留即可）
  const booksFinal = await api('/api/wordbooks')
  check('空文章本不再出现在列表', !booksFinal.some(b => b.id === articleBookId))

  // ── 8. 跨篇同词：删一篇的标记不能把默认本那一行归档 ──
  await crossArticle()

  const failed = results.filter(r => !r.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) process.exitCode = 1
}

async function crossArticle() {
  const word = `airship${String(stamp).slice(-5)}`
  const mk = (id) => ({
    id, type: 'word', text: word, lemma: '',
    detail: '[PHONETIC]/ˈeəʃɪp/[/PHONETIC]\n### 基本释义\n飞艇（测试）',
    context: `The ${word} rose slowly.`,
    paragraphId: 'p-0', startOffset: 4, endOffset: 4 + word.length,
    createdAt: new Date().toISOString(),
  })
  const mkA = mk(`mk_a_${stamp}`)
  const mkB = mk(`mk_b_${stamp}`)

  const a = await api('/api/text/save', {
    method: 'POST',
    body: JSON.stringify({ text: `The ${word} rose slowly over the bay.`, source: 'paste', title: `__归档验证A__ ${stamp}` }),
  })
  const b = await api('/api/text/save', {
    method: 'POST',
    body: JSON.stringify({ text: `Every ${word} needs a ground crew and a hangar.`, source: 'paste', title: `__归档验证B__ ${stamp}` }),
  })
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: a.id, marks: [mkA] }) })
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: b.id, marks: [mkB] }) })

  const hit = async (bookId) => (await articleBookWords(bookId)).some(w => w.word.toLowerCase() === word)
  check('跨篇同词：默认本可见', await hit('wb_default'))

  // A 篇进回收站
  await api('/api/text/update', { method: 'POST', body: JSON.stringify({ id: a.id, marks: [{ ...mkA, deletedAt: new Date().toISOString() }] }) })
  check('跨篇同词：A 篇文章本已隐藏', !(await hit(`wb_t_${a.id}`)))
  check('跨篇同词：默认本仍然可见（B 篇仍有有效标记）', await hit('wb_default'))

  // 清理
  await api('/api/recycle/permanent', { method: 'POST', body: JSON.stringify({ id: mkA.id, kind: 'mark' }) })
  await api('/api/recycle/permanent', { method: 'POST', body: JSON.stringify({ id: mkB.id, kind: 'mark' }) })
  for (const t of [a, b]) {
    await api('/api/text/delete', { method: 'POST', body: JSON.stringify({ id: t.id }) })
    await api('/api/recycle/permanent', { method: 'POST', body: JSON.stringify({ id: t.id, kind: 'text' }) })
  }
  check('跨篇同词：测试数据已清理', (await dbAll('SELECT id FROM texts WHERE id IN (?,?)', [a.id, b.id])).length === 0)
}

main().catch((e) => {
  console.error('\n验证中断:', e.message)
  process.exitCode = 1
})
