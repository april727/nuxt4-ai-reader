/**
 * 段落结构历史（texts_history）
 *
 * 用途：每次段落结构变更前留一份快照，出问题时可以回退。
 * 起因：曾出现「段落整理完成、一段时间后又被后台分段任务覆盖」导致
 * 用户手工整理的结果永久丢失 —— 当时数据库没有任何版本记录可恢复。
 *
 * 设计取舍：
 * - 只存结构相关字段（segments / marks / explanations / paragraphChats），
 *   不存 text 全文，避免历史表膨胀。
 * - 每篇保留最近 MAX_PER_TEXT 条，写入后顺手裁剪。
 * - 快照失败绝不能影响主流程，因此全部 try/catch 吞掉并只打日志。
 */
import { queryOne, queryAll, runQuery } from './db'

const MAX_PER_TEXT = 30

export interface TextHistoryRow {
  id: string
  textId: string
  segments: string
  marks: string
  explanations: string
  paragraphChats: string
  note: string
  segmentCount: number
  createdAt: string
}

/** 记录一次段落结构快照（在写入新结构之前调用）。返回快照 id，失败返回 null */
export async function snapshotText(textId: string, note = ''): Promise<string | null> {
  try {
    const row = await queryOne(
      'SELECT segments,marks,explanations,paragraphChats FROM texts WHERE id=?',
      [textId],
    )
    if (!row) return null

    const segments = String(row.segments || '[]')
    let segmentCount = 0
    try { segmentCount = JSON.parse(segments).length || 0 } catch {}

    const id = `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    await runQuery(
      `INSERT INTO texts_history (id,textId,segments,marks,explanations,paragraphChats,note,segmentCount,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        textId,
        segments,
        String(row.marks || '[]'),
        String(row.explanations || '{}'),
        String(row.paragraphChats || '{}'),
        note,
        segmentCount,
        new Date().toISOString(),
      ],
    )

    // 裁剪：仅保留最近 MAX_PER_TEXT 条
    await runQuery(
      `DELETE FROM texts_history WHERE textId=? AND id NOT IN (
         SELECT id FROM texts_history WHERE textId=? ORDER BY createdAt DESC LIMIT ${MAX_PER_TEXT}
       )`,
      [textId, textId],
    )
    return id
  } catch (err: any) {
    console.warn('[texts_history] 快照失败:', err?.message || err)
    return null
  }
}

/** 列出某篇文档的历史快照（不含大字段，列表页够用） */
export async function listTextHistory(textId: string): Promise<Array<{
  id: string; note: string; segmentCount: number; createdAt: string
}>> {
  const rows = await queryAll(
    `SELECT id,note,segmentCount,createdAt FROM texts_history WHERE textId=? ORDER BY createdAt DESC LIMIT ${MAX_PER_TEXT}`,
    [textId],
  )
  return rows.map((r: any) => ({
    id: String(r.id),
    note: String(r.note || ''),
    segmentCount: Number(r.segmentCount || 0),
    createdAt: String(r.createdAt || ''),
  }))
}

/** 取单条历史快照全文 */
export async function getTextHistory(historyId: string): Promise<TextHistoryRow | null> {
  const row = await queryOne('SELECT * FROM texts_history WHERE id=?', [historyId])
  return (row as TextHistoryRow) || null
}
