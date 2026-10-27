/**
 * 云端 prompt 读取验证脚本
 * 用 @supabase/supabase-js 直连 Supabase prompts 表，检查 16 个 key 能否读到。
 * 用法：node scripts/verify-prompt-cloud.mjs
 *
 * 可定位的问题：
 *  - 连接失败 → SUPABASE_URL / SUPABASE_KEY 配置问题
 *  - column 不存在 → prompts 表列名与假设不符（key/content/version）
 *  - [缺] → 该 key 在表里不存在（命名可能是下划线/连字符差异）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnv() {
  const env = {}
  try {
    const content = fs.readFileSync(path.join(root, '.env'), 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.SUPABASE_URL || ''
const SUPABASE_KEY = env.SUPABASE_KEY || ''

console.log('========================================')
console.log('云端 prompt 读取验证')
console.log('========================================')
console.log(`Supabase : ${SUPABASE_URL || '(未配置)'}`)
console.log(`Key      : ${SUPABASE_KEY ? SUPABASE_KEY.slice(0, 14) + '...' : '(未配置)'}`)
console.log('')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('错误：SUPABASE_URL 或 SUPABASE_KEY 未配置')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const keys = [
  'paragraph_analysis', 'word_explanation', 'mark_phrase', 'mark_sentence',
  'segment', 'article_summary', 'podcast_extract',
  'translate', 'text-clean', 'flashcard-word', 'flashcard-phrase', 'flashcard-sentence',
  'wordbook-import', 'enrich-pos', 'daily-insight', 'word-cluster',
]

let ok = 0
let missing = 0
let err = 0

for (const key of keys) {
  try {
    const { data, error } = await supabase
      .from('prompts')
      .select('key, name, variables, prompt_versions!inner(content, version)')
      .eq('key', key)
      .eq('prompt_versions.is_active', true)
      .limit(1)
    if (error) {
      console.log(`[ERR] ${key}: ${error.message}`)
      err++
    } else if (data && data.length) {
      const row = data[0]
      const pv = row.prompt_versions
      const ver = Array.isArray(pv) ? pv[0] : pv
      const content = ver?.content || ''
      const version = ver?.version ?? '?'
      console.log(`[OK] ${key} | version=${version} | ${content.length}字 | ${content.slice(0, 24).replace(/\n/g, ' ')}`)
      ok++
    } else {
      console.log(`[缺] ${key}: 表里没有这个 key 或没有激活版本`)
      missing++
    }
  } catch (e) {
    console.log(`[ERR] ${key}: ${e.message}`)
    err++
  }
}

console.log('')
console.log('========================================')
console.log(`结果: ${ok} 可读, ${missing} 缺失, ${err} 错误`)
console.log('========================================')
console.log('')
if (err > 0 && /column|relation/i.test('')) {
  // 占位，实际错误信息已在上面打印
}
console.log('说明:')
console.log('  [OK]   - 该 key 能从云端读到')
console.log('  [缺]   - key 不存在（可能是命名风格差异：连字符 flashcard-word vs 下划线 flashcard_word）')
console.log('  [ERR]  - 查询报错，多半是列名不符，把错误信息发给我')
