# DSH 交付验收 preset（acceptance）

把**交付验收能力内建进 DeepSeek Harness（DSH）**的 agent preset。设计理念：**确定性事实在插件内完成，语义判断全部由 agent 完成**——安全解包、文档解析、tree-sitter 静态分析、补缺识别、轮次快照全部原生实现在插件内（纯 Node，无任何外部进程依赖），四类偏差、问题分级、业务画像、接手方案、验收结论由 agent 基于事实包推理并取证。

## 目录结构

```
acceptance/
├── preset.yml                    # preset 显示元数据
├── agent.cordis.yml              # 组合文件（standard 为底 + tool-acceptance 行）
├── package.json                  # npm 依赖（node_modules 不入库）
├── plugins/
│   ├── acceptance.mjs            # 插件入口：注册四个验收工具 + 语义层指引
│   ├── kit.mjs                   # 工具装配：会话沙箱策略戳 / fs 适配器 / 路径校验
│   └── tools/                    # 四个工具：run / list / read / supplier
├── lib/
│   ├── deliverable.mjs           # 目录/zip/tar.gz 安全扫描（防路径穿越 + 三重体积限制 + 产物目录排除）
│   ├── documents.mjs             # md/docx/pdf/xlsx 解析（mammoth/pdfjs/xlsx）
│   ├── images.mjs                # PNG/JPEG/GIF/WebP 尺寸解析（零依赖头部解析）
│   ├── static.mjs                # tree-sitter 六语言符号/引用/函数度量提取（web-tree-sitter WASM）
│   ├── deps.mjs                  # 依赖图：引用分类（classifyRef）/路径解析/环检测/外部归口
│   ├── metrics.mjs               # 复杂度度量聚合与超阈值清单
│   ├── manifests.mjs             # 依赖清单（package.json/pom.xml/CMakeLists）
│   ├── dupes.mjs                 # 重复片段检测
│   ├── modules.mjs               # 模块表（Ce·Ca/主序列距离/规模聚合）+ 孤儿/可达性 + 架构摘要
│   ├── layering.mjs              # 分层违规校验（白名单口径）
│   ├── delta.mjs                 # 依赖漂移 delta（轮次间架构变化）
│   ├── report.mjs                # HTML 事实仪表盘（验收仪表盘.html，纯静态无外部库）
│   ├── supplier.mjs              # 供应商台账聚合
│   ├── arch.mjs                  # 架构事实合成（七步深模块，单一组装点）
│   ├── rounds.mjs                # RoundStore：轮次目录布局与产物读写（单一实现点）+ 变更识别
│   ├── names.mjs                 # 产物文件名常量（单一来源）
│   ├── baseline.mjs              # 基线加载（JSON/md/docx）与确定性补缺识别
│   └── facts.mjs                 # 两段式编排：扫描 + 事实合成/装配（确定性事实.json）
├── profiles/
│   ├── diagnostic/业务描述.md    # 车辆诊断（UDS）领域专项业务描述
│   └── cloud-java/业务描述.md    # 云端 Java 领域专项业务描述
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

**无需任何必填配置**。路径语义：交付物目录与需求/合同目录是两个独立来源，验收时由用户分别提供（绝对路径）；**验收产物缺省放交付物同级**（`<交付物父目录>\acceptance`），用户也可指定任意产物目录（工具参数 `out_dir`）。

`agent.cordis.yml` 中 `tool-acceptance` 行可选的 `config.outDir` 提供全局缺省产物根（优先级：工具参数 `out_dir` > `config.outDir` > 交付物同级/历史目录）：

```yaml
- id: tool-acceptance
  name: ./plugins/acceptance.mjs
  config:
    outDir: 'D:\somewhere\acceptance'
