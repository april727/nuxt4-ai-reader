import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const db = await getDb()

  const stmt = db.prepare('SELECT * FROM texts WHERE id=?')
  stmt.bind([id])
  let row: any = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

  // 解析 JSON 字段
  if (row.analysis) try { row.analysis = JSON.parse(row.analysis) } catch { row.analysis = null }
  if (row.segments) try { row.segments = JSON.parse(row.segments) } catch { row.segments = null }
  if (row.explanations) try { row.explanations = JSON.parse(row.explanations) } catch { row.explanations = null }
  if (row.marks) try { row.marks = JSON.parse(row.marks) } catch { row.marks = null }
  if (row.readingPosition) try { row.readingPosition = JSON.parse(row.readingPosition) } catch { row.readingPosition = null }

  return row
})
