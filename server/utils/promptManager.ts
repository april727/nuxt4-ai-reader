/**
 * Prompt 工具函数
 *
 * 来源优先级：本地覆盖文件（server/data/prompts.local.json）→ prompts.ts 常量兜底。
 * 运行时**不再自动同步云端**；云端内容只通过 /settings/prompts 页面手动拉取
 * （/api/prompt/cloud/apply 会把云端内容写进本地覆盖文件）。
 */

import { PROMPTS } from './prompts'
import { getLocalPrompt } from './promptStore'

/**
 * 项目内部 key → Prompt 管理器（云端）key 的映射
 * 内部 key 用于代码调用与本地覆盖文件；管理器 key 用于访问 Supabase。
 */
export const PROMPT_KEY_MAP: Record<string, string> = {
  // 核心阅读功能
  'explain': 'paragraph_analysis',     // 段落深度解读
  'mark-word': 'word_explanation',     // 词汇详细解释
  'mark-phrase': 'mark_phrase',        // 短语解释
  'mark-sentence': 'mark_sentence',    // 句子解释
  'segment': 'segment',                // 分段
  'analyze-article': 'article_summary',// 文章摘要生成
  'podcast_extract': 'podcast_extract',// podcast 分段
  'podcast_full': 'podcast_extract',   // 完整版复用 extract 模板
  // 次要功能（原内联 prompt）
  'translate': 'translate',            // 快速翻译
  'clean': 'text-clean',               // 文本清理
  'flashcard-word': 'flashcard-word',  // 闪卡-单词
  'flashcard-phrase': 'flashcard-phrase', // 闪卡-短语
  'flashcard-sentence': 'flashcard-sentence', // 闪卡-句子
  'card-extras': 'card-extras',        // 卡片增量补全（词根/同根词/近义词/趣味知识）
  'wordbook-import': 'wordbook-import', // 单词导入富化
  'enrich-pos': 'enrich-pos',          // 词性标注（wordbooks + words 共用）
  'daily-insight': 'daily-insight',    // 每日学习洞察
  'word-cluster': 'word-cluster',      // 词汇聚类分析
}

/** 管理页面展示用的中文名 */
export const PROMPT_LABELS: Record<string, string> = {
  'explain': '段落解读',
  'mark-word': '生词解释',
  'mark-phrase': '短语解释',
  'mark-sentence': '句子解释',
  'segment': '智能分段',
  'analyze-article': '文章分析',
  'podcast_extract': '播客整理',
  'podcast_full': '播客整理（完整版）',
  'translate': '翻译',
  'clean': '文本清理',
  'flashcard-word': '闪卡·单词',
  'flashcard-phrase': '闪卡·短语',
  'flashcard-sentence': '闪卡·句子',
  'card-extras': '卡片补充（词根/近义词/趣味知识）',
  'wordbook-import': '单词导入',
  'enrich-pos': '词性标注',
  'daily-insight': '每日洞察',
  'word-cluster': '词汇聚类',
}

/** 内部 key 列表（保持 PROMPT_KEY_MAP 的声明顺序） */
export const PROMPT_KEYS: string[] = Object.keys(PROMPT_KEY_MAP)

/**
 * 只是别名、运行时不会被单独读取的 key。
 * 例如 podcast_full 与 podcast_extract 共用同一个云端模板，
 * 且 podcast-full.post.ts 直接取 'podcast_extract'，所以不该在管理页面单列一行
 * （否则会永远显示「云端有更新」却清不掉）。
 */
export const PROMPT_ALIAS_KEYS: string[] = ['podcast_full']

/** 管理页面展示 / 「全部获取」覆盖的 key（排除别名） */
export const PROMPT_MANAGE_KEYS: string[] = PROMPT_KEYS.filter((k) => !PROMPT_ALIAS_KEYS.includes(k))

/** 把内部 key 翻译成管理器 key */
export function toManagerKey(key: string): string {
  return PROMPT_KEY_MAP[key] || key
}

/**
 * 取 prompt 模板：本地覆盖文件优先，否则回退 prompts.ts 常量。
 * 保持 async 签名以兼容既有调用方。
 */
export async function fetchPromptFromManager(key: string): Promise<string | null> {
  return getLocalPrompt(key) || PROMPTS[key] || null
}

/** 清空本地 Prompt 缓存（覆盖文件被外部改动后可调用） */
export { clearLocalPromptCache as clearPromptCache } from './promptStore'

/**
 * 获取 prompt 并填充变量（带降级）
 * 用法：const filled = await getFilledPrompt('explain', { paragraphText: '...', articleContext: '...' })
 */
export async function getFilledPrompt(
  key: string,
  vars: Record<string, string>,
): Promise<string> {
  const template = (await fetchPromptFromManager(key)) || PROMPTS[key] || ''
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
}

/**
 * 获取 prompt 模板（原始内容，保留 {var} 占位符供调用方自行填充）
 */
export async function getPromptTemplate(key: string): Promise<string> {
  return (await fetchPromptFromManager(key)) || PROMPTS[key] || ''
}

/**
 * 获取 prompt 并拆分为 system / user 两条消息（带降级）
 * 模板约定：===SYSTEM===\n...\n===USER===\n...
 * 用法：const { system, user } = await getPromptMessages('translate', { paragraph: '...' })
 */
export async function getPromptMessages(
  key: string,
  vars: Record<string, string> = {},
): Promise<{ system: string; user: string }> {
  const template = await getFilledPrompt(key, vars)
  const parts = template.split('===USER===')
  const system = (parts[0]?.replace('===SYSTEM===', '').trim() || '')
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
  const user = (parts[1]?.trim() || '')
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
  return { system, user }
}
