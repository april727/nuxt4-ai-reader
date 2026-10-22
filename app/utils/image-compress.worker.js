/**
 * 图片压缩 Worker（OffscreenCanvas，主线程零阻塞）
 *
 * 为什么需要：粘贴乐观反馈要求主线程只做一次字符串插入；
 * 而 createImageBitmap 解码 + canvas.toBlob(webp) 编码在主线程执行时
 * 会卡住输入数百毫秒，让"贴图"明显慢于"贴字"。
 * 在 Worker 里用 OffscreenCanvas 完成解码/缩放/编码，主线程全程流畅。
 *
 * 入参：{ file: File|Blob, opts: { maxEdge, quality, mime, maxBytes } }
 * 出参：{ ok:true, blob, name } 或 { ok:false, error }
 */
self.onmessage = async (e) => {
  try {
    const { file, opts } = e.data
    const maxEdge = (opts && opts.maxEdge) || 1280
    const quality = (opts && opts.quality) != null ? opts.quality : 0.74
    const mime = (opts && opts.mime) || 'image/webp'
    const maxBytes = (opts && opts.maxBytes) || 320 * 1024

    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))

    const cv = new OffscreenCanvas(w, h)
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()

    let blob = await cv.convertToBlob({ type: mime, quality })

    // 体积超预算 → 逐级降质
    if (blob.size > maxBytes) {
      for (const q of [0.62, 0.5]) {
        blob = await cv.convertToBlob({ type: mime, quality: q })
        if (blob.size <= maxBytes) break
      }
    }
    // 仍超预算 → 等比缩小再压一次（兜底极端大图）
    if (blob.size > maxBytes * 2) {
      const s2 = Math.sqrt(maxBytes / blob.size)
      const cv2 = new OffscreenCanvas(Math.max(1, Math.round(w * s2)), Math.max(1, Math.round(h * s2)))
      const c2 = cv2.getContext('2d')
      c2.imageSmoothingQuality = 'high'
      const bmp2 = await createImageBitmap(blob)
      c2.drawImage(bmp2, 0, 0, cv2.width, cv2.height)
      bmp2.close()
      blob = await cv2.convertToBlob({ type: mime, quality: 0.7 })
    }

    const base = String((file && file.name) || 'image').replace(/\.[^.]+$/, '') || 'image'
    const name = base + (mime === 'image/jpeg' ? '.jpg' : '.webp')
    self.postMessage({ ok: true, blob, name })
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || String(err) })
  }
}
