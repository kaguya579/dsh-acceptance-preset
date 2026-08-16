# 01 确定性层：依赖图（6 语言跨文件引用、模块聚合、循环依赖检测）

Status: needs-triage

## 描述

新增 `lib/deps.mjs`：基于现有 tree-sitter 语法树提取 6 语言（C/C++/Java/JS/TS/TSX）的跨文件依赖——import/include/require 解析为文件级依赖边（A 引用 B），聚合模块（目录/包）级依赖，检测循环依赖（强连通分量）。纯静态、不执行交付代码；>2MB 代码文件沿用「仅哈希不入内存解析」策略。未解析引用（第三方库、无法定位的路径）进 unresolved 清单，不强行猜。

## 建议处置

- 每语言一个 resolver：相对路径解析 + 扩展名/目录索引推断 + 包名/系统头跳过或映射到项目内文件；
- 输出：文件级边表 + 模块聚合表 + 环清单（环内节点）+ unresolved 清单；
- 单元/冒烟测试：fixtures 覆盖 6 语言样本；构造含环 fixture 验证环检测命中。

## 验收标准

- `node test/smoke.mjs` 通过；6 语言 fixture 均产出依赖边；环 fixture 命中。
