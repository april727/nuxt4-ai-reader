import { queryAll } from '../../utils/db'
import { supabaseQuery, supabaseUpsert } from '../../utils/supabase'
import { getEmbeddings } from '../../utils/embedding'

const BATCH_SIZE = 10

/**
 * POST /api/embeddings/sync
 * 增量同步标记内容向量：
 *  - 新增的标记文本 → 生成向量写入 marks_embeddings
 *  - 已存在的标记文本 → 只更新 mark_count（不重新生成向量，文本相同向量相同）
 * 对比依据：LOWER(TRIM(text)) 作为 text_key。
 */
export default defineEventHandler(async (event) => {
  // 1. 读本地 marks，去重 + 统计标记次数（排除软删除）
  const rows = await queryAll(`
    SELECT LOWER(TRIM(text)) as text_key,
           MAX(TRIM(text)) as display_text,
           MAX(type) as type,
           COUNT(*) as mark_count
    FROM marks
    WHERE text IS NOT NULL AND TRIM(text) != '' AND deletedAt IS NULL
    GROUP BY LOWER(TRIM(text))
  `)

  // 2. 拉取 Supabase 已有 text_key（分页）
  const existingMap = new Map<string, number>()
  let offset = 0
  const pageSize = 1000
  for (;;) {
    const existing = await supabaseQuery<{ text_key: string; mark_count: number }[]>(
      'marks_embeddings',
      { select: 'text_key,mark_count', limit: String(pageSize), offset: String(offset) },
    )
    for (const e of existing) existingMap.set(e.text_key, Number(e.mark_count) || 0)
    if (existing.length < pageSize) break
    offset += pageSize
  }

  // 3. 分类：新增 vs 仅次数变化
  const toEmbed: Array<{ text_key: string; display_text: string; type: string; mark_count: number }> = []
  const toUpdate: Array<{ text_key: string; mark_count: number }> = []
  for (const r of rows) {
    const key = r.text_key
    const count = Number(r.mark_count) || 1
    if (!existingMap.has(key)) {
      toEmbed.push({ text_key: key, display_text: r.display_text, type: r.type || 'word', mark_count: count })
    } else if (existingMap.get(key) !== count) {
      toUpdate.push({ text_key: key, mark_count: count })
    }
  }

  // 4. 新增 → 生成向量 + 写入
  let embedded = 0
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE)
    const vecs = await getEmbeddings(batch.map((b) => b.display_text))
    const payload = batch.map((b, idx) => ({
      text_key: b.text_key,
      display_text: b.display_text,
      type: b.type,
      mark_count: b.mark_count,
      embedding: vecs[idx],
    }))
    await supabaseUpsert('marks_embeddings', payload, 'text_key')
    embedded += batch.length
  }

  // 5. 已存在 → 更新 mark_count（merge-duplicates 只更新提供的列，embedding 保留）
  let countUpdated = 0
  for (let i = 0; i < toUpdate.length; i += 100) {
    const batch = toUpdate.slice(i, i + 100)
    await supabaseUpsert('marks_embeddings', batch, 'text_key')
    countUpdated += batch.length
  }

  return {
    total: rows.length,
    newEmbedded: embedded,
    countUpdated,
    skipped: rows.length - embedded - countUpdated,
  }
})
