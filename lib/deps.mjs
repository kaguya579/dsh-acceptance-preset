// 依赖图：把每文件的跨文件引用（static.mjs 提取的 imports）解析为文件级依赖边，
// 聚合模块（目录）级边，检测循环依赖（强连通分量）。纯确定性，绝不猜测映射。

const EDGES_CAP = 50000
const UNRESOLVED_CAP = 2000
const CYCLES_CAP = 200
const MODULE_EDGES_CAP = 20000

// JS/TS 相对引用候选扩展名（含 index 推断）
const RESOLVE_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

function dirnameOf(relPath) {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? '' : relPath.slice(0, index)
}

/** 模块名：文件所在目录；根目录文件归「（根目录）」。 */
function moduleOf(relPath) {
  const dir = dirnameOf(relPath)
  return dir === '' ? '（根目录）' : dir
}

/** 规范化（'/' 分隔、折叠 ./ 与多余的 .. 前置）。 */
function normalizeRel(pathText) {
  const parts = []
  for (const segment of pathText.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

/**
 * 解析引用 → 项目内文件路径（相对该文件），未命中返回 null。
 * @param lookup  小写路径 → 规范路径 的索引（交付物全部代码文件）
 * @param isLocal  仅 include 用：引号本地头为 true，尖括号系统头为 false
 * @param suffixIndex  Java 后缀索引（小写后缀 → 候选文件，按偏好排序）
 */
function resolveRef(language, kind, ref, fromFile, lookup, isLocal, suffixIndex) {
  if (kind === 'include') {
    if (isLocal !== true) return null // 系统头 <...>：不猜测
    const base = normalizeRel(dirnameOf(fromFile) === '' ? ref : `${dirnameOf(fromFile)}/${ref}`)
    return lookup.get(base.toLowerCase()) ?? null
  }
  if (kind === 'import' || kind === 'require' || kind === 'reexport') {
    if (language === 'Java') {
      // import com.foo.Bar → com/foo/Bar.java；通配/静态导入不可定位
      if (ref.endsWith('.*') || ref.startsWith('static ')) return null
      const target = (ref.replace(/\./g, '/') + '.java').toLowerCase()
      const exact = lookup.get(target)
      if (exact !== undefined) return exact
      // Maven 多模块布局：真实路径带 hutool-core/src/main/java 等前缀 → 后缀匹配（偏好 main > test > 其余）
      const candidates = suffixIndex.get(target)
      return candidates !== undefined && candidates.length > 0 ? candidates[0] : null
    }
    if (ref.startsWith('./') || ref.startsWith('../')) {
      const base = normalizeRel(dirnameOf(fromFile) === '' ? ref : `${dirnameOf(fromFile)}/${ref}`)
      const candidates = [base, ...[...RESOLVE_EXTS].map((ext) => base + ext)]
      for (const candidate of candidates) {
        const hit = lookup.get(candidate.toLowerCase())
        if (hit !== undefined) return hit
      }
      // 目录 index 推断：base/index.{js,jsx,ts,tsx}
      for (const ext of RESOLVE_EXTS) {
        const hit = lookup.get(`${base}/index${ext}`.toLowerCase())
        if (hit !== undefined) return hit
      }
      return null
    }
    return null // 包名引用：不猜测，归未解析
  }
  return null
}

/**
 * 组装依赖图。
 * @param codeFiles  全部代码文件路径（含 .h 等）
 * @param perFileImports  static.mjs 的 imports 输出（{ path, language, imports }[]）
 * @returns { edges, module_edges, modules, cycles, unresolved, edges_truncated }
 */
export function buildDependencyGraph(codeFiles, perFileImports) {
  const lookup = new Map()
  for (const file of codeFiles) lookup.set(file.toLowerCase(), file)

  // Java 后缀索引：Maven 工程真实路径带 src/main/java 等前缀，
  // import cn.foo.Bar 按「路径以 /cn/foo/Bar.java 结尾」后缀匹配。
  // 偏好排序：/src/main/java/ > /src/test/java/ > 其余；同档短路径优先。
  const suffixIndex = new Map()
  const preferenceOf = (file) => {
    const lower = file.toLowerCase()
    if (lower.includes('/src/main/java/')) return 0
    if (lower.includes('/src/test/java/')) return 1
    return 2
  }
  for (const file of codeFiles) {
    if (!file.toLowerCase().endsWith('.java')) continue
    const segments = file.toLowerCase().split('/')
    for (let start = 0; start < segments.length; start += 1) {
      const suffix = segments.slice(start).join('/')
      if (!suffixIndex.has(suffix)) suffixIndex.set(suffix, [])
      suffixIndex.get(suffix).push(file)
    }
  }
  for (const list of suffixIndex.values()) {
    list.sort((a, b) => preferenceOf(a) - preferenceOf(b) || a.length - b.length)
  }

  const edges = []
  const edgeSet = new Set()
  const unresolved = []
  let edgesTruncated = false
  const moduleFiles = new Map()

  for (const file of codeFiles) {
    const module = moduleOf(file)
    if (!moduleFiles.has(module)) moduleFiles.set(module, [])
    moduleFiles.get(module).push(file)
  }

  for (const item of perFileImports) {
    const { path: fromFile, language, imports } = item
    for (const ref of imports) {
      const target = resolveRef(language, ref.kind, ref.ref, fromFile, lookup, ref.local, suffixIndex)
      if (target === null) {
        if (unresolved.length < UNRESOLVED_CAP) unresolved.push({ file: fromFile, ref: ref.ref, kind: ref.kind })
        continue
      }
      const key = `${fromFile}\u0000${target}\u0000${ref.kind}`
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      if (edges.length >= EDGES_CAP) {
        edgesTruncated = true
        continue
      }
      edges.push({ from: fromFile, to: target, kind: ref.kind })
    }
  }

  // 模块级边（去重）
  const moduleEdgeSet = new Set()
  const moduleEdges = []
  for (const edge of edges) {
    const fromModule = moduleOf(edge.from)
    const toModule = moduleOf(edge.to)
    if (fromModule === toModule) continue
    const key = `${fromModule}\u0000${toModule}`
    if (moduleEdgeSet.has(key)) continue
    moduleEdgeSet.add(key)
    if (moduleEdges.length >= MODULE_EDGES_CAP) break
    moduleEdges.push({ from: fromModule, to: toModule })
  }

  const modules = [...moduleFiles.keys()].sort().map((name) => ({
    name,
    file_count: moduleFiles.get(name).length,
  }))

  const cycles = findCycles(codeFiles, edges)

  return {
    edges,
    edges_truncated: edgesTruncated,
    module_edges: moduleEdges,
    modules,
    cycles,
    unresolved,
  }
}

/** Tarjan 强连通分量 → 环清单（自环单节点也算环）。带总步数预算防病态图。 */
function findCycles(codeFiles, edges) {
  const adjacency = new Map()
  for (const file of codeFiles) adjacency.set(file, [])
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to)

  const cycles = []
  const seen = new Set()
  const budget = { steps: 0 }
  const MAX_STEPS = 2_000_000

  function walk(start) {
    // 从 start 出发的 DFS 找回到 start 的环
    const stack = [{ node: start, path: [start], visited: new Set([start]) }]
    while (stack.length > 0 && cycles.length < CYCLES_CAP && budget.steps < MAX_STEPS) {
      const { node, path: currentPath, visited } = stack.pop()
      budget.steps += 1
      const nexts = adjacency.get(node) ?? []
      for (const next of nexts) {
        if (cycles.length >= CYCLES_CAP || budget.steps >= MAX_STEPS) break
        if (next === start) {
          const members = [...currentPath]
          const canonical = [...new Set(members)].sort().join('\u0000')
          if (!seen.has(canonical)) {
            seen.add(canonical)
            cycles.push([...new Set(members)].sort())
          }
        } else if (!visited.has(next) && currentPath.length < 64) {
          const nextVisited = new Set(visited)
          nextVisited.add(next)
          stack.push({ node: next, path: [...currentPath, next], visited: nextVisited })
        }
      }
    }
  }

  for (const file of codeFiles) {
    if (cycles.length >= CYCLES_CAP) break
    walk(file)
  }
  return cycles.slice(0, CYCLES_CAP)
}
