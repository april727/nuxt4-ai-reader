import { queryOne, runQuery } from '../../../../utils/db'
import { getPromptMessages } from '../../../../utils/promptManager'
import { deepseekChat } from '../../../../utils/deepseek'

// DeepSeek AI 增强：批量获取音标+释义+例句
async function enrichWords(words: string[]): Promise<{ word: string; phonetic: string; meaning: string; example: string; pos: string }[]> {
  const results: any[] = []
  const batchSize = 5

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    // 从 Prompt 管理器获取模板（失败时降级到本地常量）
    const { system, user } = await getPromptMessages('wordbook-import', {
      count: String(batch.length),
      wordList: batch.join(', '),
    })

    try {
      const content = await deepseekChat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.3, maxTokens: 2000 },
      )
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
    const dup = await queryOne('SELECT id FROM words WHERE bookId=? AND word=?', [bookId, item.word])
    if (dup) continue

    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await runQuery(
      `INSERT INTO words (id,bookId,word,phonetic,meaning,example,pos,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, bookId, item.word, item.phonetic || '', item.meaning || '', item.example || '', item.pos || '', source, now, now]
    )
    inserted++
  }

  return { inserted, total: filtered.length, skipped: filtered.length - inserted }
})
