// 模块级架构事实：耦合度量（Ce/Ca、不稳定性、抽象度、主序列距离）、
// 规模/复杂度/重复聚合表、孤儿模块与入口可达性。纯确定性，绝不产出结论。
// 语义判断（哪些模块是中枢、哪些不可达是问题）由 agent 完成。

const ORPHANS_CAP = 500
const UNREACHABLE_CAP = 1000

/** 模块名（目录）：文件所在目录；根目录文件归「（根目录）」。单一实现点。 */
export function moduleOf(relPath) {
  const index = relPath.lastIndexOf('/')
  const dir = index === -1 ? '' : relPath.slice(0, index)
  return dir === '' ? '（根目录）' : dir
}

/** 入口文件启发式：符号名为 main 的文件，或 basename 以 Main/App/main/app/index 开头。 */
function isEntryFile(file, symbols) {
  const base = file.split('/').pop()
  if (/^(main|Main|app|App|index|Index)[._-]/.test(base) || /^(main|Main|app|App|index|Index)\.[^.]+$/.test(base)) return true
  const symbolsForFile = symbols.get(file)
  if (symbolsForFile !== undefined) {
    return symbolsForFile.some((symbol) => symbol.name === 'main' && (symbol.kind === '函数' || symbol.kind === '方法'))
  }
  return false
}

/**
 * 计算模块级事实。
 * @param codeFiles        全部代码文件路径
 * @param moduleEdges      模块级边（含 kind: 'file'|'wildcard'，来自 deps.mjs）
 * @param perFileMetrics   static.mjs metrics 输出（{ path, language, file_lines, functions }[]）
 * @param perFileSymbols   static.mjs files 输出（{ path, symbols }[]）
 * @param dupFragments     dupes.mjs fragments（occurrences 带 path）
 * @returns { modules, orphans, unreachable, entry_files }
 */
export function buildModuleFacts({ codeFiles, moduleEdges, perFileMetrics, perFileSymbols, dupFragments }) {
  // 模块归属（moduleOf 单一实现点在本模块）
  const moduleFiles = new Map()
  for (const file of codeFiles) {
    const module = moduleOf(file)
    if (!moduleFiles.has(module)) moduleFiles.set(module, [])
    moduleFiles.get(module).push(file)
  }

  // 度量与符号索引
  const metricsByPath = new Map()
  for (const item of perFileMetrics) metricsByPath.set(item.path, item)
  const symbolsByPath = new Map()
  for (const item of perFileSymbols) symbolsByPath.set(item.path, item.symbols ?? [])

  // 耦合：Ce/Ca 按模块级边（file + wildcard）
  const ceByModule = new Map()
  const caByModule = new Map()
  for (const edge of moduleEdges) {
    ceByModule.set(edge.from, (ceByModule.get(edge.from) ?? 0) + 1)
    caByModule.set(edge.to, (caByModule.get(edge.to) ?? 0) + 1)
  }

  // 重复按模块
  const dupByModule = new Map() // module → { fragments, lines }
  for (const fragment of dupFragments) {
    const seenModules = new Set()
    for (const occurrence of fragment.occurrences) {
      const module = moduleOf(occurrence.path)
      if (seenModules.has(module)) continue
      seenModules.add(module)
      const entry = dupByModule.get(module) ?? { fragments: 0, lines: 0 }
      entry.fragments += 1
      entry.lines += fragment.lines
      dupByModule.set(module, entry)
    }
  }

  const modules = []
  for (const [name, files] of [...moduleFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let functions = 0
    let lines = 0
    let complexitySum = 0
    let maxComplexity = 0
    let interfaces = 0
    let classes = 0
    for (const file of files) {
      const metric = metricsByPath.get(file)
      if (metric !== undefined) {
        lines += metric.file_lines
        functions += metric.functions.length
        for (const fn of metric.functions) {
          complexitySum += fn.complexity
          if (fn.complexity > maxComplexity) maxComplexity = fn.complexity
        }
      }
      for (const symbol of symbolsByPath.get(file) ?? []) {
        if (symbol.kind === '接口') interfaces += 1
        else if (symbol.kind === '类') classes += 1
      }
    }
    const ce = ceByModule.get(name) ?? 0
    const ca = caByModule.get(name) ?? 0
    const abstractness = interfaces + classes === 0 ? 0 : Math.round((interfaces / (interfaces + classes)) * 1000) / 1000
    const instability = ce + ca === 0 ? 0 : Math.round((ce / (ce + ca)) * 1000) / 1000
    const distance = Math.round(Math.abs(instability + abstractness - 1) * 1000) / 1000
    const dup = dupByModule.get(name) ?? { fragments: 0, lines: 0 }
    modules.push({
      name,
      file_count: files.length,
      functions,
      lines,
      mean_complexity: functions === 0 ? null : Math.round((complexitySum / functions) * 10) / 10,
      max_complexity: maxComplexity,
      ce,
      ca,
      instability,
      abstractness,
      distance,
      dup_fragments: dup.fragments,
      dup_lines: dup.lines,
    })
  }

  // 孤儿模块：文件级无入边且无出边（文件级数据由 computeReachability 提供）
  return { modules }
}

/** 架构事实摘要（同一组量的单一计算源：delta / supplier / report 复用）。 */
export function summarizeArchFacts(arch) {
  const deps = arch?.dependencies ?? {}
  const metrics = arch?.metrics ?? {}
  return {
    edges: (deps.edges ?? []).length,
    cycles: (deps.cycles ?? []).length,
    unresolved: (deps.unresolved ?? []).length,
    external: (deps.external ?? []).reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    over_threshold_functions: metrics.over_threshold?.functions?.length ?? null,
    dup_fragments: (arch?.duplicates?.fragments ?? []).length,
    modules: (deps.modules ?? []).length,
    module_lines: (arch?.modules ?? []).reduce((sum, module) => sum + (module.lines ?? 0), 0),
  }
}

/**
 * 文件级孤儿与入口可达性（需要文件级边）。
 * @param codeFiles  全部代码文件路径
 * @param edges      文件级边（{from,to}）
 * @param symbolsByPath   path → symbols[]
 */
export function computeReachability(codeFiles, edges, symbolsByPath) {
  const adjacency = new Map()
  const inDegree = new Map()
  const outDegree = new Map()
  for (const file of codeFiles) {
    adjacency.set(file, [])
    inDegree.set(file, 0)
    outDegree.set(file, 0)
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
    if (inDegree.has(edge.to)) inDegree.set(edge.to, inDegree.get(edge.to) + 1)
    if (outDegree.has(edge.from)) outDegree.set(edge.from, outDegree.get(edge.from) + 1)
  }

  const orphans = []
  for (const file of codeFiles) {
    if (inDegree.get(file) === 0 && outDegree.get(file) === 0) {
      orphans.push(file)
      if (orphans.length >= ORPHANS_CAP) break
    }
  }

  const entries = codeFiles.filter((file) => isEntryFile(file, symbolsByPath))
  const reached = new Set()
  const stack = [...entries]
  while (stack.length > 0) {
    const current = stack.pop()
    if (reached.has(current)) continue
    reached.add(current)
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) stack.push(next)
    }
  }
  const unreachable = codeFiles.filter((file) => !reached.has(file)).slice(0, UNREACHABLE_CAP)

  return { orphans, unreachable, entry_files: entries }
}
