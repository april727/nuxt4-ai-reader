/**
 * PDF 原页锚点：把「段落 + 字符区间」换成「第几页 + 矩形」。
 *
 * 两套坐标并存，各有分工：
 *   - 语义锚 { paragraphId, startOffset, endOffset } —— 查词/发音/取句/复习都只认它
 *   - 几何锚 { page, rects[] }                       —— 只负责在原页上把位置画出来
 *
 * 为什么要「对齐」而不是提取时直接记下偏移：段落边界是**后来**才定的
 * （AI 分段、手工合并/拆分都会改），提取那一刻根本不知道哪句话属于哪一段。
 * 所以只能靠文本本身把两侧接起来 —— 词级 LCS，不是字符串搜索
 * （搜索遇到重复词会全部落到第一次出现的位置）。
 *
 * 对齐用**流式窗口**而不是整篇 LCS：整篇 2000×2000 是 800MB 级的矩阵，
 * 一部长篇就爆内存。段落是有序的，每段只需在「上一段结束位置」附近找，
 * 窗口失控时才退化成大范围重试。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findContentDirs } from './storage'

export interface PdfWord {
  p: number
  t: string
  x: number
  y: number
  w: number
  h: number
}

export interface PdfLayout {
  pageCount: number
  pages: { page: number; width: number; height: number }[]
  words: PdfWord[]
}

/** 一个高亮矩形（PDF 用户空间，原点左下；渲染时 top = 页高 - y - h） */
export interface PdfRect {
  p: number
  x: number
  y: number
  w: number
  h: number
}

export interface PdfAnchors {
  pageCount: number
  pages: { page: number; width: number; height: number }[]
  /** 段落 → 起始页 + 首个矩形（跳原页、闪烁定位用，不给全部行） */
  paragraphs: Record<string, { page: number; rect: PdfRect | null; coverage: number }>
  /** 标记 id → 精确矩形（可能跨行、跨页，所以是数组） */
  marks: Record<string, PdfRect[]>
  /** 整体对齐率，排查用 */
  alignment: { tokens: number; matched: number }
}

// ── layout.json 读取（按路径缓存，按 mtime 失效）──
const layoutCache = new Map<string, { mtime: number; data: PdfLayout }>()
const LAYOUT_CACHE_MAX = 6

/** 跨 folder 找 layout.json —— 文章拖到别的文件夹时只改了 texts.folder */
export function findLayoutPath(contentId: string): string | null {
  for (const dir of findContentDirs(contentId)) {
    const p = join(dir, 'layout.json')
    if (existsSync(p)) return p
  }
  return null
}

export function readLayout(contentId: string): PdfLayout | null {
  const p = findLayoutPath(contentId)
  if (!p) return null
  try {
    const mtime = statSync(p).mtimeMs
    const hit = layoutCache.get(p)
    if (hit && hit.mtime === mtime) return hit.data
    const data = JSON.parse(readFileSync(p, 'utf8')) as PdfLayout
    if (!Array.isArray(data?.words) || !data.words.length) return null
    if (layoutCache.size >= LAYOUT_CACHE_MAX) layoutCache.clear()
    layoutCache.set(p, { mtime, data })
    return data
  } catch {
    return null
  }
}

// ── 分词 ──
// 两侧用**同一个**正则，否则永远对不上：
//   - 只取字母数字，句号逗号引号全当分隔符 —— 段落里 "lingo.And" 这种
//     缺空格的粘连能自然切成 lingo / And，而 PDF 那边本来就是两个词
//   - 撇号归一化掉："don't" → "dont"，PDF 里常常是 U+2019
const WORD_RE = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g

function norm(w: string): string {
  return w.toLowerCase().replace(/['’]/g, '')
}

interface Tok {
  /** 归一化后的词形，比较用 */
  k: string
  /** 在所属段落里的字符区间 */
  s: number
  e: number
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(text))) {
    const k = norm(m[0])
    if (k) out.push({ k, s: m.index, e: m.index + m[0].length })
  }
  return out
}

interface PTok {
  k: string
  rect: PdfRect
}

/**
 * PDF 侧展开成词。
 * pdfjs 的条目粒度很随意：多数是一词一条，也有整行一条的，还有带前导空格的。
 * 一条里含多个词时按字符长度比例切矩形 —— 对高亮来说误差几个像素无所谓。
 */
function expandPdfWords(words: PdfWord[]): PTok[] {
  const out: PTok[] = []
  for (const w of words) {
    WORD_RE.lastIndex = 0
    const hits: RegExpExecArray[] = []
    let m: RegExpExecArray | null
    while ((m = WORD_RE.exec(w.t))) hits.push(m)
    if (!hits.length) continue
    if (hits.length === 1 && hits[0].index === 0 && hits[0][0].length === w.t.trim().length) {
      out.push({ k: norm(hits[0][0]), rect: { p: w.p, x: w.x, y: w.y, w: w.w, h: w.h } })
      continue
    }
    const len = w.t.length || 1
    for (const h of hits) {
      const k = norm(h[0])
      if (!k) continue
      const x = w.x + (h.index / len) * w.w
      out.push({ k, rect: { p: w.p, x: +x.toFixed(2), y: w.y, w: +((h[0].length / len) * w.w).toFixed(2), h: w.h } })
    }
  }
  return out
}

// ── LCS ──
type Pair = [number, number]

