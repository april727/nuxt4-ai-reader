export function useTextStream() {
  const displayText = ref('')
  const isTyping = ref(false)
  const isStreaming = ref(false)
  let animationFrameId: number | null = null
  let startTime = 0
  let fullText = ''
  let incomingQueue: string[] = []
  const BASE_SPEED = 60

  // 流式模式：持续接收文本块，实时打字显示
  function startStreaming(initialText: string = '') {
    stopStreaming()
    fullText = initialText
    displayText.value = initialText
    incomingQueue = []
    isTyping.value = true
    isStreaming.value = true
    startTime = performance.now()
    animationFrameId = requestAnimationFrame(animate)
  }

  // 追加文本块（流式接收时调用）
  function appendText(chunk: string) {
    if (!chunk) return
    incomingQueue.push(chunk)
    fullText += chunk
    if (!isTyping.value) {
      isTyping.value = true
      isStreaming.value = true
      startTime = performance.now()
      animationFrameId = requestAnimationFrame(animate)
    }
  }

  // 流结束
  function endStream(full?: string) {
    isStreaming.value = false
    if (full) {
      stopStreaming()
      displayText.value = full
    }
  }

  function animate(_currentTime: number) {
    const elapsed = performance.now() - startTime
    const targetChars = Math.floor((elapsed / 1000) * BASE_SPEED)

    if (!isStreaming.value && targetChars >= fullText.length) {
      displayText.value = fullText
      stopStreaming()
      return
    }

    if (targetChars > displayText.value.length) {
      displayText.value = fullText.slice(0, Math.min(targetChars, fullText.length))
    }

    animationFrameId = requestAnimationFrame(animate)
  }

  function stopStreaming() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    isTyping.value = false
    isStreaming.value = false
  }

  function showAll(text: string) {
    stopStreaming()
    displayText.value = text
    fullText = text
  }

  function finishStreaming() {
    stopStreaming()
    displayText.value = fullText
  }

  if (import.meta.client) { onUnmounted(() => stopStreaming()) }

  return {
    displayText: readonly(displayText),
    isTyping: readonly(isTyping),
    isStreaming: readonly(isStreaming),
    startStreaming, appendText, endStream,
    stopStreaming, showAll, finishStreaming,
  }
}
