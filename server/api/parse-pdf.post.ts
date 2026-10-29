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

// ====== 版面重建（pdfjs + 行/段还原）=======
// 与 parse_pdf_js.mjs 的区别：那个只按 y 分行、join('') 拼字，会丢词间空格
// （"of creation" → "ofcreation"）、把双栏拼成一行、抹掉所有段落边界。
// 这个按 x 间距补空格、按行距/缩进/句末判断段落，并且能输出词级坐标
// 供「在原页上高亮标记」用。
//
// 放在最前面试：它是唯一同时给出段落结构和坐标的路径。
// 有任何异常都返回 null，由后面的 pymupdf4llm / pdfjs 接手 —— 导入不能因为
// 新代码挂掉，这是硬要求。
function parseWithLayout(pdfPath: string, geomPath?: string): PdfParseResult | null {
  try {
    const args = [path.resolve('server/scripts/parse_pdf_layout.mjs'), pdfPath]
    if (geomPath) args.push(`--geometry=${geomPath}`)
    const result = execFileSync(process.execPath, args, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = String(result).trim()
    if (!stdout || stdout.startsWith('PDF_PARSE_ERROR')) {
      console.warn('[parse-pdf] 版面重建失败:', stdout.slice(0, 200))
      return null
    }
    const parsed = JSON.parse(stdout)
    if (!parsed?.markdown?.trim()) return null
    return {
      markdown: parsed.markdown,
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    }
  } catch (err: any) {
    console.warn('[parse-pdf] 版面重建调用失败:', err?.message || err)
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

  // 主路径：版面重建（段落结构 + 坐标）；失败降级 pymupdf4llm；再失败降级纯 JS 抽取
  let result = parseWithLayout(pdfPath)
  let parser = 'layout'
  if (!result) {
    result = parseWithPyMuPDF4LLM(pdfPath)
    parser = 'pymupdf4llm'
  }
  if (!result) {
    result = parseWithPdfJs(pdfPath)
    parser = 'pdfjs'
  }
  if (!result) {
    throw createError({
      statusCode: 500,
      message: 'PDF 解析失败：版面重建、pymupdf4llm、pdfjs 均未能提取文字层',
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
