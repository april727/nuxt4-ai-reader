/**
 * PDF → Markdown（带版面重建）+ 词级坐标表
 *
 * 为什么不在 parse_pdf_js.mjs 上改：那个是「保证 PDF 上传永远可用」的兜底路径，
 * 一行 join('') 就能把词拼成一坨。这里另起一份，由 parse-pdf 先试新路径、
 * 失败自动回退旧路径 —— 新代码有 bug 也不会让导入挂掉。
 *
 * 旧路径的三个硬伤，这里逐条对应：
 *   1. `lines.get(y).join('')` 不补词间空格 → "of creation" 变成 "ofcreation"。
 *      这里剔掉纯空白条目，按相邻词的 x 间距判断该不该插空格。
 *   2. 只按 y 分行、不管 x → 双栏页把左右两栏拼成一行。
 *      这里先按 x 切栏（页面中缝处有持续空白即视为分栏），再在每栏内排行。
 *   3. 每行独立成行 → 段落边界全靠下游 AI 猜，取句和朗读粒度都跟着错。
 *      这里按「行距突增 / 首行缩进 / 上一行没写满」判断段落边界，段间用空行。
 *
 * 额外输出词级矩形，供「在 PDF 原页上高亮标记」用（段落文本 → 页码 + 矩形）。
 * 坐标是 PDF 用户空间（原点左下），渲染时 top = 页高 - y - h。
 *
 * 用法：node parse_pdf_layout.mjs <pdf路径> [--geometry=<输出json路径>]
 * 输出：单行 JSON { markdown, pageCount, lines }
 * 失败：输出 PDF_PARSE_ERROR xxx 并以非 0 退出（由调用方回退旧脚本）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.log('PDF_PARSE_ERROR 缺少文件路径')
  process.exit(1)
}
const geomArg = process.argv.find((a) => a.startsWith('--geometry='))
const geomPath = geomArg ? geomArg.slice('--geometry='.length) : ''

/** 词间距判定用的系数：字距 < 0.18 字号算同词，词间空格约 0.25~0.35 字号 */
const SPACE_RATIO = 0.18

