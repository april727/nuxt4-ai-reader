import { queryOne, runQuery } from '../../utils/db'
import { safeParse } from '../../utils/subtitle'
import type { SubtitlePractice } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    cueId: string
    practice: Partial<SubtitlePractice>
  }>(event)

  if (!body?.id || !body?.cueId) throw createError({ statusCode: 400, message: '缺少 id 或 cueId' })

  // 读取当前练习记录
  const row = await queryOne('SELECT subtitlePractice FROM texts WHERE id=?', [body.id])
  if (!row) throw createError({ statusCode: 404, message: '记录不存在' })

  const practice = safeParse<Record<string, SubtitlePractice>>(row.subtitlePractice, {})

  // 合并更新
  const existing = practice[body.cueId] || {
    cueId: body.cueId,
    repeatCount: 0,
    mastered: false,
    lastPracticed: '',
  }

  practice[body.cueId] = {
    ...existing,
    ...body.practice,
    cueId: body.cueId, // 确保 cueId 不变
    lastPracticed: new Date().toISOString(),
  }

  await runQuery('UPDATE texts SET subtitlePractice=? WHERE id=?', [JSON.stringify(practice), body.id])

  return { success: true, practice: practice[body.cueId] }
})
