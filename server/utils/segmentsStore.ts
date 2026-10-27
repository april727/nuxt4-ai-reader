/**
 * texts.segments 的统一写入通道
 *
 * 为什么要专门做一层：
 * segments 是一个 JSON 大字段，所有段落操作（合并 / 插入 / 删除 / 改文本 / 后台重新分段）
 * 都是「读出整份 → 改 → 写回整份」。这类 read-modify-write 一旦并发就会丢更新：
 * 用户快速连点合并时，两个请求会读到同一份旧 segments，各自合并各自的段，
 * 后写的把先写的覆盖掉 —— 表现为段落数量对不上、合并后的段落里内容顺序错乱
 * （例如 A 段跑到 B 段前面），也就是"段落实然乱了"。
 *
 * 这里提供两重保护：
 * 1. 进程内按 textId 串行（withSegmentsLock）——同一篇文档的段落操作排队执行；
 * 2. 写入时带 CAS 条件（WHERE segments = 读取时的那份）——跨进程/跨实例也不会覆盖。
 *    CAS 失败说明期间被别的写入改过，自动重读重试。
 */
import { queryOne, runQueryCount } from './db'

/** 每个 textId 一条串行链 */
const chains = new Map<string, Promise<unknown>>()

export function withSegmentsLock<T>(textId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(textId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const settled = run.then(() => undefined, () => undefined)
  chains.set(textId, settled)
  // 链走到队尾后释放引用，避免长期驻留
  settled.then(() => {
    if (chains.get(textId) === settled) chains.delete(textId)
  })
  return run
}

export interface SegmentMutation {
  /** 变动后的完整段落数组 */
  segments: any[]
  /** 是否真的改了（false 表示无需写库，例如目标段落已不存在） */
  changed: boolean
  /** 需要一起写入的其它列（marks / explanations / paragraphChats） */
  patch?: Record<string, string>
  /** 结构性冲突（例如要合并的两段已不再相邻），由调用方决定如何响应 */
  conflict?: boolean
  /** 附带返回给客户端的信息 */
  meta?: Record<string, any>
}

/** 统一重排 index，保证与数组下标一致 */
export function normalizeSegmentIndexes(segs: any[]): any[] {
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i] || typeof segs[i] !== 'object') continue
    if (segs[i].index !== i) segs[i].index = i
  }
  return segs
}

export interface MutateResult {
  segments: any[]
  changed: boolean
  conflict?: boolean
  meta?: Record<string, any>
}

/**
 * 在锁内对 segments 做一次读改写。
 *
 * mutator 拿到的 segs 是本轮读到的基线；返回 { segments, changed:false } 表示无需落库。
 * CAS 失败会自动重跑 mutator（重试时 mutator 必须是自己能重新判断的幂等逻辑）。
 */
export async function mutateSegments(
  textId: string,
  mutator: (segs: any[], row: any) => SegmentMutation | Promise<SegmentMutation>,
  opts: { retries?: number } = {},
): Promise<MutateResult> {
  const retries = opts.retries ?? 3
  return withSegmentsLock(textId, async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const row = await queryOne(
        'SELECT segments,marks,explanations,paragraphChats,readingPosition FROM texts WHERE id=?',
        [textId],
      )
      if (!row) throw createError({ statusCode: 404, message: '文本不存在' })

      const base = String(row.segments ?? '')
      let segs: any[] = []
      try { segs = JSON.parse(base || '[]') } catch { segs = [] }

      const out = await mutator(segs, row)
      if (out.conflict) {
        return { segments: segs, changed: false, conflict: true, meta: out.meta }
      }
      if (!out.changed) {
        return { segments: segs, changed: false, meta: out.meta }
      }

      const next = normalizeSegmentIndexes(out.segments)
      const cols = ['segments=?', 'updatedAt=?']
      const args: any[] = [JSON.stringify(next), new Date().toISOString()]
      for (const [k, v] of Object.entries(out.patch || {})) {
        cols.push(`${k}=?`)
        args.push(v)
      }
      args.push(textId, base)

      const affected = await runQueryCount(
        `UPDATE texts SET ${cols.join(',')} WHERE id=? AND COALESCE(segments,'')=?`,
        args,
      )
      if (affected > 0) {
        return { segments: next, changed: true, meta: out.meta }
      }
      // 基线已过期（别的写入插进来了）→ 重读后重试
      console.warn(`[segments] ${textId} 写入冲突，第 ${attempt + 1} 次重试`)
    }
    throw createError({ statusCode: 409, message: '段落结构正在被其它操作修改，请稍后重试' })
  })
}
