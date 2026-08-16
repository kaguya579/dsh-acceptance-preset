// 文档解析：md / docx / pdf / xlsx → 元数据（标题、章节数、段落数、表格数）。
// 只取元数据级信息（事实包）；正文语义判断由 agent 自行读原文。
// docx/pdf 的 sections 按 0 计（原生实现不做标题层级判定，schema 保留字段）。

import mammoth from 'mammoth'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as XLSX from 'xlsx'

/** md：标题 = 首个一级标题；章节 = 标题行数；段落 = 非空文本块数。 */
export function parseMarkdown(text) {
  const lines = text.split(/\r?\n/)
  let title = null
  let sections = 0
  for (const line of lines) {
    const match = /^\s{0,3}#\s+(.+?)\s*$/.exec(line)
    if (match !== null) {
      sections += 1
      if (title === null) title = match[1].trim()
    }
  }
  const paragraphs = countParagraphs(text)
  return { title, sections, paragraphs }
}

/** docx：mammoth 提取纯文本；标题 = 首行；段落 = 非空文本块。 */
export async function parseDocx(bytes) {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  const text = String(value ?? '')
  const lines = nonEmptyLines(text)
  return { title: lines.length > 0 ? lines[0] : null, sections: 0, paragraphs: countParagraphs(text) }
}

/** pdf：pdfjs 提取每页文本；标题 = 首行；段落 = 非空文本块。 */
export async function parsePdf(bytes) {
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const document = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise
  let text = ''
  try {
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex)
      const content = await page.getTextContent()
      for (const item of flattenTextItems(content.items)) {
        text += item.str + (item.hasEOL ? '\n' : ' ')
      }
      text += '\n'
    }
  } finally {
    await document.destroy()
  }
  const lines = nonEmptyLines(text)
  return { title: lines.length > 0 ? lines[0] : null, sections: 0, paragraphs: countParagraphs(text) }
}

/** xlsx：工作表名与行数；标题 = 工作簿属性标题或首个工作表名。 */
export function parseXlsx(bytes) {
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' })
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
    return { name, rows: range.e.r - range.s.r + 1 }
  })
  const title = workbook.Props?.Title ?? (sheets.length > 0 ? sheets[0].name : null)
  return { title, sections: 0, paragraphs: 0, tables: sheets.length, sheets }
}

/** 条目 → 文档元数据（入口）。entry.data 为原始字节。 */
export async function documentMeta(entry) {
  const ext = '.' + entry.path.toLowerCase().split('.').pop()
  const bytes = entry.data
  let parsed
  if (ext === '.md') {
    parsed = parseMarkdown(decodeUtf8(bytes))
  } else if (ext === '.docx') {
    parsed = await parseDocx(bytes)
  } else if (ext === '.pdf') {
    parsed = await parsePdf(bytes)
  } else if (ext === '.xlsx') {
    parsed = parseXlsx(bytes)
  } else {
    throw new Error(`未知文档类型：${entry.path}`)
  }
  return {
    kind: ext.slice(1),
    path: entry.path,
    title: parsed.title ?? null,
    sections: parsed.sections ?? 0,
    paragraphs: parsed.paragraphs ?? 0,
    tables: parsed.tables ?? 0,
    images: 0,
  }
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

function nonEmptyLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
}

function countParagraphs(text) {
  return text.split(/\n\s*\n/).map((block) => block.trim()).filter((block) => block.length > 0).length
}

function flattenTextItems(items, out = []) {
  for (const item of items) {
    if (typeof item.str === 'string') out.push(item)
    else if (Array.isArray(item.items)) flattenTextItems(item.items, out)
  }
  return out
}
