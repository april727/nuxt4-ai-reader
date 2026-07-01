/**
 * 发音工具 — 优先使用音频 API，fallback 到 speechSynthesis
 * 移动端优化：选择高质量语音、处理自动播放限制
 */

const PRONUNCIATION_BASE = 'https://audio.beingfine.cn/speeches/UK/UK-speech'

let cachedVoices: SpeechSynthesisVoice[] | null = null
let voicesLoaded = false

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!import.meta.client || typeof speechSynthesis === 'undefined') return Promise.resolve([])
  if (voicesLoaded && cachedVoices) return Promise.resolve(cachedVoices)

  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices()
    if (voices.length > 0) {
      cachedVoices = voices
      voicesLoaded = true
      resolve(voices)
      return
    }
    // iOS Safari 等需要异步加载
    speechSynthesis.onvoiceschanged = () => {
      cachedVoices = speechSynthesis.getVoices()
      voicesLoaded = true
      resolve(cachedVoices)
    }
    // 超时保护
    setTimeout(() => {
      if (!voicesLoaded) {
        cachedVoices = []
        voicesLoaded = true
        resolve([])
      }
    }, 3000)
  })
}

function pickBestVoice(lang: string): SpeechSynthesisVoice | null {
  if (!cachedVoices || cachedVoices.length === 0) return null

  // 优先级：
  // 1. 母语语音 + 精确匹配 (en-GB / en-US)
  // 2. 母语语音 + 前缀匹配 (en)
  // 3. 任意匹配
  const exact = cachedVoices.filter(v => v.lang === lang && v.localService)
  if (exact.length > 0) {
    // 优先选 named voice（非默认机械音）
    const named = exact.find(v => !v.name.toLowerCase().includes('default') && v.name.length > 3)
    return named || exact[0]
  }

  const prefixed = cachedVoices.filter(v => v.lang.startsWith('en') && v.localService)
  if (prefixed.length > 0) {
    const named = prefixed.find(v => !v.name.toLowerCase().includes('default') && v.name.length > 3)
    return named || prefixed[0]
  }

  const anyEn = cachedVoices.filter(v => v.lang.startsWith('en'))
  return anyEn.length > 0 ? anyEn[0] : null
}

export function usePronunciation() {
  let playTimer: ReturnType<typeof setTimeout> | null = null
  const isPlaying = ref(false)

  function getPronunciationUrl(word: string): string {
    const clean = word.replace(/[^a-zA-ZÀ-ÿ'-]/g, '').toLowerCase()
    return `${PRONUNCIATION_BASE}/${clean}.mp3`
  }

  /** 发音：优先音频 API，失败则用 speechSynthesis */
  async function pronounce(word: string, options?: { onStart?: () => void; onEnd?: () => void }) {
    if (!import.meta.client) return

    // 清除之前的计时器
    if (playTimer) { clearTimeout(playTimer); playTimer = null }
    isPlaying.value = true
    options?.onStart?.()

    const clean = word.replace(/[^a-zA-ZÀ-ÿ'-]/g, '').toLowerCase()
    if (!clean) {
      isPlaying.value = false
      options?.onEnd?.()
      return
    }

    // 方式 1：音频 URL
    let audioWorked = false
    try {
      const url = getPronunciationUrl(word)
      const audio = new Audio(url)
      audio.preload = 'auto'
      // 等待音频可播放
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 4000)
        audio.oncanplaythrough = () => { clearTimeout(timeout); resolve() }
        audio.onerror = () => { clearTimeout(timeout); reject(new Error('load error')) }
        audio.load()
      })
      await audio.play()
      audioWorked = true
      // 等待播放结束
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        setTimeout(() => resolve(), 5000)
      })
    } catch {
      // 音频失败 — 回退到 speechSynthesis
    }

    // 方式 2：speechSynthesis 回退
    if (!audioWorked && typeof speechSynthesis !== 'undefined') {
      try {
        await loadVoices()
        const voice = pickBestVoice('en-GB')
        const utterance = new SpeechSynthesisUtterance(word)
        utterance.lang = voice ? voice.lang : 'en-GB'
        utterance.rate = 0.85
        utterance.volume = 1
        if (voice) utterance.voice = voice

        await new Promise<void>((resolve) => {
          utterance.onend = () => resolve()
          utterance.onerror = () => resolve()
          setTimeout(() => resolve(), 8000) // 超时保护
          speechSynthesis.speak(utterance)
        })
      } catch {
        // 最终放弃
      }
    }

    isPlaying.value = false
    options?.onEnd?.()
  }

  /** 非阻塞发音（用于列表快速播放） */
  function pronounceSimple(word: string) {
    if (!import.meta.client) return
    const clean = word.replace(/[^a-zA-ZÀ-ÿ'-]/g, '').toLowerCase()
    if (!clean) return

    const audio = new Audio(getPronunciationUrl(word))
    audio.play().catch(async () => {
      if (typeof speechSynthesis === 'undefined') return
      await loadVoices()
      const voice = pickBestVoice('en-GB')
      const u = new SpeechSynthesisUtterance(word)
      u.lang = voice ? voice.lang : 'en-GB'
      u.rate = 0.85
      if (voice) u.voice = voice
      speechSynthesis.speak(u)
    })
  }

  function cleanup() {
    if (playTimer) { clearTimeout(playTimer); playTimer = null }
    isPlaying.value = false
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  return { pronounce, pronounceSimple, isPlaying, cleanup, getPronunciationUrl }
}
