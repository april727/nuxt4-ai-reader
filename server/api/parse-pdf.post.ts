import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

// ---- 类型 ----
interface TextItem {
  str: string
  x: number; y: number; h: number; w: number
}
interface Line {
  y: number; text: string; items: TextItem[]
}

// ---- PDF 文字提取（坐标感知） ----
async function extractTextWithLayout(pdf: any): Promise<string> {
  const allPageLines: Line[][] = []
  const pageDims: Array<{ width: number; height: number }> = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    pageDims.push({ width: vp.width, height: vp.height })
    const content = await page.getTextContent()
    const lines = extractLines(content.items as any[], vp.height)
    allPageLines.push(lines)
  }

  const avgPageH = pageDims.reduce((s, d) => s + d.height, 0) / pageDims.length
  const topZone = avgPageH * 0.10
  const bottomZone = avgPageH * 0.10

  const headerCandidates: Map<string, number> = new Map()
  const footerCandidates: Map<string, number> = new Map()

  for (const lines of allPageLines) {
    for (const line of lines) {
      const clean = cleanForFingerprint(line.text)
      if (!clean) continue
      if (line.y < topZone) {
        headerCandidates.set(clean, (headerCandidates.get(clean) || 0) + 1)
      } else if (line.y > avgPageH - bottomZone) {
        footerCandidates.set(clean, (footerCandidates.get(clean) || 0) + 1)
      }
    }
  }

  const threshold = Math.max(3, allPageLines.length * 0.33)
  const confirmedHeaders = new Set<string>()
  const confirmedFooters = new Set<string>()
  for (const [fp, count] of headerCandidates) {
    if (count >= threshold) confirmedHeaders.add(fp)
  }
  for (const [fp, count] of footerCandidates) {
    if (count >= threshold) confirmedFooters.add(fp)
  }

  const pagesOut: string[] = []
  for (let i = 0; i < allPageLines.length; i++) {
    const lines = allPageLines[i]

    function isNoise(line: Line): boolean {
      const clean = cleanForFingerprint(line.text)
      if (!clean) return false
      if (/^[-\s]*\d+[-\s]*$/.test(clean)) return true
      if (/^[ivxIVX]+$/.test(clean) && clean.length <= 5) return true
      if (/^[─_\-=•·]+$/.test(clean)) return true
      if (line.y < topZone && confirmedHeaders.has(clean)) return true
      if (line.y > avgPageH - bottomZone && confirmedFooters.has(clean)) return true
      return false
    }

    const bodyLines = lines.filter((l) => !isNoise(l))
    if (bodyLines.length === 0) continue

    const avgH = bodyLines.reduce((s, l) => {
      const h = l.items[0]?.h || 10
      return s + h
    }, 0) / bodyLines.length

    const lineTexts: string[] = []
    let prevY = bodyLines[0].y

    for (const line of bodyLines) {
      const yGap = line.y - prevY
      if (yGap > avgH * 1.5 && lineTexts.length > 0 && lineTexts[lineTexts.length - 1] !== '') {
        lineTexts.push('')
      }
      if (line.text) {
        lineTexts.push(line.text)
        prevY = line.y
      }
    }

    pagesOut.push(lineTexts.join('\n'))
  }

  return connectPages(pagesOut)
}

function extractLines(items: any[], pageH: number): Line[] {
  const valid: TextItem[] = []
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    valid.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      h: it.height || 10,
      w: it.width || 0,
    })
  }
  if (valid.length === 0) return []

  valid.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: Line[] = []
  let curY = valid[0].y
  let curItems: TextItem[] = [valid[0]]

  for (let i = 1; i < valid.length; i++) {
    const it = valid[i]
    const gap = Math.abs(it.y - curY)
    if (gap < Math.max(it.h, 8) * 0.5) {
      curItems.push(it)
    } else {
      curItems.sort((a, b) => a.x - b.x)
      const text = joinLineItems(curItems)
      if (text) lines.push({ y: curY, text, items: curItems })
      curY = it.y
      curItems = [it]
    }
  }
  curItems.sort((a, b) => a.x - b.x)
  const lastText = joinLineItems(curItems)
  if (lastText) lines.push({ y: curY, text: lastText, items: curItems })

  lines.sort((a, b) => b.y - a.y)
  return lines
}

