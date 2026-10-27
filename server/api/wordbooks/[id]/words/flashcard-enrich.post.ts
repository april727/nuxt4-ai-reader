import { queryOne, runQuery } from '../../../../utils/db'
import { getPromptMessages } from '../../../../utils/promptManager'
import { deepseekChat } from '../../../../utils/deepseek'

interface EnhancementData {
  phonetic?: string
  meaning?: string
  example?: string
  exampleZh?: string
  roots?: Array<{ part: string; note: string }>
  rootNote?: string
  related?: string[]
  similar?: string[]
  funFact?: { title: string; body: string }
  pos?: string
}

async function queryAI(word: string, type: 'word' | 'phrase' | 'sentence'): Promise<EnhancementData | null> {
  // 按类型选择对应的管理器 key
  const promptKey = type === 'word' ? 'flashcard-word' : type === 'phrase' ? 'flashcard-phrase' : 'flashcard-sentence'

  try {
    // 从 Prompt 管理器获取模板（失败时降级到本地常量）
    const { system, user } = await getPromptMessages(promptKey, { word })

    console.log(`[flashcard-enrich] 调用 AI: word="${word}", type=${type}`)
    const content = await deepseekChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.6, maxTokens: 1200, timeoutMs: 90_000 },
    )
    if (!content) {
      console.error('[flashcard-enrich] AI 返回空内容')
      return null
    }
    const m = content.match(/\{[\s\S]*\}/)
    if (!m) {
      console.error('[flashcard-enrich] 未找到 JSON，原始内容:', content.slice(0, 200))
      return null
    }
    console.log(`[flashcard-enrich] AI 成功: word="${word}"`)
    return JSON.parse(m[0])
  } catch (e: any) {
    console.error(`[flashcard-enrich] AI 调用异常:`, e.message || e)
    return null
  }
}

export default defineEventHandler(async (event) => {
  const bookId = getRouterParam(event, 'id')
  const { wordId, type } = await readBody<{ wordId: string; type?: string }>(event)
  if (!bookId || !wordId) throw createError({ statusCode: 400 })

  const word = await queryOne('SELECT * FROM words WHERE id=? AND bookId=?', [wordId, bookId])
  if (!word) throw createError({ statusCode: 404 })

  // 检测类型
  const detectType = type || (bookId === 'wb_phrases' ? 'phrase' : bookId === 'wb_sentences' ? 'sentence' : 'word')

  // 如果已有增强数据，直接返回
  if (word.enhancement) {
    try {
      const existing = JSON.parse(word.enhancement as string)
      if (existing && (existing.meaning || existing.roots || existing.funFact)) {
        return { wordId, ...existing, fromCache: true }
      }
    } catch {}
  }

  // 调用 AI
  const data = await queryAI(word.word as string, detectType as 'word' | 'phrase' | 'sentence')
  if (!data) throw createError({ statusCode: 500, message: 'AI 生成失败' })

  // 存储
  const now = new Date().toISOString()
  const enhancement = JSON.stringify(data)

  // 同时更新基础字段
  const updates: string[] = ['enhancement=?']
  const params: any[] = [enhancement]

  if (data.phonetic && !(word.phonetic as string)?.trim()) {
    updates.push('phonetic=?')
    params.push(data.phonetic)
  }
  if (data.meaning) {
    updates.push('meaning=?')
    params.push(data.meaning)
  }
  if (data.example && !(word.example as string)?.trim()) {
    updates.push('example=?')
    params.push(data.example)
  }
  if (data.pos && !(word.pos as string)?.trim()) {
    updates.push('pos=?')
    params.push(data.pos)
  }

  updates.push('updatedAt=?')
  params.push(now)
  params.push(wordId, bookId)

  await runQuery(
    `UPDATE words SET ${updates.join(',')} WHERE id=? AND bookId=?`,
    params
  )

  return { wordId, ...data, fromCache: false }
})
