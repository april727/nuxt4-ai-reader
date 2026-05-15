import { parseSubtitles, secondsToTimeStr } from '../../../utils/srt'
import { subtitlesToText } from '../../../utils/subtitle'

export default defineEventHandler(async (event) => {
  const formData = await readFormData(event)
  const file = formData.get('file') as File | null

  if (!file) throw createError({ statusCode: 400, message: '请上传字幕文件' })

  const name = file.name.toLowerCase()
  if (!name.endsWith('.srt') && !name.endsWith('.vtt')) {
    throw createError({ statusCode: 400, message: '仅支持 SRT 和 VTT 格式的字幕文件' })
  }

  const content = await file.text()
  if (!content.trim()) throw createError({ statusCode: 400, message: '字幕文件为空' })

  const subtitles = parseSubtitles(content)
  if (subtitles.length === 0) {
    throw createError({ statusCode: 400, message: '未能从文件中解析出有效字幕' })
  }

  const text = subtitlesToText(subtitles)
  const duration = subtitles.length > 0 ? Math.ceil(subtitles[subtitles.length - 1].end) : 0
  const videoUrl = formData.get('videoUrl') as string || ''

  return {
    subtitles,
    text,
    duration,
    videoUrl,
    cueCount: subtitles.length,
    durationFormatted: secondsToTimeStr(duration),
  }
})
