# 07 tree-sitter-wasms 依赖裁剪

Status: needs-triage

## 描述

`tree-sitter-wasms` 全量 51MB（约 30+ 语言语法包），实际只用 6 个（C/C++/Java/JavaScript/TypeScript/TSX）。npm 安装耗时与体积都偏大。

## 建议处置

把 6 个 wasm 文件拷入仓库（如 `lib/grammars/`）并去掉 tree-sitter-wasms 运行时依赖——语法文件本身是静态资产，随仓库分发反而更可控（同时消除版本漂移风险）。收益与仓库体积增加（约 10MB）之间权衡，低优先级。
