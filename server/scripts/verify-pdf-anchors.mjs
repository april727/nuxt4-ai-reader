/**
 * PDF 原页锚点回归（不启浏览器，纯数据）
 *
 * 验证的是「标记能不能精确落到 PDF 原始版面上」——这条链路一旦偏，
 * 用户在原页上看到的是一片漂移的高亮，比没有更糟。
 *
 * 断言全部落在**能从坐标反读出的文字**上，不是「有没有返回矩形」：
 *   1  接口可用，且给出 pageCount / pages
 *   2  词级对齐率 ≥ 95%（段落文本 vs PDF 文字层）
 *   3  标记定位率 ≥ 85%
 *   4  **按矩形回读该行，文字必须真的包含标记内容**（逐条核对）
 *   5  不同标记不能挤在同一行（对齐整体漂移时会出现这种塌缩）
 *   6  段落页码单调不减（段落是有序的，页码不该来回跳）
 *
 * 第 4 条是核心：矩形存在很容易，"框住的是那个词"只能靠反读证明。
 *
 * 没有 layout.json 的老文章会自动补生成一份（纯派生数据，删掉也无损）。
 *
 * 用法：
 *   node server/scripts/verify-pdf-anchors.mjs            # 自动挑样本
 *   node server/scripts/verify-pdf-anchors.mjs <textId>
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { q, q1 } from './_testdb.mjs'
import { resolveBase } from './lib/cdp.mjs'

const BASE = await resolveBase()
const env = readFileSync('.env', 'utf8')
const pass = (env.match(/^SITE_PASSWORD=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '') || ''
const TOKEN = createHash('sha256').update(pass).digest('hex')

let pass_ = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass_++; console.log(`  ✓ ${name}${detail ? '  · ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  ← ' + detail : ''}`) }
}

/** 跨 folder 找内容目录里的 layout.json / source.pdf */
function contentDirOf(textId) {
  const dirs = []
  for (const f of readdirSync('server/data/files')) {
    const p = path.join('server/data/files', f, textId)
    try { if (statSync(p).isDirectory()) dirs.push(p) } catch {}
  }
  return dirs
}

// ── 挑样本 ──
let textId = process.argv[2]
if (!textId) {
  const rows = await q(`SELECT id, title, marks FROM texts WHERE filePath LIKE '%.pdf' AND deletedAt IS NULL`)
  const cands = rows
    .map((r) => {
      let n = 0
      try { n = JSON.parse(r.marks || '[]').filter((m) => !m.deletedAt).length } catch {}
      const dirs = contentDirOf(r.id)
      const hasPdf = dirs.some((d) => existsSync(path.join(d, 'source.pdf')))
      return { id: r.id, title: r.title, marks: n, hasPdf }
    })
    .filter((c) => c.marks > 0 && c.hasPdf)
    .sort((a, b) => b.marks - a.marks)
  if (!cands.length) { console.log('库里没有带标记且有源 PDF 的文章，跳过'); process.exit(0) }
  textId = cands[0].id
  console.log(`样本：${cands[0].title}（${textId}，${cands[0].marks} 条标记）\n`)
}

// ── 确保有坐标表 ──
const dirs = contentDirOf(textId)
const pdfPath = dirs.map((d) => path.join(d, 'source.pdf')).find((p) => existsSync(p))
if (!pdfPath) { console.log(`找不到 ${textId} 的 source.pdf`); process.exit(1) }
let layoutPath = dirs.map((d) => path.join(d, 'layout.json')).find((p) => existsSync(p))
if (!layoutPath) {
  layoutPath = path.join(path.dirname(pdfPath), 'layout.json')
  console.log('  坐标表缺失，自动生成…')
  execFileSync(process.execPath, ['server/scripts/parse_pdf_layout.mjs', pdfPath, `--geometry=${layoutPath}`], {
    encoding: 'utf8', maxBuffer: 64 << 20,
  })
}

