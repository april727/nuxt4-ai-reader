import { queryOne, runQuery, deleteRowsFromTurso, runOnTurso } from './db'

// 标记类型 → 默认单词本 ID 映射
export const MARK_TO_BOOK: Record<string, string> = {
  word: 'wb_default',
  phrase: 'wb_phrases',
  sentence: 'wb_sentences',
}

// 从 mark detail 中提取音标、释义、词性
export function extractPhonetic(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/\[PHONETIC\]\s*(\/[^/]+\/)\s*\[\/PHONETIC\]/)
  return m?.[1] || ''
}

export function extractPos(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/\[POS\]\s*(n\.|v\.|adj\.|adv\.|pron\.|prep\.|conj\.|interj\.|art\.|num\.|det\.|modal\.|aux\.|phr\.)\s*\[\/POS\]/i)
  if (m) return m[1].toLowerCase()
  return ''
}

export function extractMeaning(detail: string): string {
  if (!detail) return ''
  // 匹配 "### 基本释义" 之后到下一个 "###" 或标签之间的内容
  const m = detail.match(/###\s*基本释义\s*\n+([\s\S]*?)(?=\n###|\n\[PHONETIC\]|\n\[LEMMA\]|$)/)
  if (!m) return ''
  return m[1]
    .replace(/^[-*]\s*/gm, '')      // 去掉列表符号
    .replace(/^\s*\d+[.、．)]\s*/gm, '') // 去掉有序编号
    .replace(/\*\*/g, '')           // 去掉加粗标记
    .replace(/\n+/g, '；')          // 多行合并为分号分隔
    .trim()
    .slice(0, 120)
}

export function extractLemma(mark: any): string {
  // 优先用 mark 对象本身的 lemma 字段
  if (mark.lemma) return mark.lemma.trim()
  // 兜底从 detail 中解析 [LEMMA] 标签
  const m = (mark.detail || '').match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
  return m?.[1]?.trim() || ''
}

/** 从解析内容里取第一张配图 */
export function extractImage(detail: string): string {
  if (!detail) return ''
  const m = detail.match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/)
  return m?.[1] || ''
}

/**
 * 标记内容指纹：只比对会落库的字段。
 * 用于判断某条标记是否真的发生变化，避免每次保存都重写整张表的标记。
 */
function markSignature(m: any): string {
  return [m.type || '', m.text || '', m.lemma || '', m.detail || '', m.note || '', m.context || '', m.image || '', m.paragraphId || '', m.startOffset ?? '', m.endOffset ?? '', m.createdAt || '', m.deletedAt || ''].join('\u0001')
}

// 同步 marks 独立表（新增/软删除/恢复 + 彻底移除）
async function syncMarksTable(textId: string, title: string, folder: string, oldMarksJson: string, newMarksJson: string) {
  let oldMarks: any[] = []
  let newMarks: any[] = []
  try { oldMarks = oldMarksJson ? JSON.parse(oldMarksJson) : [] } catch {}
  try { newMarks = JSON.parse(newMarksJson) } catch {}

  const oldIds = new Set(oldMarks.map((m: any) => m.id).filter(Boolean))
  const newIds = new Set(newMarks.map((m: any) => m.id).filter(Boolean))

  // 彻底移除：旧有但新数组里没有 → 硬删除（本地 + 云端）
  const removed = oldMarks.filter((m: any) => m.id && !newIds.has(m.id))
  for (const mark of removed) {
    await runQuery('DELETE FROM marks WHERE id=?', [mark.id])
  }
  if (removed.length) await deleteRowsFromTurso('marks', 'id', removed.map((m: any) => m.id))

  if (!newMarks.length) return

  // 只 upsert 真正变化的标记（新增、编辑解释、软删除、恢复）。
  // 原实现每次保存都全量 upsert，Turso 模式下会退化为 N 次串行远程写。
  const oldMap = new Map<string, any>()
  for (const m of oldMarks) if (m?.id) oldMap.set(m.id, m)
  const changed = newMarks.filter((m: any) => {
    if (!m.id) return false
    const prev = oldMap.get(m.id)
    return !prev || markSignature(prev) !== markSignature(m)
  })
  if (!changed.length) return

  const now = new Date().toISOString()
  for (const mark of changed) {
    const lemma = (mark.lemma || '').trim()
    const type = mark.type || 'word'
    const text = (mark.text || '').trim()
    const createdAt = mark.createdAt || now
    const deletedAt = mark.deletedAt || null
    await runQuery(
      'INSERT OR REPLACE INTO marks (id,textId,textTitle,textFolder,type,text,lemma,detail,note,createdAt,deletedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [mark.id, textId, title, folder, type, text, lemma, mark.detail || '', mark.note || '', createdAt, deletedAt]
    )
  }
}

