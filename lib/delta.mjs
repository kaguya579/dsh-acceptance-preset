// 依赖漂移 delta：对比上轮与本轮的架构事实，产出可复现的轮次间变化。
// 纯确定性：输入 = 上轮/本轮 facts 的 architecture_facts（或其 dependencies），
// 输出 = 结构化 delta；绝不产出结论（「新增环是否问题」由 agent 判断）。

const LIST_CAP = 2000

function edgeKey(edge) {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
}

function cycleKey(cycle) {
  return [...cycle].sort().join('\u0000')
}

function diffLists(prevList, curList, keyOf) {
  const prevKeys = new Set((prevList ?? []).map(keyOf))
  const curKeys = new Set((curList ?? []).map(keyOf))
  const added = (curList ?? []).filter((item) => !prevKeys.has(keyOf(item)))
  const removed = (prevList ?? []).filter((item) => !curKeys.has(keyOf(item)))
  return {
    added: added.slice(0, LIST_CAP),
    removed: removed.slice(0, LIST_CAP),
    truncated: added.length > LIST_CAP || removed.length > LIST_CAP,
  }
}

/**
 * 对比两轮架构事实 → delta。
 * @param prev  上轮 facts 的 architecture_facts（或 null）
 * @param current  本轮 facts 的 architecture_facts
 * @returns delta 对象；prev 缺失时返回 null（调用方负责 note）
 */
export function computeArchitectureDelta(prev, current) {
  if (prev === null || prev === undefined || typeof prev !== 'object') return null
  const prevDeps = prev.dependencies ?? {}
  const curDeps = current.dependencies ?? {}

  const edgeDiff = diffLists(prevDeps.edges, curDeps.edges, edgeKey)
  const moduleDiff = diffLists(prevDeps.module_edges, curDeps.module_edges, edgeKey)
  const cycleDiff = diffLists(prevDeps.cycles, curDeps.cycles, cycleKey)

  const prevModules = new Set((prevDeps.modules ?? []).map((module) => module.name))
  const curModules = new Set((curDeps.modules ?? []).map((module) => module.name))
  const modulesAdded = [...curModules].filter((name) => !prevModules.has(name)).sort()
  const modulesRemoved = [...prevModules].filter((name) => !curModules.has(name)).sort()

  const prevMetrics = prev.metrics ?? {}
  const curMetrics = current.metrics ?? {}
  const countFunctions = (metrics) => metrics?.distribution?.function_count ?? 0
  const modulesLines = (modules) => (modules ?? []).reduce((sum, module) => sum + (module.lines ?? 0), 0)
  const prevLines = modulesLines(prev.modules)
  const curLines = modulesLines(current.modules)

  const countDeps = (deps, field) => (deps?.[field] ?? []).length
  const countExternal = (deps) => (deps?.external ?? []).reduce((sum, entry) => sum + entry.count, 0)

  return {
    edges_added: edgeDiff.added,
    edges_removed: edgeDiff.removed,
    edges_truncated: edgeDiff.truncated,
    module_edges_added: moduleDiff.added,
    module_edges_removed: moduleDiff.removed,
    cycles_added: cycleDiff.added,
    cycles_removed: cycleDiff.removed,
    modules_added: modulesAdded.slice(0, LIST_CAP),
    modules_removed: modulesRemoved.slice(0, LIST_CAP),
    function_count_delta: countFunctions(curMetrics) - countFunctions(prevMetrics),
    module_lines_delta: curLines - prevLines,
    unresolved_delta: countDeps(curDeps, 'unresolved') - countDeps(prevDeps, 'unresolved'),
    external_delta: countExternal(curDeps) - countExternal(prevDeps),
  }
}
