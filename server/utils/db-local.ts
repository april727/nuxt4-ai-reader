/**
 * 本地主库（node:sqlite）
 *
 * 为什么不用 sql.js：
 *   sql.js 是 WASM 内存库，整个 95MB 数据库常驻堆内存，
 *   每次落盘都要 `db.export()` 全量序列化 95MB 再整体覆写文件 ——
 *   一次保存几百毫秒，而且写放大严重。
 *
 *   换成 node:sqlite 后：真·文件型 SQLite + WAL，单行写入是微秒级，
 *   写多少改多少，不再有全量 dump。
 *
 * 这里只暴露四个原语（all/get/run/exec），
 * 上层 db.ts 的 queryAll / queryOne / runQuery / runQueryCount 全部走它。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * node:sqlite 是 Node 22 才有的内置模块，@types/node@20 没有类型声明。
 * 用 createRequire 取，既绕过类型检查，也让 Nitro 原样保留这个 require
 * （内置模块不需要被 bundle）。
 */
const nodeRequire = createRequire(import.meta.url)

let DatabaseSyncCtor: any = null
/** node:sqlite 是否可用（Node < 22 时为 false，上层回退 sql.js） */
export function hasNodeSqlite(): boolean {
  if (DatabaseSyncCtor) return true
  try {
    const mod = nodeRequire('node:sqlite')
    if (typeof mod?.DatabaseSync === 'function') {
      DatabaseSyncCtor = mod.DatabaseSync
      return true
    }
  } catch { /* 老版本 Node 没有这个模块 */ }
  return false
}

// ── 参数归一化 ──────────────────────────────────────────────
/**
 * node:sqlite 的绑定比 sql.js 严格：undefined 和 boolean 会直接抛错
 * （`Provided value cannot be bound to SQLite parameter 2.`）。
 * 上层代码里 `params` 混入 undefined / true / false 太常见，
 * 统一在这里转成 null / 0 / 1，避免每个调用点都要自己防。
 */
function norm(v: any): any {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.toISOString()
  if (v === null) return null
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v
  return String(v)
}

function normParams(params?: any[]): any[] {
  if (!params || !params.length) return []
  const out = new Array(params.length)
  for (let i = 0; i < params.length; i++) out[i] = norm(params[i])
  return out
}

/** node:sqlite 返回的是 null-prototype 对象，转成普通对象免得序列化/展开出问题 */
function plain<T = any>(row: any): T {
  if (!row) return row
  return { ...row } as T
}

class LocalDb {
  private db: any
  readonly file: string
  /** 预编译语句缓存：同一条 SQL 反复执行时省掉语法分析，热点路径提速明显 */
  private stmts = new Map<string, any>()
  private static readonly STMT_CACHE_MAX = 400

  constructor(file: string) {
    this.file = file
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSyncCtor(file)

    // WAL：读写不互相阻塞，且写入只追加日志，不需要每次 rewrite 整库
    this.db.exec('PRAGMA journal_mode = WAL')
    // NORMAL：WAL 下不会 fsync 每个事务，掉电最多丢最后一个事务 —— 本地自用完全够
    this.db.exec('PRAGMA synchronous = NORMAL')
    // 256MB 页缓存（负数 = KB 单位）
    this.db.exec('PRAGMA cache_size = -262144')
    // 256MB 内存映射：读页面不进 memcpy，直接映射文件
    this.db.exec('PRAGMA mmap_size = 268435456')
    // 临时表/排序放内存
    this.db.exec('PRAGMA temp_store = MEMORY')
    // 排序/比较按二进制做，别开 locale（更快且与 sql.js 行为一致）
    this.db.exec('PRAGMA case_sensitive_like = OFF')
  }

  private stmt(sql: string): any {
    let s = this.stmts.get(sql)
    if (s) return s
    s = this.db.prepare(sql)
    if (this.stmts.size >= LocalDb.STMT_CACHE_MAX) this.stmts.clear()
    this.stmts.set(sql, s)
    return s
  }

