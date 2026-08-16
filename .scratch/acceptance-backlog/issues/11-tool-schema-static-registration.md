# 11 静态注册工具的 parameters 必须用完整 JSON Schema

Status: resolved

## 描述

真实会话首跑报错：模型网关拒绝 `acceptance_list_rounds` 的 schema（`got 'type: null'`）。根因：harness 的 `ToolSchema.parameters` 序列化给模型时要求**完整 JSON Schema**（`{ type: 'object', properties, required }`）；宽松扁平风格（属性内 `required: true`）仅由动态路径的 `defineTool` 编译。静态 preset 插件直接 `tools.register` 手写定义，扁平参数未经编译被原样序列化 → `type: null`。

三个工具同病（`list_rounds` 只是字母序第一个被报告）。

## Answer

v0.4.1（commit 见 git log）将三个工具的 `parameters` 全部改为完整 JSON Schema；用 stub ctx 注册验证脚本确认 `type=object` + `required` 正确。教训：mount-validate 只验挂载、不验模型侧 schema——静态插件的工具定义需自测序列化形状（本票的验证脚本方法可复用进 test/）。

## Comments

- 2026-08-16：用户真实会话发现；修复 + 验证 + 推送 GitCode；GitHub 待网络（见 08）。
