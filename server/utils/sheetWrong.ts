/**
 * 试卷错题本：把散落在各张试卷里的「错题」标注聚合成一条可复习的队列。
 *
 * 数据来源与真相：
 *   - 错题的**归属**永远是 `texts.annotations` 里 kind='wrong' 的标注；
 *     sheet_wrong 只保存「这道题复习到哪一步」（phase/interval/dueAt…）。
 *   - 因此每次读列表前做一次轻量对账（syncSheetWrong）：新增的标注补进来、
 *     被删掉的标注删掉、改过备注/挪过框的更新坐标。试卷数量很少（几十份），
 *     一次全扫是毫秒级，比维护一套增量钩子可靠得多。
 *   - 调度算法复用 utils/srs.ts 的 applyGrade（与单词/标记同一套），
 *     错题不另立一套间隔规则，否则「今天该复习什么」会出现两套口径。
 */
import { queryAll, queryOne, runQuery } from './db'
import { applyGrade, type Grade, type SrsState } from './srs'

const DDL = `CREATE TABLE IF NOT EXISTS sheet_wrong (
  id TEXT PRIMARY KEY,
  sheetId TEXT NOT NULL,
  pageId TEXT NOT NULL,
  bbox TEXT DEFAULT '{}',
  note TEXT DEFAULT '',
  phase TEXT DEFAULT 'learn',
  learnCorrect INTEGER DEFAULT 0,
  learnTotal INTEGER DEFAULT 0,
  learnWrong INTEGER DEFAULT 0,
  ease REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  reps INTEGER DEFAULT 0,
  dueAt TEXT DEFAULT '',
  lapses INTEGER DEFAULT 0,
  reviewCount INTEGER DEFAULT 0,
  lastResult TEXT DEFAULT '',
  lastReviewedAt TEXT DEFAULT '',
  createdAt TEXT,
  updatedAt TEXT
)`

let ensured = false
/**
 * 懒建表：只在第一次用到错题本时执行。
 *
 * 不塞进 db.ts 的三处建表流程，是因为本地主库是既有文件（node:sqlite 直接打开），
 * 新增表没有统一的迁移入口；而 `IF NOT EXISTS` 的代价只有一次字符串比较。
 */
export async function ensureSheetWrongTable() {
  if (ensured) return
  await runQuery(DDL)
  try { await runQuery('CREATE INDEX IF NOT EXISTS idx_sheet_wrong_due ON sheet_wrong(phase, dueAt)') } catch { /* 索引失败不影响功能 */ }
  ensured = true
}

export interface WrongSyncResult { added: number; removed: number; updated: number }

/** 以标注为准，对账 sheet_wrong（新增/删除/更新坐标备注） */
export async function syncSheetWrong(): Promise<WrongSyncResult> {
  await ensureSheetWrongTable()
  const sheets = await queryAll(
    "SELECT id, annotations FROM texts WHERE contentKind='sheet' AND deletedAt IS NULL",
  )
  const live = new Map<string, { sheetId: string; pageId: string; bbox: string; note: string }>()
  for (const s of sheets) {
    let annos: any[] = []
    try { annos = JSON.parse(s.annotations || '[]') } catch { annos = [] }
    if (!Array.isArray(annos)) continue
    for (const a of annos) {
      if (!a || a.kind !== 'wrong' || !a.id || !a.pageId) continue
      live.set(String(a.id), {
        sheetId: String(s.id),
        pageId: String(a.pageId),
        bbox: JSON.stringify(a.bbox || {}),
        note: String(a.note || ''),
      })
    }
  }

  const existing = await queryAll('SELECT id, sheetId, pageId, bbox, note FROM sheet_wrong')
  const have = new Set<string>()
  let added = 0, removed = 0, updated = 0
  const now = new Date().toISOString()

  for (const row of existing) {
    const id = String(row.id)
    have.add(id)
    const cur = live.get(id)
    if (!cur) {
      await runQuery('DELETE FROM sheet_wrong WHERE id=?', [id])
      removed++
      continue
    }
    if (cur.sheetId !== row.sheetId || cur.pageId !== row.pageId
      || cur.bbox !== String(row.bbox || '') || cur.note !== String(row.note || '')) {
      await runQuery('UPDATE sheet_wrong SET sheetId=?, pageId=?, bbox=?, note=?, updatedAt=? WHERE id=?',
        [cur.sheetId, cur.pageId, cur.bbox, cur.note, now, id])
      updated++
    }
  }

  for (const [id, cur] of live) {
    if (have.has(id)) continue
    // 新错题：dueAt 留空 = 立刻到期（和单词「新词即到期」保持一致）
    await runQuery(
      `INSERT INTO sheet_wrong (id,sheetId,pageId,bbox,note,phase,learnCorrect,learnTotal,learnWrong,ease,interval,reps,dueAt,lapses,reviewCount,lastResult,lastReviewedAt,createdAt,updatedAt)
       VALUES (?,?,?,?,?,'learn',0,0,0,2.5,0,0,'',0,0,'','',?,?)`,
      [id, cur.sheetId, cur.pageId, cur.bbox, cur.note, now, now],
    )
    added++
  }

  return { added, removed, updated }
}

export interface WrongItem {
  id: string
  sheetId: string
  sheetTitle: string
  folder: string
  pageId: string
  pageIndex: number
  pageUrl: string
  pageW: number
  pageH: number
  bbox: { x: number; y: number; w: number; h: number }
  note: string
  phase: string
  interval: number
  dueAt: string
  reviewCount: number
  lapses: number
  createdAt: string
}

