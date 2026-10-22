import { queryAll, runQuery } from '../../utils/db'
import { LEGACY_UPLOADS, moveToFinal } from '../../utils/storage'
import { clearCache } from '../../utils/cache'
import { invalidateFolderCache } from '../../utils/folderCache'
import { withFingerprintLock } from '../../utils/fingerprintLock'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; source?: string; title?: string; folder?: string; filePath?: string; chapters?: any[] }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '文本内容不能为空' })

  const fp = body.text.slice(0, 300).replace(/\s+/g, ' ').trim()

  /** 默认标题：优先用导入文件名（去扩展名），否则用文本第一句 */
  function defaultTitle(source: string, text: string): string {
    if (source && source !== 'paste' && source !== 'upload') {
      const base = source.split(/[\\/]/).pop() || ''
      if (base && !/^https?:/i.test(base)) {
        const noExt = base.replace(/\.[^.]+$/, '').trim()
        if (noExt) return noExt.slice(0, 60)
      }
    }
    return text.trim().split(/[\n.!?。！？]/)[0]?.slice(0, 60).trim() || '未命名'
  }

  const title = body.title && body.title !== '未命名'
    ? body.title : defaultTitle(body.source || '', body.text)
  const excerpt = body.text.replace(/\s+/g, ' ').trim().slice(0, 150)
  const id = `txt_${Date.now()}`
  const folderId = body.folder || 'default'

  // ── 去重（含并发去重）────────────────────────────────────
  //
  // 背景：客户端可能在一次操作里发两个 save 请求（上传时 emit 一次 + 直接调一次），
  // 两个请求几乎同时到达。若只做「先 SELECT 再 INSERT」，
  // 第二个请求的 SELECT 会在第一个 INSERT 完成前执行 → 查不到 → 两条都插进去。
  //
  // 解法：把「查重 + 插入」放进一个**按内容指纹串行化**的临界区，
  // 同一篇文章的并发请求排队执行，第二个就能查到第一个刚插入的记录并复用它。
  const existing = await withFingerprintLock(fp, async () => {
    const allTexts = await queryAll('SELECT id,title,createdAt,text FROM texts')
    for (const row of allTexts) {
      const f = String(row.text).slice(0, 300).replace(/\s+/g, ' ').trim()
      if (f === fp) return { id: row.id, title: row.title, createdAt: row.createdAt }
    }

    // 处理文件：从临时目录移动到最终位置
    let finalPath = body.filePath || ''
    if (finalPath && !finalPath.includes('/')) {
      const tempPath = path.join(LEGACY_UPLOADS, finalPath)
      if (existsSync(tempPath)) {
        finalPath = moveToFinal(tempPath, folderId, id, finalPath)
      }
      // 文件不存在时只保留原始名（PDF 等已在 parse-pdf 阶段保存的）
    }

    const now = new Date().toISOString()
    await runQuery('INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,chapters,createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, body.text.slice(0, 100000), body.source || 'upload', folderId, excerpt, finalPath, JSON.stringify(body.chapters || []), now])
    return { id, title, createdAt: now }
  })

  clearCache()
  invalidateFolderCache()
  return { id: existing.id, title: existing.title, createdAt: existing.createdAt, existed: existing.id !== id }
})
