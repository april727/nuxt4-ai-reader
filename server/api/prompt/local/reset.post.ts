import { removeLocalPrompts } from '../../../utils/promptStore'

/**
 * POST /api/prompt/local/reset
 *
 * 删除本地覆盖内容，让这些 key 恢复为 prompts.ts 常量（默认值）。
 *
 * body: { keys: string[] }
 * 返回: { reset: string[] }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ keys?: string[] }>(event).catch(() => ({}) as { keys?: string[] })
  const keys = (body?.keys || []).filter((k) => typeof k === 'string' && k)
  if (!keys.length) {
    throw createError({ statusCode: 400, message: '缺少 keys' })
  }
  removeLocalPrompts(keys)
  return { reset: keys }
})
