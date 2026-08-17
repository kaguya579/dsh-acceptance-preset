// 交付验收工具桥（原生实现版）：确定性验收能力内建在本插件中，无任何外部进程依赖。
// 职责边界：只做确定性事实（安全解包/文档解析/静态分析/架构事实/补缺识别/轮次快照，事实包内联返回）；
// 四类偏差、问题分级、业务画像、接手方案等语义判断由 agent 完成。
// 路径语义：交付物目录与需求/合同目录是两个独立来源，验收时由用户分别提供（绝对路径）；
// 产物根目录缺省为插件工程根/acceptance（可用 config.outDir 覆盖）。
// 产物落盘走 harness fs 服务（遵守会话沙箱策略，盖会话策略戳，见 kit.mjs），不需要任何提权。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTool } from './tools/run.mjs'
import { listTool } from './tools/list.mjs'
import { readTool } from './tools/read.mjs'
import { supplierTool } from './tools/supplier.mjs'

export const name = 'acceptance-bridge'

export function apply(ctx, config = {}) {
  const tools = ctx.get('tools')
  if (tools === undefined) return
  const presetRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))) // 插件工程根
  const legacyOutRoot = String(config.outDir || path.join(presetRoot, 'acceptance')) // 读/列缺省：插件工程历史产物
  const opts = { legacyOutRoot, config }

  for (const tool of [runTool(ctx, opts), listTool(ctx, opts), readTool(ctx, opts), supplierTool(ctx, opts)]) {
    ctx.effect(() => tools.register(tool), `tool: ${tool.name}`)
  }

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'tool:acceptance',
      order: 121,
      text: '交付验收工具桥：验收前先向用户询问——「交付物目录」（供应商交付，必填）与「需求/合同目录」（甲方基线，可选），均用绝对路径；「产物目录」可选：缺省放交付物同级（<交付物父目录>\\acceptance），用户也可指定任意目录（out_dir，验收全程统一使用；必须在会话沙箱可写范围内，被拒时改用交付物目录内或会话工作区内路径，或请用户 /permission danger-full-access）。调用 acceptance_run（只执行确定性层：解析/静态分析/架构事实〔依赖图〔含通配导入包级边、外部引用计数、真未解析〕/复杂度度量/模块表〔耦合 Ce·Ca、不稳定性、主序列距离、规模与重复聚合〕/孤儿与可达性/依赖清单/重复片段〕/补缺/轮次快照，事实包内联返回，绝不调用 LLM；事实包大时分节用 acceptance_read 取数，勿整包重读）。四类偏差、问题分级、业务画像、接手方案、架构与质量评审等语义判断由你基于事实包完成（可配合 read/grep 下钻交付物代码与文档取证）。术语与判定口径：验收结论为通过/打回/无法判定（无基线为建议通过/建议整改/无法判定）。产出形态：必须产出「验收文档组」六个文件到本轮产物目录（用你自己的 write 工具写）：00-验收总览.md（判定+产物索引）、01-交付物概况与业务画像.md、02-偏差明细与取证.md、03-问题清单.md（供整改）、04-架构与质量评审.md、05-接手方案.md——每个文件承载对应章节的**细节**（逐条证据、数据、分级），总览只做结论与索引，不要把所有章节塞进一个文件。03-问题清单.md 用固定表格：编号 | 类别（四类偏差） | 位置（文件:行号） | 证据 | 级别（阻断/严重/一般） | 整改要求；优化项不进问题清单。架构与质量评审：04 文件按 ATAM 简化骨架组织——架构梳理（依赖图/模块边界/耦合表〔Ce·Ca 高者=中枢与脆弱点〕/孤儿与不可达文件）→ 质量属性场景（性能/可维护性/可测试性等，每条=场景描述+对应确定性证据）→ 敏感点/权衡点（架构决策的风险与取舍，无证据锚点不列）→ 优化项清单（高/中/低分组，每条=证据〔文件:行号+度量数字〕+判断+建议）→ 与接手方案衔接；检查清单参考：依赖环、孤儿模块、入口可达性、分层违规（有分层规则时直接引用 layering.violations）、超阈值复杂度（函数>80行/圈复杂度>15/文件>1000行）、重复片段；风格类主观项不列入优化项；优化项不影响验收结论、不进整改清单、不参与问题分级。复验轮次：对比事实包 changes 与 previous_issues 逐条评估修复状态——未修复/部分修复/已修复/无法判定（未做语义检查→无法判定；「未检查」绝不表述为「已修复」，防假已修复护栏），00-验收总览给出整改完成率（已修复数/上轮问题总数）；并对比两轮 architecture_facts 追踪架构趋势（新增/消失依赖环、复杂度增减、依赖增删）；「未检查」绝不表述为「无」。领域专项：车辆诊断（UDS）业务描述见插件工程 profiles/diagnostic/业务描述.md，相关交付物验收时应先读它并按其检查重点执行。',
    }), 'prompt: acceptance guide')
  }
}
