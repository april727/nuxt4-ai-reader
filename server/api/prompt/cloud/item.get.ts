import { PROMPTS } from '../../../utils/prompts'
import { PROMPT_KEY_MAP, PROMPT_LABELS, toManagerKey } from '../../../utils/promptManager'
import { getLocalPrompt } from '../../../utils/promptStore'
import { fetchPromptVersion, isPromptCloudConfigured } from '../../../utils/promptClient'

/**
 * GET /api/prompt/cloud/item?key=explain
 *
 * 单独拉取某一条 prompt 的云端内容，与本地当前内容对比。
 * 只读，不写任何东西；页面上的「预览」和单条对比都走这里。
 *
 * 返回：key / managerKey / label / source / hasOverride
 *      localLength / cloudLength / cloudAvailable / changed / version
 *      local / cloud  两边完整内容
 */
export default defineEventHandler(async (event) => {
  const { key } = getQuery(event) as { key?: string }
  if (!key || !Object.hasOwn(PROMPT_KEY_MAP, key)) {
    throw createError({ statusCode: 400, message: '缺少或非法的 key' })
  }
  if (!isPromptCloudConfigured()) {
    throw createError({ statusCode: 400, message: '云端 Prompt 未配置（缺少 SUPABASE_URL / SUPABASE_KEY）' })
  }

  const override = getLocalPrompt(key)
  const base = PROMPTS[key] || ''
  const local = override ?? base

  let cloud = ''
  let version: string | number | null = null
  try {
    const r = await fetchPromptVersion(toManagerKey(key))
    cloud = r.content
    version = r.version
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `云端读取失败：${e?.message || e}` })
  }

  return {
    key,
    managerKey: toManagerKey(key),
    label: PROMPT_LABELS[key] || key,
    source: override ? 'override' : (base ? 'default' : 'missing'),
    hasOverride: Boolean(override),
    localLength: local.length,
    cloudLength: cloud.length,
    cloudAvailable: Boolean(cloud),
    changed: Boolean(cloud) && cloud !== local,
    version,
    local,
    cloud,
  }
})
