// tree-sitter 静态分析：六语言（C/C++/Java/JavaScript/TypeScript/TSX）符号提取。
// 使用 web-tree-sitter（WASM，纯 JS，无原生编译）+ tree-sitter-wasms 语法包。
// 只读解析、绝不执行交付代码；语法包 wasm 从本仓库 node_modules 加载。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser, Language } from 'web-tree-sitter'
import { CODE_LANG } from './deliverable.mjs'

const WASM_DIR = fileURLToPath(new URL('../node_modules/tree-sitter-wasms/out/', import.meta.url))
const LANG_WASM = {
  C: 'tree-sitter-c.wasm',
  'C++': 'tree-sitter-cpp.wasm',
  Java: 'tree-sitter-java.wasm',
  JavaScript: 'tree-sitter-javascript.wasm',
  TypeScript: 'tree-sitter-typescript.wasm',
  TSX: 'tree-sitter-tsx.wasm',
}

// 符号 kind 映射（与验收工具口径一致：函数/类/接口/方法）
const KIND_BY_TYPE = {
  function_declaration: '函数',
  method_declaration: '方法',
  method_definition: '方法',
  class_declaration: '类',
  record_declaration: '类',
  interface_declaration: '接口',
}

let loaded = null

/** 惰性加载全部语法（进程内单例）。 */
async function loadLanguages() {
  if (loaded !== null) return loaded
  await Parser.init()
  const languages = {}
  for (const [name, filename] of Object.entries(LANG_WASM)) {
    languages[name] = await Language.load(await readFile(path.join(WASM_DIR, filename)))
  }
  loaded = languages
  return loaded
}

/** 提取单棵语法树的符号（迭代遍历，防深递归爆栈）。 */
function extractSymbols(root) {
  const symbols = []
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    const type = node.type
    let record = null
    if (type === 'function_definition') {
      // C/C++：declarator → function_declarator → declarator(identifier)
      let declarator = node.childForFieldName('declarator')
      if (declarator !== null && declarator.type !== 'function_declarator' && declarator.type !== 'identifier') {
        declarator = declarator.childForFieldName('declarator')
      }
      const identifier = declarator?.childForFieldName('declarator') ?? declarator
      if (identifier !== null && identifier !== undefined && (identifier.type === 'identifier' || identifier.type === 'field_identifier')) {
        record = { kind: '函数', name: identifier.text }
      }
    } else if (type === 'class_specifier') {
      // C++ 结构体/类
      const identifier = node.childForFieldName('name')
      if (identifier !== null) record = { kind: '类', name: identifier.text }
    } else if (KIND_BY_TYPE[type] !== undefined) {
      const identifier = node.childForFieldName('name')
      if (identifier !== null) record = { kind: KIND_BY_TYPE[type], name: identifier.text }
    }
    if (record !== null) {
      symbols.push({ kind: record.kind, name: record.name, line: node.startPosition.row + 1 })
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) stack.push(node.child(index))
  }
  return symbols
}

/** 分析全部代码条目 → { files, languages, errors }。 */
export async function analyzeCodeFiles(codeEntries) {
  const languages = await loadLanguages()
  const files = []
  const errors = []
  const languageSet = new Set()
  for (const entry of codeEntries) {
    const ext = '.' + entry.path.toLowerCase().split('.').pop()
    const language = CODE_LANG.get(ext)
    if (language === undefined || languages[language] === undefined) continue
    if (entry.data === null) {
      errors.push({ path: entry.path, reason: '文件过大（> 2MB）未做静态分析' })
      continue
    }
    try {
      const parser = new Parser()
      parser.setLanguage(languages[language])
      const source = new TextDecoder('utf-8').decode(entry.data)
      const tree = parser.parse(source)
      files.push({ path: entry.path, language, symbols: extractSymbols(tree.rootNode) })
      languageSet.add(language)
    } catch (error) {
      errors.push({ path: entry.path, reason: `语法解析失败：${error.message}` })
    }
  }
  return { files, languages: [...languageSet], errors }
}