// 同步标记的删除态到 words 表
//
// 三态处理（关键：软删除不能真删词条）：
// - 彻底移除（标记从数组里消失）→ 硬删除词条
// - 软删除（进回收站）        → 归档：置 archivedAt，词条与学习进度原样保留
// - 从回收站恢复             → 取消归档：清空 archivedAt
//
// 旧实现「软删除即删词条」，恢复时会重建一条新 id 的词条，复习进度/熟练度全部丢失。
// 归档后由各查询侧过滤，词条在用户视角等于消失，但数据仍在。

/** 词条定位条件：优先 markId；历史数据（markId 为空）按「本 + 词形」兜底 */
const LOCATE_WORD_SQL = `(markId=? AND markId<>'') OR (markId='' AND bookId=? AND source=? AND LOWER(word)=LOWER(?))`

/** 生成定位参数；note 类型没有默认本映射，此时 bookId 传空串，兜底分支自然不命中 */
function locateArgs(mark: any, textId: string): any[] | null {
  const wordText = extractLemma(mark) || String(mark.text || '').trim()
  if (!wordText) return null
  return [mark.id, MARK_TO_BOOK[mark.type] || '', textId, wordText]
}

async function cleanupDeletedMarks(textId: string, oldMarksJson: string, newMarksJson: string) {
  let oldMarks: any[] = []
  let newMarks: any[] = []
  try { oldMarks = JSON.parse(oldMarksJson) } catch {}
  try { newMarks = JSON.parse(newMarksJson) } catch {}

  const newMap = new Map<string, any>()
  for (const m of newMarks) if (m?.id) newMap.set(m.id, m)

  const removed: any[] = []   // 彻底移除
  const archived: any[] = []  // 新进入回收站
  const restored: any[] = []  // 从回收站恢复
  for (const m of oldMarks) {
    if (!m.id) continue
    const next = newMap.get(m.id)
    if (!next) removed.push(m)
    else if (!m.deletedAt && next.deletedAt) archived.push(m)
    else if (m.deletedAt && !next.deletedAt) restored.push(m)
  }
  if (!removed.length && !archived.length && !restored.length) return

  const now = new Date().toISOString()

  for (const mark of removed) {
    const args = locateArgs(mark, textId)
    if (!args) continue
    await runQuery(`DELETE FROM words WHERE ${LOCATE_WORD_SQL}`, args)
    // 同步删除云端 words，防止被拉回单词本
    await runOnTurso(`DELETE FROM words WHERE ${LOCATE_WORD_SQL}`, args)
  }

  for (const mark of archived) {
    const args = locateArgs(mark, textId)
    if (!args) continue
    // 默认本按「本内同词只留一行」去重：删掉 A 篇的标记时，若同一词在 B 篇仍有有效标记，
    // 默认本那一行不能归档，否则用户会以为这个词消失了。文章本则只代表本篇，直接归档。
    const sql = `UPDATE words SET archivedAt=?, updatedAt=?
      WHERE (${LOCATE_WORD_SQL})
        AND (
          bookId NOT IN ('wb_default','wb_phrases','wb_sentences')
          OR NOT EXISTS (
            SELECT 1 FROM marks m
            WHERE m.deletedAt IS NULL
              AND m.type=?
              AND LOWER(COALESCE(NULLIF(m.lemma,''), m.text)) = LOWER(words.word)
          )
        )`
    const params = [now, now, ...args, mark.type || 'word']
    await runQuery(sql, params)
    await runOnTurso(sql, params)
  }

  for (const mark of restored) {
    const args = locateArgs(mark, textId)
    if (!args) continue
    await runQuery(`UPDATE words SET archivedAt=NULL, updatedAt=? WHERE ${LOCATE_WORD_SQL}`, [now, ...args])
    await runOnTurso(`UPDATE words SET archivedAt=NULL, updatedAt=? WHERE ${LOCATE_WORD_SQL}`, [now, ...args])
  }
}

