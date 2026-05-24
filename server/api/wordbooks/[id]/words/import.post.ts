import { getDb, saveDb } from '../../../../utils/db'

// DeepSeek AI 增强：批量获取音标+释义+例句
async function enrichWords(words: string[]): Promise<{ word: string; phonetic: string; meaning: string; example: string; pos: string }[]> {
  const results: any[] = []
  const batchSize = 5

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    const prompt = `请为以下 ${batch.length} 个英文单词/短语提供：
1. 音标 (IPA格式)
2. 简洁中文释义 (不超过15字)
3. 一个地道英文例句
4. 词性缩写 (如 n./v./adj./adv.，短语或句子填"")

严格按JSON格式返回：{"words":[{"word":"xxx","phonetic":"/xxx/","meaning":"xxx","example":"xxx","pos":"n."}]}

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
              { role: 'system', content: '你是词典助手。只返回JSON，不说其他话。' },
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
        if (data.words) results.push(...data.words)
      }
    } catch (e) {
      console.warn('[words/import] AI batch failed:', (e as any).message)
      // 失败时返回空占位
      batch.forEach(w => results.push({ word: w, phonetic: '', meaning: '', example: '', pos: '' }))
    }
  }

  return results
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { words: rawWords, enrich = true, source = '' } = await readBody<{ words: string[]; enrich?: boolean; source?: string }>(event)
  if (!bookId || !rawWords?.length) throw createError({ statusCode: 400 })

  const db = await getDb()
  const filtered = rawWords.map(w => w.trim()).filter(Boolean)

  // AI 增强
  let enriched: any[] = []
  if (enrich) {
    enriched = await enrichWords(filtered)
  } else {
    enriched = filtered.map(w => ({ word: w, phonetic: '', meaning: '', example: '', pos: '' }))
  }

  const now = new Date().toISOString()
  let inserted = 0

  for (const item of enriched) {
    // 跳过已存在的
    const dup = db.prepare('SELECT id FROM words WHERE bookId=? AND word=?')
    dup.bind([bookId, item.word])
    if (dup.step()) { dup.free(); continue }
    dup.free()

    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    db.run(
      `INSERT INTO words (id,bookId,word,phonetic,meaning,example,pos,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, bookId, item.word, item.phonetic || '', item.meaning || '', item.example || '', item.pos || '', source, now, now]
    )
    inserted++
  }

  await saveDb()
  return { inserted, total: filtered.length, skipped: filtered.length - inserted }
})