try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    // 与 parse_pdf_js.mjs 保持完全一致：前端渲染时要用同一套条目切分，
    // 参数一不同，词与坐标就对不上，原页高亮会整体错位
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise

  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    pages.push({
      page: p,
      width: vp.width,
      height: vp.height,
      items: tc.items.filter((it) => it.str && it.str.trim()),
    })
  }

  /** 按 y 把条目聚成行；容差取字高一半，避免同一行因亚像素差被拆开 */
  function groupLines(items, pageNo) {
    const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5])
    const lines = []
    for (const it of sorted) {
      const y = it.transform[5]
      const h = it.height || 10
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - y) <= Math.max(1.5, Math.min(last.h, h) * 0.5)) {
        last.items.push(it)
        last.h = Math.max(last.h, h)
        last.y = (last.y * (last.items.length - 1) + y) / last.items.length
      } else {
        lines.push({ y, h, page: pageNo, items: [it] })
      }
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.transform[4] - b.transform[4])
      const first = ln.items[0]
      const lastIt = ln.items[ln.items.length - 1]
      ln.x0 = first.transform[4]
      ln.x1 = lastIt.transform[4] + lastIt.width
      ln.text = lineText(ln)
    }
    return lines.filter((ln) => ln.text)
  }

  /** 行内重建：保留条目里的空格，但更要靠 x 间距补 —— 很多 PDF 根本不发空格条目 */
  function lineText(line) {
    let out = ''
    let prevEnd = null
    let prevH = line.h
    for (const it of line.items) {
      const x = it.transform[4]
      if (prevEnd !== null) {
        const gap = x - prevEnd
        const fs = Math.max(it.height || line.h, prevH)
        // 间隙明显大于字距才插空格；负数说明上下标重叠，也不插
        if (gap > fs * SPACE_RATIO * 0.5 && gap < fs * 5) out += ' '
        else if (gap >= fs * 5) out += ' '
      }
      out += it.str
      prevEnd = x + it.width
      prevH = it.height || prevH
    }
    return out.replace(/[ \t]+/g, ' ').trim()
  }

  /** 双栏切分：页面纵向中缝在一段范围内没有词，就认为左右分栏 */
  function splitColumns(items, pageWidth) {
    const mid = pageWidth / 2
    const band = pageWidth * 0.06
    const inBand = items.filter((it) => {
      const x = it.transform[4]
      const w = it.width
      return x + w > mid - band && x < mid + band
    })
    // 中缝带里几乎没有条目 → 双栏
    if (inBand.length > items.length * 0.04) return null
    const left = items.filter((it) => it.transform[4] < mid)
    const right = items.filter((it) => it.transform[4] >= mid)
    if (!left.length || !right.length) return null
    return [left, right]
  }

  const allLines = []
  for (const pg of pages) {
    const cols = splitColumns(pg.items, pg.width) || [pg.items]
    for (const col of cols) allLines.push(...groupLines(col, pg.page))
  }

  // ── 页眉页脚 ──
  // 只在页面上下边缘区、且明显窄（页码、书名页眉）的行才丢。不能一律丢边缘行：
  // 有些书的正文会顶到页边，按区域粗暴裁剪会把正文吃掉。
  // 也不靠「跨页文本重复」判 —— 左右页眉文本往往不同（奇数页书名、偶数页章名），
  // 各自只出现一两次，重复计数抓不到。
  const bodyLines = allLines.filter((ln) => {
    const h = pages[ln.page - 1]?.height || 754
    const w = pages[ln.page - 1]?.width || 463
    const atTop = ln.y > h * 0.9
    const atBottom = ln.y < h * 0.08
    if (!atTop && !atBottom) return true
    const narrow = ln.x1 - ln.x0 < w * 0.45
    const numeric = /^[\d\s·—–-]+$/.test(ln.text)
    return !(narrow || numeric)
  })

  // ── 正文行距基线：取相邻行间距的中位数 ──
  const gaps = []
  for (let i = 1; i < bodyLines.length; i++) {
    const a = bodyLines[i - 1]
    const b = bodyLines[i]
    if (a.page !== b.page) continue
    if (Math.abs(a.h - b.h) > a.h * 0.3) continue
    const g = a.y - b.y
    if (g > 0 && g < a.h * 3) gaps.push(g)
  }
  gaps.sort((x, y) => x - y)
  const bodyGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14

  // 正文字号：按字符数加权取众数（粗体/标题会明显更大）
  const sizeHist = new Map()
  for (const ln of bodyLines) {
    const n = ln.text.length
    const key = Math.round(ln.h * 2) / 2
    sizeHist.set(key, (sizeHist.get(key) || 0) + n)
  }
  const bodySize = [...sizeHist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10

  /**
   * 版面基准按**页**算，而且是中位数不是极值。
   * 用全篇 max(x1) 当栏宽时，只要有一行超宽（表格、图注、拉长的标题），
   * 阈值就被抬高，正常行全被判成「没写满」→ 每行都断段。
   */
  const median = (arr) => {
    if (!arr.length) return 0
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const pageStat = new Map()
  for (const ln of bodyLines) {
    if (!pageStat.has(ln.page)) pageStat.set(ln.page, [])
    pageStat.get(ln.page).push(ln)
  }
  const stats = new Map()
  for (const [p, lines] of pageStat) {
    const mainLines = lines.filter((l) => Math.abs(l.h - bodySize) <= bodySize * 0.25)
    const use = mainLines.length ? mainLines : lines
    stats.set(p, {
      x0: median(use.map((l) => l.x0)),
      width: median(use.map((l) => l.x1 - l.x0)),
    })
  }
  const statOf = (ln) => stats.get(ln.page) || { x0: 0, width: 400 }

  // ── 段落重建 ──
  const blocks = []
  let cur = null
  for (let i = 0; i < bodyLines.length; i++) {
    const ln = bodyLines[i]
    const prev = bodyLines[i - 1]
    let isNew = !cur

    if (prev && !isNew) {
      const st = statOf(ln)
      // 上一行有没有把句子写完。英文书里段内换行几乎不会落在句末标点上，
      // 段末一定落在句末 —— 用它给下面三个信号加门，能救回对白、
      // 引文这类「每行都缩进」的排版，也能让跨页的同一段接起来。
      const prevEndsSentence = /[.!?:;"”’)\]]$/.test(prev.text.trim())
      const pageChanged = prev.page !== ln.page
      const lineGap = prev.y - ln.y
      // 首行缩进要跟上一行比，不能跟页面左边距比：整块缩进的引文每一行都靠右
      const indented = prevEndsSentence && ln.x0 - prev.x0 > bodySize * 0.6
      // 上一行明显没写满 → 段末（正常行宽 376，段末 233，差得很开）
      const prevShort = prevEndsSentence && prev.x1 - prev.x0 < st.width * 0.78
      // 字号跳变（标题、图注）
      const sizeJump = (ln.h > bodySize * 1.15) !== (prev.h > bodySize * 1.15)
      if (lineGap > bodyGap * 1.35 || indented || prevShort || sizeJump
        || (pageChanged && prevEndsSentence)) isNew = true
    }

    if (isNew) {
      cur = { page: ln.page, lines: [], size: ln.h }
      blocks.push(cur)
    }
    cur.lines.push(ln)
    cur.size = Math.max(cur.size, ln.h)
  }

  /**
   * 段内连接：行尾断词要接回去。
   * `-` 是普通连字符；`¬` 是 PDF 里常见的软连字符（排版软件用它标「这里可断」），
   * 不处理就会留下 "rest¬ lessness" 这种查不到的词。
   */
  function joinBlock(block) {
    let out = ''
    for (const ln of block.lines) {
      const t = ln.text
      if (!out) { out = t; continue }
      const hyphenBreak = /[A-Za-z][-¬]$/.test(out) && /^[a-z]/.test(t)
      if (hyphenBreak) out = out.slice(0, -1) + t
      else out += ' ' + t
    }
    return out.replace(/\s+/g, ' ').replace(/[¬]/g, '').trim()
  }

  // ── 章节识别 ──
  // 重排版式的书里，标题就是「字号明显大于正文、且独占一两行的短行」。
  // 层级按字号排序给：最大的那一档算一级，次一档二级。
  // 不做关键词匹配（Chapter/Part）—— 那样会漏掉只有编号的章标题，
  // 而字号是书里最稳定的结构信号。
  const headingBlocks = blocks
    .map((b) => ({ block: b, text: joinBlock(b), size: b.size }))
    .filter((h) => h.text && h.text.length < 90 && h.size > bodySize * 1.18
      && !/^\[PAGE:\d+\]/.test(h.text)
      // 章号「6」这类纯数字短行字号最大，当目录项没意义
      && /[a-zA-Z\u4e00-\u9fa5]/.test(h.text.replace(/\[PAGE:\d+\]/g, '')))
  const sizes = [...new Set(headingBlocks.map((h) => h.size))].sort((a, b) => b - a)
  const chapters = headingBlocks.map((h, i) => ({
    index: i,
    title: h.text.replace(/\[PAGE:\d+\]/g, '').trim(),
    level: Math.min(2, sizes.indexOf(h.size)),
    page: h.block.page,
  }))

  // ── Markdown ──
  // 不往正文里写 [PAGE:n]。旧路径会写，但阅读页的 renderMarkedText 是
  // marked.parse(p.text)，不做任何 PAGE 清理 —— 标记会原样显示成 "[PAGE:1]the proper..."。
  // 页码改由 chapters[].page 给出（目录跳转够用），精确到段落的位置留给
  // 下一轮的坐标表（比一个 PAGE 标记准得多，也不会污染正文）。
  const pageCount = pages.length
  const out = []
  for (const block of blocks) {
    const text = joinBlock(block)
    if (!text) continue
    // 章号「6」这种纯数字短块在排版上是独立大字，但单独一段没有阅读价值
    if (text.length < 3 && !/[a-zA-Z\u4e00-\u9fa5]/.test(text)) continue
    const isShort = text.length < 90
    if (isShort && block.size > bodySize * 1.45) {
      out.push(`## ${text}`)
    } else if (isShort && block.size > bodySize * 1.18) {
      out.push(`### ${text}`)
    } else {
      out.push(text)
    }
  }
  const markdown = out.join('\n\n').trim()

  if (!markdown) {
    console.log('PDF_PARSE_ERROR 版面重建后没有文本')
    process.exit(1)
  }

  // ── 坐标表（可选，给原页高亮用）──
  if (geomPath) {
    const words = []
    for (const pg of pages) {
      for (const it of pg.items) {
        const w = it.str.trim()
        if (!w) continue
        words.push({
          p: pg.page,
          t: w,
          x: +it.transform[4].toFixed(2),
          y: +it.transform[5].toFixed(2),
          w: +it.width.toFixed(2),
          h: +(it.height || 10).toFixed(2),
        })
      }
    }
    writeFileSync(geomPath, JSON.stringify({
      pageCount,
      pages: pages.map((p) => ({ page: p.page, width: +p.width.toFixed(2), height: +p.height.toFixed(2) })),
      words,
    }), 'utf8')
  }

  console.log(JSON.stringify({
    markdown,
    chapters,
    pageCount,
    blocks: blocks.length,
    lines: bodyLines.length,
    bodySize,
    bodyGap: +bodyGap.toFixed(2),
  }))
} catch (err) {
  console.log('PDF_PARSE_ERROR ' + (err && err.message ? err.message : String(err)))
  process.exit(1)
}
