/** 用 <video> + <canvas> 截取视频第 10% 处的一帧，上传为缩略图 */
export function captureVideoThumbnail(file: File): Promise<string> {
  const vid = document.createElement('video')
  vid.preload = 'metadata'; vid.muted = true; vid.playsInline = true
  const blobUrl = URL.createObjectURL(file)
  vid.src = blobUrl

  return new Promise((resolve) => {
    let cleaned = false
    const clean = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(blobUrl); vid.remove() } }

    const capture = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = Math.round(320 / (vid.videoWidth / vid.videoHeight) || 180)
      const ctx = canvas.getContext('2d')
      if (!ctx) { clean(); return resolve('') }
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(async (blob) => {
        clean()
        if (!blob) return resolve('')
        try {
          const fd = new FormData(); fd.append('file', blob, 'thumb.jpg')
          const res = await $fetch<{ url: string; path: string; size: number }>('/api/file/upload-thumbnail', { method: 'POST', body: fd })
          resolve(res.path)
        } catch { resolve('') }
      }, 'image/jpeg', 0.8)
    }

    vid.onloadedmetadata = () => {
      vid.currentTime = Math.min(15, vid.duration * 0.1)
    }
    vid.onseeked = () => { capture() }
    vid.onerror = () => { clean(); resolve('') }
    setTimeout(() => { if (!cleaned) { clean(); resolve('') } }, 15000)
  })
}
