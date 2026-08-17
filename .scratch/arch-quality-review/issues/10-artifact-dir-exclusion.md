# 10 扫描排除本轮产物目录（修复交付物自污染）

Status: ready-for-agent

## 描述

产物目录（缺省 `<交付物>\acceptance`）位于交付物目录内部时，后续轮次扫描会把上轮产物（facts JSON、文档组）当成交付内容计入快照——hutool 轮次2 曾因此把轮次1 的 5MB facts 扫成 P2「交付物混入验收产物」。修复：`scanDeliverable` 增加 `excludePrefix` 选项（相对前缀），目录/zip/tar 三路统一排除该子树；`runFacts` 按「交付物根（目录）或交付物父目录（压缩包）」与产物根（outDir 的父目录）的相对路径计算前缀。

## 验收标准

- smoke 场景 10：交付物内预置 acceptance/junk 与轮次目录，运行后 file_count 不含产物子树、paths 无 acceptance/ 前缀条目。
