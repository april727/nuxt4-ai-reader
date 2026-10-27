import { queryOne, runQuery } from '../../../utils/db'

/** 允许的标注类型：与前端 kind 一一对应（q = AI 切题产出的题目区） */
const KINDS = new Set(['wrong', 'key', 'q', 'doubt', 'note'])

function clamp01(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * 保存试卷标注（整体覆盖）。
 *
 * 设计要点：标注是「原图上的叠加层」，只存归一化坐标与类型，永远不改图片像素。
 * 因此这里做的是纯数据写入，不需要任何图像处理，删除/改色/换类型都是改这一份 JSON。
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: '缺少 id' })

  const body = await readBody<{ annotations?: any[] }>(event)
  if (!Array.isArray(body?.annotations)) throw createError({ statusCode: 400, message: 'annotations 必须是数组' })

  const row = await queryOne('SELECT id, contentKind FROM texts WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '试卷不存在' })

  // 上限 2000 条：一张卷子几十条足够，超出说明客户端出了问题
  const clean = body.annotations.slice(0, 2000).map((a: any) => {
    const bw = clamp01(a?.bbox?.w)
    const bh = clamp01(a?.bbox?.h)
    const bx = Math.min(clamp01(a?.bbox?.x), 1 - bw)
    const by = Math.min(clamp01(a?.bbox?.y), 1 - bh)
    return {
      id: String(a?.id || '').slice(0, 64),
      pageId: String(a?.pageId || '').slice(0, 64),
      kind: KINDS.has(a?.kind) ? a.kind : 'key',
      bbox: { x: bx, y: by, w: bw, h: bh },
      note: String(a?.note || '').slice(0, 2000),
      createdAt: String(a?.createdAt || new Date().toISOString()),
    }
  }).filter(a => a.id && a.pageId && a.bbox.w > 0 && a.bbox.h > 0)

  await runQuery('UPDATE texts SET annotations=?, updatedAt=? WHERE id=?', [
    JSON.stringify(clean), new Date().toISOString(), id,
  ])

  return { ok: true, count: clean.length }
})
