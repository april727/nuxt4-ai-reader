import { getDb, saveDb } from '../../utils/db'
import { safeParse } from '../../utils/subtitle'
import type { SubtitlePractice } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    cueId: string
    practice: Partial<SubtitlePractice>
  }>(event)

  if (!body?.id || !body?.cueId) throw createError({ statusCode: 400, message: '缺少 id 或 cueId' })

  const db = await getDb()

  // 读取当前练习记录
  const stmt = db.prepare('SELECT subtitlePractice FROM texts WHERE id=?')
  stmt.bind([body.id])
  let row: any = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
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

  db.run('UPDATE texts SET subtitlePractice=? WHERE id=?', [JSON.stringify(practice), body.id])
  await saveDb()

  return { success: true, practice: practice[body.cueId] }
})