function joinLineItems(items: TextItem[]): string {
  let result = ''
  let lastX = -999
  for (const it of items) {
    const gap = it.x - lastX
    if (lastX >= 0 && gap > 2) { result += ' ' }
    result += it.str
    lastX = it.x + (it.w || it.str.length * it.h * 0.5)
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

function cleanForFingerprint(text: string): string {
  return text.replace(/[\d\s\-_,.·•]+/g, '').toLowerCase().trim()
}

function connectPages(pageTexts: string[]): string {
  if (pageTexts.length <= 1) return pageTexts[0] || ''

  const result: string[] = [pageTexts[0]]

  for (let i = 1; i < pageTexts.length; i++) {
    const prev = result[result.length - 1]
    const cur = pageTexts[i]
    const prevLines = prev.split('\n')
    const curLines = cur.split('\n')
    const lastLine = prevLines[prevLines.length - 1]?.trim() || ''
    const firstLine = curLines[0]?.trim() || ''

    const sentenceEnd = /[.!?。！？"」]$/
    if (lastLine && firstLine && !sentenceEnd.test(lastLine)) {
      prevLines[prevLines.length - 1] = lastLine + ' ' + firstLine
      curLines.shift()
      result[result.length - 1] = prevLines.join('\n')
      if (curLines.length > 0) result.push(curLines.join('\n'))
    } else {
      result.push(cur)
    }
  }

  return fixHyphenation(result.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim()
}

function fixHyphenation(text: string): string {
  return text.replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
}

// ====== pymupdf4llm PDF → Markdown 解析 ======
function parseWithPyMuPDF4LLM(pdfPath: string): string | null {
  try {
    const result = execSync(`python "${path.resolve('server/scripts/parse_pdf.py')}" "${pdfPath}"`, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = result.toString().trim()
    if (!stdout || stdout.startsWith('PDF_PARSE_ERROR')) {
      console.warn('[parse-pdf] pymupdf4llm 失败:', stdout)
      return null
    }
    return stdout
  } catch (err: any) {
    console.warn('[parse-pdf] pymupdf4llm 调用失败:', err.message)
    return null
  }
}

// ====== 路由处理 ======
// PDF 仅负责解析+暂存临时文件；数据库写入由 text/save 统一处理

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)
  const fileEntry = formData?.find((f) => f.name === 'file')

  if (!fileEntry || !fileEntry.data) {
    throw createError({ statusCode: 400, message: '未收到文件' })
  }

  const uploadsDir = path.resolve('server/data/uploads')
  if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true })

  const safeName = (fileEntry.filename || 'upload.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')
  const pdfPath = path.join(uploadsDir, `${Date.now()}_${safeName}`)
  await writeFile(pdfPath, fileEntry.data)

  // 主路径：pymupdf4LLM 版面感知 Markdown 提取
  const mdOutput = parseWithPyMuPDF4LLM(pdfPath)

  if (mdOutput) {
    return { text: mdOutput, filePath: path.basename(pdfPath), parser: 'pymupdf4llm' }
  }

  // 兜底：pdfjs-dist 坐标感知提取
  console.log('[parse-pdf] 回退到 pdfjs-dist 文本提取')
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(
      fileEntry.data.buffer,
      fileEntry.data.byteOffset,
      fileEntry.data.byteLength
    )
    const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true, useSystemFonts: true })
    const pdf = await loadingTask.promise

    const fullText = await extractTextWithLayout(pdf)

    if (!fullText) {
      throw createError({ statusCode: 422, message: 'PDF 中未提取到文本内容' })
    }

    return { text: fullText, filePath: path.basename(pdfPath), parser: 'pdfjs' }
  } catch (err: any) {
    console.error('PDF 服务端解析失败:', err)
    throw createError({ statusCode: 500, message: err.message || 'PDF 解析失败' })
  }
})
