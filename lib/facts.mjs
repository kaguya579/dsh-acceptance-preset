// 确定性事实编排：扫描 → 文档元数据 → 静态分析 → 架构事实（依赖图/度量/清单/重复片段）
// → 基线补缺 → 轮次快照/变更 → 组装事实包并落盘（确定性事实.json / 静态事实.json / 轮次记录.json）。
// 绝不调用 LLM、绝不产出结论；语义判断由 agent 完成。
// 事实包 schema 与验收工具 facts 出口一致（acceptance-facts/2，v1 兼容超集），轮次记录互读兼容。

import path from 'node:path'
import { scanDeliverable } from './deliverable.mjs'
import { documentMeta } from './documents.mjs'
import { imageDimensions } from './images.mjs'
import { analyzeCodeFiles } from './static.mjs'
import { buildDependencyGraph } from './deps.mjs'
import { aggregateMetrics } from './metrics.mjs'
import { parseManifests } from './manifests.mjs'
import { detectDuplicates } from './dupes.mjs'
import { buildModuleFacts, computeReachability } from './modules.mjs'
import { computeArchitectureDelta } from './delta.mjs'
import { validateLayering } from './layering.mjs'
import { renderDashboard, DASHBOARD_FILENAME } from './report.mjs'
import { candidateNames, findMissing, loadBaseline } from './baseline.mjs'
import {
  computeChanges, computeSnapshot, issuesFromRecord, loadRoundRecord,
  snapshotFromRecord, writeRoundRecord, RECORD_FILENAME,
} from './rounds.mjs'

export const FACTS_FILENAME = '确定性事实.json'
export const STATIC_FACTS_FILENAME = '静态事实.json'
export const FACTS_SCHEMA = 'acceptance-facts/2'
const PATHS_CAP = 2000 // facts.parse.paths 条数上限
const UNSUPPORTED_CAP = 500 // static_facts.unsupported_files 条数上限

/**
 * 执行一轮确定性事实分析并落盘，返回事实包。
 * @param adapter  fs 适配器（见 plugins/acceptance.mjs 的 harnessAdapter / 测试的 nodeAdapter）
 * @param deliverable  交付物绝对路径（目录 / zip / tar.gz）
 * @param baseline  基线绝对路径或 null
 * @param roundInfo  { project, round, round_type }
 * @param outDir  本轮产物目录（绝对路径）
 */
