// 分层违规校验：白名单口径——rules 声明 allowed 依赖对，未声明的跨层依赖=违规；
// 边的一端未匹配任何层则忽略并计数 unmatched；同层依赖恒放行。
// 纯确定性，绝不产出结论（「违规是否需整改」由 agent 判断）。

const VIOLATIONS_CAP = 2000

/** 解析分层规则 JSON 文本 → { layers, rules }；格式错误抛错。 */
export function parseLayeringRules(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`分层规则文件解析失败：${error.message}`)
  }
  const layers = Array.isArray(parsed?.layers) ? parsed.layers : []
  const rules = Array.isArray(parsed?.rules) ? parsed.rules : []
  for (const layer of layers) {
    if (typeof layer?.name !== 'string' || layer.name === '' || typeof layer?.match !== 'string') {
      throw new Error('分层规则无效：layers 每项必须含非空 name 与 match 字符串')
    }
  }
  for (const rule of rules) {
    if (typeof rule?.from !== 'string' || typeof rule?.to !== 'string') {
      throw new Error('分层规则无效：rules 每项必须含 from 与 to 字符串')
    }
  }
  return { layers, rules }
}

/** 模块路径匹配：`/**` 后缀=前缀匹配，否则精确匹配（大小写不敏感）。 */
export function matchModulePattern(module, pattern) {
  const moduleText = String(module).replace(/\\/g, '/').toLowerCase()
  const patternText = String(pattern).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (patternText.endsWith('/**')) {
    const prefix = patternText.slice(0, -3)
    return moduleText === prefix || moduleText.startsWith(prefix + '/')
  }
  return moduleText === patternText
}

/** 模块 → 层名（按 layers 声明顺序首个命中）；未命中返回 null。 */
export function layerOfModule(module, layers) {
  for (const layer of layers) {
    if (matchModulePattern(module, layer.match)) return layer.name
  }
  return null
}

/**
 * 白名单校验。
 * @param rules  { layers, rules }
 * @param moduleEdges  模块级边（{from, to, kind}，file + wildcard）
 * @returns { layers, rules, violations, unmatched_count, matched_edge_count }
 */
export function validateLayering(rules, moduleEdges) {
  const violations = []
  let unmatchedCount = 0
  let matchedEdgeCount = 0
  for (const edge of moduleEdges ?? []) {
    const fromLayer = layerOfModule(edge.from, rules.layers)
    const toLayer = layerOfModule(edge.to, rules.layers)
    if (fromLayer === null || toLayer === null) {
      unmatchedCount += 1
      continue
    }
    matchedEdgeCount += 1
    if (fromLayer === toLayer) continue // 同层依赖恒放行
    const allowed = rules.rules.some((rule) => rule.from === fromLayer && rule.to === toLayer)
    if (!allowed && violations.length < VIOLATIONS_CAP) {
      violations.push({ from: edge.from, to: edge.to, from_layer: fromLayer, to_layer: toLayer, kind: edge.kind, allowed: false })
    }
  }
  return { layers: rules.layers, rules: rules.rules, violations, unmatched_count: unmatchedCount, matched_edge_count: matchedEdgeCount }
}
