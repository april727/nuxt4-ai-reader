import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    textId: string
    beforeParagraphId?: string
    afterParagraphId?: string
    segmentId: string
    text: string
  }>(event)

  if (!body?.textId || !body?.segmentId || !body?.text?.trim()) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }
  if (!body.beforeParagraphId && !body.afterParagraphId) {
    throw createError({ statusCode: 400, message: '必须指定 beforeParagraphId 或 afterParagraphId' })
  }

  const row = await queryOne('SELECT segments FROM texts WHERE id=?', [body.textId])
  if (!row) throw createError({ statusCode: 404 })

  let segs: any[] = []
  try { segs = JSON.parse(row.segments || '[]') } catch {}

  // 定位参考段落位置
  const refId = body.beforeParagraphId || body.afterParagraphId
  let refIdx = segs.findIndex((s: any) => s.id === refId)
  if (refIdx === -1) throw createError({ statusCode: 404, message: '参考段落不存在' })

  // 计算插入位置
  const insertIdx = body.beforeParagraphId ? refIdx : refIdx + 1

  // 创建新段落
  const newSeg = {
    id: body.segmentId,
    index: insertIdx,
    text: body.text.trim(),
  }

  // 插入并重排索引
  segs.splice(insertIdx, 0, newSeg)
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].index !== i) {
      segs[i].index = i
    }
  }

  await runQuery('UPDATE texts SET segments=?,updatedAt=? WHERE id=?', [
    JSON.stringify(segs),
    new Date().toISOString(),
    body.textId,
  ])

  return { ok: true, segments: segs }
})
