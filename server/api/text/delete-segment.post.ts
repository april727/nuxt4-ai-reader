import { queryOne, runQuery } from '../../utils/db'
import { existsSync, unlinkSync } from 'node:fs'
import { resolveFilePath } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    segmentId: string
  }>(event)

  if (!body?.textId || !body?.segmentId) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  const row = await queryOne('SELECT * FROM texts WHERE id=?', [body.textId])
  if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

  // 解析现有数据
  let segs: any[] = []
  try { segs = JSON.parse(row.segments || '[]') } catch {}

  const segIdx = segs.findIndex((s: any) => s.id === body.segmentId)
  if (segIdx === -1) throw createError({ statusCode: 404, message: '段落不存在' })

  const seg = segs[segIdx]

  // 清理段落关联的图片文件（兼容新旧路径格式）
  if (seg.images?.length) {
    for (const imgName of seg.images) {
      try {
        const imgPath = resolveFilePath(imgName)
        if (existsSync(imgPath)) unlinkSync(imgPath)
      } catch {
        // 文件不存在或无权限，跳过
      }
    }
  }

  // 删除该段落
  segs.splice(segIdx, 1)
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].index !== i) {
      segs[i].index = i
    }
  }

  // 清理此段落的标记
  let marks: any[] = []
  try { marks = row.marks ? JSON.parse(row.marks) : [] } catch {}
  marks = marks.filter((m: any) => m.paragraphId !== body.segmentId)

  // 清理此段落的 AI 缓存
  let explanations: Record<string, string> = {}
  try { explanations = row.explanations ? JSON.parse(row.explanations) : {} } catch {}
  for (const key of Object.keys(explanations)) {
    if (key.startsWith(body.segmentId + ':')) {
      delete explanations[key]
    }
  }

  // 清理此段落的对话历史
  let paragraphChats: Record<string, any[]> = {}
  try { paragraphChats = row.paragraphChats ? JSON.parse(row.paragraphChats) : {} } catch {}
  delete paragraphChats[body.segmentId]

  // 清理阅读位置
  let readingPosition: any = null
  try { readingPosition = row.readingPosition ? JSON.parse(row.readingPosition) : null } catch {}
  if (readingPosition?.paragraphId === body.segmentId) {
    readingPosition = null
  }

  await runQuery(
    `UPDATE texts SET segments=?,marks=?,explanations=?,paragraphChats=?,readingPosition=?,updatedAt=? WHERE id=?`,
    [
      JSON.stringify(segs),
      JSON.stringify(marks),
      JSON.stringify(explanations),
      JSON.stringify(paragraphChats),
      readingPosition ? JSON.stringify(readingPosition) : '',
      new Date().toISOString(),
      body.textId,
    ]
  )

  return { ok: true, segments: segs }
})
