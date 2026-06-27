import { createHash } from 'node:crypto'
import { queryOne } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; password: string }>(event)
  if (!body?.id || !body?.password) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const row = await queryOne('SELECT passwordHash FROM folders WHERE id=? AND isPrivate=1', [body.id])

  if (!row?.passwordHash) {
    throw createError({ statusCode: 404, message: '文件夹不存在或非私密' })
  }

  const hash = createHash('sha256').update(body.password).digest('hex')
  if (hash !== row.passwordHash) {
    throw createError({ statusCode: 403, message: '密码错误' })
  }

  return { ok: true }
})
