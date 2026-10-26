/**
 * 从图片字节头解析宽高，不引任何原生依赖。
 *
 * 为什么需要：试卷画布的归一化坐标（0~1）必须乘原图真实尺寸，
 * 若依赖客户端上报的尺寸，一旦上报值与实际不符，标注位置会整体偏移。
 * 支持 PNG / JPEG / GIF / WebP（VP8、VP8L、VP8X），覆盖手机拍照与截图的所有常见格式。
 */
export function imageSize(buf: Buffer): { w: number; h: number } {
  const none = { w: 0, h: 0 }
  if (!buf || buf.length < 16) return none

  // ── PNG：IHDR 固定在偏移 16 / 20 ──
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }

  // ── GIF：第 6/8 字节小端 ──
  const head6 = buf.toString('ascii', 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  }

  // ── JPEG：扫描 SOF 段 ──
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      // SOF0~SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      if (len <= 0) break
      i += 2 + len
    }
    return none
  }

  // ── WebP ──
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16)
    if (fmt === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      return { w, h }
    }
    if (fmt === 'VP8 ') {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    }
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }
    }
  }

  return none
}
