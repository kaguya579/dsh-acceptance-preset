// 供应商台账：跨项目轮次确定性聚合（确定性事实，绝不产出语义结论）。
// 台账行 = 每项目每轮次的确定性摘要；「问题复发/整改时效」等语义判断由 agent
// 基于台账 + 各轮问题清单完成，写入 供应商档案.md。

const PROJECTS_CAP = 50
const ROUNDS_CAP = 100

/**
 * 构建供应商台账。
 * @param adapter  fs 适配器
 * @param outRoot  产物根目录（绝对路径）
 * @param supplier  供应商名（分组标签）
 * @param projects  项目名数组
 * @returns { supplier, projects: [{name, rounds: [row]}], total_rounds, note }
 */
export async function buildSupplierLedger({ adapter, outRoot, supplier, projects }) {
  const result = { supplier, projects: [], total_rounds: 0, note: null }
  for (const project of projects.slice(0, PROJECTS_CAP)) {
    let entries = []
    try {
      entries = await adapter.listDir(outRoot)
    } catch {
      result.note = `产物根不可读：${outRoot}`
      break
    }
    const roundDirs = []
    for (const entry of entries) {
      if (entry.type !== 'directory') continue
      const match = /^(.*?)-轮次(\d+)$/.exec(entry.name)
      if (match === null || match[1] !== project) continue
      roundDirs.push({ dir: entry.name, round: Number(match[2]) })
    }
    roundDirs.sort((a, b) => a.round - b.round)
    const rounds = []
    for (const roundDir of roundDirs.slice(0, ROUNDS_CAP)) {
      rounds.push(await summarizeRound(adapter, outRoot, roundDir))
    }
    result.projects.push({ name: project, rounds })
    result.total_rounds += rounds.length
  }
  return result
}

/** 单轮摘要：轮次记录（round_info/问题数）+ 事实包（规模/架构摘要）。 */
async function summarizeRound(adapter, outRoot, roundDir) {
  const roundPath = `${outRoot}\\${roundDir.dir}`
  const row = {
    round: roundDir.round,
    round_type: null,
    file_count: null,
    deterministic_issues: null,
    arch: {
      edges: null,
      cycles: null,
      unresolved: null,
      external: null,
      over_threshold_functions: null,
      dup_fragments: null,
      modules: null,
    },
  }
  try {
    const recordText = await adapter.readText(`${roundPath}\\轮次记录.json`)
    const record = JSON.parse(recordText)
    row.round_type = record?.round_info?.round_type ?? null
    row.deterministic_issues = Array.isArray(record?.issues) ? record.issues.length : null
  } catch {
    // 记录缺失：行保留空值
  }
  try {
    const factsText = await adapter.readText(`${roundPath}\\确定性事实.json`)
    const facts = JSON.parse(factsText)
    row.file_count = facts?.parse?.file_count ?? null
    const arch = facts?.architecture_facts ?? {}
    const deps = arch.dependencies ?? {}
    const metrics = arch.metrics ?? {}
    row.arch = {
      edges: (deps.edges ?? []).length,
      cycles: (deps.cycles ?? []).length,
      unresolved: (deps.unresolved ?? []).length,
      external: (deps.external ?? []).reduce((sum, entry) => sum + entry.count, 0),
      over_threshold_functions: metrics.over_threshold?.functions?.length ?? null,
      dup_fragments: (arch.duplicates?.fragments ?? []).length,
      modules: (deps.modules ?? []).length,
    }
  } catch {
    // 事实包缺失：行保留空值
  }
  return row
}
