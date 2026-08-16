// 交付验收工具桥（原生实现版）：确定性验收能力内建在本插件中，无任何外部进程依赖。
// 职责边界：只做确定性事实（安全解包/文档解析/静态分析/补缺识别/轮次快照，事实包内联返回）；
// 四类偏差、问题分级、业务画像、接手方案等语义判断由 agent 完成。
// 路径语义：交付物目录与需求/合同目录是两个独立来源，验收时由用户分别提供（绝对路径）；
// 产物根目录缺省为插件工程根/acceptance（可用 config.outDir 覆盖）。
// 产物落盘走 harness fs 服务（遵守会话沙箱策略），不需要任何提权。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runFacts, FACTS_FILENAME, STATIC_FACTS_FILENAME } from '../lib/facts.mjs'
import { loadRoundRecord, RECORD_FILENAME } from '../lib/rounds.mjs'

const ARTIFACT_FILES = {
  report: '验收报告.md',
  issues: '问题清单.md',
  facts: FACTS_FILENAME,
  static_facts: STATIC_FACTS_FILENAME,
  record: RECORD_FILENAME,
}

function normPath(value) {
  let text = String(value).trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  if (text.length === 0) return null
  if (!/^[a-zA-Z]:[\\/]/.test(text) && !text.startsWith('\\\\')) {
    throw new Error('请提供绝对路径：交付物目录与需求/合同目录由用户分别提供')
  }
  return text
}

