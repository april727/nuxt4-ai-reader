import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
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

  const result = parseWithPyMuPDF4LLM(pdfPath)
  if (!result) {
    throw createError({ statusCode: 500, message: 'PDF 解析失败（缺少 Python / pymupdf4llm 环境）' })
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
    parser: 'pymupdf4llm',
  }
})
