import { PROMPTS } from '../../utils/prompts'

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400 })

  const content = PROMPTS[name]
  if (!content) throw createError({ statusCode: 404, message: `prompt/${name} 不存在` })

  return { content }
})
