import { queryOne, runQuery } from '../../../../utils/db'
import { getPromptMessages } from '../../../../utils/promptManager'
import { deepseekChat } from '../../../../utils/deepseek'
import { buildComposedCard, type CardExtras } from '../../../../utils/cardCompose'

/**
 * 卡片数据（组合式）
 *
 * 先用标记解析 + words 已有字段拼出卡片；
 * 只把「标记解析里没有的」（词根、同根词、近义词、趣味知识、例句）交给 AI 补，
 * 已有内容不重复生成，补全结果缓存在 words.enhancement。
 */

const TYPE_LABEL: Record<string, string> = { word: '单词', phrase: '短语', sentence: '句子' }

const FIELD_SPEC: Record<string, string> = {
  meaning: '中文释义（含词性，50 字以内）',
  example: '一个地道英文例句及其中文翻译',
  roots: '词根/词缀拆解（part + 中文说明）',
  rootNote: '一句话总结这个构词逻辑',
  related: '同根词 3 个',
  similar: '近义词或近义表达 2–3 个',
  funFact: '一段有趣的词源、典故或文化知识（3–5 句中文）',
}

const KEY_SPEC: Record<string, string> = {
  meaning: '"meaning": "中文释义"',
  example: '"example": "English example",\n  "exampleZh": "例句中文翻译"',
  roots: '"roots": [{ "part": "词根/词缀", "note": "中文解释" }]',
  rootNote: '"rootNote": "一句话总结"',
  related: '"related": ["同根词1", "同根词2", "同根词3"]',
  similar: '"similar": ["近义词1", "近义词2"]',
  funFact: '"funFact": { "title": "标题", "body": "3-5 句中文" }',
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const body = await readBody<{ wordId: string; type?: 'word' | 'phrase' | 'sentence' }>(event)
  if (!bookId || !body?.wordId) throw createError({ statusCode: 400, message: '缺少 wordId' })

  const word = await queryOne('SELECT * FROM words WHERE id=? AND bookId=?', [body.wordId, bookId])
  if (!word) throw createError({ statusCode: 404, message: '词条不存在' })

  const type = body.type || (bookId === 'wb_phrases' ? 'phrase' : bookId === 'wb_sentences' ? 'sentence' : 'word')
  let composed = buildComposedCard(word, type)

  // 标记解析 + 已缓存内容已经够用 → 不再调用模型
  if (!composed.needsAI) return { ...composed, llm: false }

  const missing = composed.missing
  const missingSpec = missing.map(k => `- ${k}：${FIELD_SPEC[k] || k}`).join('\n')
  const keySpec = missing.map(k => KEY_SPEC[k] || `"${k}": "..."`).join(',\n  ')

  const detailDigest = (composed.sections || [])
    .map(s => `【${s.title}】${s.body.replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n')
    .slice(0, 1200)

  let aiError = ''
  try {
    const { system, user } = await getPromptMessages('card-extras', {
      typeLabel: TYPE_LABEL[type] || '词条',
      word: composed.headword,
      meaning: composed.meaning || '（暂无）',
      context: composed.context || '（暂无）',
      detail: detailDigest || '（暂无）',
      missingSpec,
      keySpec,
    })

    const content = await deepseekChat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.5, maxTokens: 1200, responseFormat: { type: 'json_object' }, timeoutMs: 60_000 },
    )

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const patch: CardExtras = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

    // 只补缺失字段，绝不覆盖标记解析已有的内容
    const merged: CardExtras = { ...(composed.extras as CardExtras) }
    for (const key of missing) {
      const value = (patch as any)[key]
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value) && !value.length) continue
      ;(merged as any)[key] = value
    }
    // example 与 exampleZh 成对出现
    if (patch.exampleZh && !merged.exampleZh) merged.exampleZh = patch.exampleZh

    await runQuery('UPDATE words SET enhancement=?, updatedAt=? WHERE id=?', [
      JSON.stringify(merged),
      new Date().toISOString(),
      body.wordId,
    ])

    composed = buildComposedCard({ ...word, enhancement: JSON.stringify(merged) }, type)
  } catch (e: any) {
    aiError = e?.message || 'AI 补全失败'
  }

  return { ...composed, llm: true, error: aiError || undefined }
})
