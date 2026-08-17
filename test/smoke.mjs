// 冒烟测试：用 node:fs 适配器跑通原生实现的全链路（目录/zip 交付物、基线补缺、
// 静态分析、轮次与变更识别、产物落盘）。运行：node test/smoke.mjs
// fixtures 随本仓库分发（test/fixtures/），无外部依赖。

import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat, copyFile, cp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { runFacts, FACTS_FILENAME, STATIC_FACTS_FILENAME } from '../lib/facts.mjs'
import { RECORD_FILENAME } from '../lib/rounds.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(here, 'fixtures')

function nodeAdapter(root) {
  return {
    async stat(absPath) {
      try {
        const info = await stat(absPath)
        return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }
      } catch {
        return null
      }
    },
    async readText(absPath) {
      return readFile(absPath, 'utf8')
    },
    async readBytes(absPath, maxBytes) {
      const info = await stat(absPath)
      if (info.size > maxBytes) return null
      const buffer = await readFile(absPath)
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    },
    async writeText(absPath, content) {
      await mkdir(path.dirname(absPath), { recursive: true })
      await writeFile(absPath, content, 'utf8')
    },
    async listDir(absPath) {
      const names = await readdir(absPath, { withFileTypes: true })
      const entries = []
      for (const entry of names) {
        if (entry.name.startsWith('.')) continue
        const info = await stat(path.join(absPath, entry.name))
        entries.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          size: info.size,
        })
      }
      return entries
    },
  }
}

