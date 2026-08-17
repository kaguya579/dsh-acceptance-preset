// 交付物扫描与安全解包：目录 / zip / tar.gz → 统一条目流（纯内存、绝不落盘执行）。
//
// 安全保证：
// - 绝不执行交付代码（只读字节，供解析）；
// - 压缩条目防路径穿越（拒绝绝对路径、盘符、`..`/`.` 段）；
// - 单文件 64MB、总量 512MB、条目数 5 万三重上限；
// - 排除 VCS/依赖/构建产物目录（.git/.idea/node_modules 等），避免快照噪音。
//
// 条目结构：{ path, size, sha256, kind, data }
//   path  —— 交付物内相对路径（/ 分隔）
//   kind  —— 'code' | 'doc' | 'image' | 'build' | 'other'
//   data  —— 仅对需要解析的文件保留字节（code ≤ 2MB、doc ≤ 20MB、image ≤ 8MB、build ≤ 2MB），其余为 null

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'
import tar from 'tar-stream'

// 排除目录（相对路径任一段命中即跳过）
export const EXCLUDED_DIRS = new Set([
  '.git', '.idea', '.vs', '.vscode', 'node_modules', '.venv', 'venv',
  '__pycache__', 'target', 'dist', 'out', 'build', '.mvn',
])

