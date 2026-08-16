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
  check(facts1.schema === 'acceptance-facts/1', 'schema 版本')
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
