# Spec: arch-quality-review（架构与质量评审第一刀 + 第二轮增量）

Status: ready-for-agent

2026-08-16 `/grill-with-docs` 会话收敛后、`/to-spec` 产出（第一刀）。2026-08-17 第二轮增量：真实验证（hutool 轮次2）后的修复与新架构事实。领域术语见 `CONTEXT.md`；决策依据见 ADR-0004（架构事实扩展）、ADR-0005（优化项咨询性定位）。

## 第二轮增量（2026-08-17，tickets 10–13）

### Problem（验证暴露的缺口）

真实验证（hutool 轮次2）发现：①产物目录在交付物内时自污染快照（P2「交付物混入验收产物」）；②unresolved 被 JDK/第三方/通配/静态导入噪音打满 2000 封顶，依赖图完整性不可判定；③架构事实只有边与环，缺少耦合度量、孤儿/可达性、模块聚合；④复验修复状态无结构化口径；⑤重复片段 500 封顶掩盖大项目全貌。

### Solution

1. 扫描排除本轮产物目录（ticket 10）；
2. unresolved 四分类归口：通配→包级模块边、JDK/第三方/系统头→外部计数、静态导入→忽略、相对路径真未定位→unresolved（ticket 11）；
3. 模块表（Ce/Ca、不稳定性、抽象度、主序列距离、规模与重复聚合）+ 孤儿模块 + 入口可达性（ticket 12）；
4. 03-问题清单固定表格 + 复验修复状态四值 + 防假已修复护栏 + 整改完成率（backlog 04 b 方向，ticket 13）；
5. 重复片段上限 500→2000（ticket 13）。

### Testing

- smoke 场景 5/5b/10 新断言：归口（react→external、java.*→jdk、`./nope.js`→unresolved）、通配包级边、耦合/孤儿/可达性/入口、产物目录排除（file_count 不含产物子树）；
- 修复状态口径为语义层指引，真实验收会话验证。

## 第一刀

### Problem Statement

甲方验收供应商交付物时，验收报告只有缺陷视角（四类偏差 + 问题分级）：它能回答「交付物符不符合要求」，却回答不了「交付物哪里设计得不好、接手后该先改什么」。甲方在验收时想一并了解项目架构、识别不合理之处、拿到优化方向，但 agent 现在只能靠零散下钻代码临场拼凑，没有结构化的架构事实支撑——判断没有证据锚点，报告里也没有固定位置承载这类咨询性结论。功能显得单薄，验收与「接手」之间的信息断层靠 agent 临场发挥补。

## Solution

在确定性层新增「架构事实」四件套，随事实包（schema `acceptance-facts/2`）落盘并内联返回：

1. **依赖图**：6 语言（C/C++/Java/JS/TS/TSX）跨文件引用与被引用、模块（目录/包）聚合、循环依赖检测、未解析引用清单；
2. **复杂度度量**：函数/文件行数、圈复杂度、规模分布与超阈值清单（带文件:行号证据）；
3. **依赖清单**：package.json / pom.xml / CMakeLists.txt 声明的第三方库与版本；
4. **重复片段**：内容哈希检测的重复代码块（带文件:行号对）。

agent 语义层据此产出验收报告新增节「架构与质量评审」：架构梳理 → 优化项清单（高/中/低分级，每条 = 证据 + 判断 + 建议）→ 与接手方案衔接。优化项是咨询性内容：不影响验收结论、不进整改清单、不参与问题分级。复验时 agent 对比两轮事实包追踪架构趋势。

## User Stories