/** 返回 [aIdx, bIdx] 的递增配对表 */
function lcsPairs(A: string[], a0: number, a1: number, B: string[], b0: number, b1: number): Pair[] {
  const n = a1 - a0
  const m = b1 - b0
  if (n <= 0 || m <= 0) return []
  // 值域 ≤ min(n,m)，Uint16 足够；矩阵按 (n+1)*(m+1) 展平，比二维数组省一个数量级
  const dp = new Uint16Array((n + 1) * (m + 1))
  const stride = m + 1
  for (let i = n - 1; i >= 0; i--) {
    const ai = A[a0 + i]
    const row = i * stride
    const next = row + stride
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] = ai === B[b0 + j]
        ? dp[next + j + 1] + 1
        : Math.max(dp[next + j], dp[row + j + 1])
    }
  }
  const out: Pair[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[a0 + i] === B[b0 + j]) {
      out.push([a0 + i, b0 + j])
      i++
      j++
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) i++
    else j++
  }
  return out
}

// ── 矩形合并 ──
function mergeRects(rects: PdfRect[]): PdfRect[] {
  if (!rects.length) return []
  const sorted = [...rects].sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x)
  const out: PdfRect[] = []
  let cur: PdfRect | null = null
  for (const r of sorted) {
    if (
      cur
      && r.p === cur.p
      && Math.abs(r.y - cur.y) <= Math.max(2, cur.h * 0.45)
      && r.x - (cur.x + cur.w) <= Math.max(20, cur.h * 2.2)
      && r.x >= cur.x - 1
    ) {
      const right = Math.max(cur.x + cur.w, r.x + r.w)
      cur.w = +(right - cur.x).toFixed(2)
      cur.h = Math.max(cur.h, r.h)
    } else {
      if (cur) out.push(cur)
      cur = { ...r }
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 主入口：把 segments + marks 对到 PDF 坐标上。
 *
 * segments 必须是**阅读顺序**（和 segmentsStore 里的一致），marks 的
 * paragraphId/offset 就是相对这些段落文本的偏移。
 */
export function buildAnchors(
  contentId: string,
  segments: { id: string; text: string }[],
  marks: { id: string; paragraphId: string; startOffset: number; endOffset: number; deletedAt?: string }[],
): PdfAnchors | null {
  const layout = readLayout(contentId)
  if (!layout) return null

  const P = expandPdfWords(layout.words)
  const B = P.map((w) => w.k)

  // 段落侧：拼成一条 token 流，记住每个 token 属于哪一段、段内偏移
  const A: string[] = []
  const owner: { seg: number; s: number; e: number }[] = []
  const segRanges: { a0: number; a1: number }[] = []
  segments.forEach((seg, si) => {
    const a0 = A.length
    for (const t of tokenize(seg.text || '')) {
      A.push(t.k)
      owner.push({ seg: si, s: t.s, e: t.e })
    }
    segRanges.push({ a0, a1: A.length })
  })

  const segMatch = new Map<number, Pair[]>()
  let cursor = 0
  let matched = 0

  for (let si = 0; si < segments.length; si++) {
    const { a0, a1 } = segRanges[si]
    const n = a1 - a0
    if (!n) continue

    // 窗口：从上一段结束位置往前一点起步，长度按本段词数的 2 倍 + 余量。
    // 前后留重（cursor-12）是为了容忍上一段末尾的几个词没对上。
    const lo = Math.max(0, cursor - 12)
    const hi = Math.min(B.length, cursor + n * 2 + 60)
    let pairs = lcsPairs(A, a0, a1, B, lo, hi)

    // 命中率太低：窗口偏了（跨页、图注把顺序顶乱、上一段整体没对上）。
    // 退化成大范围重试，但也不能整篇 —— 长篇会分配上百 MB 的 DP 矩阵。
    if (pairs.length < n * 0.35) {
      const w0 = Math.max(0, cursor - 1500)
      const w1 = Math.min(B.length, cursor + 3000)
      const retry = lcsPairs(A, a0, a1, B, w0, w1)
      if (retry.length > pairs.length) pairs = retry
    }

    if (pairs.length) {
      segMatch.set(si, pairs)
      matched += pairs.length
      cursor = pairs[pairs.length - 1][1] + 1
    }
  }

  const paragraphs: PdfAnchors['paragraphs'] = {}
  segments.forEach((seg, si) => {
    const pairs = segMatch.get(si)
    const total = segRanges[si].a1 - segRanges[si].a0
    if (!pairs || !total) return
    const rects = pairs.map(([, b]) => P[b].rect)
    const merged = mergeRects(rects)
    paragraphs[seg.id] = {
      page: merged[0]?.p || rects[0].p,
      rect: merged[0] || null,
      coverage: +(pairs.length / total).toFixed(3),
    }
  })

  const markRects: Record<string, PdfRect[]> = {}
  for (const mk of marks) {
    if (mk.deletedAt) continue
    const si = segments.findIndex((s) => s.id === mk.paragraphId)
    if (si < 0) continue
    const pairs = segMatch.get(si)
    if (!pairs) continue
    const own = pairs.filter(([a]) => owner[a].s >= mk.startOffset && owner[a].s < mk.endOffset)
    if (!own.length) continue
    markRects[mk.id] = mergeRects(own.map(([, b]) => P[b].rect))
  }

  return {
    pageCount: layout.pageCount,
    pages: layout.pages,
    paragraphs,
    marks: markRects,
    alignment: { tokens: A.length, matched },
  }
}