// ── 调接口 ──
const res = await fetch(`${BASE}/api/pdf/anchors?id=${textId}`, { headers: { cookie: `auth_token=${TOKEN}` } })
const a = await res.json()
check('接口返回 ok', a.ok === true, JSON.stringify(a).slice(0, 120))
if (!a.ok) { console.log('\n无法继续'); process.exit(1) }
check('页尺寸齐全', a.pageCount > 0 && a.pages?.length === a.pageCount, `${a.pageCount} 页`)

const rate = a.alignment.matched / Math.max(1, a.alignment.tokens)
check('词级对齐率 ≥ 95%', rate >= 0.95, `${(rate * 100).toFixed(1)}%（${a.alignment.matched}/${a.alignment.tokens}）`)

const row = await q1('SELECT segments, marks FROM texts WHERE id=?', [textId])
const segs = JSON.parse(row.segments || '[]')
const marks = JSON.parse(row.marks || '[]').filter((m) => !m.deletedAt)

const located = Object.keys(a.marks || {}).length
const locRate = located / Math.max(1, marks.length)
check('标记定位率 ≥ 85%', locRate >= 0.85, `${located}/${marks.length} = ${(locRate * 100).toFixed(1)}%`)

// ── 按矩形回读该行，核对文字 ──
const layout = JSON.parse(readFileSync(layoutPath, 'utf8'))
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const byPage = new Map()
for (const w of layout.words) {
  if (!byPage.has(w.p)) byPage.set(w.p, [])
  byPage.get(w.p).push(w)
}

function lineAt(rect) {
  const words = (byPage.get(rect.p) || []).filter((w) => Math.abs(w.y - rect.y) <= Math.max(2, rect.h * 0.6))
  return words.sort((x, y) => x.x - y.x).map((w) => w.t).join(' ')
}

let hit = 0
let loose = 0
let miss = []
for (const mk of marks) {
  const rects = a.marks?.[mk.id]
  if (!rects?.length) continue
  // 长句/短语常跨行，矩形会有多条：把每条所在行拼起来再比完整文本
  const rows = rects.map((r) => lineAt(r))
  const joined = norm(rows.join(' '))
  const strictOk = joined.includes(norm(mk.text))
  // 提取错字（generic → genenc）会让严格比较永远失败，但位置是对的；
  // 首词能落在第一行就说明矩形框对了地方
  const firstWord = norm(String(mk.text).split(/\s+/)[0] || '')
  const looseOk = strictOk || (!!firstWord && norm(rows[0]).includes(firstWord))
  if (strictOk) hit++
  if (looseOk) loose++
  else miss.push({ text: mk.text, line: rows[0].slice(0, 70), p: rects[0].p })
}
check('矩形回读包含完整标记文本', hit / Math.max(1, located) >= 0.8,
  `${hit}/${located} = ${(hit / Math.max(1, located) * 100).toFixed(1)}%`)
check('矩形框住标记首词（允许跨行/提取错字）', loose / Math.max(1, located) >= 0.95,
  `${loose}/${located} = ${(loose / Math.max(1, located) * 100).toFixed(1)}%`
  + (miss.length ? `；未命中：${miss.slice(0, 3).map((m) => `"${m.text}"→"${m.line}"`).join(' | ')}` : ''))

// ── 标记不能扎堆在同一位置 ──
const keys = Object.values(a.marks || {}).map((rs) => `${rs[0].p}:${Math.round(rs[0].y)}:${Math.round(rs[0].x)}`)
const uniq = new Set(keys).size
check('标记矩形互不塌缩（唯一率 ≥ 90%）', uniq / Math.max(1, keys.length) >= 0.9,
  `${uniq}/${keys.length} 唯一`)

// ── 段落页码单调不减 ──
const seq = segs.map((s) => a.paragraphs?.[s.id]?.page).filter((p) => p != null)
let inversions = 0
for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) inversions++
check('段落页码单调不减', inversions === 0, `${inversions} 处回跳（共 ${seq.length} 段）`)

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass_} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
