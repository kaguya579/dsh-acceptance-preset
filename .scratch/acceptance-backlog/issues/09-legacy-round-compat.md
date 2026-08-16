# 09 迁移后旧轮次产物跨版本互读验证

Status: needs-triage

## 描述

历史两轮产物（ai-code-helper 轮次1/2，Python facts 出口生成）已迁入插件工程的 `acceptance/`。事实包 schema 声明与 `acceptance-facts/1` 兼容、轮次记录格式一致，但 `acceptance_read` 对这两轮旧产物（尤其 `facts`/`record` artifact）的读取、以及后续对 ai-code-helper 做第 3 轮复验时的跨版本变更识别，未实测。

## 建议处置

在真实验收会话（见 01）里补测：`acceptance_read` 读旧两轮产物 + 对 ai-code-helper 跑一次复验，确认 changes/previous_issues 跨版本正确。
