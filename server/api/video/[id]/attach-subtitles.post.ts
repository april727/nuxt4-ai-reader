import { getDb, saveDb } from '../../../utils/db'
import { subtitlesToText } from '../../../utils/subtitle'
import type { SubtitleCue } from '#shared/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { subtitles } = await readBody<{ subtitles: SubtitleCue[] }>(event)

  if (!id || !subtitles?.length) throw createError({ statusCode: 400 })

  const db = await getDb()
  const text = subtitlesToText(subtitles)
  const segments = subtitles.map((c, idx) => ({
    id: `p-${idx}`, index: idx, text: c.text, start: c.start, end: c.end,
  }))
  const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 150)

  db.run(
    `UPDATE texts SET text=?, videoSubtitles=?, segments=?, excerpt=? WHERE id=?`,
    [text.slice(0, 100000), JSON.stringify(subtitles), JSON.stringify(segments), excerpt, id]
  )

  await saveDb()
  return { ok: true, subtitleCount: subtitles.length }
})
