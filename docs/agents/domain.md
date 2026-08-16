# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the 交付验收（DSH agent 版）glossary：角色（甲方/供应商/agent）、验收对象、验收过程（确定性层/agent 语义层/事实包/轮次）、验收产物与判定口径
- **`docs/adr/`** — read ADRs that touch the area you're about to work in（0001 原生内建、0002 确定性/语义分层、0003 路径语义）

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo（本仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-验收能力原生内建.md
│   ├── 0002-agent承担语义判断.md
│   └── 0003-路径语义.md
├── lib/          ← 确定性层实现（能力本体）
├── plugins/      ← DSH 插件入口（三个验收工具）
└── profiles/     ← 领域专项业务描述
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` — 交付物/基线/事实包/补缺/偏差四类/问题分级/验收轮次/复验/变更识别/业务画像/接手方案。Don't drift to synonyms the glossary explicitly avoids（如"验收批次""差异""静态层"）。

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (验收能力原生内建) — but worth reopening because…_
