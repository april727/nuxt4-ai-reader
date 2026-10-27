/**
 * 一次性迁移：Turso 云端全量数据 → 本地 node:sqlite 主库
 *
 * 背景：USE_TURSO=true 期间 reader.db 并没有被使用（所有读写都直连云端），
 * 所以本地文件是过时的。切到本地为主之前，必须先把云端最新数据整份搬下来。
 *
 * 用法：
 *   node server/scripts/migrate-to-nodesqlite.mjs            # 写入 server/data/reader.db.new
 *   node server/scripts/migrate-to-nodesqlite.mjs --write    # 直接替换 reader.db（会先备份旧文件）
 *
 * 分批拉取的原因：单表一次拉回来动辄几十 MB，跨境链路容易中途超时；
 * 按 200 行分页，慢一点但不会整趟白跑。
 */
import { createClient } from '@libsql/client'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, renameSync, unlinkSync, statSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DB_DIR = path.join(ROOT, 'server/data')
const TARGET = process.env.TARGET_DB || path.join(DB_DIR, 'reader.db.new')

/**
 * 分页大小按表自适应。
 * texts 平均每行 220KB（431 行 ≈ 95MB），一页 200 行就是 44MB，
 * 跨境单次请求必超时；按 10 行切，单页约 2MB，稳定可控。
 */
const PAGE_BY_TABLE = { texts: 10, texts_history: 5 }
const DEFAULT_PAGE = 500

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)

function fmt(n) { return n.toLocaleString('en-US') }

async function main() {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) throw new Error('.env 缺少 TURSO_URL / TURSO_AUTH_TOKEN')
  mkdirSync(DB_DIR, { recursive: true })
  if (existsSync(TARGET)) unlinkSync(TARGET)

  const turso = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })
  const db = new DatabaseSync(TARGET)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = OFF')  // 迁移期间关同步，快很多

  const t0 = Date.now()
  const tabsRes = await turso.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name",
  )
  const tables = tabsRes.rows.map(r => String(r[0]))
  console.log(`[migrate] 源表 ${tables.length} 张：${tables.join(', ')}`)

  const summary = []

  for (const table of tables) {
    const tt = Date.now()
    // 用云端的实际列定义建表（含类型与默认值），保证与云端逐字段一致
    const info = await turso.execute(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}')`)
    const cols = info.rows.map(r => ({
      name: String(r[0] ?? r.name),
      type: String(r[1] ?? r.type ?? 'TEXT'),
      notnull: Number(r[2] ?? r.notnull ?? 0),
      dflt: r[3] ?? r.dflt_value ?? null,
      pk: Number(r[4] ?? r.pk ?? 0),
    }))
    if (!cols.length) { console.log(`[migrate] ${table} 无列信息，跳过`); continue }

    const colDefs = cols.map(c => {
      let d = `"${c.name}" ${c.type || 'TEXT'}`
      if (c.pk) d += ' PRIMARY KEY'
      else if (c.notnull) d += ' NOT NULL'
      if (c.dflt !== null && c.dflt !== undefined) d += ` DEFAULT ${c.dflt}`
      return d
    })
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs.join(', ')})`)

    // 索引单独从云端搬（sqlite_master 里的原始 SQL）
    const idxRes = await turso.execute(
      `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND sql IS NOT NULL`,
    )
    for (const r of idxRes.rows) {
      try { db.exec(String(r[0])) } catch { /* 索引名冲突之类的忽略 */ }
    }

    const colNames = cols.map(c => `"${c.name}"`)
    const ph = cols.map(() => '?').join(',')
    const insertSql = `INSERT OR REPLACE INTO "${table}" (${colNames.join(',')}) VALUES (${ph})`
    const ins = db.prepare(insertSql)

    let copied = 0
    let offset = 0
    const PAGE = Number(process.env.PAGE || PAGE_BY_TABLE[table] || DEFAULT_PAGE)
    for (;;) {
      const page = await turso.execute({
        sql: `SELECT ${colNames.join(',')} FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`,
        args: [],
      })
      if (!page.rows.length) break
      db.exec('BEGIN')
      try {
        for (const row of page.rows) {
          const args = []
          for (let i = 0; i < cols.length; i++) {
            const v = row[i]
            args.push(v === undefined ? null : (typeof v === 'bigint' ? Number(v) : v))
          }
          ins.run(...args)
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      copied += page.rows.length
      offset += PAGE
      if (page.rows.length < PAGE) break
    }

    summary.push({ table, rows: copied, ms: Date.now() - tt })
    console.log(`[migrate] ${table.padEnd(18)} ${String(fmt(copied)).padStart(8)} 行  ${((Date.now() - tt) / 1000).toFixed(1)}s`)
  }

  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()

  const size = statSync(TARGET).size
  console.log(`\n[migrate] 完成：${(size / 1024 / 1024).toFixed(1)}MB，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`[migrate] 目标文件：${TARGET}`)

  // 校验：逐表比对行数
  console.log('\n[migrate] 行数校验（云端 vs 本地）：')
  const check = new DatabaseSync(TARGET)
  let allOk = true
  for (const { table } of summary) {
    let remote = 0
    try {
      const r = await turso.execute(`SELECT COUNT(*) FROM "${table}"`)
      remote = Number(r.rows[0][0])
    } catch { /* ignore */ }
    const local = Number(check.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c)
    const ok = remote === local
    if (!ok) allOk = false
    console.log(`  ${ok ? 'OK  ' : 'DIFF'} ${table.padEnd(18)} 云端 ${String(fmt(remote)).padStart(8)} / 本地 ${String(fmt(local)).padStart(8)}`)
  }
  check.close()

  if (process.argv.includes('--write')) {
    const cur = path.join(DB_DIR, 'reader.db')
    if (existsSync(cur)) {
      const bak = path.join(DB_DIR, `reader.db.bak-${new Date().toISOString().slice(0, 10)}`)
      renameSync(cur, bak)
      console.log(`[migrate] 旧库已备份为 ${path.basename(bak)}`)
    }
    renameSync(TARGET, cur)
    console.log('[migrate] 已替换为当前主库 reader.db')
  } else {
    console.log('[migrate] 未加 --write，结果留在 reader.db.new')
  }

  if (!allOk) { console.error('\n[migrate] 有表行数不一致！'); process.exitCode = 2 }
}

main().catch(e => { console.error('[migrate] 失败:', e); process.exit(1) })
