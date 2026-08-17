# 16 HTML 事实仪表盘（ticket 09 落地）

Status: ready-for-agent

## 描述

确定性层把事实包渲染为单页静态 HTML 仪表盘（范围决策：只做事实仪表盘，md 文档组保留、agent 不写 HTML）。

- 新 `lib/report.mjs`：单页静态 HTML，数据内嵌、无网络、无外部 JS 库，SVG 手写——依赖图分层布局、度量分布条形图、模块表（含耦合/主序列距离）、超阈值/重复片段/依赖清单/violations/delta 表格；
- 产物：`<项目>-轮次N\验收仪表盘.html`，`acceptance_run` 每轮自动生成（纯确定性、无 LLM）；
- 体量控制：Top N + 聚合渲染，明细截断带「已截断」提示（5MB 事实包不膨胀成 50MB HTML）；
- 语义层：00 总览链接仪表盘文件。

## 验收标准

- smoke：从 arch-code 事实包生成 HTML，断言包含依赖图 SVG 容器、模块表行数与事实包一致、无外部资源引用（href/src 无 http）。
