# 15 依赖漂移 diff 内建（architecture_delta 节）

Status: ready-for-agent

## 描述

轮次间架构变化从 agent 手工对比升级为插件内建可复现 delta。复验轮次自动读上轮 `<outRoot>/<项目>-轮次<N-1>/确定性事实.json` 对比（轮次记录与事实包同目录，无额外脆弱性、零记录格式变更）。

- delta 范围：文件级/模块级边增删、环增删、模块 ce/ca 增减与新增/消失模块、函数数/行数总量变化、unresolved/external 数量变化；
- 输出：本轮事实包新增 `architecture_delta` 节（schema 仍 acceptance-facts/2 兼容超集）；首轮/无上轮产物时 `delta=null` + 说明（note 字段）；
- 语义层：00 总览/04 评审节直接引用 delta 数字；「未检查≠无」仍适用。

## 验收标准

- smoke：同一交付物跑两轮（第二轮改动依赖）→ 第二轮 delta 含预期新增/消失边；首轮 delta=null。
