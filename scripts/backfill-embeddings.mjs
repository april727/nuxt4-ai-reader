/**
 * 向量回填脚本
 * 遍历本地 reader.db（sql.js），把两类内容向量化写入 Supabase pgvector：
 *   1. marks 表 → marks_embeddings（标记内容，去重 + 标记次数）
 *   2. texts 表段落 → article_embeddings（文章段落文字）
 * 解释内容（marks.detail 等）不向量化。
 *
 * 用法：
 *   node scripts/backfill-embeddings.mjs            # 全量
 *   node scripts/backfill-embeddings.mjs --limit 30 # 只跑前 30 条（测试用）
 *
 * 特性：upsert 写入（基于唯一键），可重复执行，断点续跑。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// ── 读取 .env ──
function loadEnv() {
  const env = {}
  try {
    const content = fs.readFileSync(path.join(root, '.env'), 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !line.trim().startsWith('#')) {
        env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* 忽略 */ }
  return env
}

const env = loadEnv()
const DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY || ''
const EMBEDDING_MODEL = env.EMBEDDING_MODEL || 'qwen3.7-text-embedding'
const EMBEDDING_DIMENSION = Number(env.EMBEDDING_DIMENSION || 1024)
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const DB_PATH = path.join(root, 'server', 'data', 'reader.db')

const EMBED_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'
const BATCH_SIZE = 10

// ── 命令行参数 ──
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

// ── 配置校验 ──
if (!DASHSCOPE_API_KEY) { console.error('错误：DASHSCOPE_API_KEY 未配置'); process.exit(1) }
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('错误：SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 未配置'); process.exit(1) }
if (!fs.existsSync(DB_PATH)) { console.error(`错误：找不到本地数据库 ${DB_PATH}`); process.exit(1) }

// ── DashScope 向量化 ──
async function getEmbeddings(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: { texts },
      parameters: { dimension: EMBEDDING_DIMENSION },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`DashScope error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data?.output?.embeddings || [])
    .sort((a, b) => a.text_index - b.text_index)
    .map((e) => e.embedding)
}

// ── Supabase upsert ──
// 必须显式指定 on_conflict 列，否则 PostgREST 默认按主键 id 冲突处理，
// 而我们的行不带 id，导致 text_key 已存在时报 409 而非更新。
const CONFLICT_COLS = {
  'marks_embeddings': 'text_key',
  'article_embeddings': 'text_id,paragraph_index',
  'word_embeddings': 'word',
}

async function upsertRows(table, rows) {
  const onConflict = CONFLICT_COLS[table]
  const url = `${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ${table} 写入失败 ${res.status}: ${body.slice(0, 200)}`)
  }
}

// ── 处理一批文本 → 向量 → 写入 ──
async function processBatch(table, rows, label) {
  const texts = rows.map((r) => r.content)
  try {
    const vecs = await getEmbeddings(texts)
    const payload = rows.map((r, idx) => ({
      ...r.data,
      embedding: vecs[idx],
    }))
    await upsertRows(table, payload)
  } catch (e) {
    console.error(`  [失败] ${label}: ${e.message}`)
  }
  // 轻微延时，避免触发 DashScope 限流
  await new Promise((r) => setTimeout(r, 120))
  return rows.length
}

// ── 主流程 ──
console.log('========================================')
console.log('向量回填脚本')
console.log('========================================')
console.log(`数据库    : ${DB_PATH}`)
console.log(`模型      : ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSION}维)`)
console.log(`Supabase  : ${SUPABASE_URL}`)
console.log(`测试模式  : ${LIMIT === Infinity ? '全量' : `仅前 ${LIMIT} 条`}`)
console.log('')

const initSqlJs = (await import('sql.js')).default
const SQL = await initSqlJs()
const db = new SQL.Database(fs.readFileSync(DB_PATH))

// ═══ 阶段 1：标记内容 → marks_embeddings ═══
console.log('阶段 1: 标记内容 → marks_embeddings')
const markStmt = db.prepare(`
  SELECT LOWER(TRIM(text)) as text_key,
         MAX(TRIM(text)) as display_text,
         MAX(type) as type,
         COUNT(*) as mark_count
  FROM marks
  WHERE text IS NOT NULL AND TRIM(text) != ''
  GROUP BY LOWER(TRIM(text))
`)
const marks = []
while (markStmt.step()) {
  const r = markStmt.getAsObject()
  marks.push({
    text_key: r.text_key,
    display_text: r.display_text,
    type: r.type || 'word',
    mark_count: Number(r.mark_count) || 1,
  })
}
markStmt.free()
console.log(`  共 ${marks.length} 条唯一标记内容`)

let done1 = 0
const markTotal = Math.min(marks.length, LIMIT)
for (let i = 0; i < markTotal; i += BATCH_SIZE) {
  const batch = marks.slice(i, i + BATCH_SIZE)
  await processBatch(
    'marks_embeddings',
    batch.map((m) => ({ content: m.display_text, data: { text_key: m.text_key, display_text: m.display_text, type: m.type, mark_count: m.mark_count } })),
    'marks',
  )
  done1 += batch.length
  console.log(`  进度 ${Math.min(done1, markTotal)}/${markTotal}`)
}

// ═══ 阶段 2：文章段落 → article_embeddings ═══
console.log('')
console.log('阶段 2: 文章段落 → article_embeddings')
const textStmt = db.prepare(`
  SELECT id, segments FROM texts
  WHERE segments IS NOT NULL AND segments != '' AND segments != '[]'
`)
const paragraphs = []
let paraIndexCounter = 0
while (textStmt.step()) {
  const r = textStmt.getAsObject()
  let segments = []
  try { segments = JSON.parse(r.segments) } catch { continue }
  for (const seg of segments) {
    const content = (seg?.text || '').trim()
    if (!content) continue
    const idx = typeof seg?.index === 'number' ? seg.index : paraIndexCounter++
    paragraphs.push({ text_id: r.id, paragraph_index: idx, content })
  }
}
textStmt.free()
console.log(`  共 ${paragraphs.length} 个段落`)

let done2 = 0
const paraTotal = Math.min(paragraphs.length, LIMIT)
for (let i = 0; i < paraTotal; i += BATCH_SIZE) {
  const batch = paragraphs.slice(i, i + BATCH_SIZE)
  await processBatch(
    'article_embeddings',
    batch.map((p) => ({ content: p.content, data: { text_id: p.text_id, paragraph_index: p.paragraph_index, content: p.content } })),
    'texts',
  )
  done2 += batch.length
  console.log(`  进度 ${Math.min(done2, paraTotal)}/${paraTotal}`)
}

console.log('')
console.log('========================================')
console.log('回填完成！可在 Supabase Table Editor 查看 marks_embeddings / article_embeddings')
console.log('========================================')
