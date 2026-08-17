// 架构事实合成：本轮全部架构级事实的唯一组装点（深模块，小 interface）。
// 输入：交付物条目（code/build）+ 可选分层规则；输出：architecture_facts 节 + 静态分析结果。
// 内部七步：静态分析 → 依赖图 → 度量 → 依赖清单 → 重复片段 → 模块表/可达性 → 分层校验。
// 纯确定性，绝不产出结论；delta（跨轮）与仪表盘（渲染）不在此模块（见 artifacts.mjs / facts.mjs）。

import { analyzeCodeFiles } from './static.mjs'
import { buildDependencyGraph } from './deps.mjs'
import { aggregateMetrics } from './metrics.mjs'
import { parseManifests } from './manifests.mjs'
import { detectDuplicates } from './dupes.mjs'
import { buildModuleFacts, computeReachability } from './modules.mjs'
import { validateLayering } from './layering.mjs'

/** 模块名（目录）：文件所在目录；根目录文件归「（根目录）」。单一实现点。 */
export function moduleOf(relPath) {
  const index = relPath.lastIndexOf('/')
  const dir = index === -1 ? '' : relPath.slice(0, index)
  return dir === '' ? '（根目录）' : dir
}

/**
 * 合成本轮架构事实。
 * @param entries      交付物条目（kind: code/build/...，含 data 字节）
 * @param layerRules   分层规则（parseLayeringRules 的输出）或 null
 * @returns { arch, staticResult }
 *   arch —— architecture_facts 节（dependencies/modules/orphans/unreachable/entry_files/metrics/manifests/duplicates/layering）
 *   staticResult —— analyzeCodeFiles 输出（供调用方拼 static_facts 摘要）
 */
export async function computeArchitectureFacts(entries, layerRules) {
  const codeEntries = entries.filter((entry) => entry.kind === 'code')
  const codeFiles = codeEntries.map((entry) => entry.path)
  const staticResult = await analyzeCodeFiles(codeEntries)

  const dependencyGraph = buildDependencyGraph(codeFiles, staticResult.imports)
  const metrics = aggregateMetrics(staticResult.metrics)
  const manifests = parseManifests(entries.filter((entry) => entry.kind === 'build'))
  const duplicates = detectDuplicates(codeEntries)
  const moduleFacts = buildModuleFacts({
    codeFiles,
    moduleEdges: dependencyGraph.module_edges,
    perFileMetrics: staticResult.metrics,
    perFileSymbols: staticResult.files,
    dupFragments: duplicates.fragments,
  })
  const symbolsByPath = new Map(staticResult.files.map((file) => [file.path, file.symbols ?? []]))
  const reachability = computeReachability(codeFiles, dependencyGraph.edges, symbolsByPath)

  const arch = {
    dependencies: dependencyGraph,
    modules: moduleFacts.modules,
    orphans: reachability.orphans,
    unreachable: reachability.unreachable,
    entry_files: reachability.entry_files,
    metrics,
    manifests,
    duplicates,
    layering: layerRules === null || layerRules === undefined
      ? null
      : validateLayering(layerRules, dependencyGraph.module_edges),
  }
  return { arch, staticResult }
}
