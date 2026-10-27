/**
 * 向量化模块 — 阿里云百炼 DashScope 千问文本向量模型
 * 调用 qwen3.7-text-embedding（DashScope 原生 text-embedding 接口）
 * 供 pgvector 语义搜索使用。
 */

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || ''
const MODEL = process.env.EMBEDDING_MODEL || 'qwen3.7-text-embedding'
const DIMENSION = Number(process.env.EMBEDDING_DIMENSION || 1024)

const EMBED_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'
const BATCH_SIZE = 10 // 单次请求最多条数（保守取值）

/** 获取当前配置的向量维度（建表时须与此一致） */
export function getEmbeddingDimension(): number {
  return DIMENSION
}

/**
 * 批量向量化文本
 * @param texts 文本数组，内部自动分批
 * @returns 每个文本对应的向量数组（与输入顺序一致）
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!DASHSCOPE_API_KEY) throw new Error('DASHSCOPE_API_KEY not configured')

  const cleaned = texts.map((t) => (t || '').trim()).filter(Boolean)
  const results: number[][] = []

  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE)
    const vecs = await callDashScope(batch)
    results.push(...vecs)
  }

  return results
}

/**
 * 向量化单条文本
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const [vec] = await getEmbeddings([text])
  if (!vec) throw new Error('embedding 返回为空')
  return vec
}

/** 单次调用 DashScope 原生 text-embedding 接口 */
async function callDashScope(texts: string[]): Promise<number[][]> {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: { texts },
      parameters: { dimension: DIMENSION },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`DashScope embedding error: ${res.status} ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  const embeddings: Array<{ text_index: number; embedding: number[] }> =
    data?.output?.embeddings || []

  if (!embeddings.length) throw new Error('DashScope embedding 返回空')

  // 按 text_index 排序，保证与输入顺序一致
  return embeddings
    .sort((a, b) => a.text_index - b.text_index)
    .map((e) => e.embedding)
}
