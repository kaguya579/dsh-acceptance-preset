// 确定性事实编排：扫描 → 文档元数据 → 静态分析 → 基线补缺 → 轮次快照/变更 →
// 组装事实包并落盘（确定性事实.json / 静态事实.json / 轮次记录.json）。
// 绝不调用 LLM、绝不产出结论；语义判断由 agent 完成。
// 事实包 schema 与验收工具 facts 出口一致（acceptance-facts/1），轮次记录互读兼容。

import path from 'node:path'
import { scanDeliverable } from './deliverable.mjs'
import { documentMeta } from './documents.mjs'
import { imageDimensions } from './images.mjs'
import { analyzeCodeFiles } from './static.mjs'
import { candidateNames, findMissing, loadBaseline } from './baseline.mjs'
import {
  computeChanges, computeSnapshot, issuesFromRecord, loadRoundRecord,
  snapshotFromRecord, writeRoundRecord, RECORD_FILENAME,
} from './rounds.mjs'

export const FACTS_FILENAME = '确定性事实.json'
export const STATIC_FACTS_FILENAME = '静态事实.json'
export const FACTS_SCHEMA = 'acceptance-facts/1'

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
export async function runFacts({ adapter, deliverable, baseline, roundInfo, outDir }) {
  const scanned = await scanDeliverable(adapter, deliverable)
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
    baseline: {
      required_count: requiredItems.length,
      required_items: requiredItems,
      missing_count: missingItems.length,
      missing_items: missingItems,
    },
    changes,
    previous_issues: previousIssues,
    deterministic_issues: deterministicIssues,
  }

  // 落盘（adapter.writeText 原子写，自动建父目录）
  await adapter.writeText(path.join(outDir, FACTS_FILENAME), JSON.stringify(facts, null, 2))
  await adapter.writeText(path.join(outDir, STATIC_FACTS_FILENAME), JSON.stringify(facts.static_facts, null, 2))
  await writeRoundRecord(adapter, outDir, roundInfo, snapshot, deterministicIssues)
  return facts
}
