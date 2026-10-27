import { parseSubtitles, secondsToTimeStr } from '../../../utils/srt'
import { subtitlesToText } from '../../../utils/subtitle'

/** 尝试多种编码解码文件内容 */
function tryDecode(buffer: ArrayBuffer): { content: string; encoding: string } {
  // 按常见程度排序的编码列表
  const encodings = ['utf-8', 'utf-16le', 'utf-16be', 'gbk', 'gb2312', 'windows-1252', 'iso-8859-1']

  for (const enc of encodings) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true })
      const text = decoder.decode(buffer)
      // 验证解码结果是否看起来像有效字幕：包含时间戳或 WEBVTT 头
      if (text.includes('-->') || text.trim().startsWith('WEBVTT')) {
        return { content: text, encoding: enc }
      }
    } catch {
      // 该编码不兼容，继续尝试下一个
    }
  }

  // 最后兜底：UTF-8 宽容模式
  const fallback = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  return { content: fallback, encoding: 'utf-8 (fallback)' }
}

export default defineEventHandler(async (event) => {
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null

  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'no_file', message: '请上传字幕文件' })
  }

  const name = file.name.toLowerCase()
  if (!name.endsWith('.srt') && !name.endsWith('.vtt')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'bad_format',
      message: '仅支持 SRT 和 VTT 格式的字幕文件',
    })
  }

  // 文件大小检查：正常字幕文件不会超过 5MB
  if (file.size > 5 * 1024 * 1024) {
    throw createError({
      statusCode: 400,
      statusMessage: 'too_large',
      message: '文件过大（超过 5MB），请确认是否为有效字幕文件',
    })
  }
  if (file.size === 0) {
    throw createError({ statusCode: 400, statusMessage: 'empty_file', message: '字幕文件为空' })
  }

  // 读取二进制内容，尝试多种编码解码
  const buffer = await file.arrayBuffer()
  const { content, encoding } = tryDecode(buffer)

  if (!content.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'empty_content',
      message: '字幕文件内容为空（编码: ' + encoding + '）',
    })
  }

  // 去掉 BOM 头（某些编辑器会在 UTF-8 文件头加 BOM）
  const cleaned = content.replace(/^﻿/, '')

  const subtitles = parseSubtitles(cleaned)
  if (subtitles.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'parse_failed',
      message: '未能从文件中解析出有效字幕（编码: ' + encoding + '，请确认文件包含正确的时间戳格式）',
    })
  }

  const text = subtitlesToText(subtitles)
  const duration = subtitles.length > 0 ? Math.ceil(subtitles[subtitles.length - 1].end) : 0
  const videoUrl = (formData.get('videoUrl') as string) || ''

  return {
    subtitles,
    text,
    duration,
    videoUrl,
    cueCount: subtitles.length,
    durationFormatted: secondsToTimeStr(duration),
    encoding,
  }
})
