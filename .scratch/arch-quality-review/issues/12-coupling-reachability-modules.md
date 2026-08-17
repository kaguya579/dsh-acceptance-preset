# 12 耦合度量（Ce/Ca/主序列距离）+ 孤儿/可达性 + 模块级聚合表

Status: ready-for-agent

## 描述

架构细化下一刀（纯确定性，基于已修好的依赖图）：

1. **模块表扩展**（新 `lib/modules.mjs`）：每模块 file_count/函数数/行数/均值与最大复杂度、Ce（传出模块数）、Ca（传入模块数）、不稳定性 Ce/(Ce+Ca)、抽象度 接口/(接口+类)、主序列距离 |I+A−1|、重复片段数与行数；
2. **孤儿模块**：文件级无入边且无出边的文件（cap 500）；
3. **入口可达性**：入口启发式（符号名为 main 的函数/方法，或 basename 以 Main/App/main/app/index 开头）→ BFS → 不可达文件清单（cap 1000，注明启发式）。

产出进 `architecture_facts`：`modules`、`orphans`、`unreachable`、`entry_files`。

## 验收标准

- smoke 场景 5b：cycle 模块 ce/ca ≥1；instability/distance ∈ [0,1]；big.c 在 orphans；cycle/a.js 与 big.c 在 unreachable；入口命中 c/main.c、js/app.js。
