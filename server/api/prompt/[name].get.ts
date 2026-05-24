import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 启动时一次性加载全部 prompt 文件到内存
const cache = new Map<string, string>()

function loadPrompt(name: string): string {
  if (cache.has(name)) return cache.get(name)!
  const filePath = resolve(`prompt/${name}.md`)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: `prompt/${name}.md 不存在` })
  const content = readFileSync(filePath, 'utf-8')
  cache.set(name, content)
  return content
}

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400 })
  return { content: loadPrompt(name) }
})
