import { getDb, saveDb } from '../../../../utils/db'

// DeepSeek: 批量获取词性
async function enrichPos(words: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const batchSize = 20

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    const prompt = `为以下英文单词标注词性。只返回JSON：
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
      const res = await $fetch<{ choices: { message: { content: string } }[] }>(
        `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: {
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
            messages: [
              { role: 'system', content: '你是词典专家。只返回JSON。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          },
        }
      )

      const content = res.choices?.[0]?.message?.content || ''
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
      console.warn('[enrich-pos] AI batch failed:', (e as any).message)
    }
  }

  return result
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  if (!bookId) throw createError({ statusCode: 400 })

  // 短语本和句子本不需要词性
  if (bookId === 'wb_phrases' || bookId === 'wb_sentences') {
    return { enriched: 0, total: 0, skipped: true }
  }

  const db = await getDb()

  // 查找所有需要补充词性的单词（pos 为空且为单个英文单词）
  const stmt = db.prepare('SELECT id, word FROM words WHERE bookId=? AND (pos IS NULL OR pos = \'\')')
  stmt.bind([bookId])
  const targets: Array<{ id: string; word: string }> = []
  while (stmt.step()) {
    const w = stmt.getAsObject()
    const wordText = (w.word as string) || ''
    // 只处理纯英文单词（不含空格、标点），短语和句子跳过
    if (/^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(wordText)) {
      targets.push({ id: w.id as string, word: wordText })
    }
  }
  stmt.free()

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
    db.run('UPDATE words SET pos=?, updatedAt=? WHERE id=?', [pos, now, t.id])
    enriched++
  }

  if (enriched) await saveDb()
  return { enriched, total: targets.length }
})