let failures = 0
function check(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}`)
  }
}

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), 'dsh-acceptance-smoke-'))
  const adapter = nodeAdapter(work)

  // ── 场景 1：目录交付物 + 基线（无缺项），首轮 ──
  console.log('场景 1：目录交付物 + baseline.json，第 1 轮')
  const round1Dir = path.join(work, 'acceptance', '冒烟项目-轮次1')
  const facts1 = await runFacts({
    adapter,
    deliverable: path.join(FIXTURES, 'sample-delivery'),
    baseline: path.join(FIXTURES, 'baseline.json'),
    roundInfo: { project: '冒烟项目', round: 1, round_type: '例行验收' },
    outDir: round1Dir,
  })
  check(facts1.schema === 'acceptance-facts/2', 'schema 版本')
  check(facts1.architecture_facts !== undefined, '事实包含架构事实节')
  check(facts1.parse.file_count === 3, `文件数 3（实际 ${facts1.parse.file_count}）`)
  check(facts1.parse.documents.length === 2, `文档 2 份（实际 ${facts1.parse.documents.length}）`)
  check(facts1.static_facts.languages.join(',') === 'C', `语言 C（实际 ${facts1.static_facts.languages}）`)
  const mainSymbols = facts1.static_facts.files.find((file) => file.path === 'code/main.c')?.symbols ?? []
  check(mainSymbols.some((symbol) => symbol.kind === '函数' && symbol.name === 'main'), '提取到 main 函数')
  check(facts1.baseline.required_count === 3 && facts1.baseline.missing_count === 0, '基线 3 条全部命中')
  check(facts1.changes === null, '首轮无变更')
  check((await adapter.stat(path.join(round1Dir, FACTS_FILENAME))) !== null, '确定性事实.json 落盘')
  check((await adapter.stat(path.join(round1Dir, STATIC_FACTS_FILENAME))) !== null, '静态事实.json 落盘')
  check((await adapter.stat(path.join(round1Dir, RECORD_FILENAME))) !== null, '轮次记录.json 落盘')

  // ── 场景 2：修改 + 新增 + 缺项基线，复验 ──
  console.log('场景 2：v2 目录 + baseline-with-missing.json，第 2 轮复验')
  const v2 = path.join(work, 'delivery-v2')
  await cp(path.join(FIXTURES, 'sample-delivery'), v2, { recursive: true })
  const mainC = path.join(v2, 'code', 'main.c')
  await writeFile(mainC, (await readFile(mainC, 'utf8')) + '\n/* v2 */\n', 'utf8')
  await writeFile(path.join(v2, 'docs', '新增.md'), '# 新增\n', 'utf8')
  const facts2 = await runFacts({
    adapter,
    deliverable: v2,
    baseline: path.join(FIXTURES, 'baseline-with-missing.json'),
    roundInfo: { project: '冒烟项目', round: 2, round_type: '复验' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次2'),
  })
  check(JSON.stringify(facts2.changes.modified) === JSON.stringify(['code/main.c']), `变更-修改（实际 ${JSON.stringify(facts2.changes.modified)}）`)
  check(JSON.stringify(facts2.changes.added) === JSON.stringify(['docs/新增.md']), `变更-新增（实际 ${JSON.stringify(facts2.changes.added)}）`)
  check(facts2.baseline.missing_count === 1 && facts2.baseline.missing_items[0].text === '测试报告', '缺项识别：测试报告')
  check(facts2.deterministic_issues.length === 1 && facts2.deterministic_issues[0].severity === '严重', '确定性缺项 → 严重级 Issue')
  check(facts2.previous_issues.length === 0, '上轮问题为空')

  // ── 场景 3：zip 交付物与目录结果一致 ──
  console.log('场景 3：zip 交付物（等价性）')
  const { zipSync, strToU8 } = await import('fflate')
  const zipped = {}
  const rootDir = path.join(FIXTURES, 'sample-delivery')
  for (const name of await readdir(rootDir)) {
    const abs = path.join(rootDir, name)
    if ((await stat(abs)).isFile()) zipped[name] = strToU8(await readFile(abs, 'utf8'))
  }
  zipped['code/main.c'] = await readFile(path.join(rootDir, 'code', 'main.c'))
  zipped['docs/产品说明.md'] = await readFile(path.join(rootDir, 'docs', '产品说明.md'))
  const zipPath = path.join(work, 'delivery.zip')
  await writeFile(zipPath, Buffer.from(zipSync(zipped)))
  const facts3 = await runFacts({
    adapter,
    deliverable: zipPath,
    baseline: path.join(FIXTURES, 'baseline.json'),
    roundInfo: { project: '冒烟项目', round: 3, round_type: '例行验收' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次3'),
  })
  check(facts3.parse.file_count === facts1.parse.file_count, `zip 与目录文件数一致（${facts3.parse.file_count}）`)
  check(facts3.static_facts.files.length === facts1.static_facts.files.length, 'zip 与目录静态分析一致')

  // ── 场景 4：路径穿越防护 ──
  console.log('场景 4：恶意 zip（../ 路径）被静默跳过')
  const evil = { '../evil.txt': strToU8('x'), 'ok/README.md': strToU8('# ok\n') }
  const evilPath = path.join(work, 'evil.zip')
  await writeFile(evilPath, Buffer.from(zipSync(evil)))
  const facts4 = await runFacts({
    adapter,
    deliverable: evilPath,
    baseline: null,
    roundInfo: { project: '冒烟项目', round: 4, round_type: '例行验收' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次4'),
  })
  check(facts4.parse.file_count === 1, `仅 1 个合法条目（实际 ${facts4.parse.file_count}）`)
  check(!facts4.parse.paths.some((entry) => entry.includes('..')), '无穿越路径条目')

  // ── 场景 5：架构事实 —— 依赖图 / 环 / 未解析引用（6 语言） ──
  console.log('场景 5：arch-code 依赖图（6 语言跨文件引用 + 环 + 未解析）')
  const facts5 = await runFacts({
    adapter,
    deliverable: path.join(FIXTURES, 'arch-code'),
    baseline: null,
    roundInfo: { project: '冒烟项目', round: 5, round_type: '例行验收' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次5'),
  })
  const arch5 = facts5.architecture_facts
  check(facts5.schema === 'acceptance-facts/2', 'schema 版本 2')
  const hasEdge = (from, to, kind) => arch5.dependencies.edges.some((edge) => edge.from === from && edge.to === to && edge.kind === kind)
  check(hasEdge('c/main.c', 'c/util.h', 'include'), 'C include 依赖边')
  check(hasEdge('cpp/main.cpp', 'cpp/helper.hpp', 'include'), 'C++ include 依赖边')
  check(hasEdge('a/Main.java', 'b/Helper.java', 'import'), 'Java import 依赖边')
  check(hasEdge('maven/src/main/java/cn/demo/Main.java', 'maven/src/main/java/cn/demo/Util.java', 'import'), 'Java Maven 布局后缀映射依赖边')
  check(hasEdge('js/app.js', 'js/lib/util.js', 'require'), 'JS require 依赖边')
  check(hasEdge('ts/app.ts', 'ts/lib/util.ts', 'import'), 'TS 扩展名推断依赖边')
  check(hasEdge('tsx/App.tsx', 'tsx/Button.tsx', 'import'), 'TSX 扩展名推断依赖边')
  check(arch5.dependencies.cycles.some((cycle) => cycle.includes('cycle/a.js') && cycle.includes('cycle/b.js')), '循环依赖环命中')
  // 归口：包名引用 → 外部计数，不进 unresolved；相对路径未定位 → unresolved 真问题
  check(!arch5.dependencies.unresolved.some((item) => item.file === 'tsx/Button.tsx' && item.ref === 'react'), '包名引用不再归未解析')
  check(arch5.dependencies.external.some((entry) => entry.group === 'third-party' && entry.prefix === 'react'), '包名引用归外部计数（react）')
  check(arch5.dependencies.external.some((entry) => entry.group === 'jdk' && entry.prefix === 'java'), 'JDK 引用归外部计数（java）')
  check(arch5.dependencies.unresolved.some((item) => item.file === 'js/miss.js' && item.ref === './nope.js'), '相对路径未定位仍归未解析')
  check(arch5.dependencies.static_imports >= 0, '静态导入计数存在')
  // 通配导入 → 包级模块边
  check(arch5.dependencies.module_edges.some((edge) => edge.kind === 'wildcard' && edge.from === 'maven/src/main/java/cn/demo' && edge.to === 'maven/src/main/java/cn/other'), '通配导入包级模块边')

  // ── 场景 5b：耦合度量 / 孤儿 / 可达性 / 模块聚合表 ──
  const moduleTable = arch5.modules
  check(moduleTable.some((module) => module.name === 'ts' && module.ce >= 1), '模块耦合 Ce 计算（ts→ts/lib）')
  check(moduleTable.some((module) => module.name === 'ts/lib' && module.ca >= 1), '模块耦合 Ca 计算（ts/lib 被依赖）')
  check(moduleTable.some((module) => module.instability >= 0 && module.instability <= 1 && module.distance >= 0 && module.distance <= 1), '不稳定性/主序列距离在 [0,1]')
  check(moduleTable.some((module) => module.functions > 0 && module.lines > 0), '模块规模聚合（函数数/行数）')
  check(arch5.orphans.includes('c/big.c'), '孤儿文件识别（big.c 无任何边）')
  check(arch5.unreachable.includes('cycle/a.js') && arch5.unreachable.includes('c/big.c'), '入口可达性（cycle/未接入文件不可达）')
  check(arch5.entry_files.includes('c/main.c') && arch5.entry_files.includes('js/app.js'), '入口文件启发式命中')

  // ── 场景 6：复杂度度量超阈值清单（同一轮事实） ──
  const overFuncs = arch5.metrics.over_threshold.functions
  check(overFuncs.some((fn) => fn.name === 'long_func' && fn.lines > 80 && fn.reasons.some((reason) => reason.includes('函数行数'))), '超长函数命中（行数 > 80）')
  check(overFuncs.some((fn) => fn.name === 'complex_func' && fn.complexity > 15 && fn.reasons.some((reason) => reason.includes('圈复杂度'))), '高复杂度函数命中（圈复杂度 > 15）')
  check(arch5.metrics.distribution.function_count > 0, '函数度量分布存在')
  check(arch5.metrics.thresholds.FUNCTION_LINES === 80 && arch5.metrics.thresholds.COMPLEXITY === 15, '阈值常量随事实输出')

  // ── 场景 7：依赖清单（package.json / pom.xml / CMakeLists） ──
  console.log('场景 7：arch-manifests 依赖清单')
  const facts7 = await runFacts({
    adapter,
    deliverable: path.join(FIXTURES, 'arch-manifests'),
    baseline: null,
    roundInfo: { project: '冒烟项目', round: 7, round_type: '例行验收' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次7'),
  })
  const manifests7 = facts7.architecture_facts.manifests
  check(manifests7.entries.some((entry) => entry.name === 'lodash' && entry.version === '^4.17.21' && entry.type === 'npm'), 'package.json 依赖条目')
  check(manifests7.entries.some((entry) => entry.name === 'org.junit.jupiter:junit-jupiter' && entry.version === '5.10.2' && entry.type === 'maven'), 'pom.xml 依赖条目（属性展开）')
  check(manifests7.entries.some((entry) => entry.name === 'com.google.guava:guava' && entry.version === ''), 'pom.xml 缺失版本留空')
  check(manifests7.entries.some((entry) => entry.name === 'Threads' && entry.type === 'cmake-find_package'), 'CMake find_package 条目')
  check(manifests7.heuristic === true, 'CMake 启发式标记')

  // ── 场景 8：重复片段检测 ──
  console.log('场景 8：arch-dupes 重复片段')
  const facts8 = await runFacts({
    adapter,
    deliverable: path.join(FIXTURES, 'arch-dupes'),
    baseline: null,
    roundInfo: { project: '冒烟项目', round: 8, round_type: '例行验收' },
    outDir: path.join(work, 'acceptance', '冒烟项目-轮次8'),
  })
  const dupes8 = facts8.architecture_facts.duplicates
  check(dupes8.fragments.some((fragment) => fragment.lines >= 9 && fragment.occurrences.some((occurrence) => occurrence.path === 'a.js') && fragment.occurrences.some((occurrence) => occurrence.path === 'b.js')), '跨文件重复片段命中（≥9 行）')

  // ── 场景 9：历史 /1 事实包仍可通用解析 ──
  console.log('场景 9：历史 acceptance-facts/1 可读兼容')
  const legacy = JSON.parse(await readFile(path.join(FIXTURES, 'facts-v1.json'), 'utf8'))
  check(legacy.schema === 'acceptance-facts/1' && legacy.parse.file_count === 1, '历史 /1 事实包解析')

  // ── 场景 10：产物目录排除（交付物内 acceptance 不再自污染） ──
  console.log('场景 10：交付物内产物目录排除')
  const polluted = path.join(work, 'polluted-delivery')
  await cp(path.join(FIXTURES, 'sample-delivery'), polluted, { recursive: true })
  await mkdir(path.join(polluted, 'acceptance', 'hutool-轮次1'), { recursive: true })
  await writeFile(path.join(polluted, 'acceptance', 'junk-上轮产物.txt'), 'junk', 'utf8') // 预置旧产物
  await writeFile(path.join(polluted, 'acceptance', 'hutool-轮次1', '确定性事实.json'), '{}', 'utf8')
  const facts10 = await runFacts({
    adapter,
    deliverable: polluted,
    baseline: null,
    roundInfo: { project: '冒烟项目', round: 10, round_type: '例行验收' },
    outDir: path.join(polluted, 'acceptance', '冒烟项目-轮次10'),
  })
  check(facts10.parse.file_count === 3, `排除产物目录后文件数 3（实际 ${facts10.parse.file_count}）`)
  check(!facts10.parse.paths.some((entry) => entry.startsWith('acceptance/')), '产物目录子树被排除')

  await rm(work, { recursive: true, force: true })
  if (failures > 0) {
    console.error(`\n${failures} 项断言失败`)
    process.exit(1)
  }
  console.log('\n全部断言通过 ✓')
}

main().catch((error) => {
  console.error('冒烟失败：', error)
  process.exit(1)
})
