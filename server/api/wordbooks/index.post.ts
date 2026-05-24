import { getDb, saveDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)
  if (!name?.trim()) throw createError({ statusCode: 400, message: '名称不能为空' })

  const db = await getDb()
  const id = `wb_${Date.now()}`
  db.run('INSERT INTO wordbooks (id,name,createdAt) VALUES (?,?,?)',
    [id, name.trim(), new Date().toISOString()])
  await saveDb()
  return { id, name: name.trim() }
})
