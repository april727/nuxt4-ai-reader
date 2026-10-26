import { queryOne, runQuery } from '../../utils/db'
import { syncMarks } from '../../utils/marksSync'
import { snapshotText } from '../../utils/textHistory'
import { mutateSegments } from '../../utils/segmentsStore'

/**
 * 更新文本的若干字段。
 *
 * 这里有一条必须守住的规则：**只写请求里真正给出的列**。
 *
 * 旧实现无论传了什么，都会把 title/analysis/segments/explanations/marks/...
 * 一次性全量写回，而 `segments` 用的是这次请求开始时读到的旧值。
 * 这个接口被高频调用（保存标记、阅读位置、段落笔记、解释缓存……），
 * 于是只要用户合并段落的同时有一个 `text/update` 在飞，
 * 合并结果就会被那份旧 segments 覆盖 —— 已合并的段落"复活"、
 * 段落内容顺序错乱。这也是"合并完过一会儿段落就乱了"的真正来源。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string; title?: string; analysis?: any; segments?: any[]; explanations?: Record<string,string>
    marks?: any[]; readingPosition?: any; paragraphChats?: Record<string, any[]>
    paragraphNotes?: any[]; paragraphNotesMap?: Record<string, string>
  }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const existing = await queryOne('SELECT * FROM texts WHERE id=?', [body.id])
  if (!existing) throw createError({ statusCode: 404 })

  const sets: string[] = []
  const args: any[] = []

  if (body.title !== undefined) {
    sets.push('title=?')
    args.push(body.title)
  }

  if (body.analysis !== undefined) {
    sets.push('analysis=?')
    args.push(body.analysis ? JSON.stringify(body.analysis) : '')
  }

  // 段落结构：走统一的串行通道，避免与合并/插入/删除互相覆盖
  let segmentsHandledByStore = false
  if (body.segments !== undefined) {
    await snapshotText(body.id, '段落结构更新')
    const nextSegs = Array.isArray(body.segments) ? body.segments : []
    await mutateSegments(body.id, (segs) => {
      // 内容完全一致就不写（避免无意义的历史快照与同步）
      if (JSON.stringify(segs) === JSON.stringify(nextSegs)) {
        return { segments: segs, changed: false }
      }
      segs.length = 0
      segs.push(...nextSegs.map((s: any, i: number) => ({ ...s, index: i })))
      return { segments: segs, changed: true }
    })
    segmentsHandledByStore = true
  }

  // 解释缓存是「按段落 ID 增量合并」，必须保留已有条目
  if (body.explanations !== undefined) {
    let cur: Record<string, string> = {}
    try { cur = existing.explanations ? JSON.parse(existing.explanations) : {} } catch {}
    if (body.explanations) {
      for (const [k, v] of Object.entries(body.explanations)) {
        if (v) cur[k] = v
        else delete cur[k]
      }
    }
    sets.push('explanations=?')
    args.push(JSON.stringify(cur))
  }

  const marksChanged = body.marks !== undefined
  if (marksChanged) {
    sets.push('marks=?')
    args.push(JSON.stringify(body.marks))
  }

  if (body.readingPosition !== undefined) {
    sets.push('readingPosition=?')
    args.push(JSON.stringify(body.readingPosition))
  }

  if (body.paragraphChats !== undefined) {
    sets.push('paragraphChats=?')
    args.push(JSON.stringify(body.paragraphChats))
  }

  if (body.paragraphNotes !== undefined) {
    sets.push('paragraphNotes=?')
    args.push(JSON.stringify(body.paragraphNotes))
  }

  if (body.paragraphNotesMap !== undefined) {
    sets.push('paragraphNotesMap=?')
    args.push(JSON.stringify(body.paragraphNotesMap))
  }

  // 只有确实有字段要改时才发 UPDATE（segments 已由串行通道单独写）
  const hasPlainFields = sets.length > 0
  if (hasPlainFields) {
    sets.push('updatedAt=?')
    args.push(new Date().toISOString())
    args.push(body.id)
    await runQuery(`UPDATE texts SET ${sets.join(',')} WHERE id=?`, args)
  } else if (!segmentsHandledByStore) {
    // 什么都没传：只刷新 updatedAt，绝不触碰任何内容列
    await runQuery('UPDATE texts SET updatedAt=? WHERE id=?', [new Date().toISOString(), body.id])
  }

  // markers 变更时，同步 marks 独立表 + 单词本
  if (marksChanged) {
    const title = body.title !== undefined ? body.title : existing.title
    await syncMarks(body.id, title, existing.folder || 'default', existing.marks || '[]', JSON.stringify(body.marks))
  }

  return { ok: true }
})
