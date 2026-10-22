import { PROMPTS } from '../../../utils/prompts'
import { PROMPT_MANAGE_KEYS, PROMPT_LABELS, toManagerKey } from '../../../utils/promptManager'
import { getLocalPrompt, localPromptFilePath } from '../../../utils/promptStore'
import { isPromptCloudConfigured } from '../../../utils/promptClient'

/**
 * GET /api/prompt/cloud/preview
 *
 * 只读本地：列出每条 prompt 的本地当前内容与来源。
 * **不访问云端**（页面加载不再一次性下载云端全部 prompt）。
 * 云端内容按条获取，见 GET /api/prompt/cloud/item?key=xxx
 *
 * 返回每条：
 *   key / managerKey / label
 *   source      'override'=本地覆盖文件 | 'default'=prompts.ts 常量 | 'missing'
 *   hasOverride 本地是否有覆盖
 *   localLength / local  本地当前完整内容
 */
export default defineEventHandler(async () => {
  const items = PROMPT_MANAGE_KEYS.map((key) => {
    const override = getLocalPrompt(key)
    const base = PROMPTS[key] || ''
    const local = override ?? base
    return {
      key,
      managerKey: toManagerKey(key),
      label: PROMPT_LABELS[key] || key,
      source: override ? 'override' : (base ? 'default' : 'missing'),
      hasOverride: Boolean(override),
      localLength: local.length,
      local,
    }
  })

  return {
    configured: isPromptCloudConfigured(),
    file: localPromptFilePath(),
    count: items.length,
    overrideCount: items.filter((i) => i.hasOverride).length,
    items,
  }
})
