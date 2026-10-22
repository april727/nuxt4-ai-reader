/**
 * DeepSeek 统一调用封装
 *
 * 收敛此前散落在 20+ 个端点里的三套写法（$fetch / 原生 fetch / 各自拼 baseUrl），
 * 统一处理：模型与网关地址、隐藏推理开关、超时、错误归一化、参数兼容回退。
 *
 * 设计约定：
 * - 只负责「传输」，不解析业务 JSON。各端点保留自己的容错解析与兜底逻辑。
 * - 默认关闭隐藏推理（thinking: disabled）。实测开启时 reasoning_content 约占
 *   完成量 48%，首字延迟从 0.5s 升至 3.6s 以上，而本应用不展示推理内容。
 *   需要推理的调用方显式传 `thinking: true`。
 * - 网关不认识 `thinking` 字段会返回 400，此时自动去参重试一次。
 */
import { createError } from 'h3'

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | string
  content: string
}

export interface DeepSeekOptions {
  /** 覆盖默认模型（默认取 DEEPSEEK_MODEL） */
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: { type: 'json_object' | 'text' }
  /** 是否允许模型输出隐藏推理，默认 false */
  thinking?: boolean
  timeoutMs?: number
}

const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_TIMEOUT = 120_000
const STREAM_TIMEOUT = 300_000

function resolveBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
}

function resolveApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw createError({ statusCode: 500, message: 'DEEPSEEK_API_KEY not configured' })
  return key
}

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY)
}

async function normalizeError(res: Response): Promise<Error> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {}
  return createError({
    statusCode: 502,
    message: `DeepSeek API error ${res.status}${detail ? `: ${detail}` : ''}`,
    data: { upstreamStatus: res.status },
  })
}

function buildBody(messages: DeepSeekMessage[], opts: DeepSeekOptions, stream: boolean): Record<string, any> {
  const body: Record<string, any> = {
    model: opts.model || getDeepSeekModel(),
    messages,
    stream,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2000,
  }
  if (opts.responseFormat) body.response_format = opts.responseFormat
  if (opts.thinking !== true) body.thinking = { type: 'disabled' }
  return body
}

async function post(body: Record<string, any>, timeoutMs: number): Promise<Response> {
  const url = `${resolveBaseUrl()}/v1/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${resolveApiKey()}`,
  }
  const send = (payload: Record<string, any>) => fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })

  let res: Response
  try {
    res = await send(body)
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw createError({ statusCode: 504, message: 'DeepSeek 请求超时' })
    }
    throw createError({ statusCode: 502, message: `DeepSeek 请求失败: ${err?.message || 'unknown'}` })
  }

  // 兼容不支持 thinking 参数的模型/网关
  if (res.status === 400 && body.thinking) {
    const { thinking: _omit, ...rest } = body
    res = await send(rest)
  }

  return res
}

/** 非流式对话，返回文本内容 */
export async function deepseekChat(messages: DeepSeekMessage[], opts: DeepSeekOptions = {}): Promise<string> {
  const res = await post(buildBody(messages, opts, false), opts.timeoutMs ?? DEFAULT_TIMEOUT)
  if (!res.ok) throw await normalizeError(res)
  const data = await res.json() as any
  return data?.choices?.[0]?.message?.content || ''
}

/** 流式请求，返回上游 SSE Response（由调用方负责转发与解析） */
export async function deepseekStream(messages: DeepSeekMessage[], opts: DeepSeekOptions = {}): Promise<Response> {
  const res = await post(buildBody(messages, opts, true), opts.timeoutMs ?? STREAM_TIMEOUT)
  if (!res.ok || !res.body) throw await normalizeError(res)
  return res
}
