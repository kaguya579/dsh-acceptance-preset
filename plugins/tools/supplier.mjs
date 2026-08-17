// acceptance_supplier_profile 工具：供应商确定性台账。

import { buildSupplierLedger } from '../../lib/supplier.mjs'
import { validateProject, resolveOutDir, withRoundAccess } from '../kit.mjs'

export function supplierTool(ctx, { legacyOutRoot, config }) {
  return {
    name: 'acceptance_supplier_profile',
    description: '产出供应商确定性台账：聚合指定项目全部轮次的确定性摘要（轮次/类型/时间/文件数/相对上轮变更摘要/确定性缺项数/架构摘要〔依赖边/环/未解析/外部引用/超阈值函数/重复片段/模块数〕），并附跨项目趋势表（按时间/轮次序）。返回 JSON 台账；语义档案（供应商档案.md：问题复发/整改时效/质量趋势）由 agent 基于台账 + 各轮问题清单撰写。',
    parameters: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: '供应商名（分组标签，不含路径分隔符与引号）' },
        projects: { type: 'array', items: { type: 'string' }, description: '项目名数组（必须是验收时使用的项目名）' },
        out_dir: { type: 'string', description: '可选：产物根目录（绝对路径）；缺省为插件工程历史产物目录' },
      },
      required: ['supplier', 'projects'],
    },
    output: { schema: { type: 'object' }, render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      const { adapter } = withRoundAccess(ctx, exec)
      const supplier = validateProject(args.supplier)
      const projects = Array.isArray(args.projects) ? args.projects.map((item) => String(item).trim()).filter((item) => item.length > 0) : []
      if (projects.length === 0) throw new Error('projects 必填：至少一个项目名')
      const outRoot = resolveOutDir(args, legacyOutRoot, config)
      return await buildSupplierLedger({ adapter, outRoot, supplier, projects })
    },
  }
}
