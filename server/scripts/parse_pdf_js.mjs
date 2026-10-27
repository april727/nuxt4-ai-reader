/**
 * PDF → 纯文本（pdfjs-dist，无 Python 依赖）
 *
 * 为什么要独立成子进程：pdfjs v4 在 Nitro 的 dev worker 内运行会导致
 * 该 worker 直接退出（"worker exited with code 0"），整个请求 500。
 * 放到当前 Node 二进制启动的子进程里执行，既隔离风险，又不依赖 PATH 上的 node。
 *
 * 用法：node parse_pdf_js.mjs <pdf路径>
 * 输出：单行 JSON { markdown } ；失败时输出 PDF_PARSE_ERROR xxx
 */
import { readFileSync } from 'node:fs'

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.log('PDF_PARSE_ERROR 缺少文件路径')
  process.exit(0)
}

try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise

  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()

    // 同一 y 坐标归为一行，按 y 自上而下输出
    const lines = new Map()
    for (const it of tc.items) {
      if (!it || !it.str) continue
      const y = Math.round((it.transform && it.transform[5]) || 0)
      const arr = lines.get(y)
      if (arr) arr.push(it.str)
      else lines.set(y, [it.str])
    }

    out.push(`[PAGE:${p}]`)
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      const line = lines.get(y).join('').replace(/[ \t]+/g, ' ').trim()
      if (line) out.push(line)
    }
    out.push('')
    if (page.cleanup) page.cleanup()
  }

  const markdown = out.join('\n').trim()
  if (!markdown) {
    console.log('PDF_PARSE_ERROR 未提取到文字层')
    process.exit(0)
  }
  console.log(JSON.stringify({ markdown }))
} catch (err) {
  console.log('PDF_PARSE_ERROR ' + (err && err.message ? err.message : String(err)))
}
