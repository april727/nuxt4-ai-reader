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

// 同步已删除/软删除的标记：从 words 表中删除对应单词
async function cleanupDeletedMarks(textId: string, oldMarksJson: string, newMarksJson: string) {
  let oldMarks: any[] = []
  let newMarks: any[] = []
  try { oldMarks = JSON.parse(oldMarksJson) } catch {}
  try { newMarks = JSON.parse(newMarksJson) } catch {}

  const newIds = new Set(newMarks.map((m: any) => m.id).filter(Boolean))
  // 彻底移除的 + 软删除的（deletedAt 非空）
  const deleted = oldMarks.filter((m: any) => m.id && (!newIds.has(m.id) || newMarks.find((n: any) => n.id === m.id)?.deletedAt))
  if (!deleted.length) return

  for (const mark of deleted) {
    const lemma = extractLemma(mark)
    const wordText = lemma || (mark.text || '').trim()
    if (!wordText) continue
    const bookId = MARK_TO_BOOK[mark.type]
    if (!bookId) continue
    // 以 markId 为准删除；历史数据（markId 为空）按词形兜底
    await runQuery(
      `DELETE FROM words WHERE (markId=? AND markId<>'') OR (markId='' AND bookId=? AND source=? AND LOWER(word)=LOWER(?))`,
      [mark.id, bookId, textId, wordText],
    )
    // 同步删除云端 words，防止被拉回单词本
    await runOnTurso(
      `DELETE FROM words WHERE (markId=? AND markId<>'') OR (markId='' AND bookId=? AND source=? AND LOWER(word)=LOWER(?))`,
      [mark.id, bookId, textId, wordText],
    )
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
