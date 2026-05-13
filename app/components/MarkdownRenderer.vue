<template>
  <div class="markdown-renderer prose" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { marked } from 'marked'

const props = defineProps<{
  content: string
}>()

const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    return marked.parse(props.content, { breaks: true, gfm: true }) as string
  } catch {
    return props.content.replace(/\n/g, '<br>')
  }
})
</script>

<style scoped>
.markdown-renderer {
  line-height: 1.75;
  color: #334155;
}

.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3),
.markdown-renderer :deep(h4) {
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  font-weight: 600;
  color: #1e293b;
}

.markdown-renderer :deep(h2) { font-size: 1.2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.35em; }
.markdown-renderer :deep(h3) { font-size: 1.05em; }
.markdown-renderer :deep(p) { margin: 0.6em 0; }
.markdown-renderer :deep(strong) { font-weight: 600; color: #0f172a; }
.markdown-renderer :deep(ul), .markdown-renderer :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.markdown-renderer :deep(li) { margin: 0.25em 0; }
.markdown-renderer :deep(code) {
  background: #f1f5f9;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
  color: #c026d3;
}
.markdown-renderer :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.8em 0;
}
.markdown-renderer :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
}
.markdown-renderer :deep(blockquote) {
  border-left: 3px solid #6366f1;
  padding-left: 1em;
  margin: 0.8em 0;
  color: #64748b;
}
.markdown-renderer :deep(a) {
  color: #6366f1;
  text-decoration: underline;
}
.markdown-renderer :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
}
.markdown-renderer :deep(th), .markdown-renderer :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 0.5em 0.75em;
  text-align: left;
}
.markdown-renderer :deep(th) {
  background: #f8fafc;
  font-weight: 600;
}
</style>
