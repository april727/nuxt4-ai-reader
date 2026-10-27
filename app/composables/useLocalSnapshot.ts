/**
 * 首屏快照缓存（localStorage）
 *
 * 问题：书架/侧栏用的是 `server: false` 的 useAsyncData，
 * 刷新页面后 Nuxt payload 里没有数据，`getCachedData` 无从命中，
 * 于是每次刷新都要等一次接口往返 —— 哪怕接口只要 20ms，也一定有白屏。
 *
 * 做法：把上次的列表落 localStorage，在 useAsyncData 之前同步塞回 payload，
 * 首屏直接渲染上次的内容，接口回来后无缝替换。
 * 本地为主之后数据只会比快照新，短暂不一致完全可接受（且用户看不到）。
 */

const PREFIX = 'yr-snap:'
/** 超过这个时间的快照不再用于首屏（避免拿几个月前的列表闪一下） */
const MAX_AGE = 30 * 24 * 60 * 60 * 1000
const MAX_BYTES = 3 * 1024 * 1024

function readRaw(key: string): any | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const box = JSON.parse(raw)
    if (!box || typeof box !== 'object') return undefined
    if (typeof box.at === 'number' && Date.now() - box.at > MAX_AGE) {
      window.localStorage.removeItem(PREFIX + key)
      return undefined
    }
    return box.data
  } catch {
    return undefined
  }
}

export function saveSnapshot(key: string, data: any) {
  if (typeof window === 'undefined') return
  if (data === undefined || data === null) return
  try {
    const raw = JSON.stringify({ at: Date.now(), data })
    if (raw.length > MAX_BYTES) return
    window.localStorage.setItem(PREFIX + key, raw)
  } catch {
    // 配额满：清掉旧快照重试一次，仍失败就放弃（不影响功能）
    try {
      clearSnapshots()
      window.localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }))
    } catch { /* ignore */ }
  }
}

export function clearSnapshots() {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    for (const k of keys) window.localStorage.removeItem(k)
  } catch { /* ignore */ }
}

/**
 * 作废单个快照。
 *
 * 用于「一次操作同时影响两个列表」的场景（移动文章会改掉源文件夹和目标文件夹
 * 两边的列表）。只靠接口返回后写回新快照不够稳妥：只要中间任何一步失败，
 * 旧快照就会留下来，下次首屏又把旧列表端出来 —— 表现为「移走了但原位还在」。
 */
export function forgetSnapshot(key: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
}

/**
 * 在首次 useAsyncData 之前调用：把 localStorage 里的快照灌进 Nuxt payload，
 * 这样 getCachedData 立刻命中，组件首帧就有数据。
 *
 * @param keys 需要预热的缓存键；不传则预热全部已知前缀
 */
export function primeSnapshots(nuxtApp: any, keys: string[]) {
  if (typeof window === 'undefined') return
  const bag = nuxtApp?.payload?.data as Record<string, any> | undefined
  if (!bag) return
  for (const key of keys) {
    if (bag[key] !== undefined) continue
    const v = readRaw(key)
    if (v !== undefined) bag[key] = v
  }
}

/** 读取单个快照（用于 ref 初值） */
export function readSnapshot<T>(key: string): T | undefined {
  return readRaw(key) as T | undefined
}