  all(sql: string, params?: any[]): any[] {
    const p = normParams(params)
    const rows = p.length ? this.stmt(sql).all(...p) : this.stmt(sql).all()
    const out = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) out[i] = plain(rows[i])
    return out
  }

  get(sql: string, params?: any[]): any | null {
    const p = normParams(params)
    const row = p.length ? this.stmt(sql).get(...p) : this.stmt(sql).get()
    return row ? plain(row) : null
  }

  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
    const p = normParams(params)
    const r = p.length ? this.stmt(sql).run(...p) : this.stmt(sql).run()
    return {
      changes: Number(r?.changes ?? 0),
      lastInsertRowid: Number(r?.lastInsertRowid ?? 0),
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /**
   * 把 WAL 内容合并回主库文件。
   * 需要「让外部工具（sql.js / 备份脚本）看到完整数据」时调用。
   */
  checkpoint(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 有人正在读时可能失败，忽略 */ }
  }

  /**
   * 导出整库快照（等价于 sql.js 的 export）。
   * VACUUM INTO 生成的是一个已整理、可直接被 sql.js 打开的独立文件。
   */
  exportTo(target: string): void {
    try { if (existsSync(target)) nodeRequire('node:fs').unlinkSync(target) } catch { /* ignore */ }
    const escaped = target.replace(/\\/g, '/').replace(/'/g, "''")
    this.db.exec(`VACUUM INTO '${escaped}'`)
  }

  /** 预编译一批写操作，减少重复解析（大批量插入时用） */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      throw e
    }
  }

  close(): void {
    try { this.stmts.clear(); this.db.close() } catch { /* ignore */ }
  }
}

let local: LocalDb | null = null
let initPromise: Promise<LocalDb | null> | null = null

/** 本地主库默认路径：server/data/reader.db（标准 SQLite 文件，备份脚本可直接读） */
export function localDbPath(): string {
  return process.env['LOCAL_DB_PATH'] || path.resolve('server/data/reader.db')
}

export async function getLocalDb(): Promise<LocalDb | null> {
  if (local) return local
  if (initPromise) return initPromise
  initPromise = Promise.resolve().then(() => {
    if (!hasNodeSqlite()) {
      console.warn('[db-local] 当前 Node 不支持 node:sqlite，回退 sql.js')
      return null
    }
    const t0 = Date.now()
    local = new LocalDb(localDbPath())
    console.log(`[db-local] 本地主库就绪 ${localDbPath()} (${Date.now() - t0}ms)`)
    return local
  })
  return initPromise
}

export function closeLocalDb() {
  if (local) { local.close(); local = null; initPromise = null }
}

// ── sql.js 兼容适配器 ───────────────────────────────────────
/**
 * sync-from-turso.ts / sync-turso.ts 原本按 sql.js 的
 * `prepare → bind → step → getAsObject → free` 写。
 * 这里包一层，让它们能直接操本地主库，而不是「读出整库 → 组装 → 覆写文件」
 * （WAL 模式下覆写文件会直接破坏主库）。
 */
export function asSqljsCompat(db: LocalDb) {
  return {
    run(sql: string, params?: any[]) { db.run(sql, params) },
    exec(sql: string) { db.exec(sql) },
    prepare(sql: string) {
      // sql.js 的 stmt 是游标语义，这里用「一次取全 + 手动步进」模拟
      let rows: any[] | null = null
      let idx = -1
      let bound: any[] | undefined
      return {
        bind(params?: any[]) {
          bound = params
          rows = null
          idx = -1
        },
        step(): boolean {
          if (rows === null) rows = db.all(sql, bound)
          idx++
          return idx < rows.length
        },
        getAsObject(): any {
          return (rows && rows[idx]) || {}
        },
        run(params?: any[]) {
          db.run(sql, params)
        },
        free() { /* no-op */ },
      }
    },
    export() {
      // 兼容需要 Uint8Array 的调用方：先落临时快照再读回来
      const fs = nodeRequire('node:fs')
      const tmp = path.join(path.dirname(db.file), `.export-${Date.now()}.db`)
      try {
        db.exportTo(tmp)
        return new Uint8Array(fs.readFileSync(tmp))
      } finally {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      }
    },
    close() { /* 主库句柄由 db.ts 统一管理，这里不关 */ },
  }
}

export type LocalDbHandle = LocalDb
