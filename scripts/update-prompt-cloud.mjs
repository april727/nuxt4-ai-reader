/**
 * 云端 Prompt 顺序调整脚本（写 Supabase）
 *
 * 目标：把 mark-word（云端 key = word_explanation）的「### 当前语境用法」小节
 * 移动到「### 基本释义」小节之前。只做位置调整，不改任何措辞。
 *
 * 设计要点：
 *  - 读取云端**当前激活版本**的原文，只重排小节顺序，再写成一个新版本。
 *    （不会用本地文件覆盖云端，避免把云端其它改动冲掉）
 *  - 若两个小节顺序已经是「当前语境用法」在前，则判定为已完成并跳过（可重复运行）。
 *  - 默认 dry-run，只打印不写库；加 --yes 才真正写入。
 *
 * 用法：
 *   node scripts/update-prompt-cloud.mjs          # 预演：打印前后对比
 *   node scripts/update-prompt-cloud.mjs --yes    # 真正写入新版本
 *
 * 依赖 .env：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（回退 SUPABASE_KEY）
 * 写入逻辑：旧激活版本 is_active=false，插入 version+1 且 is_active=true 的新版本。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const PROMPT_KEY = 'word_explanation'          // 云端 key
const TITLE_CUR = '当前语境用法'                // 要前移的小节
const TITLE_BASIC = '基本释义'                  // 参照小节

const APPLY = process.argv.includes('--yes')

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
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = env.SUPABASE_KEY || ''
const KEY = SERVICE_KEY || ANON_KEY

console.log('========================================')
console.log('云端 mark-word prompt 顺序调整')
console.log('========================================')
console.log(`Supabase : ${SUPABASE_URL || '(未配置)'}`)
console.log(`写入密钥 : ${SERVICE_KEY ? 'service_role（可写）' : ANON_KEY ? 'publishable（大概率被 RLS 拒绝）' : '(未配置)'}`)
console.log(`模式     : ${APPLY ? '写入 (--yes)' : '预演 dry-run'}`)
console.log('')

if (!SUPABASE_URL || !KEY) {
  console.error('错误：SUPABASE_URL 或密钥未配置，检查 .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** 按行首 '### ' 把小节切块；返回 [{title, lines}]，前言块 title=null */
function splitSections(md) {
  const lines = String(md).split('\n')
  const blocks = []
  let cur = { title: null, lines: [] }
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/)
    if (m) {
      blocks.push(cur)
      cur = { title: m[1], lines: [line] }
    } else {
      cur.lines.push(line)
    }
  }
  blocks.push(cur)
  return blocks.filter((b) => b.lines.length > 0)
}

const join = (blocks) => blocks.map((b) => b.lines.join('\n')).join('\n')
const titles = (blocks) => blocks.filter((b) => b.title).map((b) => b.title)

/** 把 titleMove 小节整体移到 titleBefore 小节之前 */
function moveSectionBefore(md, titleMove, titleBefore) {
  const blocks = splitSections(md)
  const iMove = blocks.findIndex((b) => b.title === titleMove)
  const iBefore = blocks.findIndex((b) => b.title === titleBefore)
  if (iMove === -1) return { ok: false, reason: `云端内容里找不到小节「### ${titleMove}」` }
  if (iBefore === -1) return { ok: false, reason: `云端内容里找不到小节「### ${titleBefore}」` }
  if (iMove < iBefore) return { ok: false, already: true, content: md, blocks }
  const [block] = blocks.splice(iMove, 1)
  const target = blocks.findIndex((b) => b.title === titleBefore)
  blocks.splice(target, 0, block)
  return { ok: true, content: join(blocks), blocks }
}

/** 探测 prompt_versions 的外键列名（如 prompt_id） */
function pickForeignKey(sample) {
  const cols = Object.keys(sample || {})
  if (cols.includes('prompt_id')) return 'prompt_id'
  return cols.find((c) => c.endsWith('_id') && c !== 'id') || null
}

