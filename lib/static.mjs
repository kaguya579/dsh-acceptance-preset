// tree-sitter 静态分析：六语言（C/C++/Java/JavaScript/TypeScript/TSX）符号提取，
// 同一遍遍历附带提取：跨文件引用（import/include/require/reexport）与函数度量
// （行数/圈复杂度）。使用 web-tree-sitter（WASM，纯 JS，无原生编译）。
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

// 圈复杂度计数的决策点节点类型（按语言语法差异并集）
const DECISION_TYPES = new Set([
  'if_statement', 'for_statement', 'while_statement', 'do_statement',
  'conditional_expression', 'catch_clause',
  'case_statement', // C / C++
  'switch_case', // JS / TS / TSX
  'switch_block_statement_group', // Java
])

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

/** C/C++ function_definition / class_specifier 的符号名提取。 */
function recordFor(type, node) {
  if (type === 'function_definition') {
    // C/C++：declarator → function_declarator → declarator(identifier)
    let declarator = node.childForFieldName('declarator')
    if (declarator !== null && declarator.type !== 'function_declarator' && declarator.type !== 'identifier') {
      declarator = declarator.childForFieldName('declarator')
    }
    const identifier = declarator?.childForFieldName('declarator') ?? declarator
    if (identifier !== null && identifier !== undefined && (identifier.type === 'identifier' || identifier.type === 'field_identifier')) {
      return { kind: '函数', name: identifier.text }
    }
  } else if (type === 'class_specifier') {
    const identifier = node.childForFieldName('name')
    if (identifier !== null) return { kind: '类', name: identifier.text }
  } else if (KIND_BY_TYPE[type] !== undefined) {
    const identifier = node.childForFieldName('name')
    if (identifier !== null) return { kind: KIND_BY_TYPE[type], name: identifier.text }
  }
  return null
}

/** 迭代遍历子树，统计决策点数量（圈复杂度计数的确定性口径：决策点 + 1）。 */
function countDecisions(root) {
  let count = 0
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (DECISION_TYPES.has(node.type)) {
      count += 1
    } else if (node.type === 'binary_expression') {
      const operator = node.childForFieldName('operator')
      if (operator !== null && (operator.text === '&&' || operator.text === '||')) count += 1
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) stack.push(node.child(index))
  }
  return count
}

/** 去掉字符串节点文本两端的引号。 */
function unquote(text) {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1)
  }
  return text
}

/** 提取单棵语法树的事实（迭代遍历，防深递归爆栈）。 */
function extractFacts(root) {
  const symbols = []
  const imports = []
  const functions = []
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    const type = node.type

    // 符号（含函数度量：行数 + 圈复杂度）
    const record = recordFor(type, node)
    if (record !== null) {
      const line = node.startPosition.row + 1
      symbols.push({ kind: record.kind, name: record.name, line })
      if (record.kind === '函数' || record.kind === '方法') {
        functions.push({
          name: record.name,
          kind: record.kind,
          line,
          lines: node.endPosition.row - node.startPosition.row + 1,
          complexity: countDecisions(node) + 1,
        })
      }
    }

    // 跨文件引用
    if (type === 'preproc_include') {
      const pathNode = node.childForFieldName('path')
      if (pathNode !== null) {
        const text = pathNode.text
        imports.push({ kind: 'include', ref: unquote(text), local: text.startsWith('"') })
      }
    } else if (type === 'import_statement') {
      const source = node.childForFieldName('source')
      if (source !== null) imports.push({ kind: 'import', ref: unquote(source.text), local: false })
    } else if (type === 'import_declaration') {
      // Java：import b.Helper; → 最后一个命名子节点；通配/静态导入的 ref 需拼回
      const children = []
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index)
        if (child !== null) children.push(child)
      }
      const last = children[children.length - 1]
      if (last !== undefined) {
        if (last.type === 'asterisk') {
          const scope = children[children.length - 2]
          const ref = scope !== undefined ? `${scope.text}.*` : '*'
          imports.push({ kind: 'import', ref, local: false })
        } else {
          imports.push({ kind: 'import', ref: last.text, local: false })
        }
      }
    } else if (type === 'export_statement') {
      const source = node.childForFieldName('source')
      if (source !== null) imports.push({ kind: 'reexport', ref: unquote(source.text), local: false })
    } else if (type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (callee !== null && callee.type === 'identifier' && callee.text === 'require') {
        const args = node.childForFieldName('arguments')
        const first = args?.namedChild(0)
        if (first !== null && first !== undefined && first.type === 'string') {
          imports.push({ kind: 'require', ref: unquote(first.text), local: false })
        }
      }
    }

    for (let index = node.childCount - 1; index >= 0; index -= 1) stack.push(node.child(index))
  }
  return { symbols, imports, functions }
}

/**
 * 分析全部代码条目 → { files, languages, errors, imports, metrics }。
 * files 保持既有形状（path/language/symbols）；imports/metrics 按文件对齐，
 * 供依赖图与复杂度聚合使用（同一次解析，不重复 parse）。
 */
export async function analyzeCodeFiles(codeEntries) {
  const languages = await loadLanguages()
  const files = []
  const errors = []
  const imports = []
  const metrics = []
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
      const facts = extractFacts(tree.rootNode)
      files.push({ path: entry.path, language, symbols: facts.symbols })
      imports.push({ path: entry.path, language, imports: facts.imports })
      metrics.push({ path: entry.path, language, file_lines: source.split('\n').length, functions: facts.functions })
      languageSet.add(language)
    } catch (error) {
      errors.push({ path: entry.path, reason: `语法解析失败：${error.message}` })
    }
  }
  return { files, languages: [...languageSet], errors, imports, metrics }
}
