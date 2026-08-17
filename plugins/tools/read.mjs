// acceptance_read 工具：读取某轮次的验收产物。

import path from 'node:path'
import { createRoundStore } from '../../lib/rounds.mjs'
import { artifactFile, validateProject, validateRound, resolveOutDir, withRoundAccess } from '../kit.mjs'

export function readTool(ctx, { legacyOutRoot, config }) {
  return {
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
    output: { schema: { type: 'object' }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      const { adapter } = withRoundAccess(ctx, exec)
      const outRoot = resolveOutDir(args, legacyOutRoot, config)
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const filename = artifactFile(args.artifact)
      const filePath = path.join(createRoundStore(adapter, outRoot).roundDir(project, round), filename)
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
}
