import { queryAll, runQuery } from '../../utils/db'

// AI 批量获取词性（仅用于纯英文单词）
async function enrichWordPos(words: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const batchSize = 25

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    const prompt = `为以下英文单词标注最常见、最常用的词性。如果一个词有多种词性，只标注其中最常用的一种。只返回JSON：
{"words":[{"word":"xxx","pos":"n."}]}

词性缩写：n./v./adj./adv./pron./prep./conj./interj./art./num./det./modal./aux.

单词列表：${batch.join(', ')}`

    try {
      const config = useRuntimeConfig()
      const apiKey = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY
      const res = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是词典专家。只返回JSON，不要代码块。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 3000,
        }),
      })

      if (!res.ok) continue
      const json = await res.json() as any
      const content = json.choices?.[0]?.message?.content || ''
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
