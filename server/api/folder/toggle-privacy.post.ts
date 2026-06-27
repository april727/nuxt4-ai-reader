import { createHash } from 'node:crypto'
import { queryOne, runQuery } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; password?: string }>(event)
  if (!body?.id) throw createError({ statusCode: 400 })

  const row = await queryOne('SELECT isPrivate, passwordHash FROM folders WHERE id=?', [body.id])
  if (!row) throw createError({ statusCode: 404 })

  const currentlyPrivate = row.isPrivate === 1

  if (currentlyPrivate) {
    // 取消私密
    await runQuery('UPDATE folders SET isPrivate=0, passwordHash=\'\' WHERE id=?', [body.id])
    return { ok: true, isPrivate: false }
  }

  // 设为私密：需要密码
  if (!body.password || body.password.length < 4) {
    throw createError({ statusCode: 400, message: '密码至少需要4位' })
  }

  const hash = createHash('sha256').update(body.password).digest('hex')
  await runQuery('UPDATE folders SET isPrivate=1, passwordHash=? WHERE id=?', [hash, body.id])
  return { ok: true, isPrivate: true }
})