1. As 甲方, I want the facts package to include cross-file dependency edges for all six supported languages, so that the agent can reason about coupling without re-parsing the code.
2. As 甲方, I want each dependency edge to carry its kind (import/include), so that evidence is traceable to a source construct.
3. As 甲方, I want dependencies aggregated at module (directory/package) granularity, so that the architecture overview reads at the module level instead of the file level.
4. As 甲方, I want cycle detection to list the member nodes of every dependency cycle, so that circular dependencies become provable evidence rather than an impression.
5. As 甲方, I want unresolved references (third-party packages, system headers, unlocatable paths) listed separately and never guessed, so that internal and external dependencies stay distinguishable.
6. As 甲方, I want files over 2MB to remain hash-only and unparsed, so that large deliverables keep the existing safety posture.
7. As 甲方, I want per-function metrics (line count, cyclomatic complexity) with file:line anchors, so that every 优化项 can cite exact evidence.
8. As 甲方, I want an over-threshold list (over-long functions/files, over-complex functions) precomputed, so that the agent does not scan raw distributions for suspects.
9. As 甲方, I want distribution summaries (counts, mean, median, Top N) per metric, so that the agent can describe scale and complexity trends without recomputing them.
10. As 甲方, I want package.json dependencies (with versions) extracted, so that the third-party surface of JS/TS deliverables is visible.
11. As 甲方, I want pom.xml dependency coordinates (groupId/artifactId/version) extracted, so that Java deliverables' third-party surface is visible.
12. As 甲方, I want CMakeLists.txt targets and find_package references extracted with a heuristic label, so that C/C++ deliverables' build dependencies are visible without over-claiming precision.
13. As 甲方, I want manifest entries to carry their source file and type, so that each entry can be traced back to where it was declared.
14. As 甲方, I want missing versions left empty rather than guessed, so that the facts stay honest.
15. As 甲方, I want duplicated fragments (above a length threshold) reported with file:line pairs, so that 工程卫生优化项 have hard evidence.
16. As 甲方, I want the facts package schema bumped to `acceptance-facts/2` with every v1 field unchanged, so that existing consumers keep working.
17. As 甲方, I want historical `/1` rounds to stay readable through the existing read tool, so that cross-round comparison never breaks.
18. As 甲方, I want the acceptance tool descriptions updated to mention 架构事实, so that future agents know the capability exists.
19. As agent, I want prompt guidance defining the 架构与质量评审 section structure (梳理 → 优化项 → 接手衔接), so that reports are consistent across rounds.
20. As agent, I want a checklist of evidence-backed review items (依赖环、孤儿模块、可达性、分层违规、超阈值复杂度、重复片段), so that findings come from facts instead of invention.
21. As agent, I want explicit rules that 优化项 use 高/中/低 grading and never mix with 问题分级, so that the conclusion's integrity is preserved.
22. As agent, I want cross-round trend rules for 复验 (new/disappeared cycles, complexity growth, dependency additions/removals), so that architecture trends are checked consistently.
23. As 甲方, I want 优化项 excluded from the 整改清单 and the 验收结论, so that a compliant vendor delivery can never be failed on subjective advice.
24. As 甲方, I want style-subjective items (naming, style, refactoring taste) excluded from 优化项, so that the review section stays credible.
25. As agent, I want every 优化项 to carry a deterministic evidence anchor, so that each suggestion is verifiable and contestable.

## Implementation Decisions

### 模块划分（确定性层）

- 新增四个解析模块：依赖提取、复杂度度量、构建清单解析、重复片段检测；每个模块是纯函数集合，输入来自现有扫描/解析结果，输出结构化事实，绝不调用 LLM、绝不产出结论（ADR-0002）。
- 现有静态分析的一次解析结果被复用（度量与依赖提取挂在同一次 tree-sitter 解析上），不引入第二遍全量解析。
- 编排在现有 facts 编排函数内完成：四个模块的产出合并为事实包新增的 `architecture_facts` 节；不新增插件工具、不改产物文件布局。

### 依赖图（6 语言）

- 覆盖语言与现有静态分析一致：C、C++、Java、JavaScript、TypeScript、TSX；不新增语言（ADR-0004，wasm 体积考量）。
- 解析规则按语言：C/C++ 的 `#include`（引号本地头参与解析，尖括号系统头归未解析）、Java 的 `import`（包路径先精确映射，未命中按后缀匹配覆盖 Maven `src/main/java` 等布局前缀，偏好 main > test > 其余）、JS/TS/TSX 的 `import`/`require`（相对路径 + 扩展名/目录索引推断；包名不映射、归未解析）。
- 解析失败或无法定位的引用一律进 unresolved 清单，绝不猜测映射。
- 模块聚合按目录/包层级；循环依赖以强连通分量计算，环清单含全部成员节点，按规范化顺序去重。
- 产出形状：文件级边表（from/to/kind）+ 模块聚合表 + 环清单 + unresolved 清单；大图的边数设上限并带截断标记（沿用事实包现有截断惯例）。

### 复杂度度量

- 指标：函数/方法行数、文件行数、圈复杂度（分支计数）；每条指标带文件:行号。
- 超阈值清单内置阈值常量（函数行数 > 80、圈复杂度 > 15、文件行数 > 1000），阈值集中在单一模块内可调，作为事实输出而非结论。
- 分布摘要：总数、均值、中位、Top N；超阈值清单与 Top N 设条数上限。

### 依赖清单

- 三个格式：package.json（dependencies/devDependencies 及版本）、pom.xml（groupId/artifactId/version，用现有 XML 解析依赖；属性占位符尽力展开，缺失版本留空）、CMakeLists.txt（find_package/target_link_libraries/add_subdirectory 启发式，明确标注为启发式结果）。
- 条目携带名称、版本（可空）、来源文件、类型（声明处）；聚合去重按名称+版本。