// 代码语言 ↔ 扩展名
export const CODE_LANG = new Map([
  ['.c', 'C'], ['.h', 'C'],
  ['.cpp', 'C++'], ['.cc', 'C++'], ['.cxx', 'C++'], ['.hpp', 'C++'], ['.hh', 'C++'],
  ['.java', 'Java'],
  ['.js', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'],
  ['.ts', 'TypeScript'], ['.tsx', 'TSX'], ['.jsx', 'TSX'],
])

const DOC_EXTS = new Set(['.md', '.docx', '.pdf', '.xlsx'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const BUILD_NAMES = new Set([
  'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'settings.gradle', 'settings.gradle.kts', 'Makefile', 'CMakeLists.txt',
  'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml', 'Dockerfile',
])
const BUILD_SUFFIXES = ['.csproj', '.sln']

export const LIMITS = {
  MAX_ENTRY_BYTES: 64 * 1024 * 1024, // 单文件
  MAX_TOTAL_BYTES: 512 * 1024 * 1024, // 总量
  MAX_ENTRIES: 50000, // 条目数
  MAX_ARCHIVE_BYTES: 512 * 1024 * 1024, // 压缩包读取上限
  MAX_CODE_BYTES: 2 * 1024 * 1024, // 保留字节的代码文件上限
  MAX_DOC_BYTES: 20 * 1024 * 1024, // 保留字节的文档上限
  MAX_IMAGE_BYTES: 8 * 1024 * 1024, // 保留字节的图片上限
}

/** 条目类型判定（kind）。 */
export function kindOf(relPath) {
  const base = relPath.split('/').pop()
  const lower = base.toLowerCase()
  const ext = '.' + lower.split('.').pop()
  if (CODE_LANG.has(ext)) return 'code'
  if (DOC_EXTS.has(ext)) return 'doc'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (BUILD_NAMES.has(base) || BUILD_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return 'build'
  return 'other'
}

/** 某类文件保留字节的上限。 */
function dataCap(kind) {
  if (kind === 'code') return LIMITS.MAX_CODE_BYTES
  if (kind === 'doc') return LIMITS.MAX_DOC_BYTES
  if (kind === 'image') return LIMITS.MAX_IMAGE_BYTES
  if (kind === 'build') return LIMITS.MAX_CODE_BYTES // 构建清单（package.json/pom.xml/CMakeLists）供依赖清单解析
  return 0
}

/** 压缩条目路径净化：非法返回 null（路径穿越防护）。 */
function sanitizeEntryPath(name) {
  if (typeof name !== 'string' || name.length === 0) return null
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return null
  return segments.filter((segment) => segment !== '').join('/')
}

/** 相对路径任一段命中排除目录。 */
function excludedByDir(relPath) {
  return relPath.split('/').some((segment) => EXCLUDED_DIRS.has(segment))
}

/** 排除前缀规范化：''/'.'/'..'开头/盘符/绝对路径 → null（无可排除内容）。 */
function normalizeExcludePrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.trim() === '') return null
  let text = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (text === '' || text === '.' || text === '..' || text.startsWith('../') || /^[a-zA-Z]:/.test(text)) return null
  return text
}

/** rel 是否命中排除前缀（前缀本身或其子树）。 */
function excludedByPrefix(rel, exclude) {
  if (exclude === null) return false
  const lower = rel.toLowerCase()
  return lower === exclude || lower.startsWith(exclude + '/')
}

/**
 * 扫描交付物入口：按路径形态分发到目录/zip/tar.gz 扫描。
 * @param options.outRoot  可选：产物根（绝对路径）；若位于交付物目录内，
 *   扫描时排除该子树（产物目录自污染防护——前缀计算与匹配均在本模块）。
 */
export async function scanDeliverable(adapter, deliverablePath, options = {}) {
  const stat = await adapter.stat(deliverablePath)
  if (stat === null) throw new Error(`交付物不存在：${deliverablePath}`)
  const base = stat.type === 'directory' ? deliverablePath : path.dirname(deliverablePath)
  const rawExclude = typeof options.outRoot === 'string'
    ? path.relative(base, options.outRoot).replace(/\\/g, '/')
    : ''
  const exclude = normalizeExcludePrefix(rawExclude)
  if (stat.type === 'directory') return scanDirectory(adapter, deliverablePath, exclude)
  if (stat.type === 'file') {
    const lower = deliverablePath.toLowerCase()
    if (lower.endsWith('.zip')) return scanZip(adapter, deliverablePath, exclude)
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return scanTarGz(adapter, deliverablePath, exclude)
    throw new Error(`不支持的交付物格式：${deliverablePath}（支持目录 / zip / tar.gz）`)
  }
  throw new Error(`交付物路径不可用（非文件非目录）：${deliverablePath}`)
}

/** 目录扫描：递归列出文件，跳过排除目录与产物目录前缀。 */
async function scanDirectory(adapter, root, exclude) {
  const entries = []
  const errors = []
  const budget = { bytes: 0, count: 0 }

  async function walk(dirAbs, relPrefix) {
    let children
    try {
      children = await adapter.listDir(dirAbs)
    } catch (error) {
      errors.push({ path: relPrefix || '.', reason: `目录读取失败：${error.message}` })
      return
    }
    for (const child of children) {
      const rel = relPrefix === '' ? child.name : `${relPrefix}/${child.name}`
      if (excludedByPrefix(rel, exclude)) continue
      if (child.type === 'directory') {
        if (EXCLUDED_DIRS.has(child.name)) continue
        await walk(`${dirAbs}\\${child.name}`, rel)
      } else if (child.type === 'file') {
        await addFileEntry(adapter, `${dirAbs}\\${child.name}`, rel, child.size, entries, errors, budget)
      } else {
        errors.push({ path: rel, reason: '非常规文件（符号链接等），跳过' })
      }
    }
  }

  await walk(root, '')
  return { entries, errors }
}

/** 单文件条目：体积/预算检查、按需保留字节、sha256。 */
async function addFileEntry(adapter, absPath, rel, declaredSize, entries, errors, budget) {
  const size = declaredSize ?? 0
  if (size > LIMITS.MAX_ENTRY_BYTES) {
    errors.push({ path: rel, reason: `单文件超过 ${LIMITS.MAX_ENTRY_BYTES} 字节，跳过` })
    return
  }
  if (budget.bytes + size > LIMITS.MAX_TOTAL_BYTES || budget.count >= LIMITS.MAX_ENTRIES) {
    errors.push({ path: rel, reason: '交付物总量/条目数超限，跳过' })
    return
  }
  const kind = kindOf(rel)
  const keepData = size <= dataCap(kind)
  const maxRead = keepData ? dataCap(kind) : LIMITS.MAX_ENTRY_BYTES
  let data = null
  try {
    data = await adapter.readBytes(absPath, maxRead)
  } catch (error) {
    errors.push({ path: rel, reason: `读取失败：${error.message}` })
    return
  }
  if (data === null) {
    errors.push({ path: rel, reason: '读取超限，跳过' })
    return
  }
  const sha256 = createHash('sha256').update(data).digest('hex')
  budget.bytes += size
  budget.count += 1
  entries.push({ path: rel, size, sha256, kind, data: keepData ? data : null })
}

/** 压缩条目（zip/tar 共用）：体积/预算检查、按需保留字节、sha256。 */
function addArchiveEntry(rel, size, bytes, entries, errors, budget) {
  if (size > LIMITS.MAX_ENTRY_BYTES) {
    errors.push({ path: rel, reason: `单文件超过 ${LIMITS.MAX_ENTRY_BYTES} 字节，跳过` })
    return
  }
  if (budget.bytes + size > LIMITS.MAX_TOTAL_BYTES || budget.count >= LIMITS.MAX_ENTRIES) {
    errors.push({ path: rel, reason: '交付物总量/条目数超限，跳过' })
    return
  }
  const kind = kindOf(rel)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const keepData = size <= dataCap(kind)
  budget.bytes += size
  budget.count += 1
  entries.push({ path: rel, size, sha256, kind, data: keepData ? bytes : null })
}

/** zip 解包扫描（Unzip.push 同步处理，受 LIMITS 约束）。 */
async function scanZip(adapter, zipPath, exclude) {
  const archive = await adapter.readBytes(zipPath, LIMITS.MAX_ARCHIVE_BYTES)
  if (archive === null) throw new Error(`zip 压缩包超过 ${LIMITS.MAX_ARCHIVE_BYTES} 字节，拒绝解包`)
  const entries = []
  const errors = []
  const budget = { bytes: 0, count: 0 }
  const unzip = new Unzip((file) => {
    if (file.name.endsWith('/')) {
      file.terminate() // 目录条目
      return
    }
    const rel = sanitizeEntryPath(file.name)
    if (rel === null || excludedByDir(rel) || excludedByPrefix(rel, exclude)) {
      file.terminate() // 非法路径/排除目录/产物目录：静默跳过
      return
    }
    const chunks = []
    let received = 0
    file.ondata = (error, chunk, final) => {
      if (error !== null) {
        errors.push({ path: rel, reason: `解压失败：${error.message}` })
        return
      }
      received += chunk.length
      if (received <= LIMITS.MAX_ENTRY_BYTES) chunks.push(chunk.slice())
      if (final) {
        // file.size 为压缩后长度，file.originalSize 为解压后长度（数据描述符条目两者可能不可靠）
        const expected = file.originalSize ?? file.size
        if (expected > 0 && received !== expected) {
          errors.push({ path: rel, reason: '压缩条目长度与声明不符，跳过' })
          return
        }
        addArchiveEntry(rel, received, concatBytes(chunks), entries, errors, budget)
      }
    }
    file.start() // 显式启动该条目的数据投递
  })
  unzip.register(UnzipInflate) // 支持 deflate 压缩条目（默认仅 stored）
  try {
    unzip.push(new Uint8Array(archive), true) // 同步处理全部条目
  } catch (error) {
    throw new Error(`zip 解包失败：${error.message}`)
  }
  return { entries, errors }
}

/** tar.gz 解包扫描（同上约束）。 */
async function scanTarGz(adapter, tarPath, exclude) {
  const archive = await adapter.readBytes(tarPath, LIMITS.MAX_ARCHIVE_BYTES)
  if (archive === null) throw new Error(`tar.gz 压缩包超过 ${LIMITS.MAX_ARCHIVE_BYTES} 字节，拒绝解包`)
  let decompressed
  try {
    decompressed = gunzipSync(Buffer.from(archive))
  } catch (error) {
    throw new Error(`tar.gz 解压失败：${error.message}`)
  }
  if (decompressed.length > LIMITS.MAX_TOTAL_BYTES) {
    throw new Error(`tar.gz 解压后超过 ${LIMITS.MAX_TOTAL_BYTES} 字节，拒绝解包`)
  }
  const entries = []
  const errors = []
  const budget = { bytes: 0, count: 0 }
  await new Promise((resolve, reject) => {
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file') {
        stream.resume()
        next()
        return
      }
      const rel = sanitizeEntryPath(header.name)
      if (rel === null || excludedByDir(rel) || excludedByPrefix(rel, exclude)) {
        stream.resume()
        next()
        return
      }
      const chunks = []
      let received = 0
      stream.on('data', (chunk) => {
        received += chunk.length
        if (received <= LIMITS.MAX_ENTRY_BYTES) chunks.push(Buffer.from(chunk))
      })
      stream.on('end', () => {
        if (received !== header.size) {
          errors.push({ path: rel, reason: 'tar 条目长度与声明不符，跳过' })
        } else {
          addArchiveEntry(rel, header.size, concatBytes(chunks), entries, errors, budget)
        }
        next()
      })
      stream.on('error', (error) => {
        errors.push({ path: rel, reason: `tar 条目读取失败：${error.message}` })
        next()
      })
    })
    extract.on('error', (error) => reject(new Error(`tar 解包失败：${error.message}`)))
    extract.on('finish', () => resolve())
    extract.end(decompressed)
  })
  return { entries, errors }
}

/** Uint8Array/Buffer 分块拼接（每块已拷贝，直接 concat）。 */
function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}
