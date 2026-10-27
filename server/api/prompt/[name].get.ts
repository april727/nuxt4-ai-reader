import { fetchPromptFromManager } from '../../utils/promptManager'

/**
 * GET /api/prompt/[name]
 * 获取本地 Prompt 模板。
 * 来源：server/data/prompts.local.json（本地覆盖）→ prompts.ts 常量兜底。
 * 运行时不再自动访问云端；云端内容需在 /settings/prompts 页面手动「获取云端」。
 */
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400 })

  const content = await fetchPromptFromManager(name)
  if (!content) throw createError({ statusCode: 404, message: `prompt/${name} 不存在` })

  return { content }
})
