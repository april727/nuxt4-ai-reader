import { queryOne, runQuery } from '../../../../utils/db'

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
  let prompt: string
  if (type === 'word') {
    prompt = `你是一个专业的英文词汇老师。请为英文单词"${word}"生成完整的闪卡学习资料。`

    const jsonTemplate = {
      phonetic: "/IPA音标/",
      meaning: "中文释义（含词性如 adj./v./n.）",
      example: "地道的英文例句",
      exampleZh: "例句中文翻译",
      roots: [
        { part: "词缀或词根", note: "用中文解释来源和含义" }
      ],
      rootNote: "字面含义的总结，用一句话解释构词逻辑",
      related: ["同根词1", "同根词2", "同根词3"],
      similar: ["近义词1", "近义词2", "近义词3"],
      funFact: {
        title: "有趣的知识点标题（1句话）",
        body: "有趣的故事或知识点，可以涉及词源故事、历史典故、科学趣闻、文化背景等。要有趣、有人情味，让读者觉得学到了意料之外的东西。用中文写，约3-5句话。"
      },
      pos: "词性缩写如 n./v./adj./adv."
    }

    prompt += `\n\n只返回JSON：\n${JSON.stringify(jsonTemplate, null, 2)}`
  } else if (type === 'phrase') {
    prompt = `你是一个专业的英文老师。请为英文短语"${word}"生成闪卡学习资料。只返回JSON：\n${JSON.stringify({
      meaning: "中文释义",
      example: "英文例句",
      exampleZh: "例句中文翻译",
      similar: ["相近短语1", "相近短语2"],
      funFact: {
        title: "有趣的知识点标题",
        body: "关于这个短语的由来故事、文化背景或有趣知识。用中文写，约3-5句话。"
      }
    }, null, 2)}`
  } else {
    prompt = `你是一个专业的英文老师。请为英文句子"${word}"生成闪卡学习资料。只返回JSON：\n${JSON.stringify({
      translation: "中文翻译",
      similar: ["相近表达1", "相近表达2"],
      funFact: {
        title: "有趣的知识点标题",
        body: "与这个句子或其背景相关的有趣知识。用中文写，约3-5句话。"
      }
    }, null, 2)}`
  }

  try {
    const apiUrl = `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`
    const apiKey = process.env.DEEPSEEK_API_KEY || ''
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

    if (!apiKey) {
      console.error('[flashcard-enrich] DEEPSEEK_API_KEY 未配置')
      return null
    }

    console.log(`[flashcard-enrich] 调用 AI: word="${word}", type=${type}, model=${model}`)
    const res = await $fetch<{ choices: { message: { content: string } }[] }>(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model,
        messages: [
          { role: 'system', content: '你返回的必须是纯JSON，不能包含任何markdown标记或解释文字。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6, max_tokens: 1200,
      },
    })
    const content = res.choices?.[0]?.message?.content || ''
    if (!content) {
      console.error('[flashcard-enrich] AI 返回空内容，response:', JSON.stringify(res).slice(0, 200))
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
