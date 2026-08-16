// 基线加载与确定性补缺识别（复用验收工具的口径）：
// - 基线形态：JSON 结构化清单 / md 清单行 / docx 列表段；目录聚合其下全部基线文件；
// - 每条要求项带出处（source_path + location）；
// - 补缺匹配：规范化（trim + 小写）子串匹配，候选来自交付物相对路径、末段名、
//   去扩展名与文档标题；不做语义/模糊匹配。

import mammoth from 'mammoth'

const LIST_LINE_RE = /^\s*(?:[-*•]\s+|[-*•](?=\S)|(?:[-*]\s*)?\[[ xX]\]\s+)(.+?)\s*$/
const NUMBERED_RE = /^\s*(?:\d+[.)、]|（\d+）)\s*(.+?)\s*$/

/** 加载基线（文件或目录）。 */
export async function loadBaseline(adapter, baselinePath) {
  const stat = await adapter.stat(baselinePath)
  if (stat === null) throw new Error(`基线不存在：${baselinePath}`)
  if (stat.type === 'directory') {
    const items = []
    const children = await adapter.listDir(baselinePath)
    for (const child of children) {
      if (child.type !== 'file') continue
      const lower = child.name.toLowerCase()
      if (!(lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.docx'))) continue
      items.push(...await loadBaselineFile(adapter, `${baselinePath}\\${child.name}`))
    }
    if (items.length === 0) throw new Error(`基线目录下无可用基线文件（JSON/md/docx）：${baselinePath}`)
    return items
  }
  if (stat.type === 'file') return loadBaselineFile(adapter, baselinePath)
  throw new Error(`基线路径不可用：${baselinePath}`)
}

/** 单个基线文件 → 要求项清单。 */
async function loadBaselineFile(adapter, filePath) {
  const lower = filePath.toLowerCase()
  const name = filePath.replace(/\\/g, '/').split('/').pop()
  if (lower.endsWith('.json')) {
    const text = await adapter.readText(filePath)
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      throw new Error(`基线 JSON 解析失败：${filePath}：${error.message}`)
    }
    const required = Array.isArray(data) ? data : data?.required_items
    if (!Array.isArray(required)) throw new Error(`基线 JSON 缺少 required_items 数组：${filePath}`)
    return required
      .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
      .map((entry, index) => ({ text: entry.trim(), source_path: name, location: `required_items[${index}]` }))
  }
  if (lower.endsWith('.md')) {
    const text = await adapter.readText(filePath)
    const lines = text.split(/\r?\n/)
    const items = []
    for (let index = 0; index < lines.length; index += 1) {
      const match = LIST_LINE_RE.exec(lines[index]) ?? NUMBERED_RE.exec(lines[index])
      if (match !== null && match[1].trim() !== '') {
        items.push({ text: match[1].trim(), source_path: name, location: `第 ${index + 1} 行` })
      }
    }
    return items
  }
  if (lower.endsWith('.docx')) {
    const bytes = await adapter.readBytes(filePath, 20 * 1024 * 1024)
    if (bytes === null) throw new Error(`基线 docx 过大：${filePath}`)
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    const items = []
    String(value ?? '').split(/\r?\n/).forEach((line, index) => {
      const match = LIST_LINE_RE.exec(line) ?? NUMBERED_RE.exec(line)
      if (match !== null && match[1].trim() !== '') {
        items.push({ text: match[1].trim(), source_path: name, location: `第 ${index + 1} 行` })
      }
    })
    return items
  }
  throw new Error(`不支持的基线格式：${filePath}`)
}

/** 规范化：trim + 小写。 */
function normalize(text) {
  return text.trim().toLowerCase()
}

/** 补缺识别：返回基线要求但在交付物中不存在的要求项。 */
export function findMissing(requiredItems, candidateNames) {
  const candidates = candidateNames.map(normalize)
  const missing = []
  for (const item of requiredItems) {
    const target = normalize(item.text)
    if (!candidates.some((candidate) => candidate.includes(target))) {
      missing.push(item)
    }
  }
  return missing
}

/** 从条目与文档元数据构建匹配候选名（口径同验收工具）。 */
export function candidateNames(entries, documents) {
  const names = []
  for (const entry of entries) {
    names.push(entry.path)
    const last = entry.path.split('/').pop()
    names.push(last)
    const dot = last.lastIndexOf('.')
    names.push(dot > 0 ? last.slice(0, dot) : last)
  }
  for (const document of documents) {
    if (document.title !== null) names.push(document.title)
  }
  return names
}
