import { queryOne, runQuery } from '../../utils/db'

/**
 * 手动上传分段 / 播客整理结果（不调用 AI）
 *
 * 与 AI 分段后的数据结构完全一致：
 * - segments: string[] → 写入 texts.segments（[{id, index, text}]）
 * - notes:     string   → 写入 texts.notes（Markdown，播客/博客整理用，可被知识要点同步）
 *
 * 段落变更后自动清空旧 explanations / paragraphChats（段落 ID 已失效）
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    segments?: string[]
    notes?: string
  }>(event)

  if (!body?.id) throw createError({ statusCode: 400, message: '缺少文本 ID' })

  const row = await queryOne('SELECT id FROM texts WHERE id=?', [body.id])
  if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

  const now = new Date().toISOString()
  const updates: string[] = []
  const params: any[] = []
  let segmentCount = 0

  if (Array.isArray(body.segments)) {
    const segs = body.segments
      .map((t, i) => ({ id: `p-${i}`, index: i, text: (t || '').trim() }))
      .filter((s) => s.text.length > 0)
    segmentCount = segs.length
    if (segmentCount === 0) throw createError({ statusCode: 400, message: '没有有效的段落内容' })

    updates.push('segments=?')
    params.push(JSON.stringify(segs))
    // 段落变化 → 旧解释/聊天缓存失效
    updates.push('explanations=?')
    params.push('')
    updates.push('paragraphChats=?')
    params.push('')
  }

  if (typeof body.notes === 'string') {
    updates.push('notes=?')
    params.push(body.notes.slice(0, 50000))
  }

  if (!updates.length) return { ok: true, segmentCount: 0 }

  params.push(now, body.id)
  await runQuery(`UPDATE texts SET ${updates.join(', ')}, updatedAt=? WHERE id=?`, params)

  return { ok: true, segmentCount }
})
