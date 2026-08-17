// 依赖漂移 delta：对比上轮与本轮的架构事实，产出可复现的轮次间变化。
// 纯确定性：输入 = 上轮/本轮 facts 的 architecture_facts（或其 dependencies），
// 输出 = 结构化 delta；绝不产出结论（「新增环是否问题」由 agent 判断）。

import { summarizeArchFacts } from './modules.mjs'

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
  const prevSummary = summarizeArchFacts(prev)
  const curSummary = summarizeArchFacts(current)

  // 模块 ce/ca 变化（同模块两轮均有才计）
  const prevModuleMap = new Map((prev.modules ?? []).map((module) => [module.name, module]))
  const curModuleMap = new Map((current.modules ?? []).map((module) => [module.name, module]))
  const couplingChanges = []
  for (const [name, curModule] of curModuleMap) {
    const prevModule = prevModuleMap.get(name)
    if (prevModule === undefined) continue // 新增模块由 modules_added 覆盖
    const ceDelta = (curModule.ce ?? 0) - (prevModule.ce ?? 0)
    const caDelta = (curModule.ca ?? 0) - (prevModule.ca ?? 0)
    if (ceDelta !== 0 || caDelta !== 0) couplingChanges.push({ module: name, ce_delta: ceDelta, ca_delta: caDelta })
  }

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
    module_coupling_changes: couplingChanges.slice(0, LIST_CAP),
    function_count_delta: countFunctions(curMetrics) - countFunctions(prevMetrics),
    module_lines_delta: curSummary.module_lines - prevSummary.module_lines,
    unresolved_delta: curSummary.unresolved - prevSummary.unresolved,
    external_delta: curSummary.external - prevSummary.external,
  }
}
