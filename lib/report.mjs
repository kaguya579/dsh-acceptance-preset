// HTML 事实仪表盘：把事实包渲染为单页静态 HTML（数据内嵌、无网络、无外部 JS 库）。
// 纯确定性，绝不产出结论；md 文档组由 agent 产出，本文件只做事实可视化。

import { summarizeArchFacts } from './modules.mjs'
import { DASHBOARD_FILENAME } from './names.mjs'

export { DASHBOARD_FILENAME }

const MODULE_GRAPH_CAP = 120 // 依赖图最多渲染的模块数
const MODULE_EDGES_CAP = 400 // 依赖图最多渲染的模块级边数
const TABLE_CAP = 50 // 表格明细上限

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function table(headers, rows) {
  const head = headers.map((header) => `<th>${esc(header)}</th>`).join('')
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function svgGraph(modules, moduleEdges) {
  const nodes = modules.slice(0, MODULE_GRAPH_CAP)
  if (nodes.length === 0) return '<p class="muted">无模块</p>'
  const columns = Math.ceil(Math.sqrt(nodes.length))
  const cellW = 240
  const cellH = 60
  const width = columns * cellW
  const height = Math.ceil(nodes.length / columns) * cellH
  const positions = new Map()
  nodes.forEach((module, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    positions.set(module.name, { x: column * cellW + cellW / 2, y: row * cellH + cellH / 2 })
  })
  const edgeRendered = new Set()
  const lines = []
  for (const edge of moduleEdges.slice(0, MODULE_EDGES_CAP)) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (from === undefined || to === undefined) continue
    const key = `${edge.from}\u0000${edge.to}`
    if (edgeRendered.has(key)) continue
    edgeRendered.add(key)
    const stroke = edge.kind === 'wildcard' ? '#b45309' : '#64748b'
    lines.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="1.5" opacity="0.55"/>`)
  }
  const nodesSvg = nodes.map((module) => {
    const position = positions.get(module.name)
    return `<g><circle cx="${position.x}" cy="${position.y}" r="6" fill="#3b82f6"/><text x="${position.x}" y="${position.y - 12}" text-anchor="middle" font-size="10">${esc(module.name)}</text></g>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">${lines.join('')}${nodesSvg}</svg>`
}

/** 度量横向条形图（纯 div）。 */
function bars(items, labelOf, valueOf, max) {
  if (items.length === 0) return '<p class="muted">无数据</p>'
  const peak = max ?? Math.max(...items.map(valueOf), 1)
  return items.map((item) => {
    const width = Math.round((valueOf(item) / peak) * 100)
    return `<div class="bar-row"><span class="bar-label">${esc(labelOf(item))}</span><span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span><span class="bar-value">${valueOf(item)}</span></div>`
  }).join('')
}

/**
 * 渲染事实仪表盘。
 * @param facts  runFacts 返回的事实包
 * @returns HTML 字符串
 */
export function renderDashboard(facts) {
  const arch = facts.architecture_facts ?? {}
  const deps = arch.dependencies ?? {}
  const metrics = arch.metrics ?? {}
  const delta = facts.architecture_delta
  const round = facts.round_info ?? {}
  const summary = summarizeArchFacts(arch)

  const moduleRows = (arch.modules ?? []).slice(0, TABLE_CAP).map((module) => [
    module.name, module.file_count, module.functions, module.lines,
    module.ce, module.ca, module.instability, module.abstractness, module.distance,
    module.dup_fragments,
  ])
  const overRows = (metrics.over_threshold?.functions ?? []).slice(0, TABLE_CAP).map((fn) => [
    fn.path, fn.name, fn.line, fn.lines, fn.complexity, (fn.reasons ?? []).join('；'),
  ])
  const fileRows = (metrics.over_threshold?.files ?? []).slice(0, TABLE_CAP).map((file) => [file.path, file.lines])
  const dupRows = (arch.duplicates?.fragments ?? []).slice(0, TABLE_CAP).map((fragment) => [
    fragment.lines, fragment.occurrences.map((occurrence) => `${occurrence.path}:${occurrence.line}`).join('<br>'),
  ])
  const manifestRows = (arch.manifests?.entries ?? []).slice(0, TABLE_CAP).map((entry) => [
    entry.name, entry.version, entry.type, entry.source,
  ])
  const layering = arch.layering
  const layeringRows = layering === null ? [] : layering.violations.slice(0, TABLE_CAP).map((violation) => [
    `${violation.from_layer}→${violation.to_layer}`, violation.from, violation.to, violation.kind,
  ])
  const externalRows = (deps.external ?? []).slice(0, TABLE_CAP).map((entry) => [entry.group, entry.prefix, entry.count])
  const deltaRows = delta === null ? [] : [
    ['新增边', delta.edges_added.length],
    ['消失边', delta.edges_removed.length],
    ['新增环', delta.cycles_added.length],
    ['消失环', delta.cycles_removed.length],
    ['新增模块', delta.modules_added.length],
    ['消失模块', delta.modules_removed.length],
    ['函数数变化', delta.function_count_delta],
    ['未解析变化', delta.unresolved_delta],
  ]
  const topComplex = bars(
    metrics.distribution?.top_complex_functions ?? [],
    (fn) => `${fn.path}:${fn.name}`, (fn) => fn.complexity, 50,
  )
  const topLong = bars(
    metrics.distribution?.top_longest_functions ?? [],
    (fn) => `${fn.path}:${fn.name}`, (fn) => fn.lines, 200,
  )

  const sections = []
  sections.push(`<section><h2>概览</h2>${table(
    ['项', '值'],
    [
      ['项目', `${round.project} 第 ${round.round} 轮（${round.round_type ?? ''}）`],
      ['事实包 schema', facts.schema ?? ''],
      ['文件数', facts.parse?.file_count ?? 0],
      ['代码文件数', (facts.parse?.code_files ?? []).length],
      ['语言', (facts.static_facts?.languages ?? []).join(', ')],
      ['依赖边', summary.edges],
      ['模块', summary.modules],
      ['依赖环', summary.cycles],
      ['真未解析', summary.unresolved],
      ['外部引用', summary.external],
      ['超阈值函数', summary.over_threshold_functions ?? 0],
      ['重复片段', summary.dup_fragments],
    ],
  )}</section>`)

  if (delta !== null) {
    sections.push(`<section><h2>依赖漂移（相对上轮）</h2>${table(['指标', '变化'], deltaRows)}</section>`)
  } else if (facts.architecture_delta_note !== null) {
    sections.push(`<section><h2>依赖漂移</h2><p class="muted">${esc(facts.architecture_delta_note)}</p></section>`)
  }

  sections.push(`<section><h2>依赖图（模块级，前 ${MODULE_GRAPH_CAP} 模块 / ${MODULE_EDGES_CAP} 边）</h2>${svgGraph(arch.modules ?? [], deps.module_edges ?? [])}<p class="muted">灰色=文件级边，橙色=通配导入包级边；虚线省略。完整数据见 确定性事实.json。</p></section>`)

  sections.push(`<section><h2>模块表（前 ${TABLE_CAP}）</h2>${table(
    ['模块', '文件', '函数', '行数', 'Ce', 'Ca', '不稳定性', '抽象度', '主序列距离', '重复片段'],
    moduleRows,
  )}</section>`)

  sections.push(`<section><h2>最高圈复杂度函数</h2>${topComplex}</section>`)
  sections.push(`<section><h2>最长函数</h2>${topLong}</section>`)

  if (overRows.length > 0) {
    sections.push(`<section><h2>超阈值函数（前 ${TABLE_CAP}）</h2>${table(['路径', '函数', '行', '行数', '圈复杂度', '原因'], overRows)}</section>`)
  }
  if (fileRows.length > 0) {
    sections.push(`<section><h2>超阈值文件（前 ${TABLE_CAP}）</h2>${table(['路径', '行数'], fileRows)}</section>`)
  }

  sections.push(`<section><h2>孤儿文件（${(arch.orphans ?? []).length}）与不可达文件（${(arch.unreachable ?? []).length}）</h2><p>${esc((arch.orphans ?? []).slice(0, 50).join('、')) || '无'}</p><p>${esc((arch.unreachable ?? []).slice(0, 50).join('、')) || '无'}</p></section>`)

  if (layering !== null) {
    sections.push(`<section><h2>分层校验（白名单，违规 ${layering.violations.length} 条，未匹配 ${layering.unmatched_count} 边）</h2>${layeringRows.length > 0 ? table(['层依赖', '来源模块', '目标模块', '边类型'], layeringRows) : '<p class="muted">无违规</p>'}</section>`)
  }

  sections.push(`<section><h2>外部引用（前 ${TABLE_CAP}）</h2>${table(['分组', '前缀', '次数'], externalRows)}</section>`)
  sections.push(`<section><h2>重复片段（前 ${TABLE_CAP}，共 ${(arch.duplicates?.fragments ?? []).length}）</h2>${table(['行数', '出现位置'], dupRows)}</section>`)
  sections.push(`<section><h2>依赖清单（前 ${TABLE_CAP}）</h2>${table(['名称', '版本', '类型', '来源'], manifestRows)}</section>`)

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>验收仪表盘 · ${esc(round.project)} · 第 ${esc(round.round)} 轮</title>
<style>
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; color: #1e293b; background: #f8fafc; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; }
  th { background: #f1f5f9; }
  .muted { color: #64748b; font-size: 12px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin: 2px 0; font-size: 12px; }
  .bar-label { width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; background: #e2e8f0; height: 10px; border-radius: 3px; }
  .bar-fill { display: block; height: 10px; background: #3b82f6; border-radius: 3px; }
  .bar-value { width: 48px; text-align: right; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; }
</style></head><body>
<h1>验收仪表盘 · ${esc(round.project)} · 第 ${esc(round.round)} 轮（${esc(round.round_type ?? '')}）</h1>
<p class="muted">由确定性层自动生成（${esc(DASHBOARD_FILENAME)}）；细节与语义判断见验收文档组（00–05）。</p>
${sections.join('\n')}
</body></html>`
}
