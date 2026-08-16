# 05 tar.gz 路径测试覆盖

Status: needs-triage

## 描述

`lib/deliverable.mjs` 的 tar.gz 分支（gunzipSync + tar-stream extract、条目净化与限额）已实现但**无任何测试**——smoke.mjs 只覆盖 zip。tar 头解析、长度不符条目、目录条目跳过等行为未验证。

## 建议处置

在 test/smoke.mjs 增加场景：用 tar-stream 打包 fixtures 生成 .tar.gz（含目录条目与恶意 `../` 条目），断言条目数/穿越防护/与目录扫描等价。
