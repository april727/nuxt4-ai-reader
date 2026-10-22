/**
 * Supabase REST 查询工具（pgvector 向量库）
 * 用 fetch 直接调 PostgREST，避免引入 @supabase/supabase-js 依赖。
 * 仅服务端使用，携带 service_role key。
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY)
}

/**
 * 通用 REST 查询
 * @param table 表名，如 marks_embeddings
 * @param params PostgREST 参数：select/order/limit/type=eq.word 等
 */
export async function supabaseQuery<T = any>(
  table: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置')
  }
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ${table} 查询失败 ${res.status}: ${body.slice(0, 150)}`)
  }
  return res.json()
}

/**
 * 写入（upsert，基于 on_conflict 唯一键）
 */
export async function supabaseUpsert<T = any>(
  table: string,
  rows: any[],
  onConflict: string,
): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置')
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
    {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ${table} 写入失败 ${res.status}: ${body.slice(0, 150)}`)
  }
  return res.json()
}
