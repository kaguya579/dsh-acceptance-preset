// acceptance_list_rounds 工具：列出产物根下的验收轮次。

import path from 'node:path'
import { listRoundDirs } from '../../lib/rounds.mjs'
import { resolveOutDir, withRoundAccess } from '../kit.mjs'

export function listTool(ctx, { legacyOutRoot, config }) {
  return {
    name: 'acceptance_list_rounds',
    description: '列出验收产物根目录下已完成的验收轮次（项目、轮次号与各轮产物文件清单），供复验与跨轮对比使用。产物根缺省为插件工程历史产物目录，可用 out_dir 指定（与验收时的产物目录一致）。',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '可选：只列指定项目的轮次' },
        out_dir: { type: 'string', description: '可选：产物根目录（绝对路径）；缺省为插件工程历史产物目录' },
      },
    },
    output: { schema: { type: 'object' }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      const { adapter } = withRoundAccess(ctx, exec)
      const outRoot = resolveOutDir(args, legacyOutRoot, config)
      if ((await adapter.stat(outRoot)) === null) {
        return { rounds: [], note: '验收产物根目录尚不存在（还没有任何验收轮次）' }
      }
      const filter = typeof args.project === 'string' ? args.project.trim() : ''
      const dirs = await listRoundDirs(adapter, outRoot, filter === '' ? undefined : filter)
      const rounds = []
      for (const dir of dirs) {
        const files = []
        for (const child of await adapter.listDir(path.join(outRoot, dir.dir))) {
          files.push({ name: child.name, type: child.type, size: child.size })
        }
        rounds.push({ project: dir.project, round: dir.round, dir: dir.dir, files })
      }
      return { rounds }
    },
  }
}