// 同步标记到单词本：新增词条，并在解析内容变化时补齐既有词条
async function syncMarksToWordbooks(textId: string, oldMarksJson: string, newMarksJson: string, title = '') {
  let oldMarks: any[] = []
  let newMarks: any[] = []
  try { oldMarks = oldMarksJson ? JSON.parse(oldMarksJson) : [] } catch {}
  try { newMarks = JSON.parse(newMarksJson) } catch {}
  if (!newMarks.length) return

  const oldMap = new Map<string, any>()
  for (const m of oldMarks) if (m?.id) oldMap.set(m.id, m)

  // 新增、从回收站恢复、或解析内容发生变化的标记都要处理。
  // 关键点：AI 回填 detail 属于「内容变化」，必须把释义/音标补进已有词条，
  // 否则会在词条创建时抓到一条空的壳。
  const changed = newMarks.filter((m: any) => {
    if (!m.id || m.deletedAt) return false
    const prev = oldMap.get(m.id)
    if (!prev || prev.deletedAt) return true
    return markSignature(prev) !== markSignature(m)
  })
  if (!changed.length) return

  const now = new Date().toISOString()
  // 同一批次里同一单词本只校验一次，减少远程往返
  const knownBooks = new Set<string>()

  // 每篇文章一个专属单词本（与三个默认本并存）
  const articleBook = await ensureArticleBook(textId, title, knownBooks)

  /** 确保默认本存在 */
  async function ensureBook(bookId: string): Promise<boolean> {
    if (knownBooks.has(bookId)) return true
    const wb = await queryOne('SELECT id FROM wordbooks WHERE id=?', [bookId])
    if (!wb) return false
    knownBooks.add(bookId)
    return true
  }

  /** 把一个标记 upsert 到指定单词本（同一本内同词只保留一行） */
  async function upsertMarkWord(bookId: string, mark: any): Promise<void> {
    const lemma = extractLemma(mark)
    const wordText = lemma || String(mark.text).trim()
    const detail = mark.detail || ''
    const phonetic = extractPhonetic(detail)
    const meaning = extractMeaning(detail)
    const pos = extractPos(detail)
    const image = mark.image || extractImage(detail)
    const context = mark.context || ''
    const markType = mark.type || 'word'
    const paragraphId = mark.paragraphId || ''
    const startOffset = Number(mark.startOffset) || 0
    const endOffset = Number(mark.endOffset) || 0
    // 有原词时以原词为主词条，原文作为笔记
    const note = lemma && lemma !== String(mark.text).trim()
      ? `原文: ${String(mark.text).trim()}${mark.note ? '\n' + mark.note : ''}`
      : mark.note || ''

    // 先按 (bookId, markId) 定位 —— markId 在多本书里会重复，不能单独当键；
    // 再按「本 + 词形」兜底，保证同一本内不出现重复词条
    let existing = await queryOne('SELECT * FROM words WHERE bookId=? AND markId=?', [bookId, mark.id])
    let revived = false
    if (!existing) {
      existing = await queryOne('SELECT * FROM words WHERE bookId=? AND LOWER(word)=LOWER(?)', [bookId, wordText])
      // 命中的是「已从单词本移除」的旧词条，且这次是一条新标记 → 复活
      if (existing?.dismissedAt) revived = true
    }

    if (existing) {
      // 同一个标记对应的词条被用户主动移除（墓碑）→ 不再更新，避免"复活"
      if (existing.dismissedAt && !revived) return

      const patch: Record<string, any> = {}
      if (existing.markId !== mark.id) patch.markId = mark.id
      if (revived) patch.dismissedAt = ''
      // 命中的是「曾在回收站里归档过」的词条，而这次是一条有效标记 → 取消归档
      // （同一词在另一篇重新标记时，按词形兜底会命中已归档的旧行）
      if (existing.archivedAt) patch.archivedAt = null
      if (detail && existing.detail !== detail) patch.detail = detail
      if (context && existing.context !== context) patch.context = context
      if (image && existing.image !== image) patch.image = image
      if (markType && existing.type !== markType) patch.type = markType
      if (paragraphId && existing.paragraphId !== paragraphId) patch.paragraphId = paragraphId
      if (existing.startOffset !== startOffset) patch.startOffset = startOffset
      if (existing.endOffset !== endOffset) patch.endOffset = endOffset
      // 只补空字段，绝不覆盖用户手工编辑过的内容与学习进度
      if (!existing.phonetic && phonetic) patch.phonetic = phonetic
      if (!existing.meaning && meaning) patch.meaning = meaning
      if (!existing.pos && pos) patch.pos = pos
      if (!existing.note && note) patch.note = note

      const keys = Object.keys(patch)
      if (keys.length) {
        await runQuery(
          `UPDATE words SET ${keys.map(k => `${k}=?`).join(',')},updatedAt=? WHERE id=?`,
          [...keys.map(k => patch[k]), now, existing.id],
        )
      }
      return
    }

    const wordId = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await runQuery(
      `INSERT INTO words (id,bookId,word,phonetic,meaning,pos,note,source,markId,detail,context,image,type,paragraphId,startOffset,endOffset,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [wordId, bookId, wordText, phonetic, meaning, pos, note, textId, mark.id, detail, context, image, markType, paragraphId, startOffset, endOffset, now, now]
    )
  }

  for (const mark of changed) {
    const globalBook = MARK_TO_BOOK[mark.type]
    if (!mark.text?.trim()) continue
    const targets: string[] = []
    // 默认本（按类型汇总）：note 类型按设计不进
    if (globalBook && await ensureBook(globalBook)) targets.push(globalBook)
    // 文章专属本：note 也收，便于回看本篇笔记
    if (articleBook) targets.push(articleBook)
    for (const bookId of targets) await upsertMarkWord(bookId, mark)
  }
}

/** 文章专属单词本的 id 规则 */
export function articleBookIdOf(textId: string): string {
  return `wb_t_${textId}`
}

/** 懒创建文章专属单词本；创建失败返回 null（不阻断主流程） */
export async function ensureArticleBook(
  textId: string,
  title: string,
  knownBooks?: Set<string>,
): Promise<string | null> {
  if (!textId) return null
  const id = articleBookIdOf(textId)
  if (knownBooks?.has(id)) return id
  try {
    const found = await queryOne('SELECT id FROM wordbooks WHERE id=?', [id])
    if (!found) {
      const name = (title || '未命名文章').trim().slice(0, 40)
      await runQuery(
        'INSERT INTO wordbooks (id,name,isDefault,sortOrder,createdAt) VALUES (?,?,0,?,?)',
        [id, name, 1000, new Date().toISOString()],
      )
    }
    knownBooks?.add(id)
    return id
  } catch {
    return null
  }
}

/** 标记变更后统一同步（marks 独立表 + 单词本 + 单词清理） */
export async function syncMarks(textId: string, title: string, folder: string, oldMarksJson: string, newMarksJson: string) {
  await syncMarksTable(textId, title, folder, oldMarksJson, newMarksJson)
  await syncMarksToWordbooks(textId, oldMarksJson, newMarksJson, title)
  await cleanupDeletedMarks(textId, oldMarksJson, newMarksJson)
}
