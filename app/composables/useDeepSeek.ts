import type { ArticleAnalysis, Paragraph, ParagraphAction, ChatMessage, MarkType } from '#shared/types'

export function useDeepSeek() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function analyzeArticle(text: string): Promise<{ analysis: ArticleAnalysis; segments: Paragraph[] }> {
    loading.value = true; error.value = null
    try {
      return await $fetch<{ analysis: ArticleAnalysis; segments: Paragraph[] }>('/api/deepseek/analyze', { method: 'POST', body: { text } })
    } catch (e: any) { error.value = e?.statusMessage || '分析失败'; throw e }
    finally { loading.value = false }
  }

  async function paragraphAction(paragraph: string, action: ParagraphAction, articleContext: string, chatHistory?: ChatMessage[]): Promise<string> {
    loading.value = true; error.value = null
    try {
      const endpoint = action === 'translate' ? '/api/deepseek/translate' : action === 'explain' ? '/api/deepseek/explain' : '/api/deepseek/chat'
      const payload = action === 'search'
        ? { messages: [...(chatHistory || []), { role: 'user' as const, content: `请搜索并解释以下段落的相关信息：\n\n${paragraph}` }], articleContext }
        : { paragraph, action, articleContext }
      return (await $fetch<{ content: string }>(endpoint, { method: 'POST', body: payload })).content
    } catch (e: any) { error.value = e?.statusMessage || '操作失败'; throw e }
    finally { loading.value = false }
  }

  async function lookupWord(word: string, context?: string): Promise<WordDetail> {
    loading.value = true; error.value = null
    try { return await $fetch<WordDetail>('/api/deepseek/word', { method: 'POST', body: { word, context } }) }
    catch (e: any) { error.value = e?.statusMessage || '查询失败'; throw e }
    finally { loading.value = false }
  }

  async function sendChat(messages: ChatMessage[], articleContext: string, paragraphContext?: string): Promise<string> {
    loading.value = true; error.value = null
    try { return (await $fetch<{ content: string }>('/api/deepseek/chat', { method: 'POST', body: { messages, articleContext, paragraphContext } })).content }
    catch (e: any) { error.value = e?.statusMessage || '对话失败'; throw e }
    finally { loading.value = false }
  }

  async function markExplain(text: string, type: MarkType, paragraphContext: string, articleContext: string): Promise<{ detail: string; phonetic: string }> {
    loading.value = true; error.value = null
    try {
      return await $fetch<{ detail: string; phonetic: string }>('/api/deepseek/mark', {
        method: 'POST', body: { text, type, paragraphContext, articleContext }
      })
    } catch (e: any) { error.value = e?.statusMessage || '标记解释失败'; throw e }
    finally { loading.value = false }
  }

  // 流式解释（逐块返回，不等待完整响应）
  async function streamExplain(messages: Array<{ role: string; content: string }>, onChunk: (text: string) => void): Promise<void> {
    loading.value = true; error.value = null
    try {
      const resp = await fetch('/api/deepseek/stream', { method: 'POST', body: JSON.stringify({ messages }), headers: { 'Content-Type': 'application/json' } })
      if (!resp.ok || !resp.body) throw new Error('Stream failed')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (chunk) onChunk(chunk)
      }
    } catch (e: any) { error.value = e?.message || '流式请求失败'; throw e }
    finally { loading.value = false }
  }

  return { loading, error, analyzeArticle, paragraphAction, markExplain, sendChat, streamExplain }
}
