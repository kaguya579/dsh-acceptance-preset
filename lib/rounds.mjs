// 轮次机制：文件快照（sha256）、变更识别、轮次记录读写、上轮问题清单。
// 与验收工具口径一致：轮次记录.json = { round_info, snapshot, issues }；
// 变更识别按路径比对（新增/修改/删除，修改 = 同路径不同 sha256）。

export const RECORD_FILENAME = '轮次记录.json'

import path from 'node:path'
import { FACTS_FILENAME, STATIC_FACTS_FILENAME, DASHBOARD_FILENAME } from './names.mjs'

const VALID_TYPES = new Set(['文档间偏差', '文档-代码偏差', '基线偏差', '缺项'])
const VALID_SEVERITIES = new Set(['阻断', '严重', '一般'])

/** 条目 → 文件快照（相对路径 → {sha256, size}，按路径排序）。 */
export function computeSnapshot(entries) {
  const snapshot = {}
  for (const entry of entries) {
    snapshot[entry.path] = { sha256: entry.sha256, size: entry.size }
  }
  const sorted = {}
  for (const key of Object.keys(snapshot).sort()) sorted[key] = snapshot[key]
  return sorted
}

/** 轮次记录 → 快照（非法条目跳过）。 */
export function snapshotFromRecord(record) {
  const snapshot = {}
  const raw = record?.snapshot
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [pathName, entry] of Object.entries(raw)) {
      if (
        entry !== null && typeof entry === 'object'
        && typeof entry.sha256 === 'string'
        && typeof entry.size === 'number'
      ) {
        snapshot[pathName] = { sha256: entry.sha256, size: entry.size }
      }
    }
  }
  return snapshot
}

/** 变更识别：prev/current 快照按路径比对，结果按路径排序。 */
export function computeChanges(previous, current) {
  const previousPaths = new Set(Object.keys(previous))
  const currentPaths = new Set(Object.keys(current))
  const added = []
  const removed = []
  const modified = []
  for (const pathName of [...currentPaths].sort()) {
    if (!previousPaths.has(pathName)) added.push(pathName)
  }
  for (const pathName of [...previousPaths].sort()) {
    if (!currentPaths.has(pathName)) removed.push(pathName)
  }
  for (const pathName of [...currentPaths].sort()) {
    if (previousPaths.has(pathName) && previous[pathName].sha256 !== current[pathName].sha256) {
      modified.push(pathName)
    }
  }
  return { added, modified, removed }
}

/** 读取轮次记录；缺失/不可解析返回 null。 */
export async function loadRoundRecord(adapter, recordPath) {
  const stat = await adapter.stat(recordPath)
  if (stat === null || stat.type !== 'file') return null
  try {
    const data = JSON.parse(await adapter.readText(recordPath))
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

/** 列出产物根下的轮次目录（`<项目>-轮次N`），按目录名排序。 */
export async function listRoundDirs(adapter, outRoot, filterProject) {
  const dirs = []
  const entries = await adapter.listDir(outRoot)
  for (const entry of entries) {
    if (entry.type !== 'directory') continue
    const match = /^(.*?)-轮次(\d+)$/.exec(entry.name)
    if (match === null) continue
    if (filterProject !== undefined && match[1] !== filterProject) continue
    dirs.push({ dir: entry.name, project: match[1], round: Number(match[2]) })
  }
  return dirs
}

/** 写入轮次记录.json（写入侧与读取侧同口径校验枚举，非法条目丢弃）。 */
export async function writeRoundRecord(adapter, roundDir, roundInfo, snapshot, issues) {
  const record = {
    round_info: {
      project: roundInfo.project,
      round: roundInfo.round,
      round_type: roundInfo.round_type,
    },
    snapshot,
    issues: issuesToDict(issues).filter((issue) => VALID_TYPES.has(issue.deviation_type) && VALID_SEVERITIES.has(issue.severity)),
    created_at: Date.now(),
  }
  await adapter.writeText(path.join(roundDir, RECORD_FILENAME), JSON.stringify(record, null, 2))
}

/**
 * 轮次存储（RoundStore）：产物目录布局与轮次产物读写的单一实现点。
 * `<outRoot>/<项目>-轮次<N>/` 布局与产物文件名只在模块内出现。
 */
export function createRoundStore(adapter, outRoot) {
  return {
    outRoot,
    roundDir(project, round) {
      return path.join(outRoot, `${project}-轮次${round}`)
    },
    prevRoundDir(project, round) {
      return round > 1 ? path.join(outRoot, `${project}-轮次${round - 1}`) : null
    },
    async readFacts(project, round) {
      const text = await adapter.readText(path.join(this.roundDir(project, round), FACTS_FILENAME))
      return JSON.parse(text)
    },
    async readRecord(project, round) {
      return loadRoundRecord(adapter, path.join(this.roundDir(project, round), RECORD_FILENAME))
    },
    listRounds(filterProject) {
      return listRoundDirs(adapter, outRoot, filterProject)
    },
    /** 落盘本轮四个产物（确定性事实/静态事实/仪表盘/轮次记录）。 */
    async writeArtifacts(project, round, { facts, staticFacts, dashboardHtml, snapshot, issues, roundInfo }) {
      const roundDir = this.roundDir(project, round)
      await adapter.writeText(path.join(roundDir, FACTS_FILENAME), JSON.stringify(facts, null, 2))
      await adapter.writeText(path.join(roundDir, STATIC_FACTS_FILENAME), JSON.stringify(staticFacts, null, 2))
      await adapter.writeText(path.join(roundDir, DASHBOARD_FILENAME), dashboardHtml)
      await writeRoundRecord(adapter, roundDir, roundInfo, snapshot, issues)
    },
  }
}

/** 问题 → 纯字典（轮次记录口径：deviation_type/severity/title/evidence）。 */
export function issuesToDict(issues) {
  return issues.map((issue) => ({
    deviation_type: issue.deviation_type,
    severity: issue.severity,
    title: issue.title,
    evidence: issue.evidence,
  }))
}

/** 轮次记录 → 上轮问题清单（校验枚举后重建，非法条目跳过）。 */
export function issuesFromRecord(record) {
  const issues = []
  const raw = record?.issues
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (
        entry !== null && typeof entry === 'object'
        && VALID_TYPES.has(entry.deviation_type)
        && VALID_SEVERITIES.has(entry.severity)
        && typeof entry.title === 'string' && entry.title.trim() !== ''
      ) {
        issues.push({
          deviation_type: entry.deviation_type,
          severity: entry.severity,
          title: entry.title.trim(),
          evidence: typeof entry.evidence === 'string' ? entry.evidence : '',
          explanation: typeof entry.explanation === 'string' ? entry.explanation : '',
        })
      }
    }
  }
  return issues
}
