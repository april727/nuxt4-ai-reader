import { queryAll } from '../../utils/db'
import { permanentDeleteText } from '../../utils/recycleTexts'

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export default defineEventHandler(async () => {
  // 回收站：软删除的文件/书
  const fileRows = await queryAll(
    'SELECT id,title,source,folder,excerpt,filePath,createdAt,deletedAt FROM texts WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC'
  )

  // 自动清理超过保留期的文件（移磁盘文件到垃圾箱 + 硬删除）
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const files = []
  for (const r of fileRows) {
    if (r.deletedAt && new Date(r.deletedAt).getTime() < cutoff) {
      try { await permanentDeleteText(r.id) } catch {}
      continue
    }
    files.push({
      id: r.id,
      title: r.title || '未命名',
      source: r.source || '',
      folder: r.folder || 'default',
      excerpt: r.excerpt || '',
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
    })
  }

  // 回收站：软删除的标记（父文本未删除的，即单独删除的标记；父文本删除的归入上面的文件区）
  const markRows = await queryAll(
    `SELECT m.* FROM marks m
     LEFT JOIN texts t ON t.id = m.textId
     WHERE m.deletedAt IS NOT NULL AND (t.id IS NULL OR t.deletedAt IS NULL)
     ORDER BY m.deletedAt DESC`
  )
  const marks = markRows.map((row: any) => ({
    id: row.id,
    text: row.text,
    type: row.type,
    lemma: row.lemma,
    detail: row.detail,
    note: row.note,
    textId: row.textId,
    textTitle: row.textTitle,
    textFolder: row.textFolder,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }))

  return { files, marks, totalFiles: files.length, totalMarks: marks.length }
})
