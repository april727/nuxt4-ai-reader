/**
 * 脚本用的数据库连接层
 *
 * 背景：以前所有脚本都直连 Turso（因为服务端也是 USE_TURSO=true）。
 * 切到「本地为主」之后，服务读写的是本地 reader.db，
 * 脚本还去改 Turso 就会出现「写进去了但接口 404」这种假故障 ——
 * 数据写到了服务看不见的地方。
 *
 * 这里按 .env 的 USE_TURSO 自动选同一个引擎，脚本和服务永远看同一份数据。
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

export const env = (() => {
  const out = {}
  const file = path.join(ROOT, '.env')
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '').trim()
  }
  return out
})()

export const BASE = process.env.TEST_BASE || 'http://localhost:3000'

export const cookie = `auth_token=${(await import('node:crypto')).createHash('sha256').update(env.SITE_PASSWORD || '').digest('hex')}`

const useTurso = env.USE_TURSO === 'true'
const DB_FILE = process.env.LOCAL_DB_PATH || path.join(ROOT, 'server/data/reader.db')

let _turso = null
let _local = null

function turso() {
  if (!_turso) _turso = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })
  return _turso
}

/** 惰性打开本地主库（主库可能正被 dev 服务占用，WAL 下可安全并发读） */
async function ensureLocal() {
  if (_local) return _local
  const { DatabaseSync } = await import('node:sqlite')
  if (!existsSync(DB_FILE)) throw new Error(`本地库不存在: ${DB_FILE}`)
  _local = new DatabaseSync(DB_FILE)
  try { _local.exec('PRAGMA busy_timeout = 5000') } catch { /* ignore */ }
  return _local
}

function normArg(v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

/** 查询多行，返回普通对象数组（与 libsql 的 rows 结构一致） */
export async function q(sql, args = []) {
  if (useTurso) {
    const r = await turso().execute({ sql, args })
    return Array.from(r.rows)
  }
  const db = await ensureLocal()
  const stmt = db.prepare(sql)
  const rows = args.length ? stmt.all(...args.map(normArg)) : stmt.all()
  return Array.from(rows)
}

/** 查询单行 */
export async function q1(sql, args = []) {
  const rows = await q(sql, args)
  return rows[0] || null
}

/** 写操作，返回受影响行数 */
export async function qRun(sql, args = []) {
  if (useTurso) {
    const r = await turso().execute({ sql, args })
    return Number(r.rowsAffected || 0)
  }
  const db = await ensureLocal()
  const stmt = db.prepare(sql)
  const r = args.length ? stmt.run(...args.map(normArg)) : stmt.run()
  return Number(r?.changes || 0)
}

/** 当前脚本操作的引擎，便于日志里说清楚 */
export const engine = useTurso ? 'turso' : 'local'

/** 带鉴权的接口调用 */
export async function api(p, opts = {}) {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`${p} → ${res.status} ${String(text).slice(0, 200)}`)
  return data
}

export function closeAll() {
  try { _local?.close() } catch { /* ignore */ }
  _local = null
}
