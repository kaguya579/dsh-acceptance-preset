# DSH 交付验收 preset（acceptance）

把**交付验收能力内建进 DeepSeek Harness（DSH）**的 agent preset。设计理念：**确定性事实在插件内完成，语义判断全部由 agent 完成**——安全解包、文档解析、tree-sitter 静态分析、补缺识别、轮次快照全部原生实现在插件内（纯 Node，无任何外部进程依赖），四类偏差、问题分级、业务画像、接手方案、验收结论由 agent 基于事实包推理并取证。

## 目录结构

```
acceptance/
├── preset.yml                    # preset 显示元数据
├── agent.cordis.yml              # 组合文件（standard 为底 + tool-acceptance 行）
├── package.json                  # npm 依赖（node_modules 不入库）
├── plugins/
│   └── acceptance.mjs            # 插件入口：acceptance_run/list_rounds/read 三个工具
├── lib/
│   ├── deliverable.mjs           # 目录/zip/tar.gz 安全扫描（防路径穿越 + 三重体积限制）
│   ├── documents.mjs             # md/docx/pdf/xlsx 解析（mammoth/pdfjs/xlsx）
│   ├── images.mjs                # PNG/JPEG/GIF/WebP 尺寸解析（零依赖头部解析）
│   ├── static.mjs                # tree-sitter 六语言符号提取（web-tree-sitter WASM）
│   ├── baseline.mjs              # 基线加载（JSON/md/docx）与确定性补缺识别
│   ├── rounds.mjs                # 文件快照/变更识别/轮次记录
│   └── facts.mjs                 # 编排：确定性事实.json + 静态事实.json + 轮次记录.json
├── profiles/
│   └── diagnostic/业务描述.md    # 车辆诊断（UDS）领域专项业务描述，agent 验收时读取
├── acceptance/                   # 验收产物根（缺省；不入库，见 .gitignore）
├── test/
│   └── smoke.mjs                 # 冒烟测试（node test/smoke.mjs）
├── README.md
└── LICENSE                       # Apache-2.0
```

## 前置依赖

- DeepSeek Harness（DSH）
- Node.js（harness 自带运行时）；**无 Python、无外部工具依赖**
- npm 依赖安装：`npm install`（纯 JS/WASM 依赖，无原生编译）

## 安装（落到本地）

```powershell
# GitCode（国内）：
git clone https://gitcode.com/kaguya589/dsh-acceptance-preset.git "${env:DSH_HOME:-$HOME/.dsh}/.agent-presets/acceptance"
# GitHub：
git clone https://github.com/kaguya579/dsh-acceptance-preset.git "${env:DSH_HOME:-$HOME/.dsh}/.agent-presets/acceptance"

cd "${env:DSH_HOME:-$HOME/.dsh}/.agent-presets/acceptance"
npm install
```

重启 DSH（或新会话）后选择 `acceptance` preset 即可；新会话的 agent 将拥有 `acceptance_run` / `acceptance_list_rounds` / `acceptance_read` 三个工具。

## 配置

**无需任何必填配置**。路径语义：交付物目录与需求/合同目录是两个独立来源，验收时由用户分别提供（绝对路径）；验收产物写入插件工程根下的 `acceptance/`。

`agent.cordis.yml` 中 `tool-acceptance` 行可选的 `config.outDir` 覆盖产物根目录：

```yaml
- id: tool-acceptance
  name: ./plugins/acceptance.mjs
  config:
    outDir: 'D:\somewhere\acceptance'
```

## 能力清单（内建，无 LLM、无结论）

- 交付物：目录 / zip / tar.gz；压缩包防路径穿越（拒绝对路径/盘符/`..`），单文件 64MB、总量 512MB、条目数 5 万三重上限；排除 `.git`/`node_modules`/`target` 等噪音目录
- 文档：md / docx / pdf / xlsx 元数据（标题/章节/段落/表格）
- 代码：tree-sitter 六语言（C/C++/Java/JavaScript/TypeScript/TSX）符号提取（函数/类/接口/方法 + 行号）
- 基线：JSON 清单 / md 清单行 / docx 列表段，目录聚合；确定性补缺识别（规范化子串匹配，缺项带出处）
- 轮次：文件 sha256 快照、变更识别（新增/修改/删除）、复验上轮问题清单
- 产物：`确定性事实.json`（schema `acceptance-facts/1`）+ `静态事实.json` + `轮次记录.json`
- 兼容性：事实包与轮次记录格式与[交付验收工具](https://gitcode.com/kaguya589/project-handover)的 facts 出口一致，历史轮次可互读

## 安全姿态

- 全程**无子进程**：解析在 harness 进程内完成，产物落盘走 harness `fs` 服务，遵守会话沙箱策略，不需要任何提权
- 绝不执行交付代码；压缩包只解字节、不落盘、不执行
- 大文件不载入解析（代码 >2MB、文档 >20MB 仅哈希不入内存解析）

## 使用

在 acceptance preset 会话中直接用中文对话：`验收 xxx 的交付物，第 1 轮`——agent 会分别向你询问**交付物目录**（供应商交付）与**需求/合同目录**（甲方基线，可选）两个绝对路径；复验用 `第 2 轮复验`；出整改清单用 `生成给供应商的整改清单`；车端诊断类交付物会按 `profiles/diagnostic/业务描述.md` 的检查重点执行。

## 维护

- 升级：本地 preset 目录 `git pull && npm install`（新会话生效）
- 测试：`node test/smoke.mjs`（依赖交付验收工具仓库的 fixtures，见测试文件头部注释）
- 改动走分支 + MR/PR，提交信息「英文前缀 + 中文描述」
