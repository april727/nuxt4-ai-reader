import { runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)
  if (!name?.trim()) throw createError({ statusCode: 400, message: '名称不能为空' })

  const id = `wb_${Date.now()}`
  await runQuery('INSERT INTO wordbooks (id,name,createdAt) VALUES (?,?,?)',
    [id, name.trim(), new Date().toISOString()])
  return { id, name: name.trim() }
})
