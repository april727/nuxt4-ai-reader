import { queryOne, runQuery } from '../../../utils/db'

/**
 * 保存整卷判分（整体覆盖）。
 *
 * 与标注分开成一个字段、一个接口的原因：
 *   1. 判分是高频操作（点一下对错就变），标注是低频（框一次）。混在一起会让
 *      每点一次对错都重写整份 annotations，白白放大写放大与冲突面。
 *   2. 语义不同源：标注是「这道题在哪」，判分是「这次作答对不对」。删框时判分
 *      要跟着消失，所以这里按现存注解 id 过滤一遍，避免留下没有主人的分数。
 *
 * 总分不落库，由前端按 items 现算 —— 两份真值必然会在某次部分更新后打架。
 */

const VERDICTS = new Set(['right', 'half', 'wrong', 'blank'])
const MAX_SCORE_CAP = 1000

function num(v: any, fallback = 0): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(MAX_SCORE_CAP, Math.max(0, n)) * 100) / 100
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })

  const body = await readBody<{ items?: Record<string, any> }>(event)
  if (!body?.items || typeof body.items !== 'object') {
    throw createError({ statusCode: 400, message: 'items 必须是对象' })
  }

  const row = await queryOne('SELECT id, annotations FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '试卷不存在' })

  // 只认现存注解：框被删掉后，它的分数不该继续参与总分
  let alive: Set<string>
  try {
    const list = JSON.parse(row.annotations || '[]')
    alive = new Set(Array.isArray(list) ? list.map((a: any) => String(a?.id || '')) : [])
  } catch {
    alive = new Set()
  }

  const items: Record<string, any> = {}
  for (const [annoId, g] of Object.entries(body.items)) {
    if (!annoId || !alive.has(annoId)) continue
    const verdict = VERDICTS.has(g?.verdict) ? g.verdict : 'wrong'
    const max = num(g?.max)
    const got = Math.min(max, num(g?.got))
    items[annoId] = { verdict, max, got }
  }

  const count = Object.keys(items).length
  await runQuery('UPDATE texts SET grading=?, updatedAt=? WHERE id=?', [
    JSON.stringify({ items, updatedAt: new Date().toISOString() }),
    new Date().toISOString(),
    id,
  ])

  return { ok: true, count }
})
