// 确定性事实编排（两段式薄指挥）：
//   扫描 → 文档/图片元数据 → computeArchitectureFacts（架构事实合成，深模块）
//   → 基线补缺 → 轮次快照/变更 → delta → 组装事实包 → RoundStore 落盘四个产物。
// 绝不调用 LLM、绝不产出结论；语义判断由 agent 完成。
// 事实包 schema 与验收工具 facts 出口一致（acceptance-facts/2，v1 兼容超集），轮次记录互读兼容。

import path from 'node:path'
import { scanDeliverable } from './deliverable.mjs'
import { documentMeta } from './documents.mjs'
import { imageDimensions } from './images.mjs'
import { computeArchitectureFacts } from './arch.mjs'
import { computeArchitectureDelta } from './delta.mjs'
import { renderDashboard } from './report.mjs'
import { candidateNames, findMissing, loadBaseline } from './baseline.mjs'
import {
  computeChanges, computeSnapshot, issuesFromRecord, createRoundStore,
  snapshotFromRecord, RECORD_FILENAME,
} from './rounds.mjs'

export const FACTS_SCHEMA = 'acceptance-facts/2'

export { FACTS_FILENAME, STATIC_FACTS_FILENAME, DASHBOARD_FILENAME, RECORD_FILENAME } from './names.mjs'
const PATHS_CAP = 2000 // facts.parse.paths 条数上限
const UNSUPPORTED_CAP = 500 // static_facts.unsupported_files 条数上限

/**
 * 执行一轮确定性事实分析并落盘，返回事实包。
 * @param adapter  fs 适配器（见 plugins/acceptance.mjs 的 harnessAdapter / 测试的 nodeAdapter）
 * @param deliverable  交付物绝对路径（目录 / zip / tar.gz）
 * @param baseline  基线绝对路径或 null
 * @param roundInfo  { project, round, round_type }
 * @param outRoot  产物根目录（绝对路径；轮次目录布局由 RoundStore 负责）
 * @param layerRules  分层规则（parseLayeringRules 输出）或 null
 */
export async function runFacts({ adapter, deliverable, baseline, roundInfo, outRoot, layerRules }) {
  // 产物目录排除：产物根若位于交付物目录内，扫描时跳过该子树，
  // 避免复验轮次把上轮产物当成交付内容（目录/zip/tar 三路统一按相对前缀排除）。
  const deliverableStat = await adapter.stat(deliverable)
  const deliverableBase = deliverableStat?.type === 'directory' ? deliverable : path.dirname(deliverable)
  const rawExclude = path.relative(deliverableBase, outRoot).replace(/\\/g, '/')
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

  // 架构事实合成（深模块：七步一次完成；含静态分析）
  const { arch: architectureFacts, staticResult } = await computeArchitectureFacts(entries, layerRules)
  const buildFiles = entries.filter((entry) => entry.kind === 'build').map((entry) => entry.path)
  const otherFiles = entries.filter((entry) => entry.kind === 'other').map((entry) => entry.path)

  // 基线 + 补缺识别
  const hasBaseline = baseline !== null
  let requiredItems = []
  let missingItems = []
  if (hasBaseline) {
    requiredItems = await loadBaseline(adapter, baseline)
    missingItems = findMissing(requiredItems, candidateNames(entries, documents))
  }

  // 轮次：上轮记录、变更识别（路径语义由 RoundStore 单一实现）
  const project = roundInfo.project
  const round = roundInfo.round
  const store = createRoundStore(adapter, outRoot)
  const previousDir = store.prevRoundDir(project, round)
  const previousRecord = previousDir === null
    ? null
    : await store.readRecord(project, round - 1)
  const snapshot = computeSnapshot(entries)
  const changes = previousRecord === null
    ? null
    : computeChanges(snapshotFromRecord(previousRecord), snapshot)
  const previousIssues = previousRecord === null ? [] : issuesFromRecord(previousRecord)

  // 依赖漂移 delta：复验轮次读上轮事实包对比（首轮/缺失 → null + note）
  let architectureDelta = null
  let architectureDeltaNote = '首轮：无上轮事实包可对比'
  if (previousDir !== null) {
    try {
      const prevFacts = await store.readFacts(project, round - 1)
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
      project,
      round,
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

  // 落盘（RoundStore：布局与文件名单一实现）
  await store.writeArtifacts(project, round, {
    facts,
    staticFacts: facts.static_facts,
    dashboardHtml: renderDashboard(facts),
    snapshot,
    issues: deterministicIssues,
    roundInfo,
  })
  return facts
}
