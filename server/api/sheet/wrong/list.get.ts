import { listSheetWrong, sheetWrongStats } from '../../../utils/sheetWrong'

/**
 * 试卷错题本列表。
 *
 * `due=0` 用来看「全部错题」（含未到期、已掌握），默认只看今天该复习的。
 * 每次请求都会先做一次标注对账，所以刚标完错题刷新就能看到，不需要额外的同步按钮。
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const dueOnly = String(q.due ?? '1') !== '0'
  const sheetId = q.sheetId ? String(q.sheetId) : undefined
  // 必须先等 list（它内部做标注对账）再统计，并行会让 stats 读到对账前的行数
  const items = await listSheetWrong({ dueOnly, sheetId })
  const stats = await sheetWrongStats()
  return { items, stats, dueOnly }
})