```

## 能力清单（内建，无 LLM、无结论）

- 交付物：目录 / zip / tar.gz；防路径穿越（拒绝对路径/盘符/`..`），单文件 64MB、总量 512MB、条目数 5 万三重上限；排除 `.git`/`node_modules`/`target` 等噪音目录；**产物目录自污染排除**（产物根位于交付物内时自动跳过该子树）
- 文档：md / docx / pdf / xlsx 元数据（标题/章节/段落/表格）
- 代码：tree-sitter 六语言（C/C++/Java/JavaScript/TypeScript/TSX）符号、跨文件引用、函数度量（行数/圈复杂度）提取
- 架构事实（schema `acceptance-facts/2`）：
  - 依赖图：文件级边、模块聚合、循环依赖、通配导入包级边、外部引用计数（JDK/第三方/系统头）、真未解析清单（相对路径未定位）
  - 复杂度度量：函数/文件行数、圈复杂度、分布摘要与超阈值清单（阈值 80/15/1000，随事实输出）
  - 模块表：Ce·Ca 耦合、不稳定性、抽象度、主序列距离、规模与重复聚合；孤儿文件、入口可达性
  - 依赖清单：package.json / pom.xml / CMakeLists.txt（版本缺失留空）
  - 重复片段：≥6 行跨文件重复（上限 2000，按模块聚合）
  - 分层校验：白名单口径（`架构分层规则.json` 产物目录自动读取或 layer_rules 参数传入）
  - 依赖漂移 delta：复验轮次自动对比上轮事实包（边/环/模块 ce·ca/度量变化）
- 基线：JSON 清单 / md 清单行 / docx 列表段，目录聚合；确定性补缺识别（规范化子串匹配，缺项带出处）
- 轮次：文件 sha256 快照、变更识别（新增/修改/删除）、复验上轮问题清单与修复状态口径（语义层四值）
- 产物：`确定性事实.json` + `静态事实.json` + `轮次记录.json` + `验收仪表盘.html`（单页静态、SVG 手写、无外部资源）
- 供应商台账：`acceptance_supplier_profile` 跨项目轮次聚合（时间/变更/架构摘要 + 跨项目趋势表）
- 兼容性：历史 `acceptance-facts/1` 轮次可互读

## 安全姿态

- 全程**无子进程**：解析在 harness 进程内完成，产物落盘走 harness `fs` 服务，遵守会话沙箱策略，不需要任何提权
- **产物写入必须盖「会话沙箱策略」戳**：每次工具调用解析 `sandboxPolicy.resolve({ session })` 并作为 per-call policy 传入 `fs.writeText`（与 `tool-fs` 同一模式）。不盖戳时插件内部 fs 调用会回落**部署默认策略**（workspace-write + 宿主进程 cwd 为根），会话的 `/permission` 与工作区不生效——2026-08-16 hutool 会话因此被拒写交付物同级目录、被迫搬运交付物（诊断记录见 git 历史/会话日志）。新增插件工具时沿用同一模式
- 绝不执行交付代码；压缩包只解字节、不落盘、不执行
- 大文件不载入解析（代码 >2MB、文档 >20MB 仅哈希不入内存解析）

## 使用

在 acceptance preset 会话中直接用中文对话：`验收 xxx 的交付物，第 1 轮`——agent 会向你询问**交付物目录**（供应商交付，必填）、**需求/合同目录**（甲方基线，可选）、**产物目录**（可选：缺省与交付物同级 `<交付物父目录>\acceptance`，也可指定任意目录）三个绝对路径；复验用 `第 2 轮复验`；出整改清单用 `生成给供应商的整改清单`；车端诊断类交付物会按 `profiles/diagnostic/业务描述.md` 的检查重点执行。

> 产物目录受会话沙箱约束：workspace-write 会话下需在会话工作区内（如 `<交付物>\acceptance`）；要在工作区外落盘可先 `/permission danger-full-access`。agent 产出的**验收文档组**（6 个 markdown：总览/画像/偏差明细/问题清单/架构与质量评审/接手方案）也写在同一产物目录。

## 维护

- 升级：本地 preset 目录 `git pull && npm install`（新会话生效）
- 测试：`node test/smoke.mjs`（依赖交付验收工具仓库的 fixtures，见测试文件头部注释）
- 改动走分支 + MR/PR，提交信息「英文前缀 + 中文描述」
