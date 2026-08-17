# 18 供应商档案确定性台账工具（acceptance_supplier_profile）

Status: ready-for-agent

## 描述

决策 B：新增插件工具做确定性统计，agent 只做语义档案。工具 `acceptance_supplier_profile`：

- 参数：supplier（供应商名，分组标签）、projects（项目名数组）、out_dir 可选（缺省同 acceptance_list_rounds 语义）；
- 行为：遍历各项目全部轮次 → 读轮次记录与确定性事实.json → 产出**确定性台账 JSON**：每项目每轮次 {轮次/时间/文件数/变更摘要/确定性缺项数/架构摘要〔edges/cycles/unresolved/超阈值函数数/重复片段数/模块数〕} + 跨项目趋势表（按轮次序）；
- 语义层：agent 基于台账 + 各轮 03-问题清单.md 写 `供应商档案.md`（问题复发/整改时效/质量趋势，数据溯源到轮次记录）；
- CONTEXT.md「供应商档案」术语更新：台账（确定性）+ 档案（语义）双层。

## 验收标准

- smoke：构造两个项目各两轮的产物目录 → 工具台账含全部轮次行与趋势表；真实验收会话验证档案产出。