export async function runFacts({ adapter, deliverable, baseline, roundInfo, outDir, layerRules }) {
  // 产物目录排除：产物根（outDir 的父目录）若位于交付物目录内，扫描时跳过该子树，
  // 避免复验轮次把上轮产物当成交付内容（目录/zip/tar 三路统一按相对前缀排除）。
  const deliverableStat = await adapter.stat(deliverable)
  const deliverableBase = deliverableStat?.type === 'directory' ? deliverable : path.dirname(deliverable)
  const rawExclude = path.relative(deliverableBase, path.dirname(outDir)).replace(/\\/g, '/')
  const scanned = await scanDeliverable(adapter, deliverable, { excludePrefix: rawExclude })
  const entries = scanned.entries
  const errors = [...scanned.errors]

  // 文档元数据
  const documents = []
  for (const entry of entries) {
    if (entry.kind !== 'doc' || entry.data === null) continue
    try {
      documents.push(await documentMeta(entry))
    } catch (error) {
      errors.push({ path: entry.path, reason: `文档解析失败：${error.message}` })
    }
  }

  // 图片元数据（宽高解析失败记 null）
  const images = []
  for (const entry of entries) {
    if (entry.kind !== 'image' || entry.data === null) continue
    const dimensions = imageDimensions(entry.data)
    images.push({
      path: entry.path,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      size: entry.size,
    })
  }

  // 静态分析 + 构建文件 + 其余文件
  const staticResult = await analyzeCodeFiles(entries.filter((entry) => entry.kind === 'code'))
  const buildFiles = entries.filter((entry) => entry.kind === 'build').map((entry) => entry.path)
  const otherFiles = entries.filter((entry) => entry.kind === 'other').map((entry) => entry.path)

  // 架构事实（确定性层扩展，绝不产出结论）：
  // 依赖图（6 语言跨文件引用/模块聚合/环检测/外部归口）+ 耦合与模块聚合表 +
  // 孤儿/可达性 + 复杂度度量 + 依赖清单 + 重复片段
  const codeEntries = entries.filter((entry) => entry.kind === 'code')
  const codeFiles = codeEntries.map((entry) => entry.path)
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
  const architectureFacts = {
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

  // 基线 + 补缺识别
  const hasBaseline = baseline !== null
  let requiredItems = []
  let missingItems = []
  if (hasBaseline) {
    requiredItems = await loadBaseline(adapter, baseline)
    missingItems = findMissing(requiredItems, candidateNames(entries, documents))
  }

  // 轮次：上轮记录、变更识别
  const previousDir = roundInfo.round > 1
    ? path.join(path.dirname(outDir), `${roundInfo.project}-轮次${roundInfo.round - 1}`)
    : null
  const previousRecord = previousDir === null
    ? null
    : await loadRoundRecord(adapter, path.join(previousDir, RECORD_FILENAME))
  const snapshot = computeSnapshot(entries)
  const changes = previousRecord === null
    ? null
    : computeChanges(snapshotFromRecord(previousRecord), snapshot)
  const previousIssues = previousRecord === null ? [] : issuesFromRecord(previousRecord)

  // 依赖漂移 delta：复验轮次读上轮事实包对比（首轮/缺失 → null + note）
  let architectureDelta = null
  let architectureDeltaNote = '首轮：无上轮事实包可对比'
  if (previousDir !== null) {
    const prevFactsPath = path.join(previousDir, FACTS_FILENAME)
    try {
      const prevText = await adapter.readText(prevFactsPath)
      const prevFacts = JSON.parse(prevText)
      architectureDelta = computeArchitectureDelta(prevFacts?.architecture_facts ?? null, architectureFacts)
      if (architectureDelta === null) architectureDeltaNote = '上轮事实包缺少 architecture_facts，无法对比'
    } catch (error) {
      architectureDeltaNote = `上轮事实包读取失败，无法对比：${error.message}`
    }
  }

  // 确定性缺项 → Issue（口径：缺项/严重，证据带基线出处）
  const deterministicIssues = missingItems.map((item) => ({
    deviation_type: '缺项',
    severity: '严重',
    title: item.text,
    evidence: `${item.source_path}：${item.location}`,
    explanation: '基线要求项在交付物中不存在（确定性补缺识别）。',
  }))

  const paths = entries.map((entry) => entry.path)
  const facts = {
    schema: FACTS_SCHEMA,
    round_info: {
      project: roundInfo.project,
      round: roundInfo.round,
      round_type: roundInfo.round_type,
    },
    has_baseline: hasBaseline,
    parse: {
      file_count: paths.length,
      paths: paths.slice(0, PATHS_CAP),
      paths_truncated: paths.length > PATHS_CAP,
      documents,
      code_files: entries.filter((entry) => entry.kind === 'code').map((entry) => ({ path: entry.path, size: entry.size })),
      images,
      errors,
    },
    static_facts: {
      languages: staticResult.languages,
      build_files: buildFiles,
      unsupported_files: otherFiles.slice(0, UNSUPPORTED_CAP),
      unsupported_count: otherFiles.length,
      files: staticResult.files,
      errors: staticResult.errors,
    },
    architecture_facts: architectureFacts,
    baseline: {
      required_count: requiredItems.length,
      required_items: requiredItems,
      missing_count: missingItems.length,
      missing_items: missingItems,
    },
    changes,
    previous_issues: previousIssues,
    architecture_delta: architectureDelta,
    architecture_delta_note: architectureDeltaNote,
    deterministic_issues: deterministicIssues,
  }

  // 落盘（adapter.writeText 原子写，自动建父目录）
  await adapter.writeText(path.join(outDir, FACTS_FILENAME), JSON.stringify(facts, null, 2))
  await adapter.writeText(path.join(outDir, STATIC_FACTS_FILENAME), JSON.stringify(facts.static_facts, null, 2))
  await adapter.writeText(path.join(outDir, DASHBOARD_FILENAME), renderDashboard(facts))
  await writeRoundRecord(adapter, outDir, roundInfo, snapshot, deterministicIssues)
  return facts
}
