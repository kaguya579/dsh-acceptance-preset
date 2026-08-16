# 06 领域专项 agent 读取流程验证

Status: needs-triage

## 描述

诊断专项业务描述已随插件工程分发（`profiles/diagnostic/业务描述.md`），systemPrompt 也指引 agent 在相关验收前读取。但「agent 实际会读、会按检查重点逐项执行」的流程未在真实验收中验证过（历史 ai-code-helper 是云端项目，未触发诊断专项）。

## 建议处置

找一份车端/UDS 类交付物（或构造样例）在 acceptance preset 会话实测：确认 agent 读取业务描述并逐项执行检查重点。可与 01 的会话验证合并进行。
