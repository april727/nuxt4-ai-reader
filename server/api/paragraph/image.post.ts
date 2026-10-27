import { queryOne } from '../../utils/db'
import { mutateSegments } from '../../utils/segmentsStore'
import { writeFileSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getImagesDir, ensureDir } from '../../utils/storage'
import { queueFileSync } from '../../utils/file-sync'

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event)
  if (!form?.length) throw createError({ statusCode: 400, message: '未收到文件' })

  const file = form.find(f => f.name === 'file')
  const textId = form.find(f => f.name === 'id')?.data.toString()
  const paraId = form.find(f => f.name === 'paragraphId')?.data.toString()

  if (!file || !textId || !paraId) {
    throw createError({ statusCode: 400, message: '缺少 file/id/paragraphId' })
  }

  // 获取该内容所属的 folder
  let folderId = 'default'
  const folderRow = await queryOne('SELECT folder FROM texts WHERE id=?', [textId])
  if (folderRow) folderId = folderRow.folder || 'default'

  const ext = file.filename ? (file.filename.includes('.') ? '.' + file.filename.split('.').pop() : '.png') : '.png'
  const hash = randomUUID().slice(0, 8)
  const dir = getImagesDir(folderId, textId)
  ensureDir(dir)

  const filename = `img_${hash}${ext}`
  const filePath = `${folderId}/${textId}/images/${filename}`
  writeFileSync(dir + '/' + filename, file.data)
  queueFileSync(filePath, dir + '/' + filename, ext === '.png' ? 'image/png' : 'image/jpeg')

  // 段落为空时的兜底分段需要原文，先取出来（不要在锁里再发查询）
  const textRow = await queryOne('SELECT text FROM texts WHERE id=?', [textId])
  const rawTextForFallback = String(textRow?.text || '')

  // 更新 segments JSON（走统一串行通道，避免与合并/插入等操作互相覆盖）
  const result = await mutateSegments(textId, (segments) => {
    if (!segments.length) {
      // 段落还没建立：按自然段补一份，随后插入图片（与旧行为一致）
      const blocks = rawTextForFallback.split(/\n\s*\n/).filter((b: string) => b.trim())
      blocks.forEach((b: string, i: number) => {
        segments.push({ id: `q-${i}`, index: i, text: b.trim() })
      })
    }
    const para = segments.find((s: any) => s.id === paraId)
    if (!para) return { segments, changed: false, conflict: true, meta: { reason: 'paragraph_missing' } }
    if (!para.images) para.images = []
    para.images.push(filePath)
    return { segments, changed: true }
  })

  if (result.conflict) {
    // 段落结构已变化（段落被合并/删除），删除刚落盘的图片，避免留下孤儿文件
    try { unlinkSync(dir + '/' + filename) } catch {}
    throw createError({ statusCode: 409, message: '段落已变化，请刷新后重试' })
  }

  return { url: `/api/file/${encodeURIComponent(filePath)}`, name: filePath, paragraphId: paraId }
})