### 重复片段

- 规范化后行级内容哈希，最小片段长度阈值（默认 6 行）；报告片段对，每条带文件:行号。
- 2MB 以上文件跳过解析（与现有大文件策略一致）；片段清单设条数上限。

### 事实包 schema 升版

- schema 版本字段从 `acceptance-facts/1` 升为 `acceptance-facts/2`；/2 是 /1 的兼容超集，所有 v1 字段保持不变，新增顶层 `architecture_facts` 节（依赖图、度量、依赖清单、重复片段四个子节）。
- 读取兼容天然成立：现有 read 工具对 facts 产物做通用 JSON 解析，不按版本分派；历史 /1 轮次无需迁移。
- 工具描述与语义指引文案更新，提及架构事实与评审节（见下）。

### agent 语义层（无插件事实改动）

- 系统提示新增「架构与质量评审」节指引：报告节结构（架构梳理 → 优化项按高/中/低分组〔每条 = 证据 + 判断 + 建议〕→ 接手方案衔接）、检查清单（依赖环、孤儿模块、可达性、分层违规、超阈值复杂度、重复片段——借鉴 dependency-cruiser/ArchUnit 规则语义）、与业务画像的分工（画像说「是什么」，评审节说「哪里不合理、怎么优化」）。
- 复验跨轮趋势规则：agent 对比两轮事实包（新增/消失依赖环、复杂度增减、依赖增删）；「未检查」绝不表述为「无」。
- 优化项定位规则：不影响验收结论、不进整改清单、不参与问题分级；风格类主观项不列入。术语已入 `CONTEXT.md`。

## Testing Decisions

### 什么算好测试

只断言外部行为——`runFacts` 返回的事实包内容与落盘 JSON——不测模块内部实现细节；fixture 驱动、无网络、无 LLM、纯 Node 可复现。

### 测试缝

- **唯一测试缝（沿用现有）**：`test/smoke.mjs` 经 `runFacts` 端到端断言，与现有场景（目录/zip 等价、路径穿越、变更识别）同一风格。
- 新增场景：六语言依赖图（含跨文件引用 fixture 与一个环 fixture）、超阈值清单命中、三个 manifest 格式解析、重复片段命中、schema 为 /2 且 v1 字段不变、历史 /1 形状 fixture 仍可通用解析。
- 语义层（系统提示/评审节）无自动化缝：仓库无 prompt 测试先例，不新建缝，以一次真实验收会话人工验证（报告含评审节、优化项均带证据、与问题清单分表）。

### 测试 fixture

- 新增 fixture：各语言多文件代码目录（含跨文件 import/include）、一对构成环的文件、package.json/pom.xml/CMakeLists.txt 样本、含重复块的文件对；全部随 `test/fixtures/` 分发。

### 先例

现有 smoke 场景即为先例：精确计数断言（文件数、符号名、变更列表）、schema 字段断言、落盘文件存在性断言。

## Out of Scope

- 供应商档案/跨项目对比（独立 ticket）
- 云端 Java 领域专项业务描述（独立 ticket）
- HTML 报告/仪表盘（第二刀，依赖本 spec 稳定）
- 整改清单结构化 + 复验修复状态规则（已由 `.scratch/acceptance-backlog/` 跟踪）
- 测试映射（源代码↔测试文件缺口估算）、新语言支持（Python/Go 等）
- 插件侧跨轮次趋势 diff（趋势由 agent 对比两轮事实包完成，ADR-0004）
- 引入 codegraph 类外部引擎或 JS 专用依赖库（ADR-0004 已弃）

## Further Notes

- 本 spec 对应 tickets 01–06（`.scratch/arch-quality-review/issues/`）；07–09（供应商档案、云端 Java 专项、HTML 报告）各为独立 ticket，不在本 spec 范围。整改清单结构化由 `.scratch/acceptance-backlog/issues/04-recheck-fix-status-rules.md` 跟踪。
- 同类产品调研（实时核验版）见 `.scratch/arch-quality-review/research.md`：借鉴定论 Top 5 中「适应度函数/漂移检测、依赖+耦合度量、Code Health 评分、ATAM 报告骨架」已落入本 spec 的确定性层与语义层设计。
- 阈值常量（函数 80 行、圈复杂度 15、文件 1000 行、重复片段 6 行）是起始值，集中在单模块内便于按验收实践调参；它们产出的是「超阈值事实」，不是结论。
- 一致性不变量：确定性层只产事实、绝不产结论；优化项是咨询性内容；「未检查」绝不表述为「无」。
