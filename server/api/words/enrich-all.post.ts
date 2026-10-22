import { queryAll, runQuery } from '../../utils/db'
import { getPromptMessages } from '../../utils/promptManager'
import { deepseekChat } from '../../utils/deepseek'

// AI 批量获取词性（仅用于纯英文单词）
async function enrichWordPos(words: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const batchSize = 25

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    // 从 Prompt 管理器获取模板（与 wordbooks 的 enrich-pos 共用，失败时降级到本地常量）
    const { system, user } = await getPromptMessages('enrich-pos', { wordList: batch.join(', ') })

    try {
      const content = await deepseekChat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.2, maxTokens: 3000 },
      )
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0])
        if (data.words && Array.isArray(data.words)) {
          for (const item of data.words) {
            if (item.word && item.pos) {
              result.set(item.word.trim().toLowerCase(), item.pos)
            }
          }
        }
      }
    } catch (e) {
      console.warn('[enrich-all] AI batch failed:', (e as any).message)
    }
  }

  return result
}

export default defineEventHandler(async () => {
  const now = new Date().toISOString()
  let phrases = 0
  let sentences = 0
  let aiWords = 0

  // ── 阶段一：短语本全部标为 phr. ──
  const phraseResult = await runQuery(
    `UPDATE words SET pos='phr.', updatedAt=? WHERE bookId='wb_phrases' AND (pos IS NULL OR pos='')`,
    [now]
  )
  phrases = Number(phraseResult.rowsAffected) || 0

  // ── 阶段二：句子本全部标为 sent. ──
  const sentenceResult = await runQuery(
    `UPDATE words SET pos='sent.', updatedAt=? WHERE bookId='wb_sentences' AND (pos IS NULL OR pos='')`,
    [now]
  )
  sentences = Number(sentenceResult.rowsAffected) || 0

  // ── 阶段三：单词本中未标注的纯英文词 → AI 补全 ──
  const targetsRows = await queryAll(`
    SELECT id, word FROM words
    WHERE (pos IS NULL OR pos = '')
    AND bookId NOT IN ('wb_phrases', 'wb_sentences')
  `)
  const targets: Array<{ id: string; word: string }> = []
  for (const row of targetsRows) {
    const wordText = (row.word as string) || ''
    if (/^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(wordText)) {
      targets.push({ id: row.id as string, word: wordText })
    }
  }

  if (targets.length > 0) {
    const posMap = await enrichWordPos(targets.map(t => t.word))
    for (const t of targets) {
      const pos = posMap.get(t.word.trim().toLowerCase())
      if (!pos) continue
      await runQuery('UPDATE words SET pos=?, updatedAt=? WHERE id=?', [pos, now, t.id])
      aiWords++
    }
  }

  return {
    phrases,    // 短语本标注数
    sentences,  // 句子本标注数
    aiWords,    // AI 补全的单词数
    total: phrases + sentences + aiWords,
  }
})
