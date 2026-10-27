<template>
  <div class="pn-view" v-if="sections">
    <!-- 情景对话 -->
    <section v-if="sections.dialogue" class="pn-section pn-dialogue">
      <h2 class="pn-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        情景对话
      </h2>
      <div class="pn-dialogue-body">
        <div v-for="(line, i) in sections.dialogueLines" :key="i" class="pn-dialogue-line" :class="speakerClass(line)">
          <span v-if="hasSpeaker(line)" class="pn-speaker">{{ getSpeaker(line) }}</span>
          <span class="pn-speech" :class="{ 'no-speaker': !hasSpeaker(line) }">{{ stripSpeaker(line) }}</span>
        </div>
      </div>
    </section>

    <!-- 重点词汇表 -->
    <section v-if="sections.vocabulary" class="pn-section pn-vocab">
      <h2 class="pn-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        重点词汇
      </h2>
      <div class="pn-vocab-table-wrap">
        <table class="pn-vocab-table">
          <thead>
            <tr><th>词汇</th><th>音标</th><th>中文含义</th><th>原文例句</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in sections.vocabRows" :key="i">
              <td class="pn-vocab-word">{{ row[0] || '' }}</td>
              <td class="pn-vocab-phonetic">{{ row[1] || '' }}</td>
              <td class="pn-vocab-meaning">{{ row[2] || '' }}</td>
              <td class="pn-vocab-example">{{ row[3] || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 重点句型与短语 -->
    <section v-if="sections.phrases" class="pn-section pn-phrases">
      <h2 class="pn-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 7 11 14 20 7"/></svg>
        重点句型与短语
      </h2>
      <div class="pn-phrases-list">
        <div v-for="(phrase, i) in sections.phraseItems" :key="i" class="pn-phrase-card">
          <h3 class="pn-phrase-name">{{ phrase.title }}</h3>
          <div class="pn-phrase-body" v-html="renderMd(phrase.body)"></div>
        </div>
      </div>
    </section>

    <!-- 口语小贴士 -->
    <section v-if="sections.tips" class="pn-section pn-tips">
      <h2 class="pn-section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        口语小贴士
      </h2>
      <div class="pn-tips-body" v-html="renderMd(sections.tips)"></div>
    </section>
  </div>
  <div v-else class="pn-fallback" v-html="renderMd(content)"></div>
</template>

<script setup lang="ts">
import { marked } from 'marked'

const props = defineProps<{ content: string }>()

interface Sections {
  dialogue: string
  dialogueLines: string[]
  vocabulary: string
  vocabRows: string[][]
  phrases: string
  phraseItems: Array<{ title: string; body: string }>
  tips: string
}

function renderMd(text: string) {
  if (!text) return ''
  try { return marked.parse(text, { breaks: true, gfm: true }) } catch { return text }
}

function hasSpeaker(line: string) { return /^[AB][:：]/.test(line) || /^\*\*[AB]\*\*[:：]/.test(line) }
function getSpeaker(line: string) { return line.startsWith('**') ? line.slice(2, 3) : line.slice(0, 1) }
function stripSpeaker(line: string) { return line.replace(/^(\*\*)?[AB](\*\*)?[:：]\s*/, '').replace(/\*\*/g, '') }
function speakerClass(line: string) {
  if (line.includes('A') && (line.startsWith('A') || line.startsWith('**A'))) return 'speakerA'
  if (line.includes('B') && (line.startsWith('B') || line.startsWith('**B'))) return 'speakerB'
  return ''
}

const sections = computed<Sections | null>(() => {
  const raw = props.content
  if (!raw || !raw.includes('## 情景对话')) return null

  // 按 ## 标题分割
  const parts = raw.split(/(?=^## )/m)
  const result: any = { dialogueLines: [], vocabRows: [], phraseItems: [] }

  for (const part of parts) {
    const normalized = part.trim()
    if (normalized.startsWith('## 情景对话')) {
      result.dialogue = normalized.replace(/^## 情景对话.*?\n/, '').trim()
      const allLines = result.dialogue.split('\n').map((l: string) => l.trim()).filter(Boolean)
      // 优先匹配 A:/B: 标记的行
      const marked = allLines.filter((l: string) => /^[AB][:：]/.test(l) || /^\*\*[AB]\*\*[:：]/.test(l))
      // 如果匹配到的行足够多则用标记行，否则兜底显示所有非空行
      result.dialogueLines = marked.length >= 2 ? marked : allLines.filter((l: string) => !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('-'))
    } else if (normalized.startsWith('## 重点词汇')) {
      result.vocabulary = normalized.replace(/^## 重点词汇.*?\n/, '').trim()
      // 解析表格行（跳过表头）
      const lines = result.vocabulary.split('\n')
      for (const line of lines) {
        if (line.startsWith('|') && !line.includes('---') && !line.includes('词汇')) {
          const cells = line.split('|').map((c: string) => c.trim()).filter(Boolean)
          if (cells.length >= 3) result.vocabRows.push(cells)
        }
      }
    } else if (normalized.startsWith('## 重点句型')) {
      result.phrases = normalized.replace(/^## 重点句型.*?\n/, '').trim()
      // 按 ### 分割短语条目
      const phraseParts = result.phrases.split(/(?=^### )/m)
      for (const pp of phraseParts) {
        const trimmed = pp.trim()
        if (!trimmed) continue
        const titleMatch = trimmed.match(/^### (.+)/)
        result.phraseItems.push({
          title: titleMatch ? titleMatch[1] : '短语',
          body: titleMatch ? trimmed.replace(/^### .+\n/, '') : trimmed,
        })
      }
    } else if (normalized.startsWith('## 口语小贴士')) {
      result.tips = normalized.replace(/^## 口语小贴士.*?\n/, '').trim()
    }
  }

  return result.dialogue || result.vocabulary || result.phrases || result.tips ? result : null
})
</script>

<style scoped>
.pn-view { color: #1a1a18; }
.pn-section { margin-bottom: 28px; }
.pn-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600; color: #1a1a18;
  font-family: 'Lora', Georgia, serif;
  margin-bottom: 14px; padding-bottom: 8px;
  border-bottom: 1.5px solid rgba(0,0,0,0.06);
}
.pn-section-title svg { color: #3d3591; flex-shrink: 0; }

/* 情景对话 */
.pn-dialogue-body {
  background: #fafaf7; border-radius: 12px; padding: 16px 18px;
  border: 0.5px solid rgba(0,0,0,0.05);
}
.pn-dialogue-line {
  padding: 6px 0; font-size: 14px; line-height: 1.7;
  display: flex; gap: 8px; font-family: 'Lora', Georgia, serif;
}
.pn-dialogue-line + .pn-dialogue-line { border-top: 0.5px solid rgba(0,0,0,0.04); }
.pn-speaker {
  font-weight: 600; font-size: 12px; flex-shrink: 0; width: 22px;
  font-family: 'DM Sans', sans-serif;
}
.speakerA .pn-speaker { color: #3d3591; }
.speakerB .pn-speaker { color: #059669; }
.pn-speech { color: #4a4a46; }
.pn-speech.no-speaker { padding-left: 0; }

/* 词汇表 */
.pn-vocab-table-wrap { overflow-x: auto; border-radius: 10px; border: 0.5px solid rgba(0,0,0,0.06); }
.pn-vocab-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pn-vocab-table th {
  background: #f0edfa; color: #3d3591; font-weight: 600; font-size: 11.5px;
  padding: 10px 12px; text-align: left; font-family: 'DM Sans', sans-serif;
}
.pn-vocab-table td { padding: 9px 12px; border-top: 0.5px solid rgba(0,0,0,0.05); line-height: 1.5; }
.pn-vocab-word { font-weight: 600; color: #1a1a18; white-space: nowrap; font-family: 'Lora', Georgia, serif; }
.pn-vocab-phonetic { color: #6b6963; font-size: 12px; white-space: nowrap; font-family: 'DM Mono', monospace; }
.pn-vocab-meaning { color: #4a4a46; }
.pn-vocab-example { color: #6b6963; font-size: 12px; font-style: italic; max-width: 260px; }

/* 句型短语 */
.pn-phrases-list { display: flex; flex-direction: column; gap: 10px; }
.pn-phrase-card {
  background: #fafaf7; border-radius: 10px; padding: 14px 16px;
  border: 0.5px solid rgba(0,0,0,0.05);
}
.pn-phrase-name {
  font-size: 14px; font-weight: 600; color: #3d3591;
  font-family: 'Lora', Georgia, serif; margin: 0 0 8px;
}
.pn-phrase-body { font-size: 13px; line-height: 1.7; color: #4a4a46; }
.pn-phrase-body :deep(p) { margin: 0.3em 0; }
.pn-phrase-body :deep(strong) { color: #1a1a18; }

/* 口语小贴士 */
.pn-tips-body {
  background: #fffbeb; border-radius: 10px; padding: 14px 16px;
  border: 0.5px solid rgba(245,158,11,0.2); font-size: 13px; line-height: 1.7; color: #4a4a46;
}
.pn-tips-body :deep(p) { margin: 0.3em 0; }
.pn-tips-body :deep(strong) { color: #92400e; }

.pn-fallback { font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
</style>