function validateProject(project) {
  const value = String(project).trim()
  if (value.length === 0) throw new Error('project 必填')
  if (/[\\/"']/.test(value)) throw new Error('project 不能包含路径分隔符或引号')
  return value
}

function validateRound(round) {
  const value = Number(round)
  if (!Number.isInteger(value) || value < 1) throw new Error('round 必须是正整数')
  return value
}

function artifactFile(artifact) {
  const name = ARTIFACT_FILES[artifact]
  if (name === undefined) throw new Error('artifact 必须是 report/issues/facts/static_facts/record 之一')
  return name
}

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** harness fs 服务 → lib 所需的适配器（全部绝对路径）。写入时盖会话沙箱策略戳。 */
function harnessAdapter(fs, policyOf) {
  return {
    async stat(absPath) {
      const target = await fs.resolve(absPath)
      const info = await fs.stat(target)
      return info === undefined ? null : { type: info.type, size: info.size ?? 0 }
    },
    async readText(absPath) {
      return fs.readText(await fs.resolve(absPath))
    },
    async readBytes(absPath, maxBytes) {
      const target = await fs.resolve(absPath)
      try {
        return await fs.readBytes(target, undefined, maxBytes)
      } catch (error) {
        if (String(error?.code ?? '').includes('TOO_LARGE')) return null
        throw error
      }
    },
    async writeText(absPath, content) {
      try {
        await fs.writeText(await fs.resolve(absPath), content, undefined, undefined, policyOf())
      } catch (error) {
        if (error?.code === 'FS_SANDBOX_DENIED') {
          throw new Error(`[sandbox: 产物目录写入被会话沙箱拒绝] ${absPath} 不在当前会话可写范围内。`
            + `请把 out_dir 指向会话工作区内的目录（如 <交付物>\\acceptance），或切换会话权限（/permission danger-full-access）后重试。原始信息：${error.message}`)
        }
        throw error
      }
    },
    async listDir(absPath) {
      const entries = await fs.listDir(await fs.resolve(absPath))
      return entries.map((entry) => ({ name: entry.name, type: entry.type, size: entry.size ?? 0 }))
    },
  }
}

/** 解析当前工具调用所属会话的沙箱策略（会话不存在/服务缺失时回落部署默认）。 */
function resolveSessionPolicy(ctx, exec) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const agent = exec?.agent
  if (sandboxPolicy === undefined || agent === undefined) return null
  try {
    return sandboxPolicy.resolve({ session: agent.session })
  } catch {
    return null
  }
}

export const name = 'acceptance-bridge'

export function apply(ctx, config = {}) {
  const fs = ctx.get('fs')
  const tools = ctx.get('tools')
  if (fs === undefined || tools === undefined) return
  const presetRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))) // 插件工程根
  const legacyOutRoot = String(config.outDir || path.join(presetRoot, 'acceptance')) // 读/列缺省：插件工程历史产物

  /** 解析产物根目录：工具参数 out_dir > config.outDir > 用途回落值。 */
  function resolveOutDir(args, fallback) {
    if (typeof args.out_dir === 'string' && args.out_dir.trim() !== '') {
      const explicit = normPath(args.out_dir)
      if (explicit === null) throw new Error('out_dir 路径无效')
      return explicit
    }
    if (typeof config.outDir === 'string' && config.outDir.trim() !== '') {
      return String(config.outDir)
    }
    return fallback
  }

  const runTool = {
    name: 'acceptance_run',
    description: '对交付物执行一轮确定性验收分析（内建实现：安全解包、docx/pdf/md/xlsx 解析、tree-sitter 静态分析、架构事实〔依赖图/复杂度度量/依赖清单/重复片段〕、补缺识别、轮次快照与变更识别；绝不调用 LLM、不产出报告与结论——语义判断由 agent 基于返回的事实包完成）。验收前先向用户询问：「交付物目录」（供应商交付，必填）与「需求/合同目录」（甲方基线，可选），均用绝对路径；产物目录可选——缺省放交付物同级（<交付物父目录>\\acceptance），用户可指定任意目录，但必须在会话沙箱可写范围内（被拒时用交付物目录内或会话工作区内路径，或请用户 /permission danger-full-access）。大项目可能耗时数分钟。产物落盘 <产物根>/<项目>-轮次<N>/（确定性事实.json、静态事实.json、轮次记录.json），事实包同时内联在返回的 facts 字段（大项目会很大，分节细节用 acceptance_read 按 artifact 取数，不要整包重读）。复验轮次（round_type=复验）自动识别变更并携带上轮问题清单（previous_issues），agent 应自行评估修复状态，并对比两轮事实包的 architecture_facts 追踪架构趋势。',
    parameters: {
      type: 'object',
      properties: {
        deliverable: { type: 'string', description: '交付物目录或压缩包（zip/tar.gz）的绝对路径（由用户提供）' },
        baseline: { type: 'string', description: '可选：基线（需求/合同）文件或目录（JSON/md/docx）的绝对路径；不提供则跳过补缺识别' },
        project: { type: 'string', description: '项目名称（字母、数字、中文、连字符；不含路径分隔符与引号）' },
        round: { type: 'number', description: '验收轮次（正整数）；同项目同轮次号会覆盖该轮产物' },
        round_type: { type: 'string', enum: ['例行验收', '复验'], description: '轮次类型；复验会基于上一轮轮次记录做变更识别' },
        out_dir: { type: 'string', description: '可选：产物根目录（绝对路径）；缺省为交付物同级的 acceptance 目录' },
      },
      required: ['deliverable', 'project', 'round'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 600000,
    async execute(args, exec) {
      const deliverable = normPath(args.deliverable)
      if (deliverable === null) throw new Error('deliverable 必填')
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const roundType = args.round_type === '复验' ? '复验' : '例行验收'
      const outDir = resolveOutDir(args, path.join(path.dirname(deliverable), 'acceptance'))
      const roundDir = path.join(outDir, `${project}-轮次${round}`)
      let baseline = null
      if (typeof args.baseline === 'string' && args.baseline.trim() !== '') {
        baseline = normPath(args.baseline)
        if (baseline === null) throw new Error('baseline 路径无效')
      }
      // 每次调用独立解析会话沙箱策略并盖在写入上（会话 /permission 与工作区跟随本会话）
      const policy = resolveSessionPolicy(ctx, exec)
      const adapter = harnessAdapter(fs, () => policy)
      const startedAt = Date.now()
      const facts = await runFacts({
        adapter,
        deliverable,
        baseline,
        roundInfo: { project, round, round_type: roundType },
        outDir: roundDir,
      })
      return {
        ok: true,
        output_dir: roundDir,
        duration_ms: Date.now() - startedAt,
        facts,
      }
    },
  }
  ctx.effect(() => tools.register(runTool), 'tool: acceptance_run')

  const listTool = {
    name: 'acceptance_list_rounds',
    description: '列出验收产物根目录下已完成的验收轮次（项目、轮次号与各轮产物文件清单），供复验与跨轮对比使用。产物根缺省为插件工程历史产物目录，可用 out_dir 指定（与验收时的产物目录一致）。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '可选：只列指定项目的轮次' },
        out_dir: { type: 'string', description: '可选：产物根目录（绝对路径）；缺省为插件工程历史产物目录' },
      },
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      const outRoot = resolveOutDir(args, legacyOutRoot)
      if ((await adapter.stat(outRoot)) === null) {
        return { rounds: [], note: '验收产物根目录尚不存在（还没有任何验收轮次）' }
      }
      const filter = typeof args.project === 'string' ? args.project.trim() : ''
      const rounds = []
      for (const entry of await adapter.listDir(outRoot)) {
        if (entry.type !== 'directory') continue
        const match = /^(.*?)-轮次(\d+)$/.exec(entry.name)
        if (match === null) continue
        const project = match[1]
        const round = Number(match[2])
        if (filter !== '' && project !== filter) continue
        const files = []
        for (const child of await adapter.listDir(path.join(outRoot, entry.name))) {
          files.push({ name: child.name, type: child.type, size: child.size })
        }
        rounds.push({ project, round, dir: entry.name, files })
      }
      return { rounds }
    },
  }
  ctx.effect(() => tools.register(listTool), 'tool: acceptance_list_rounds')

  const readTool = {
    name: 'acceptance_read',
    description: '读取某项目某轮次的验收产物：report=验收报告.md、issues=问题清单.md（旧版 pipeline 产物）；facts=确定性事实.json（facts 出口的结构化事实包）、static_facts=静态事实.json、record=轮次记录.json（文件 sha256 快照与上轮问题，复验修复状态的基础）。JSON 产物返回解析后的对象，report/issues 返回 markdown 全文。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目名称' },
        round: { type: 'number', description: '轮次（正整数）' },
        artifact: { type: 'string', enum: ['report', 'issues', 'facts', 'static_facts', 'record'], description: '产物类型' },
        out_dir: { type: 'string', description: '可选：产物根目录（绝对路径）；缺省为插件工程历史产物目录' },
      },
      required: ['project', 'round', 'artifact'],
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args) {
      const outRoot = resolveOutDir(args, legacyOutRoot)
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const filename = artifactFile(args.artifact)
      const filePath = path.join(outRoot, `${project}-轮次${round}`, filename)
      const text = await adapter.readText(filePath)
      if (args.artifact === 'report' || args.artifact === 'issues') {
        return { path: filePath, text }
      }
      let json = null
      let parseError = null
      try {
        json = JSON.parse(text)
      } catch (error) {
        parseError = String(error)
      }
      return { path: filePath, json, parse_error: parseError }
    },
  }
  ctx.effect(() => tools.register(readTool), 'tool: acceptance_read')

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'tool:acceptance',
      order: 121,
      text: '交付验收工具桥：验收前先向用户询问——「交付物目录」（供应商交付，必填）与「需求/合同目录」（甲方基线，可选），均用绝对路径；「产物目录」可选：缺省放交付物同级（<交付物父目录>\\acceptance），用户也可指定任意目录（out_dir，验收全程统一使用；必须在会话沙箱可写范围内，被拒时改用交付物目录内或会话工作区内路径，或请用户 /permission danger-full-access）。调用 acceptance_run（只执行确定性层：解析/静态分析/架构事实〔依赖图/复杂度度量/依赖清单/重复片段〕/补缺/轮次快照，事实包内联返回，绝不调用 LLM；事实包大时分节用 acceptance_read 取数，勿整包重读）。四类偏差、问题分级、业务画像、接手方案、架构与质量评审等语义判断由你基于事实包完成（可配合 read/grep 下钻交付物代码与文档取证）。术语与判定口径：验收结论为通过/打回/无法判定（无基线为建议通过/建议整改/无法判定）。产出形态：必须产出「验收文档组」六个文件到本轮产物目录（用你自己的 write 工具写）：00-验收总览.md（判定+产物索引）、01-交付物概况与业务画像.md、02-偏差明细与取证.md、03-问题清单.md（供整改）、04-架构与质量评审.md、05-接手方案.md——每个文件承载对应章节的**细节**（逐条证据、数据、分级），总览只做结论与索引，不要把所有章节塞进一个文件。架构与质量评审：架构梳理（依赖图/模块边界观察）→ 优化项清单（高/中/低分组，每条=证据〔文件:行号+度量数字〕+判断+建议）→ 与接手方案衔接；检查清单参考：依赖环、孤儿模块、可达性、分层违规、超阈值复杂度（函数>80行/圈复杂度>15/文件>1000行）、重复片段；风格类主观项不列入优化项；优化项不影响验收结论、不进整改清单、不参与问题分级。复验轮次：对比事实包 changes 与 previous_issues 识别变更与修复状态，并对比两轮 architecture_facts 追踪架构趋势（新增/消失依赖环、复杂度增减、依赖增删）；「未检查」绝不表述为「无」。领域专项：车辆诊断（UDS）业务描述见插件工程 profiles/diagnostic/业务描述.md，相关交付物验收时应先读它并按其检查重点执行。',
    }), 'prompt: acceptance guide')
  }
}
