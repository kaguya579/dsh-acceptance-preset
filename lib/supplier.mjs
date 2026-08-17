// 供应商台账：跨项目轮次确定性聚合（确定性事实，绝不产出语义结论）。
// 台账行 = 每项目每轮次的确定性摘要；「问题复发/整改时效」等语义判断由 agent
// 基于台账 + 各轮问题清单完成，写入 供应商档案.md。

import path from 'node:path'
import { listRoundDirs, snapshotFromRecord, computeChanges } from './rounds.mjs'
import { summarizeArchFacts } from './modules.mjs'

const PROJECTS_CAP = 50
const ROUNDS_CAP = 100

/**
 * 构建供应商台账。
 * @param adapter  fs 适配器
 * @param outRoot  产物根目录（绝对路径）
 * @param supplier  供应商名（分组标签）
 * @param projects  项目名数组
 * @returns { supplier, projects: [{name, rounds: [row]}], trend, total_rounds, note }
 *   trend：全部轮次按时间/轮次序的扁平表（跨项目趋势）。
 */
export async function buildSupplierLedger({ adapter, outRoot, supplier, projects }) {
  const result = { supplier, projects: [], trend: [], total_rounds: 0, note: null }
  for (const project of projects.slice(0, PROJECTS_CAP)) {
    let roundDirs = []
    try {
      roundDirs = await listRoundDirs(adapter, outRoot, project)
    } catch {
      result.note = `产物根不可读：${outRoot}`
      break
    }
    roundDirs.sort((a, b) => a.round - b.round)
    const rounds = []
    let previousRecord = null
    for (const roundDir of roundDirs.slice(0, ROUNDS_CAP)) {
      const summary = await summarizeRound(adapter, outRoot, roundDir, previousRecord)
      previousRecord = summary.record
      rounds.push(summary.row)
    }
    result.projects.push({ name: project, rounds })
    result.total_rounds += rounds.length
    for (const row of rounds) {
      result.trend.push({ project, ...row })
    }
  }
  result.trend.sort((a, b) => (a.created_at ?? a.round) - (b.created_at ?? b.round))
  return result
}

/** 单轮摘要：轮次记录（round_info/时间/问题数/相对上轮变更）+ 事实包（规模/架构摘要）。 */
async function summarizeRound(adapter, outRoot, roundDir, previousRecord) {
  const roundPath = path.join(outRoot, roundDir.dir)
  const row = {
    round: roundDir.round,
    round_type: null,
    created_at: null,
    file_count: null,
    changes: null,
    deterministic_issues: null,
    arch: null,
  }
  let record = null
  try {
    const recordText = await adapter.readText(path.join(roundPath, '轮次记录.json'))
    record = JSON.parse(recordText)
  } catch {
    // 记录缺失：行保留空值
  }
  if (record !== null && typeof record === 'object') {
    row.round_type = record.round_info?.round_type ?? null
    row.created_at = record.created_at ?? null
    row.deterministic_issues = Array.isArray(record.issues) ? record.issues.length : null
    if (previousRecord !== null && typeof previousRecord === 'object') {
      const changes = computeChanges(snapshotFromRecord(previousRecord), snapshotFromRecord(record))
      row.changes = { added: changes.added.length, modified: changes.modified.length, removed: changes.removed.length }
    }
  }
  try {
    const factsText = await adapter.readText(path.join(roundPath, '确定性事实.json'))
    const facts = JSON.parse(factsText)
    row.file_count = facts?.parse?.file_count ?? null
    row.arch = summarizeArchFacts(facts?.architecture_facts ?? {})
  } catch {
    // 事实包缺失：行保留空值
  }
  return { row, record }
}
