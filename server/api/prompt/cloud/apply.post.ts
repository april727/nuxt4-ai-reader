import { PROMPTS } from '../../../utils/prompts'
import { PROMPT_KEY_MAP, PROMPT_MANAGE_KEYS, toManagerKey } from '../../../utils/promptManager'
import { getLocalPrompt, setLocalPrompts } from '../../../utils/promptStore'
import { fetchPromptVersion, getAllPrompts, isPromptCloudConfigured } from '../../../utils/promptClient'

/**
 * POST /api/prompt/cloud/apply
 *
 * 把云端 prompt 内容写进本地覆盖文件（server/data/prompts.local.json），
 * 之后运行时就会用本地这份，不再访问云端。
 *
 * body：
 *   { keys: string[] }   —— 只拉这几条，**逐条**向云端请求（默认，单独拉取）
 *   { mode: 'changed' }  —— 整体比一遍，只写入云端有更新的
 *   { mode: 'all' }      —— 整体比一遍，写入全部（批量按钮用，会一次性读云端）
 * 返回: { applied: string[], skipped: {key, reason}[] }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ keys?: string[]; mode?: 'changed' | 'all' }>(event)
    .catch(() => ({} as { keys?: string[]; mode?: 'changed' | 'all' }))

  if (!isPromptCloudConfigured()) {
    throw createError({ statusCode: 400, message: '云端 Prompt 未配置（缺少 SUPABASE_URL / SUPABASE_KEY）' })
  }

  const applied: string[] = []
  const skipped: Array<{ key: string; reason: string }> = []
  const entries: Record<string, string> = {}

  // ── 批量：整体检查后再写 ──
  if (body?.mode === 'changed' || body?.mode === 'all') {
    const cloud = await getAllPrompts()
    const localOf = (key: string) => getLocalPrompt(key) ?? PROMPTS[key] ?? ''

    for (const key of PROMPT_MANAGE_KEYS) {
      const content = cloud[toManagerKey(key)]
      if (!content) {
        skipped.push({ key, reason: '云端没有该 key 的激活版本' })
        continue
      }
      // 「只拉有更新的」跳过与本地一致的
      if (body.mode === 'changed' && content === localOf(key)) continue
      entries[key] = content
      applied.push(key)
    }

    if (applied.length) setLocalPrompts(entries)
    return { applied, skipped }
  }

  // ── 单独拉取：逐条向云端请求 ──
  const requested = Array.isArray(body?.keys) && body.keys.length ? body.keys : PROMPT_MANAGE_KEYS
  const valid = requested.filter((k) => typeof k === 'string' && Object.hasOwn(PROMPT_KEY_MAP, k))
  if (!valid.length) {
    throw createError({ statusCode: 400, message: '没有合法的 prompt key' })
  }

  for (const key of valid) {
    try {
      const { content } = await fetchPromptVersion(toManagerKey(key))
      if (content) {
        entries[key] = content
        applied.push(key)
      } else {
        skipped.push({ key, reason: '云端没有该 key 的激活版本' })
      }
    } catch (e: any) {
      skipped.push({ key, reason: e?.message || String(e) })
    }
  }

  if (applied.length) setLocalPrompts(entries)
  return { applied, skipped }
})
