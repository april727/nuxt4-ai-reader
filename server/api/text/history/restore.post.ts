import { runQuery } from '../../../utils/db'
import { getTextHistory, snapshotText } from '../../../utils/textHistory'

/**
 * POST /api/text/history/restore
 * body: { historyId }
 *
 * 把某条历史快照的段落结构回滚到 texts 表。
 * 回滚前会先给「当前状态」也留一份快照 —— 回退本身也要可撤销。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ historyId: string }>(event)
  if (!body?.historyId) throw createError({ statusCode: 400, message: '缺少 historyId' })

  const snap = await getTextHistory(body.historyId)
  if (!snap) throw createError({ statusCode: 404, message: '历史记录不存在' })

  // 回退前的现状也存一份，避免误操作不可逆
  await snapshotText(snap.textId, '回退前自动备份')

  await runQuery(
    `UPDATE texts SET segments=?,marks=?,explanations=?,paragraphChats=?,updatedAt=? WHERE id=?`,
    [
      snap.segments || '[]',
      snap.marks || '[]',
      snap.explanations || '{}',
      snap.paragraphChats || '{}',
      new Date().toISOString(),
      snap.textId,
    ],
  )

  let segments: any[] = []
  try { segments = JSON.parse(snap.segments || '[]') } catch {}

  return { ok: true, textId: snap.textId, segmentCount: segments.length, segments }
})
