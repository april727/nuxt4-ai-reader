/**
 * 按内容指纹串行化的临界区（用于防止并发重复插入）。
 *
 * 场景：客户端在一次上传里可能发出两个内容相同的 POST（历史遗留：emit 一次 +
 * 直接调一次），两个请求几乎同时到达服务端。若「查重 → 插入」之间没有互斥，
 * 两个请求的 SELECT 都会在对方 INSERT 完成前执行 → 都查不到 → 插出两条重复记录。
 *
 * 解法：同一指纹的请求排队执行，后到的那个一定能查到先到者刚插入的记录。
 * 不同指纹之间仍然完全并行，不影响正常吞吐。
 */

/** 指纹 → 正在执行的 Promise 链 */
const chains = new Map<string, Promise<any>>()

/**
 * 在给定指纹的临界区内执行 fn。
 * 同一指纹的调用会串行排队；不同指纹并行。
 */
export function withFingerprintLock<T>(fingerprint: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(fingerprint) || Promise.resolve()
  // 无论前一个成功还是失败，都要继续执行下一个（不能因异常卡死队列）
  const run = prev.then(fn, fn)
  // 只保留链尾，旧的链节点会被自然回收
  const tail = run.then(() => undefined, () => undefined)
  chains.set(fingerprint, tail)

  // 队列排空后清理，避免 Map 无限增长
  tail.then(() => {
    if (chains.get(fingerprint) === tail) chains.delete(fingerprint)
  })

  return run
}
