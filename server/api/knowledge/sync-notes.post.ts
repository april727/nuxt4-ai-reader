import { queryAll, queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async () => {
  // 读取所有有 paragraphNotes 或 notes 的文本
  const rows = await queryAll(
    `SELECT id, title, paragraphNotes, notes FROM texts
     WHERE (paragraphNotes IS NOT NULL AND paragraphNotes != '' AND paragraphNotes != '[]')
        OR (notes IS NOT NULL AND notes != '')`
  )

  let created = 0
  let skipped = 0

  for (const row of rows) {
    // 处理 paragraphNotes（JSON 数组）
    if (row.paragraphNotes && row.paragraphNotes !== '[]') {
      try {
        const notes = JSON.parse(row.paragraphNotes)
        if (Array.isArray(notes)) {
          for (const note of notes) {
            if (!note.quotedText) continue
            // 检查是否已存在相同的知识点
            const existing = await queryOne(
              "SELECT id FROM knowledge_points WHERE content=? AND sourceId=? AND sourceType='note' LIMIT 1",
              [note.quotedText, row.id]
            )
            if (existing) { skipped++; continue }

            const kpId = `kp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            const now = new Date().toISOString()
            await runQuery(
              `INSERT INTO knowledge_points (id,content,note,sourceId,sourceTitle,sourceType,customGroup,sortOrder,createdAt,updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [kpId, note.quotedText, note.userContent || '', row.id, row.title || '', 'note', '', Date.now(), now, now]
            )
            created++
          }
        }
      } catch { /* 跳过解析失败的 */ }
    }

    // 处理 text-level notes（播客生成的 Markdown 笔记）
    if (row.notes && typeof row.notes === 'string' && row.notes.trim()) {
      const existing = await queryOne(
        "SELECT id, content FROM knowledge_points WHERE sourceId=? AND sourceType='podcast_note' LIMIT 1",
        [row.id]
      )
      if (existing) {
        // 已有但内容可能被截断，用完整内容更新
        if (existing.content && existing.content.length < row.notes.length) {
          await runQuery('UPDATE knowledge_points SET content=? WHERE id=?', [row.notes.slice(0, 50000), existing.id])
          created++
        } else {
          skipped++
        }
      } else {
        const kpId = `kp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const now = new Date().toISOString()
        await runQuery(
          `INSERT INTO knowledge_points (id,content,note,sourceId,sourceTitle,sourceType,customGroup,sortOrder,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [kpId, row.notes.slice(0, 50000), '', row.id, row.title || '', 'podcast_note', '', Date.now(), now, now]
        )
        created++
      }
    }
  }

  return { created, skipped, message: `已同步 ${created} 条，跳过 ${skipped} 条重复` }
})
