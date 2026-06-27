import { queryOne, queryAll, runQuery } from '../../utils/db'
import type { VideoMeta } from '#shared/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    playlistTitle: string
    videos: Array<{ id: string; title: string; url: string }>
  }>(event)

  if (!body?.videos?.length) throw createError({ statusCode: 400, message: '没有要导入的视频' })

  const folderName = body.playlistTitle.trim()

  // 创建文件夹（检测重名）
  const existingFolder = await queryOne('SELECT id FROM folders WHERE name=?', [folderName])
  if (existingFolder) {
    throw createError({ statusCode: 409, message: `文件夹「${folderName}」已存在` })
  }

  const folderId = 'folder_' + Date.now()
  const now = new Date().toISOString()
  await runQuery('INSERT INTO folders (id,name,parent,createdAt) VALUES (?,?,?,?)', [
    folderId, folderName, '', now,
  ])

  // 逐条导入（零等待模式 —— 只存 DB，元数据后续异步拉取）
  let imported = 0
  let skipped = 0
  const importedIds: string[] = []

  // 批量预加载所有已有的 youtube/bilibili 视频 URL 用于去重
  const existing = new Set<string>()
  try {
    const allRows = await queryAll("SELECT videoMeta FROM texts WHERE source IN ('youtube','bilibili')")
    for (const row of allRows) {
      if (row.videoMeta) {
        try {
          const meta: VideoMeta = JSON.parse(row.videoMeta)
          if (meta.url) existing.add(meta.url)
        } catch {}
      }
    }
  } catch {
    // 兼容旧库无 source 条件
  }

  for (const video of body.videos) {
    // 去重
    if (existing.has(video.url)) {
      skipped++
      continue
    }

    const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const isBilibili = video.url.includes('bilibili.com')
    const videoType = isBilibili ? 'bilibili' : 'youtube'

    const videoMeta: VideoMeta = {
      url: video.url,
      type: videoType,
      duration: 0,
      thumbnail: '',
    }

    await runQuery(
      `INSERT INTO texts (id,title,text,source,folder,excerpt,filePath,segments,analysis,videoMeta,videoSubtitles,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, video.title, '', videoType, folderId,
        '', '', '[]', '', JSON.stringify(videoMeta), '[]', now,
      ]
    )

    imported++
    importedIds.push(id)
    existing.add(video.url)
  }

  return { folderId, folderName, imported, skipped, importedIds }
})
