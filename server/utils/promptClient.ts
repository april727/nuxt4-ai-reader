/**
 * Prompt 云端读取客户端
 * 直接用 @supabase/supabase-js 连接 Supabase 的 prompts 表读取模板，
 * 不再经过 localhost:3002 管理 UI（那只是编辑工具）。
 *
 * 用 anon/publishable key（公开密钥），prompts 表已对该 key 开放 SELECT。
 *
 * 接口契约：
 *   getPrompt(key, variables?) → { content, rendered, version }
 *   - content:  原始模板（含 {var} 占位符）
 *   - rendered: 变量已替换的完整 prompt（未传 variables 时 = content）
 *   - version:  当前版本号（如 "v12"）
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_KEY || ''

export interface PromptResult {
  content: string
  rendered: string
  version: string | number | null
}

let client: SupabaseClient | null = null

function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return client
}

/** 是否已配置 Supabase（否则调用方应走本地兜底） */
export function isPromptCloudConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY)
}

/**
 * 从 Supabase 读取 prompt 并（可选）替换变量
 *
 * 表结构（join）：
 *   prompts          — key / name / variables 等元数据
 *   prompt_versions  — content / version / is_active（内容与版本在这里）
 * 查询逻辑：按 key 找到 prompt，取 is_active 的版本内容。
 *
 * @param key 管理器里的 prompt key，如 paragraph_analysis
 * @param variables 变量表，替换模板中的 {var} 占位符
 */
export async function getPrompt(
  key: string,
  variables?: Record<string, string>,
): Promise<PromptResult> {
  const c = getClient()
  const empty: PromptResult = { content: '', rendered: '', version: null }
  if (!c) return empty

  try {
    const { data, error } = await c
      .from('prompts')
      .select('key, name, variables, prompt_versions!inner(content, version)')
      .eq('key', key)
      .eq('prompt_versions.is_active', true)
      .maybeSingle()

    if (error || !data) return empty

    // prompt_versions 是嵌套关联：可能为对象或数组，统一取第一条激活版本
    const pv = (data as any).prompt_versions
    const row = Array.isArray(pv) ? pv[0] : pv
    const content = row?.content || ''
    const version = row?.version ?? null

    let rendered = content
    if (variables && content) {
      rendered = content.replace(/\{(\w+)\}/g, (_, k) => variables[k] ?? `{${k}}`)
    }

    return { content, rendered, version }
  } catch {
    return empty
  }
}

/**
 * 单条拉取（严格版）：只查一个 key，出错抛异常，便于接口把错误透给前端。
 * key 不存在时返回空内容（而不是抛错）。
 */
export async function fetchPromptVersion(
  key: string,
): Promise<{ content: string; version: string | number | null }> {
  const c = getClient()
  if (!c) throw new Error('云端 Prompt 未配置（缺少 SUPABASE_URL / SUPABASE_KEY）')

  const { data, error } = await c
    .from('prompts')
    .select('key, prompt_versions!inner(content, version)')
    .eq('key', key)
    .eq('prompt_versions.is_active', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return { content: '', version: null }

  const pv = (data as any).prompt_versions
  const row = Array.isArray(pv) ? pv[0] : pv
  return { content: row?.content || '', version: row?.version ?? null }
}

/**
 * 一次性读取全部激活 Prompt。
 * 只在管理页的批量操作（「拉取有更新的」/「全部获取」）里使用；
 * 平时页面加载与预览都走单条拉取，不再整体下载。
 */
export async function getAllPrompts(): Promise<Record<string, string>> {
  const c = getClient()
  if (!c) return {}

  try {
    const { data, error } = await c
      .from('prompts')
      .select('key, prompt_versions!inner(content, is_active)')
      .eq('prompt_versions.is_active', true)

    if (error || !data) return {}

    const result: Record<string, string> = {}
    for (const row of data as any[]) {
      const pv = row.prompt_versions
      const version = Array.isArray(pv) ? pv[0] : pv
      if (row.key && version?.content) result[row.key] = version.content
    }
    return result
  } catch {
    return {}
  }
}
