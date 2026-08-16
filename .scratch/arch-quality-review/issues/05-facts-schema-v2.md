# 05 事实包 schema 升版 acceptance-facts/2 与历史轮次兼容

Status: needs-triage

## 描述

`lib/facts.mjs` 编排接入 01–04 的产出，事实包 schema 从 `acceptance-facts/1` 升版到 `acceptance-facts/2`：新增「架构事实」节（依赖图/复杂度度量/依赖清单/重复片段），原有字段保持不变。历史 /1 轮次保持可读——`acceptance_read` 按 schema 版本分派解析。

## 建议处置

- schema 版本字段显式化；/2 为 /1 的兼容超集；
- 同步更新 `acceptance_run`/`acceptance_read` 工具描述与 systemPrompt 提及事实包内容处；
- 兼容性冒烟：读一个 /1 fixture 验证照常解析。

## 验收标准

- smoke 通过（含 /1 读兼容用例）；新轮次事实包含架构事实节且 schema 版本为 2。
