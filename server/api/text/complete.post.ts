import { queryOne, runQuery } from '../../utils/db'
import { clearCache } from '../../utils/cache'

/**
 * 完成阅读 / 复习完成 / 取消完成
 *
 * 设计（用户确认）：
 *  - 「完成」必须是显式动作，不用滚动进度推断（读完 ≠ 读懂）
 *  - 完成后按自评给出下次复习日期：读懂了 ×1.5、大致看懂 ×1、还需再看 ×0.5
 *  - 间隔夹取 1~90 天，避免乘数累积后变成"永远不复习"
 *  - nextReviewAt 存本地日期 YYYY-MM-DD（避免 UTC 跨日错位）
 */

const RATING_MULT: Record<string, number> = { good: 1.5, fair: 1, hard: 0.5 }
const MIN_DAYS = 1
const MAX_DAYS = 90

/** 本地日期（不是 UTC，否则东八区夜间会算到前一天） */
function localDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + days)
  return localDate(dt)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    action?: 'complete' | 'uncomplete'
    rating?: 'good' | 'fair' | 'hard'
    intervalDays?: number
  }>(event)

  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 ID' })
  const id = body.id
  const action = body.action || 'complete'

  const row = await queryOne(
    'SELECT completedAt, reviewIntervalDays, reviewCount, nextReviewAt FROM texts WHERE id=?',
    [id],
  )
  if (!row) throw createError({ statusCode: 404, message: '文章不存在' })

  const now = new Date()
  const nowIso = now.toISOString()

  // ── 取消完成：清空完成态与排程（保留历史复习次数）──
  if (action === 'uncomplete') {
    await runQuery(
      "UPDATE texts SET completedAt=NULL, nextReviewAt=NULL, selfRating='' WHERE id=?",
      [id],
    )
    clearCache()
    return { completedAt: null, nextReviewAt: null }
  }

  // ── 完成 / 复习完成 ──
  const isReview = !!row.completedAt
  const base = Math.max(
    MIN_DAYS,
    Number(body.intervalDays) || Number(row.reviewIntervalDays) || 7,
  )
  const mult = body.rating ? (RATING_MULT[body.rating] ?? 1) : 1
  const interval = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(base * mult)))
  const nextReviewAt = addDays(localDate(now), interval)
  const reviewCount = Number(row.reviewCount || 0) + (isReview ? 1 : 0)

  await runQuery(
    'UPDATE texts SET completedAt=?, reviewIntervalDays=?, nextReviewAt=?, reviewCount=?, lastReviewedAt=?, selfRating=? WHERE id=?',
    [
      row.completedAt || nowIso, // 首次完成时间保持不变
      interval,
      nextReviewAt,
      reviewCount,
      nowIso,
      body.rating || '',
      id,
    ],
  )
  clearCache()

  return {
    completedAt: row.completedAt || nowIso,
    nextReviewAt,
    intervalDays: interval,
    reviewCount,
    isReview,
  }
})
