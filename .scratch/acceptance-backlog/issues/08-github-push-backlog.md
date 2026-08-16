# 08 GitHub 远端推送补齐

Status: needs-triage

## 描述

2026-08-16 GitHub 推送两次失败（connection reset / 443 连接超时，疑似公司网络限制）。GitCode 为最新（1845968 之后的所有提交 + v0.3.0），GitHub 停留在 3368163/v0.2.0。

## 建议处置

网络可达时（如非公司网络）在插件工程目录执行 `git push github main && git push github --tags` 补齐；每次提交的推送流程保留双远端。
