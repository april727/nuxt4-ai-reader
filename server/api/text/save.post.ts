import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text: string; source?: string; title?: string; folder?: string; filePath?: string }>(event)
  if (!body?.text?.trim()) throw createError({ statusCode: 400, message: '文本内容不能为空' })

  const fp = body.text.slice(0, 300).replace(/\s+/g, ' ').trim()
  const title = body.title && body.title !== '未命名'
    ? body.title : (body.text.trim().split(/[\n.!?。！？]/)[0]?.slice(0, 60).trim() || '未命名')
  const excerpt = body.text.replace(/\s+/g, ' ').trim().slice(0, 150)
  const id = `txt_${Date.now()}`

  const db = await getDb()

  // 去重
  const stmt = db.prepare('SELECT id,title,createdAt,text FROM texts')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    const f = String(row.text).slice(0, 300).replace(/\s+/g, ' ').trim()
    if (f === fp) { stmt.free(); return { id: row.id, title: row.title, createdAt: row.createdAt, existed: true } }
  }
  stmt.free()

  db.run('INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,createdAt) VALUES (?,?,?,?,?,?,?,?)',
    [id, title, body.text.slice(0, 100000), body.source || 'paste', body.folder || 'default', excerpt, body.filePath || '', new Date().toISOString()])
  await saveDb()
  return { id, title, createdAt: new Date().toISOString() }
})
