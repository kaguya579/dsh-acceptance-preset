// 重复片段检测：规范化行级内容哈希，找出跨文件的重复连续行块（≥ 阈值行）。
// 纯确定性、零新增依赖；>2MB 文件不参与（data 为 null，由扫描层保证）。

export const MIN_FRAGMENT_LINES = 6
const FRAGMENTS_CAP = 500

/** 行规范化：去首尾空白，跳过空行。 */
function normalizeLine(line) {
  return line.trim()
}

/** 简单稳定字符串哈希（djb2 变体），只用于分组候选，不用于安全。 */
function hashLines(lines) {
  let hash = 5381
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      hash = ((hash * 33) ^ line.charCodeAt(index)) >>> 0
    }
    hash = ((hash * 33) ^ 0x1f) >>> 0 // 行分隔
  }
  return hash
}

/**
 * 检测跨文件重复片段。
 * @param codeEntries  交付物中 kind === 'code' 且 data 非 null 的条目
 * @returns { fragments, skipped_large }  片段含 occurrences（{path, line}[]）
 */
export function detectDuplicates(codeEntries) {
  // path → 规范化行数组
  const files = []
  const skippedLarge = []
  for (const entry of codeEntries) {
    if (entry.data === null) {
      skippedLarge.push({ path: entry.path, reason: '文件过大（> 2MB）未做重复检测' })
      continue
    }
    let text
    try {
      text = new TextDecoder('utf-8').decode(entry.data)
    } catch (error) {
      continue
    }
    const lines = text.split('\n').map(normalizeLine)
    files.push({ path: entry.path, lines })
  }

  // 6 行滑动窗哈希 → 出现位置
  const windows = new Map() // hash → [{path, line}]
  for (const file of files) {
    const lines = file.lines
    for (let start = 0; start + MIN_FRAGMENT_LINES <= lines.length; start += 1) {
      const window = []
      let allEmpty = true
      for (let offset = 0; offset < MIN_FRAGMENT_LINES; offset += 1) {
        const line = lines[start + offset]
        if (line !== '') allEmpty = false
        window.push(line)
      }
      if (allEmpty) continue
      const hash = hashLines(window)
      if (!windows.has(hash)) windows.set(hash, [])
      windows.get(hash).push({ path: file.path, line: start + 1 })
    }
  }

  // 候选：同一哈希出现在 ≥2 个不同文件 → 贪心延长比对
  const fragments = []
  const reported = new Set() // path|start 集合去重（避免同片段被多次报告）
  for (const occurrences of windows.values()) {
    if (fragments.length >= FRAGMENTS_CAP) break
    const distinctFiles = new Set(occurrences.map((occurrence) => occurrence.path))
    if (distinctFiles.size < 2) continue
    // 取首两个出现位置做贪心延长
    const anchor = occurrences[0]
    if (reported.has(`${anchor.path}|${anchor.line}`)) continue
    const anchorFile = files.find((file) => file.path === anchor.path)
    const otherFile = files.find((file) => file.path === [...distinctFiles][1])
    if (anchorFile === undefined || otherFile === undefined) continue
    let length = MIN_FRAGMENT_LINES
    while (
      anchor.line + length - 1 < anchorFile.lines.length
      && anchorFile.lines[anchor.line + length - 1] === otherFile.lines[occurrences.find((o) => o.path === otherFile.path).line + length - 1]
    ) {
      length += 1
    }
    // 收集该片段在全部文件中的出现位置
    const fragmentOccurrences = occurrences
      .filter((occurrence) => {
        const file = files.find((f) => f.path === occurrence.path)
        if (file === undefined) return false
        for (let offset = 0; offset < length; offset += 1) {
          if (file.lines[occurrence.line - 1 + offset] !== anchorFile.lines[anchor.line - 1 + offset]) return false
        }
        return true
      })
      .map((occurrence) => ({ path: occurrence.path, line: occurrence.line }))
    for (const occurrence of fragmentOccurrences) reported.add(`${occurrence.path}|${occurrence.line}`)
    fragments.push({ lines: length, occurrences: fragmentOccurrences })
  }
  fragments.sort((a, b) => b.lines - a.lines)
  return { fragments: fragments.slice(0, FRAGMENTS_CAP), skipped_large: skippedLarge }
}
