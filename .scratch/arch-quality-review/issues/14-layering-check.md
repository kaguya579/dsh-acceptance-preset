# 14 分层违规校验（白名单规则 + 确定性校验器）

Status: ready-for-agent

## 描述

把「分层违规」从 agent 手工判断升级为「规则 + 确定性校验」（deptrac/ArchUnit 思路）。决策：①规则由 agent 从架构文档/业务描述提取，写成本轮产物目录下 `架构分层规则.json`（本轮产物，复验可更新）；②白名单口径——rules 声明 allowed 依赖对，未声明的跨层依赖=违规，边未匹配任何层则忽略并计数 unmatched。

- 新 `lib/layering.mjs`：输入规则 + 模块级边（file + wildcard），输出 violations[]（{rule, from, to}）+ unmatched_count；
- 规则格式：`{ layers: [{name, match}], rules: [{from, to}] }`，match 按模块（目录）路径前缀/glob；
- `acceptance_run` 加可选参数 `layer_rules`（规则文件绝对路径）；产物目录存在 `架构分层规则.json` 时自动读取；
- 事实输出：`architecture_facts.layering = { layers, rules, violations, unmatched_count }`；
- 语义层：04 评审节「分层违规」优化项直接用 violations 作证据。

## 验收标准

- smoke：构造含违规的分层规则 fixture + 跨模块边 fixture → violations 命中预期对；未声明 allowed 的跨层边必现；unmatched 计数正确。
