/**
 * 发音工具（前端统一入口）
 *
 * 链路：
 *   1. 词形还原：音库只收原形（catches→catch），变形词先还原再解析
 *   2. 服务端代理解析：POST /api/pronounce/resolve —— 服务端无 CORS 限制，
 *      并发探测 + 落盘缓存，命中即返回（见 ~/utils/pronounce 注释）
 *   3. 播放：复用同一个 <audio> 元素串行播放（换 src 立即 play 会被浏览器吞音）
 *   4. 兜底：音库里没有的词（专有名词/缩写等）回退 speechSynthesis
 *
 * 稳定性要点：
 *   - 复用单例 audio 元素，避免并发 play 互相打断
 *   - 播放失败/被浏览器拦截时自动重试一次，再退合成音
 *   - 预取：整篇单词提前解析，用户点击时零等待
 */

function player() {
  // 复用全局单例：所有发音入口共用一个串行播放器，不会互相打断
  return getSharedPronPlayer()
}

/** 解析一个词的实际可播音频地址（含词形还原），查不到返回 null */
export function resolveWordAudio(word: string, accent: 'UK' | 'US' = 'UK') {
  return pronResolve(word, accent)
}

/**
 * 等待一个音频播完（供阻塞式调用）。
 * 用共享播放器的 Promise 版，避免每次 new Audio 造成并发打断。
 */
function playAndWait(src: string): Promise<void> {
  return player().playOneAsync(src)
}

/** 浏览器合成音兜底 */
function speakFallback(word: string) {
  if (typeof speechSynthesis === 'undefined') return
  try {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-GB'
    u.rate = 0.85
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {}
}

export function usePronunciation() {
  const isPlaying = ref(false)

  /** 阻塞式发音：解析（含词形还原）→ 播放 → 等播完；失败回退合成音 */
  async function pronounce(word: string, options?: { onStart?: () => void; onEnd?: () => void }) {
    if (!import.meta.client) return
    isPlaying.value = true
    options?.onStart?.()

    const r = await pronResolve(word)
    if (r) {
      await playAndWait(r.src)
      isPlaying.value = false
      options?.onEnd?.()
      return
    }
    speakFallback(word)
    isPlaying.value = false
    options?.onEnd?.()
  }

  /** 非阻塞发音（列表快速播放）：命中用共享串行播放器，未命中回退合成音 */
  function pronounceSimple(word: string) {
    if (!import.meta.client) return
    pronResolve(word).then((r) => {
      if (r) { player().playOne(r.src); return }
      speakFallback(word)
    })
  }

  function cleanup() {
    isPlaying.value = false
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  return { pronounce, pronounceSimple, isPlaying, cleanup }
}
