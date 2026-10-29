/**
 * PDF 坐标映射可行性诊断（只读：不写库、不改文件、不碰接口）
 *
 * 回答一个问题：现有「段落 + 字符偏移」的标记，能不能精确落到 PDF 原页的哪个位置。
 * 这是「在 PDF 原页上标注」方案的前置验证 —— 如果做不到，那个方案就不成立。
 *
 * 做法：
 *   1. pdfjs 抽出每页的「词 + 精确矩形」。pdfjs 的文本条目本身是逐词切的
 *      （连空格都是独立条目，带宽度），所以不需要按字符估算宽度。
 *   2. 段落文本切词，与 PDF 词做词级 LCS 对齐 —— 段落文本可能被清洗过
 *      （修断词、去页眉），不能用子串查找，必须做序列对齐。
 *   3. 每条标记的 (paragraphId, startOffset, endOffset) 找到覆盖的词，
 *      顺着对齐表查到 PDF 矩形，得到 { page, rects[] }。
 *
 * 实测（txt_1778817835379 / 170-175.pdf，50 条标记）：
 *   词级对齐 99.1%（1843/1860），47 条完全定位、1 条部分、2 条失败。
 *   失败的 2 条不是坐标的问题，而是**文本对不上**：PDF 原文是 excusively /
 *   superimposed，段落被清洗成了 exclusively / superimpose。这恰好说明
 *   「坐标是物理真相、文本是逻辑真相」—— 文本被改写后仍然定得住位置，
 *   纯文本匹配就废了。
 *
 * 用法：
 *   node server/scripts/probe-pdf-geom.mjs            # 自动挑 PDF 文章
 *   node server/scripts/probe-pdf-geom.mjs <textId>   # 指定文章
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { q, q1 } from './_testdb.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FILES = path.join(ROOT, 'server/data/files')
const UPLOADS = path.join(ROOT, 'server/data/uploads')

/** 该文章的原始 PDF 在哪。归档后是 files/<folder>/<id>/source.pdf，导入时的临时文件在 uploads/ */
function findPdf(row) {
  const direct = path.join(FILES, row.folder || 'default', row.id, 'source.pdf')
  const candidates = [direct]
  try {
    for (const folder of readdirSync(FILES)) {
      candidates.push(path.join(FILES, folder, row.id, 'source.pdf'))
    }
  } catch { /* files 目录可能不存在 */ }
  if (row.filePath) {
    candidates.push(path.join(FILES, row.folder || 'default', row.id, row.filePath))
    candidates.push(path.join(UPLOADS, row.filePath))
  }
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) || null
}

/** PDF 侧：按阅读顺序（页 → 行 y 降序 → 行内 x 升序）导出词与矩形 */
async function pdfWords(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
  }).promise

  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const rows = new Map()
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue
      const y = Math.round(it.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push(it)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      // 排序必须先落到变量：在 for-of 的绑定里引用同名变量会命中 TDZ
      const lineItems = rows.get(y).sort((p, q2) => p.transform[4] - q2.transform[4])
      for (const it of lineItems) {
        out.push({
          w: it.str, page: p,
          x: +it.transform[4].toFixed(2), y: +it.transform[5].toFixed(2),
          ww: +it.width.toFixed(2), hh: +it.height.toFixed(2),
          vh: vp.height, vw: vp.width,
        })
      }
    }
  }
  return { words: out, pages: doc.numPages }
}