/**
 * 列出错题（默认只列到期的）。
 *
 * 一次扫全部试卷的 segments 取页面图地址：试卷页数是「文档级」，同一份卷子
 * 里所有错题共享同一组页面，按 sheetId 缓存解析结果避免重复 JSON.parse。
 */
export async function listSheetWrong(opts: { dueOnly?: boolean; sheetId?: string } = {}): Promise<WrongItem[]> {
  const sync = await syncSheetWrong()
  if (sync.added || sync.removed || sync.updated) {
    console.log(`[sheet-wrong] 对账 +${sync.added} -${sync.removed} ~${sync.updated}`)
  }

  const where: string[] = []
  const args: any[] = []
  if (opts.sheetId) { where.push('w.sheetId=?'); args.push(opts.sheetId) }
  const rows = await queryAll(
    `SELECT w.*, t.title AS sheetTitle, t.folder AS folder
       FROM sheet_wrong w LEFT JOIN texts t ON t.id = w.sheetId
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY w.dueAt ASC`,
    args,
  )

  const pageCache = new Map<string, any[]>()
  const now = Date.now()
  const out: WrongItem[] = []

  for (const r of rows) {
    // 已掌握的不再进日常队列（但列表里仍可查，用 dueOnly=false 时才看得到）
    if (opts.dueOnly !== false) {
      if (r.phase === 'mastered') continue
      if (r.dueAt && Date.parse(r.dueAt) > now) continue
    }

    let pages = pageCache.get(r.sheetId)
    if (!pages) {
      const sheet = await queryOne('SELECT segments FROM texts WHERE id=?', [r.sheetId])
      try { pages = JSON.parse(sheet?.segments || '[]') } catch { pages = [] }
      if (!Array.isArray(pages)) pages = []
      pageCache.set(r.sheetId, pages!)
    }
    const idx = pages!.findIndex((p: any) => p && p.id === r.pageId)
    if (idx < 0) continue // 页面被删掉了，等下一次对账清理
    const page = pages![idx]

    let bbox = { x: 0, y: 0, w: 0, h: 0 }
    try { bbox = JSON.parse(r.bbox || '{}') } catch { /* 保持零框 */ }

    out.push({
      id: String(r.id),
      sheetId: String(r.sheetId),
      sheetTitle: String(r.sheetTitle || '未命名试卷'),
      folder: String(r.folder || 'default'),
      pageId: String(r.pageId),
      pageIndex: idx,
      pageUrl: String(page.url || ''),
      pageW: Number(page.w) || 0,
      pageH: Number(page.h) || 0,
      bbox: {
        x: Number(bbox.x) || 0,
        y: Number(bbox.y) || 0,
        w: Number(bbox.w) || 0,
        h: Number(bbox.h) || 0,
      },
      note: String(r.note || ''),
      phase: String(r.phase || 'learn'),
      interval: Number(r.interval) || 0,
      dueAt: String(r.dueAt || ''),
      reviewCount: Number(r.reviewCount) || 0,
      lapses: Number(r.lapses) || 0,
      createdAt: String(r.createdAt || ''),
    })
  }
  return out
}

/** 评分：走与单词/标记同一套 applyGrade */
export async function gradeSheetWrong(id: string, grade: Grade) {
  await ensureSheetWrongTable()
  const row = await queryOne('SELECT * FROM sheet_wrong WHERE id=?', [id])
  if (!row) throw createError({ statusCode: 404, message: '错题不存在' })

  const state: SrsState = {
    phase: row.phase || 'learn',
    learnCorrect: Number(row.learnCorrect) || 0,
    learnTotal: Number(row.learnTotal) || 0,
    learnWrong: Number(row.learnWrong) || 0,
    ease: Number(row.ease) || 2.5,
    interval: Number(row.interval) || 0,
    repetitions: Number(row.reps) || 0,
    nextReview: String(row.dueAt || ''),
    reviewCount: Number(row.reviewCount) || 0,
    lapses: Number(row.lapses) || 0,
  }
  const next = applyGrade(state, grade)

  await runQuery(
    `UPDATE sheet_wrong SET phase=?, learnCorrect=?, learnTotal=?, learnWrong=?, ease=?, interval=?,
       reps=?, dueAt=?, lapses=?, reviewCount=?, lastResult=?, lastReviewedAt=?, updatedAt=? WHERE id=?`,
    [
      next.phase, next.learnCorrect, next.learnTotal, next.learnWrong, next.ease, next.interval,
      next.repetitions, next.nextReview, next.lapses ?? 0, next.reviewCount ?? 0,
      grade, next.lastReviewedAt || new Date().toISOString(), new Date().toISOString(), id,
    ],
  )

  return {
    id,
    phase: next.phase,
    interval: next.interval,
    dueAt: next.nextReview,
    ease: next.ease,
  }
}

/** 统计：到期数 / 总数 / 已掌握 */
export async function sheetWrongStats() {
  await ensureSheetWrongTable()
  const now = new Date().toISOString()
  const rows = await queryAll('SELECT phase, dueAt FROM sheet_wrong')
  let due = 0, total = rows.length, mastered = 0
  for (const r of rows) {
    if (r.phase === 'mastered') { mastered++; continue }
    if (!r.dueAt || String(r.dueAt) <= now) due++
  }
  return { due, total, mastered, learning: total - mastered }
}
