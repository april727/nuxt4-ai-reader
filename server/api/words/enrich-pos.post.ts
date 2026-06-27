import { queryAll, runQuery } from '../../utils/db'

// DeepSeek: 批量获取词性，跨全部单词本
async function enrichPos(words: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const batchSize = 25

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    const prompt = `为以下英文单词标注最常见、最常用的词性。如果一个词有多种词性，只标注其中最常用的一种。只返回JSON：
{"words":[{"word":"xxx","pos":"n."}]}

词性缩写对照：
- n. 名词
- v. 动词（含及物/不及物）
- adj. 形容词
- adv. 副词
- pron. 代词
- prep. 介词
- conj. 连词
- interj. 感叹词
- art. 冠词
- num. 数词
- det. 限定词
- modal. 情态动词
- aux. 助动词

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
            { role: 'system', content: '你是词典专家。只返回JSON，不要代码块标记。' },
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
      console.warn('[enrich-pos] batch failed:', (e as any).message)
    }
  }

  return result
}

export default defineEventHandler(async () => {
  // 查找所有需要补充词性的纯英文单词（跨全部单词本，跳过短语本和句子本）
  const stmt = await queryAll(`
    SELECT w.id, w.word, w.bookId
    FROM words w
    WHERE (w.pos IS NULL OR w.pos = '')
    AND w.bookId NOT IN ('wb_phrases', 'wb_sentences')
  `)
  const targets: Array<{ id: string; word: string }> = []
  for (const row of stmt) {
    const wordText = (row.word as string) || ''
    // 只处理纯英文单词（不含空格和标点，允许连字符组合词）
    if (/^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(wordText)) {
      targets.push({ id: row.id as string, word: wordText })
    }
  }

  if (!targets.length) return { enriched: 0, total: 0 }

  // 批量获取词性
  const posMap = await enrichPos(targets.map(t => t.word))
  if (!posMap.size) return { enriched: 0, total: targets.length }

  // 更新数据库
  const now = new Date().toISOString()
  let enriched = 0
  for (const t of targets) {
    const pos = posMap.get(t.word.trim().toLowerCase())
    if (!pos) continue
    await runQuery('UPDATE words SET pos=?, updatedAt=? WHERE id=?', [pos, now, t.id])
    enriched++
  }

  return { enriched, total: targets.length }
})