/** 段落侧：逐词 + 它在段落文本里的字符区间（标记的 offset 就是按这个比的） */
function paraTokens(segments) {
  const tokens = []
  for (const s of segments) {
    const re = /\S+/g
    let m
    while ((m = re.exec(s.text))) {
      tokens.push({
        seg: s.id,
        start: m.index,
        end: m.index + m[0].length,
        norm: m[0].toLowerCase().replace(/[^a-z0-9']/g, ''),
      })
    }
  }
  return tokens
}

/** 词级 LCS。段落的词 → PDF 的词，得到对齐表（Map<token, pdfWord>） */
function alignTokens(tokens, words) {
  const a = tokens.filter((t) => t.norm)
  const A = a.map((t) => t.norm)
  const B = words.map((p) => p.w.toLowerCase().replace(/[^a-z0-9']/g, ''))
  const n = A.length
  const m = B.length
  const dp = new Uint16Array((n + 1) * (m + 1))
  const at = (i, j) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = A[i] === B[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const map = new Map()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { map.set(a[i], words[j]); i++; j++ }
    else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++
    else j++
  }
  return { map, matched: map.size, total: n }
}

/** 一组矩形，同一行的合并成一条，减少前端要画的 DOM 数 */
function mergeRects(hits) {
  const rows = new Map()
  for (const h of hits) {
    const key = `${h.page}:${h.y}`
    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push(h)
  }
  const round = (v) => +v.toFixed(2)
  const out = []
  for (const arr of rows.values()) {
    arr.sort((p, q2) => p.x - q2.x)
    const first = arr[0]
    let box = { page: first.page, x: first.x, y: first.y, w: first.ww, h: first.hh, vh: first.vh }
    for (const it of arr.slice(1)) {
      const gap = it.x - (box.x + box.w)
      // 同一行内相邻词之间只有字距；洞比字高还大说明中间空了（换了成分），断开成两个矩形
      if (gap <= it.hh * 1.6) {
        box.w = round(it.x + it.ww - box.x)
        box.h = round(Math.max(box.h, it.hh))
      } else {
        out.push(box)
        box = { page: it.page, x: it.x, y: it.y, w: it.ww, h: it.hh, vh: it.vh }
      }
    }
    out.push(box)
  }
  return out
}

async function main() {
  const argId = process.argv[2]
  const COLS = 'id,title,source,folder,filePath,segments,marks'
  const row = argId
    ? await q1(`SELECT ${COLS} FROM texts WHERE id=?`, [argId])
    : (await q(`SELECT ${COLS} FROM texts
        WHERE deletedAt IS NULL AND filePath IS NOT NULL AND lower(filePath) LIKE '%.pdf'
        ORDER BY length(marks) DESC LIMIT 40`)).find((r) => findPdf(r))

  if (!row) {
    console.error('没找到可诊断的 PDF 文章（库里没有 filePath 以 .pdf 结尾、且原文件还在的记录）')
    process.exit(1)
  }

  const pdfPath = findPdf(row)
  if (!pdfPath) {
    console.error(`${row.id} 的原始 PDF 不在磁盘上（filePath=${row.filePath}），无法诊断`)
    process.exit(1)
  }

  console.log(`文章：${row.title}  [${row.id}]`)
  console.log(`原文件：${path.relative(ROOT, pdfPath)}`)

  const segments = JSON.parse(row.segments || '[]')
  const marks = JSON.parse(row.marks || '[]')
  if (!segments.length) {
    console.error('这篇没有段落数据（segments 为空），标记无从定位')
    process.exit(1)
  }

  const { words, pages } = await pdfWords(pdfPath)
  const tokens = paraTokens(segments)
  const { map, matched, total } = alignTokens(tokens, words)

  console.log(`\n── 文本对齐 ──`)
  console.log(`PDF：${pages} 页 / ${words.length} 个词`)
  console.log(`段落：${segments.length} 段 / ${total} 个词`)
  console.log(`对齐命中 ${matched}（${((matched / total) * 100).toFixed(1)}%）`)

  const bySeg = new Map()
  for (const t of tokens) {
    if (!bySeg.has(t.seg)) bySeg.set(t.seg, [])
    bySeg.get(t.seg).push(t)
  }

  console.log(`\n── 标记定位（${marks.length} 条）──`)
  let full = 0
  let partial = 0
  const failed = []
  const located = []
  for (const mk of marks) {
    const cover = (bySeg.get(mk.paragraphId) || [])
      .filter((t) => t.start >= mk.startOffset && t.start < mk.endOffset)
    const hits = cover.map((t) => map.get(t)).filter(Boolean)
    if (!hits.length) {
      failed.push(mk)
      continue
    }
    if (hits.length < cover.length) partial++
    else full++
    const rects = mergeRects(hits)
    located.push({ mk, rects })
  }
  console.log(`完全定位 ${full} / 部分定位 ${partial} / 失败 ${failed.length}`)

  if (located.length) {
    const byPage = new Map()
    for (const { rects } of located) {
      for (const r of rects) byPage.set(r.page, (byPage.get(r.page) || 0) + 1)
    }
    console.log(`落在页面：${[...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([p, n]) => `第${p}页×${n}`).join(' · ')}`)

    console.log(`\n── 示例（前 6 条）──`)
    for (const { mk, rects } of located.slice(0, 6)) {
      const r = rects[0]
      // PDF 的 y 从页面底部往上，前端画高亮要的是从上往下的 top
      const top = +(r.vh - r.y - r.h).toFixed(2)
      console.log(
        `  "${mk.text.slice(0, 22)}" → 第${r.page}页 `
        + `x=${r.x} y=${r.y} w=${r.w} h=${r.h}`
        + `（屏坐标 top≈${top}）`
        + (rects.length > 1 ? ` +${rects.length - 1} 段` : ''),
      )
    }
  }

  if (failed.length) {
    console.log(`\n── 定位失败（${failed.length} 条）──`)
    for (const mk of failed) {
      const seg = segments.find((s) => s.id === mk.paragraphId)
      const ctx = seg ? seg.text.slice(Math.max(0, mk.startOffset - 25), mk.endOffset + 25) : '(段落已不存在)'
      console.log(`  "${mk.text.slice(0, 24)}"  ${mk.paragraphId}[${mk.startOffset}..${mk.endOffset}]`)
      console.log(`    上下文：${JSON.stringify(ctx)}`)
    }
    console.log('  说明：多为段落文本被清洗改写过（修断词/改词形），PDF 原文写法不同。')
    console.log('  这类正是「必须存坐标」的理由 —— 文本对不上，位置仍然是对的。')
  }
}

main().catch((err) => {
  console.error('诊断失败：', err?.message || err)
  process.exit(1)
})
