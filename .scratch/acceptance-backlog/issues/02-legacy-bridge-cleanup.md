# 02 旧动态插件 accpt-1 停用

Status: needs-triage

## 描述

本会话内的动态插件 `accpt-1`（Python 桥接版）已随原工程归档而失效（python/.venv 已不在），但插件定义仍挂在本会话。新会话走 preset 原生版后，accpt-1 无存在价值。

## 建议处置

当前会话内执行 cordis_stop（或 cordis_undefine）清理；动态插件随进程重启自然消失，无需其他动作。
