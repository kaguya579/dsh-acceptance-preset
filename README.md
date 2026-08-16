# DSH 交付验收 preset（acceptance）

把[交付验收工具](https://gitcode.com/kaguya589/project-handover)桥接进 DeepSeek Harness（DSH）的 agent preset。设计理念：**工具只做确定性事实，语义判断全部由 agent 完成**——解析/静态分析/补缺识别/轮次快照由 Python facts 出口执行（绝不调用 LLM、绝不超时崩盘），四类偏差、问题分级、业务画像、接手方案、验收结论由 agent 基于事实包推理并取证。

## 目录结构

```
acceptance/
├── preset.yml                    # preset 显示元数据
├── agent.cordis.yml              # 组合文件（standard 为底 + tool-acceptance 行）
├── plugins/acceptance-bridge.mjs # 插件本体（零依赖，随 preset 分发）
├── README.md
└── LICENSE                       # Apache-2.0
```

## 前置依赖

- DeepSeek Harness（DSH）
- Python ≥ 3.12 + [交付验收工具](https://gitcode.com/kaguya589/project-handover)：`pip install -e .`（需含 `facts` 子命令，即 main 分支）
- 验收工具默认使用项目内 `.venv` 的 python（可配置）

## 安装（落到本地）

```powershell
git clone <本仓库> "${env:DSH_HOME:-$HOME/.dsh}/.agent-presets/acceptance"
```

重启 DSH（或新会话）后选择 `acceptance` preset 即可；新会话的 agent 将拥有 `acceptance_run` / `acceptance_list_rounds` / `acceptance_read` 三个工具。

## 配置

编辑 `agent.cordis.yml` 中 `tool-acceptance` 行的 `config`：

| 字段 | 含义 | 缺省 |
|---|---|---|
| `projectRoot` | 交付验收项目根目录（**必填**） | — |
| `pythonPath` | python 解释器 | `<projectRoot>\.venv\Scripts\python.exe` |
| `outDir` | 验收产物根目录 | `<projectRoot>\acceptance` |
| `sandboxMode` | 验收子进程沙箱模式 | `danger-full-access` |

## 安全姿态

`sandboxMode` 缺省为 `danger-full-access`：DSH Windows 沙箱下受限子进程无法写工作区（实测 Errno 13），而验收运行需要写产物目录与临时解包目录。验收工具自身保证：绝不执行交付代码、压缩包解包防路径穿越、写盘范围仅产物目录与临时目录。如你的部署不启用该沙箱，可改为 `workspace-write`。

## 使用

在 acceptance preset 会话中直接用中文对话：`验收 D:\交付\xxx.zip，项目 xxx，第 1 轮`；复验用 `第 2 轮复验`；出整改清单用 `生成给供应商的整改清单`。

## 维护

- 插件改动后 `git push`，本地 preset 目录 `git pull` 即生效（新会话生效）。
- 验收工具侧改动见项目仓库的 `docs/` 与分支工作流。
