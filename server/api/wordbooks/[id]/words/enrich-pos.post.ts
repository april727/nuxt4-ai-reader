import { queryAll, runQuery } from '../../../../utils/db'
import { getPromptMessages } from '../../../../utils/promptManager'
import { deepseekChat } from '../../../../utils/deepseek'

// DeepSeek: 批量获取词性
async function enrichPos(words: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const batchSize = 20

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize)
    // 从 Prompt 管理器获取模板（失败时降级到本地常量）
    const { system, user } = await getPromptMessages('enrich-pos', { wordList: batch.join(', ') })

    try {
      const content = await deepseekChat(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { temperature: 0.3, maxTokens: 2000 },
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

  // 查找所有需要补充词性的单词（pos 为空且为单个英文单词）
  const rows = await queryAll("SELECT id, word FROM words WHERE bookId=? AND (pos IS NULL OR pos = '') AND (archivedAt IS NULL OR archivedAt='')", [bookId])
  const targets: Array<{ id: string; word: string }> = []
  for (const w of rows) {
    const wordText = (w.word as string) || ''
    // 只处理纯英文单词（不含空格、标点），短语和句子跳过
    if (/^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(wordText)) {
      targets.push({ id: w.id as string, word: wordText })
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
