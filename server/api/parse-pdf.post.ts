import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import path from 'node:path'

export interface PdfChapter {
  index: number
  title: string
  level: number   // 0=Part/Book, 1=Chapter, 2=Section
  page: number    // 1-based 页码
}

interface PdfParseResult {
  markdown: string
  chapters: PdfChapter[]
}

// ====== pymupdf4llm PDF → Markdown + 章节 解析（唯一路径） ======
// 纯文字英文书籍：pymupdf4llm 版面感知提取 + fitz 字号/关键词章节识别，
// 无需 OCR / 大模型。解析不消耗任何 API token。
function parseWithPyMuPDF4LLM(pdfPath: string): PdfParseResult | null {
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
    const parsed = JSON.parse(stdout)
    if (!parsed?.markdown?.trim()) return null
    return {
      markdown: parsed.markdown,
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    }
  } catch (err: any) {
    console.warn('[parse-pdf] pymupdf4llm 调用失败:', err.message)
    return null
  }
}

// ====== pdfjs-dist 回退（纯 JS，无 Python 依赖） ======
// 场景：服务器/本机没有 pymupdf4llm 时，Python 路径必然失败。
// pdfjs-dist 已是项目依赖，用它抽取文字层，保证 PDF 上传始终可用。
// 注意：pdfjs 不能在 Nitro worker 内直接跑（会让 worker 退出），
// 因此交给当前 Node 二进制启动的子进程执行。
function parseWithPdfJs(pdfPath: string): PdfParseResult | null {
  try {
    const result = execFileSync(process.execPath, [path.resolve('server/scripts/parse_pdf_js.mjs'), pdfPath], {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = String(result).trim()
    if (!stdout || stdout.startsWith('PDF_PARSE_ERROR')) {
      console.warn('[parse-pdf] pdfjs 回退失败:', stdout)
      return null
    }
    const parsed = JSON.parse(stdout)
    if (!parsed?.markdown?.trim()) return null
    // 纯 JS 回退不做章节识别
    return { markdown: parsed.markdown, chapters: [] }
  } catch (err: any) {
    console.warn('[parse-pdf] pdfjs 子进程调用失败:', err?.message || err)
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

  // 优先 pymupdf4llm（版面感知、能识别章节）；失败则回退纯 JS 解析
  let result = parseWithPyMuPDF4LLM(pdfPath)
  let parser = 'pymupdf4llm'
  if (!result) {
    result = parseWithPdfJs(pdfPath)
    parser = 'pdfjs'
  }
  if (!result) {
    throw createError({
      statusCode: 500,
      message: 'PDF 解析失败：pymupdf4llm 不可用，且 pdfjs 未能提取文字层',
    })
  }

  // 扫描版 / 无文字层检测：去掉页码标记后正文文字过少即视为无效
  const textChars = result.markdown.replace(/\[PAGE:\d+\]/g, '').replace(/\s+/g, '').length
  if (textChars < 50) {
    throw createError({ statusCode: 422, message: '未从 PDF 提取到有效文本（可能是扫描版图片 PDF）' })
  }

  return {
    text: result.markdown,
    chapters: result.chapters,
    filePath: path.basename(pdfPath),
    parser,
  }
})
