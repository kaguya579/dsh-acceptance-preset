// 图片尺寸解析：从头部字节确定性读出宽高（PNG/JPEG/GIF/WebP），不依赖任何库。
// 解析失败返回 null（事实包中 width/height 记 null，不影响其他字段）。

export function imageDimensions(bytes) {
  if (bytes.length < 26) return null
  if (isPng(bytes)) {
    // PNG：签名 8 字节 + IHDR（长度 4 + 类型 4）→ 宽 @16、高 @20（大端）
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
  }
  if (isGif(bytes)) {
    // GIF：'GIF87a/89a' + 逻辑屏幕宽高（小端 @6/@8）
    return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) }
  }
  if (isJpeg(bytes)) return jpegDimensions(bytes)
  if (isWebp(bytes)) return webpDimensions(bytes)
  return null
}

function isPng(bytes) {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function isGif(bytes) {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
}

function isJpeg(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8
}

function isWebp(bytes) {
  // 'RIFF' + 长度 + 'WEBP'
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
}

function jpegDimensions(bytes) {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    // SOF0-SOF15（跳过 DHT C4 / JPG C8 / DAC CC / 填充 FF）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: readU16BE(bytes, offset + 5), width: readU16BE(bytes, offset + 7) }
    }
    const length = readU16BE(bytes, offset + 2)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function webpDimensions(bytes) {
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunk === 'VP8X') {
    // 画布宽高 = 24 位小端值 + 1
    return { width: 1 + readU24LE(bytes, 24), height: 1 + readU24LE(bytes, 27) }
  }
  if (chunk === 'VP8 ') {
    // 有损：帧标签 9D 01 2A @23..25，宽高 14 位小端 @26/@28
    if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: readU16LE(bytes, 26) & 0x3fff, height: readU16LE(bytes, 28) & 0x3fff }
    }
    return null
  }
  if (chunk === 'VP8L') {
    // 无损：0x2F 标记 @20，随后 4 字节位域
    if (bytes[20] !== 0x2f) return null
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return { width, height }
  }
  return null
}

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readU32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000)
    + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  )
}
