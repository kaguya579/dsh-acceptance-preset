// 依赖清单：解析构建清单（package.json / pom.xml / CMakeLists.txt）声明的第三方库与版本。
// 版本缺失留空、绝不猜测；CMake 为文本启发式，明确标注 heuristic。

import { DOMParser } from '@xmldom/xmldom'

const ENTRIES_CAP = 2000

function parsePackageJson(text) {
  const entries = []
  let json
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { entries, error: `package.json 解析失败：${error.message}` }
  }
  const sections = [
    ['dependencies', 'npm'],
    ['devDependencies', 'npm-dev'],
  ]
  for (const [section, type] of sections) {
    const deps = json[section]
    if (deps === undefined || deps === null || typeof deps !== 'object') continue
    for (const [name, version] of Object.entries(deps)) {
      entries.push({ name, version: typeof version === 'string' ? version : '', type })
    }
  }
  return { entries, error: null }
}

function parsePomXml(text) {
  const entries = []
  let doc
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
  } catch (error) {
    return { entries, error: `pom.xml 解析失败：${error.message}` }
  }
  // 属性占位符映射（${...} 尽力展开）
  const properties = new Map()
  const propsNodes = doc.getElementsByTagName('properties')
  for (let index = 0; index < propsNodes.length; index += 1) {
    const prop = propsNodes.item(index)
    for (let childIndex = 0; childIndex < prop.childNodes.length; childIndex += 1) {
      const child = prop.childNodes.item(childIndex)
      if (child.nodeType === 1) properties.set(child.tagName, child.textContent?.trim() ?? '')
    }
  }
  const interpolate = (value) => value.replace(/\$\{([^}]+)\}/g, (_, key) => properties.get(key) ?? `\${${key}}`)

  const depNodes = doc.getElementsByTagName('dependency')
  for (let index = 0; index < depNodes.length; index += 1) {
    const dep = depNodes.item(index)
    const textOf = (tag) => {
      const el = dep.getElementsByTagName(tag).item(0)
      return el === null || el === undefined ? '' : (el.textContent ?? '').trim()
    }
    const groupId = textOf('groupId')
    const artifactId = textOf('artifactId')
    if (groupId === '' || artifactId === '') continue
    entries.push({
      name: `${groupId}:${artifactId}`,
      version: interpolate(textOf('version')),
      type: 'maven',
    })
  }
  return { entries, error: null }
}

function parseCmakeLists(text) {
  const entries = []
  const findPackages = /find_package\s*\(\s*([A-Za-z0-9_.+-]+)/g
  for (const match of text.matchAll(findPackages)) {
    entries.push({ name: match[1], version: '', type: 'cmake-find_package' })
  }
  const linkLibraries = /target_link_libraries\s*\(\s*([A-Za-z0-9_.+-]+)\s*([^)]*)\)/g
  for (const match of text.matchAll(linkLibraries)) {
    const target = match[1]
    for (const lib of match[2].split(/\s+/)) {
      const name = lib.trim()
      if (name === '' || name === target) continue
      if (/^(PUBLIC|PRIVATE|INTERFACE|debug|optimized|general)$/.test(name)) continue
      entries.push({ name, version: '', type: `cmake-link:${target}` })
    }
  }
  const addSubdirs = /add_subdirectory\s*\(\s*([A-Za-z0-9_.+-/]+)/g
  for (const match of text.matchAll(addSubdirs)) {
    entries.push({ name: match[1], version: '', type: 'cmake-subdir' })
  }
  return { entries, error: null }
}

/**
 * 解析构建清单条目 → 依赖清单。
 * @param buildEntries  交付物中 kind === 'build' 的条目（data 保留字节）
 * @returns { entries, errors, heuristic }  条目带 source 文件路径
 */
export function parseManifests(buildEntries) {
  const entries = []
  const errors = []
  let heuristic = false
  for (const entry of buildEntries) {
    if (entry.data === null) continue
    let text
    try {
      text = new TextDecoder('utf-8').decode(entry.data)
    } catch (error) {
      errors.push({ path: entry.path, reason: `构建清单解码失败：${error.message}` })
      continue
    }
    const base = entry.path.split('/').pop()
    let parsed = { entries: [], error: null }
    if (base === 'package.json') {
      parsed = parsePackageJson(text)
    } else if (base === 'pom.xml') {
      parsed = parsePomXml(text)
    } else if (base === 'CMakeLists.txt') {
      parsed = parseCmakeLists(text)
      heuristic = true
    } else {
      continue // 其余构建清单格式不在第一刀范围
    }
    if (parsed.error !== null) {
      errors.push({ path: entry.path, reason: parsed.error })
      continue
    }
    for (const item of parsed.entries) {
      if (entries.length >= ENTRIES_CAP) break
      entries.push({ ...item, source: entry.path })
    }
  }
  // 按 名称+版本+类型 去重（保留首个来源）
  const seen = new Set()
  const deduped = []
  for (const item of entries) {
    const key = `${item.name}\u0000${item.version}\u0000${item.type}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return { entries: deduped, errors, heuristic }
}
