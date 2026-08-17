// acceptance_run 工具：一轮确定性验收分析。

import path from 'node:path'
import { runFacts } from '../../lib/facts.mjs'
import { createRoundStore } from '../../lib/rounds.mjs'
import { parseLayeringRules } from '../../lib/layering.mjs'
import { normPath, validateProject, validateRound, resolveOutDir, withRoundAccess } from '../kit.mjs'

export function runTool(ctx, { config }) {
  return {
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
        layer_rules: { type: 'string', description: '可选：分层规则文件（架构分层规则.json）的绝对路径；缺省自动读取本轮产物目录下的同名文件；提供后做白名单分层校验，违规进 architecture_facts.layering' },
      },
      required: ['deliverable', 'project', 'round'],
    },
    output: { schema: { type: 'object' }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    timeoutMs: 600000,
    async execute(args, exec) {
      const { adapter } = withRoundAccess(ctx, exec)
      const deliverable = normPath(args.deliverable)
      if (deliverable === null) throw new Error('deliverable 必填')
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const roundType = args.round_type === '复验' ? '复验' : '例行验收'
      const outDir = resolveOutDir(args, path.join(path.dirname(deliverable), 'acceptance'), config)
      let baseline = null
      if (typeof args.baseline === 'string' && args.baseline.trim() !== '') {
        baseline = normPath(args.baseline)
        if (baseline === null) throw new Error('baseline 路径无效')
      }
      const store = createRoundStore(adapter, outDir)
      const roundDir = store.roundDir(project, round)
      // 分层规则：参数优先，缺省自动读取本轮产物目录下的 架构分层规则.json
      let layerRules = null
      if (typeof args.layer_rules === 'string' && args.layer_rules.trim() !== '') {
        const rulesPath = normPath(args.layer_rules)
        if (rulesPath === null) throw new Error('layer_rules 路径无效')
        layerRules = parseLayeringRules(await adapter.readText(rulesPath))
      } else {
        const autoPath = path.join(roundDir, '架构分层规则.json')
        if ((await adapter.stat(autoPath)) !== null) {
          layerRules = parseLayeringRules(await adapter.readText(autoPath))
        }
      }
      const startedAt = Date.now()
      const facts = await runFacts({
        adapter,
        deliverable,
        baseline,
        roundInfo: { project, round, round_type: roundType },
        outRoot: outDir,
        layerRules,
      })
      return {
        ok: true,
        output_dir: roundDir,
        duration_ms: Date.now() - startedAt,
        facts,
      }
    },
  }
}