async function main() {
  // 1. 找 prompt 行
  const { data: promptRow, error: pErr } = await supabase
    .from('prompts')
    .select('*')
    .eq('key', PROMPT_KEY)
    .maybeSingle()
  if (pErr) throw new Error(`查 prompts 表失败：${pErr.message}`)
  if (!promptRow) throw new Error(`prompts 表里没有 key=${PROMPT_KEY}`)
  const promptId = promptRow.id
  if (promptId === undefined) throw new Error('prompts 行里没有 id 字段，无法关联版本表')

  // 2. 探测版本表结构与外键列
  const { data: sample, error: sErr } = await supabase.from('prompt_versions').select('*').limit(1)
  if (sErr) throw new Error(`查 prompt_versions 表失败：${sErr.message}`)
  const fk = pickForeignKey(Array.isArray(sample) ? sample[0] : sample)
  if (!fk) throw new Error('无法从 prompt_versions 推断外键列（期望 prompt_id）')
  console.log(`prompt.id = ${promptId} | 版本表外键列 = ${fk}`)
  console.log('')

  // 3. 取当前激活版本
  const { data: verRows, error: vErr } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq(fk, promptId)
    .eq('is_active', true)
    .limit(5)
  if (vErr) throw new Error(`查激活版本失败：${vErr.message}`)
  if (!verRows || !verRows.length) throw new Error('没有找到 is_active=true 的版本')
  if (verRows.length > 1) console.warn(`注意：有 ${verRows.length} 个激活版本，取第一条处理`)
  const current = verRows[0]
  const currentContent = current.content || ''

  const curBlocks = splitSections(currentContent)
  console.log('当前版本小节顺序：')
  titles(curBlocks).forEach((t, i) => console.log(`  ${i + 1}. ### ${t}`))
  console.log('')

  // 4. 计算新内容（只搬位置）
  const res = moveSectionBefore(currentContent, TITLE_CUR, TITLE_BASIC)
  if (!res.ok && res.already) {
    console.log(`✓ 顺序已是目标状态（「${TITLE_CUR}」已在「${TITLE_BASIC}」之前），无需修改。`)
    return
  }
  if (!res.ok) throw new Error(res.reason)

  console.log('调整后小节顺序：')
  titles(res.blocks).forEach((t, i) => console.log(`  ${i + 1}. ### ${t}`))
  console.log('')
  console.log('-------- 调整后完整内容 --------')
  console.log(res.content)
  console.log('--------------------------------')
  console.log('')

  if (!APPLY) {
    console.log('预演结束，未写库。确认无误后执行：')
    console.log('  node scripts/update-prompt-cloud.mjs --yes')
    return
  }

  // 5. 计算新版本号（兼容数字 或 v12 形式）
  const rawVer = current.version
  let nextVersion
  if (typeof rawVer === 'number') nextVersion = rawVer + 1
  else {
    const m = String(rawVer ?? '').match(/^(.*?)(\d+)\s*$/)
    nextVersion = m ? `${m[1]}${Number(m[2]) + 1}` : `${rawVer ?? ''}-next`
  }

  // 6. 旧版本下线
  const { error: dErr } = await supabase
    .from('prompt_versions')
    .update({ is_active: false })
    .eq(fk, promptId)
    .eq('is_active', true)
  if (dErr) throw new Error(`停用旧版本失败（可能被 RLS 拒绝，需 service_role）：${dErr.message}`)

  // 7. 插入新版本
  const insertRow = { ...current, content: res.content, version: nextVersion, is_active: true }
  delete insertRow.id
  const { error: iErr } = await supabase.from('prompt_versions').insert(insertRow)
  if (iErr) {
    // 回滚：把旧版本重新激活，尽量不留下"没有激活版本"的空档
    await supabase
      .from('prompt_versions')
      .update({ is_active: true })
      .eq(fk, promptId)
      .eq('version', rawVer)
    throw new Error(`插入新版本失败：${iErr.message}（已尝试回滚旧版本激活状态）`)
  }

  console.log(`✓ 已写入新版本 ${nextVersion}（旧版本 ${rawVer} 已停用）`)
  console.log('提示：应用端每天首次同步一次云端快照；想立刻生效可重启 dev 服务，或等次日。')
}

main().catch((e) => {
  console.error('')
  console.error('✗ 出错：' + (e?.message || e))
  process.exit(1)
})
