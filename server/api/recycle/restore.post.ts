import { modifyMarkInText } from '../../utils/recycleMarks'
import { restoreText } from '../../utils/recycleTexts'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string; kind: 'mark' | 'text' }>(event)
  if (!body?.id) throw createError({ statusCode: 400, message: '缺少 id' })

  const ok = body.kind === 'text'
    ? (await restoreText(body.id)).ok
    : (await modifyMarkInText(body.id, 'restore')).ok
  if (!ok) throw createError({ statusCode: 404, message: '内容不存在' })

  return { ok: true }
})
