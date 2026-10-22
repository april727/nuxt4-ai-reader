/**
 * 段落解释后台任务管理器
 * 逐段（并发）生成整篇文章所有段落的解释，写入 texts.explanations 缓存。
 * 用户在页面触发后，任务在服务端进程后台运行，离开页面不影响。
 */

import { queryOne, runQuery } from './db'
import { getPromptMessages } from './promptManager'
import { deepseekChat } from './deepseek'

export interface ExplainTaskProgress {
  textId: string
  total: number      // 总段落数
  done: number       // 已完成（含跳过缓存）
  failed: number     // 失败数
  running: boolean
  errors: string[]
}

const tasks = new Map<string, ExplainTaskProgress>()
const CONCURRENCY = 4

export function getExplainTask(textId: string): ExplainTaskProgress | null {
  return tasks.get(textId) || null
}

/** 非流式调用 DeepSeek，强制 JSON 输出 */
async function callDeepSeekJson(system: string, user: string): Promise<string> {
  return deepseekChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.2, maxTokens: 5000, responseFormat: { type: 'json_object' }, timeoutMs: 180_000 },
  )
}

/** 保存某段解释到 texts.explanations（合并写入，不覆盖其他段） */
async function saveExplanation(textId: string, pid: string, markdown: string) {
  const existing = await queryOne('SELECT explanations FROM texts WHERE id=?', [textId])
  const cur = existing?.explanations ? JSON.parse(existing.explanations) : {}
  cur[`${pid}:explain`] = markdown
  await runQuery('UPDATE texts SET explanations=?, updatedAt=? WHERE id=?', [
    JSON.stringify(cur),
    new Date().toISOString(),
    textId,
  ])
}

/** 并发池执行段落解释 */
async function runPool(pending: any[], textId: string, task: ExplainTaskProgress, articleContext: string) {
  let i = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < pending.length) {
      const seg = pending[i++]
      const pid = seg.id
      try {
        const { system, user } = await getPromptMessages('explain', {
          paragraphText: seg.text || '',
          articleContext,
        })
        const raw = await callDeepSeekJson(system, user)
        if (!raw || !raw.trim()) {
          // 模型返回空内容：不写入空键，标记失败（前端可见 failed 数）
          task.failed++
          task.errors.push(`${pid}: 模型返回空内容`)
        } else {
          // 存原始 JSON（而非渲染后的 Markdown）：保留 sentenceTranslations 逐句翻译，
          // 前端读取走 parseExplainJson 优先解析，选中原文句子时可精准高亮对应翻译
          await saveExplanation(textId, pid, raw)
          task.done++
        }
      } catch (e: any) {
        task.failed++
        task.errors.push(`${pid}: ${e.message}`)
      }
    }
  })
  await Promise.all(workers)
  task.running = false
}

/** 读文章 → 启动后台任务 → 返回（promise 用于 event.waitUntil 保持后台执行） */
export async function startExplainTaskAsync(textId: string): Promise<{ total: number; pending: number; promise: Promise<void> } | { error: string }> {
  // 已有一个正在运行的任务 → 拒绝重复触发
  if (tasks.get(textId)?.running) return { error: '已有解释任务在运行' }

  const text = await queryOne('SELECT * FROM texts WHERE id=?', [textId])
  if (!text) return { error: '文章不存在' }

  let segments: any[] = []
  try { segments = JSON.parse(text.segments || '[]') } catch { segments = [] }
  if (!segments.length) return { error: '文章没有段落' }

  let cached: Record<string, string> = {}
  try { cached = JSON.parse(text.explanations || '{}') } catch {}

  const pending = segments.filter((s) => s?.id && !cached[`${s.id}:explain`])
  const total = segments.length

  if (!pending.length) {
    return { total, pending: 0, promise: Promise.resolve() }
  }

  const task: ExplainTaskProgress = {
    textId,
    total,
    done: total - pending.length,
    failed: 0,
    running: true,
    errors: [],
  }
  tasks.set(textId, task)

  // 用文章标题作为背景上下文（单段解释时前端会传更完整的上下文）
  const articleContext = (text.title as string) || ''
  const promise = runPool(pending, textId, task, articleContext)
  return { total, pending: pending.length, promise }
}
