/**
 * 本地 Prompt 覆盖层
 *
 * 运行时 prompt 来源优先级：本地覆盖文件 → prompts.ts 常量兜底。
 * 运行时**不再自动访问云端**；只有 /settings/prompts 页面点「获取云端」时，
 * 才由 /api/prompt/cloud/apply 把云端内容写入本文件（人工可控的拉取）。
 *
 * 文件：server/data/prompts.local.json
 * 形如：{ "mark-word": "===SYSTEM===\n...", "explain": "..." }
 * 键为项目内部 key（explain / mark-word / mark-phrase / ...），与 PROMPT_KEY_MAP 一致。
 */

import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve('server/data/prompts.local.json')

/** 进程内缓存：避免每次 AI 调用都读盘 */
let cache: Record<string, string> | null = null

/** 读取全部本地覆盖内容（带缓存） */
export function readLocalPrompts(): Record<string, string> {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v) out[k] = v
      }
      cache = out
    } else {
      cache = {}
    }
  } catch {
    // 文件不存在 / 解析失败 → 视为没有本地覆盖
    cache = {}
  }
  return cache
}

/** 取单个 key 的本地覆盖内容，没有则返回 null */
export function getLocalPrompt(key: string): string | null {
  const v = readLocalPrompts()[key]
  return typeof v === 'string' && v ? v : null
}

/** 已被本地覆盖的 key 列表 */
export function listLocalKeys(): string[] {
  return Object.keys(readLocalPrompts())
}

function persist(data: Record<string, string>) {
  // 与 readLocalPrompts 的读取过滤保持一致：只保留非空字符串，
  // 否则写入后缓存与重新读盘的结果会不一致。
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v) clean[k] = v
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(clean, null, 2), 'utf-8')
    cache = clean
  } catch (e: any) {
    throw new Error(`写入本地 Prompt 文件失败：${e?.message || e}`)
  }
}

/** 批量写入覆盖内容（与现有内容合并） */
export function setLocalPrompts(entries: Record<string, string>): void {
  persist({ ...readLocalPrompts(), ...entries })
}

/** 批量移除覆盖，恢复为 prompts.ts 常量 */
export function removeLocalPrompts(keys: string[]): void {
  const next = { ...readLocalPrompts() }
  for (const k of keys) delete next[k]
  persist(next)
}

/** 清空进程内缓存（下次读取重新从磁盘加载） */
export function clearLocalPromptCache(): void {
  cache = null
}

/** 本地覆盖文件的绝对路径（供页面/调试显示） */
export function localPromptFilePath(): string {
  return FILE
}
