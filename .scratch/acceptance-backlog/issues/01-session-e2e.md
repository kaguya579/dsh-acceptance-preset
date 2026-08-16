# 01 新 preset 未在真实会话端到端验证

Status: needs-triage

## 描述

mount-validate 通过（组合挂载成功）与 Node 冒烟测试全绿，但插件的 harnessAdapter（ctx.fs 的 resolve/readBytes/writeText/listDir 在真实服务上的行为）未经真实 acceptance preset 会话端到端验证。风险点集中在：writeText 原子写落盘、readBytes 的 FS_TOO_LARGE 降级、fs 服务在插件 fiber 内的可用性。

## 建议处置

重启 DSH → 新会话选 acceptance preset → 实测一轮验收（目录与 zip 各一次）→ 确认三个工具与产物落盘。验证通过后本票置 resolved。
