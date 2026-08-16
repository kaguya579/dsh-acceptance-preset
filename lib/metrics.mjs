// 复杂度度量聚合：函数/文件行数、圈复杂度、分布摘要与超阈值清单。
// 原始度量来自 static.mjs（同一次 tree-sitter 解析）；此处只做聚合与阈值判定，
// 产出的是「超阈值事实」，不是结论。

// 超阈值常量（起始值，按验收实践可调；单一来源）
export const THRESHOLDS = {
  FUNCTION_LINES: 80,
  COMPLEXITY: 15,
  FILE_LINES: 1000,
}

const OVER_THRESHOLD_FUNCTIONS_CAP = 500
const OVER_THRESHOLD_FILES_CAP = 200
const TOP_CAP = 20

function median(sortedNumbers) {
  if (sortedNumbers.length === 0) return null
  const mid = Math.floor(sortedNumbers.length / 2)
  if (sortedNumbers.length % 2 === 1) return sortedNumbers[mid]
  return Math.round(((sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2) * 10) / 10
}

function round1(value) {
  return Math.round(value * 10) / 10
}

/**
 * 聚合全文件度量 → 架构事实的 metrics 节。
 * @param perFileMetrics  static.mjs 的 metrics 输出（{ path, language, file_lines, functions }[]）
 */
export function aggregateMetrics(perFileMetrics) {
  const allFunctions = []
  for (const file of perFileMetrics) {
    for (const fn of file.functions) {
      allFunctions.push({ path: file.path, language: file.language, ...fn })
    }
  }

  const functionLines = allFunctions.map((fn) => fn.lines).sort((a, b) => a - b)
  const complexities = allFunctions.map((fn) => fn.complexity).sort((a, b) => a - b)

  const overThresholdFunctions = []
  let functionsTruncated = false
  for (const fn of allFunctions) {
    const reasons = []
    if (fn.lines > THRESHOLDS.FUNCTION_LINES) reasons.push(`函数行数 ${fn.lines} > ${THRESHOLDS.FUNCTION_LINES}`)
    if (fn.complexity > THRESHOLDS.COMPLEXITY) reasons.push(`圈复杂度 ${fn.complexity} > ${THRESHOLDS.COMPLEXITY}`)
    if (reasons.length > 0) {
      if (overThresholdFunctions.length < OVER_THRESHOLD_FUNCTIONS_CAP) overThresholdFunctions.push({ ...fn, reasons })
      else functionsTruncated = true
    }
  }

  const overThresholdFiles = perFileMetrics
    .filter((file) => file.file_lines > THRESHOLDS.FILE_LINES)
    .slice(0, OVER_THRESHOLD_FILES_CAP)
    .map((file) => ({
      path: file.path,
      lines: file.file_lines,
      reason: `文件行数 ${file.file_lines} > ${THRESHOLDS.FILE_LINES}`,
    }))

  return {
    thresholds: { ...THRESHOLDS },
    distribution: {
      function_count: allFunctions.length,
      mean_function_lines: allFunctions.length > 0 ? round1(allFunctions.reduce((sum, fn) => sum + fn.lines, 0) / allFunctions.length) : null,
      median_function_lines: median(functionLines),
      mean_complexity: allFunctions.length > 0 ? round1(allFunctions.reduce((sum, fn) => sum + fn.complexity, 0) / allFunctions.length) : null,
      median_complexity: median(complexities),
      top_longest_functions: [...allFunctions].sort((a, b) => b.lines - a.lines).slice(0, TOP_CAP)
        .map((fn) => ({ path: fn.path, name: fn.name, line: fn.line, lines: fn.lines })),
      top_complex_functions: [...allFunctions].sort((a, b) => b.complexity - a.complexity).slice(0, TOP_CAP)
        .map((fn) => ({ path: fn.path, name: fn.name, line: fn.line, complexity: fn.complexity })),
    },
    over_threshold: {
      functions: overThresholdFunctions.map((fn) => ({
        path: fn.path, name: fn.name, line: fn.line, lines: fn.lines, complexity: fn.complexity, reasons: fn.reasons,
      })),
      functions_truncated: functionsTruncated,
      files: overThresholdFiles,
    },
  }
}
