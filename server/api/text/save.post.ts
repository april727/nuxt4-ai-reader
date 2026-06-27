import { queryAll, runQuery } from '../../utils/db'
import { LEGACY_UPLOADS, moveToFinal } from '../../utils/storage'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; source?: string; title?: string; folder?: string; filePath?: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '文本内容不能为空' })

  const fp = body.text.slice(0, 300).replace(/\s+/g, ' ').trim()
  const title = body.title && body.title !== '未命名'
    ? body.title : (body.text.trim().split(/[\n.!?。！？]/)[0]?.slice(0, 60).trim() || '未命名')
  const excerpt = body.text.replace(/\s+/g, ' ').trim().slice(0, 150)
  const id = `txt_${Date.now()}`
  const folderId = body.folder || 'default'

  // 去重
  const allTexts = await queryAll('SELECT id,title,createdAt,text FROM texts')
  for (const row of allTexts) {
    const f = String(row.text).slice(0, 300).replace(/\s+/g, ' ').trim()
    if (f === fp) { return { id: row.id, title: row.title, createdAt: row.createdAt, existed: true } }
  }

  // 处理文件：从临时目录移动到最终位置
  let finalPath = body.filePath || ''
  if (finalPath && !finalPath.includes('/')) {
    const tempPath = path.join(LEGACY_UPLOADS, finalPath)
    if (existsSync(tempPath)) {
      finalPath = moveToFinal(tempPath, folderId, id, finalPath)
    } else {
      // 文件不存在，只保留原始名（用于 PDF 等已在 parse-pdf 阶段保存的）
      finalPath = finalPath
    }
  }

  await runQuery('INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,createdAt) VALUES (?,?,?,?,?,?,?,?)',
    [id, title, body.text.slice(0, 100000), body.source || 'paste', folderId, excerpt, finalPath, new Date().toISOString()])
  return { id, title, createdAt: new Date().toISOString() }
})
