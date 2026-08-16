# 调研：软件交付验收 / 代码评审 / 架构评审同类产品（实时核验版）

- 日期：2026-08-16
- 方式：web_search 聚类核验（9 次查询，预算内）；主域名/官网已核验者给链接，未能直接命中者标注「未核验」，不编造链接
- 与知识版出入：⚠️ 见文末「出入清单」

## 一、静态分析 / 代码质量平台

### 1. SonarQube / SonarCloud（SonarSource）
- **URL（已核验）**：[SonarQube 文档](https://docs.sonarsource.com/sonarqube-server/readme.md)、[SonarCloud 文档](https://docs.sonarsource.com/sonarqube-cloud/readme.md)
- **借鉴**：问题分级（Bug/Vulnerability/Code Smell + Blocker/Critical/Major/Minor/Info）与「阻断/严重/一般」同构；Quality Gate 对应「通过/打回」；圈复杂度/认知复杂度/重复率
- **两层映射**：issue/度量检出 → 确定性层；规则裁剪与阈值 → agent 语义层

### 2. CodeScene
- **URL（已核验）**：[codescene.com/product/how-it-works](https://codescene.com/product/how-it-works)、[Rust 支持公告](https://codescene.com/blog/rust-programming-language-is-now-supported-in-codescene)
- **借鉴**：Code Health 1–10 评分、热点识别（变更频次+协作+缺陷集中）、复杂度+耦合+认知负荷
- **两层映射**：历史挖掘/度量 → 确定性层（复用轮次快照）；评分聚合、打回阈值 → agent 语义层

### 3. NDepend
- **URL**：未核验（聚类查询未命中官方页）
- **借鉴**：依赖矩阵、Ce/Ca 耦合、主序列距离、CQLinq 自定义规则 → 度量/依赖图归确定性层，原则解读归 agent 语义层

### 4. Structure101（⚠️ 已被 SonarSource 收编）
- **URL（已核验）**：[SonarSource Structure101 文档](https://www.sonarsource.com/structure101/docs/cpa/studio/Content/intro/welcome-studio.html)
- **借鉴**：架构依赖图、分层违规校验、模块级复杂度/耦合

### 5. deptrac
- **URL（已核验）**：[deptrac.github.io](https://deptrac.github.io/deptrac/)、[github.com/deptrac/deptrac](https://github.com/deptrac/deptrac)
- **借鉴**：声明式层规则 + 可进 CI 的违规报告——「确定性层 + 语义层生成规则」范例

### 6. ArchUnit
- **URL**：官方域名未直接命中（[codecentric 实践文](https://www.codecentric.de/en/knowledge-hub/blog/archunit-in-practice-keep-your-architecture-clean)、[Thoughtworks 洞见](http://insights.thoughtworks.cn/archunit/) 为真实引用）
- **借鉴**：架构约束写成可执行断言；freeze store 冻结基线违规——与「轮次快照+基线补缺」同构

## 二、AI 代码评审 / 仓库理解工具

### 7. CodeRabbit（未核验到官方页）
### 8. Greptile（未核验到官方页）
### 9. Amazon CodeGuru Reviewer（未核验到官方页）
### 10. Qodo（原 CodiumAI，已核验改名）
- **URL（已核验）**：[qodo.ai/blog](https://www.qodo.ai/blog/pull-request-automation-tools/)
- **借鉴**：测试覆盖补全建议、AI 原生质量门
### 11. GitHub Copilot code review（未核验到专属页）
### 12. 通义灵码 / CodeBuddy / Bito（官方域名未核验）

此类工具几乎全部落在 **agent 语义层**、缺少确定性架构事实底座——正是本产品的差异化点。

## 三、架构评审方法论

### 13. ATAM（SEI）
- **URL（已核验）**：[SEI ATAM](https://www.sei.cmu.edu/library/the-architecture-tradeoff-analysis-method-2/)、[ATAM Collection](https://sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/)
- **借鉴**：质量属性场景 + 敏感点/权衡点（「不合理之处」结构化表达）+ 风险分级报告

### 14. C4 model（c4model.com 官方页未直接命中；[arc42 FAQ B-17](https://faq.arc42.org/questions/B-17/) 佐证常与 arc42 并用）

### 15. arc42
- **URL（已核验）**：[arc42.org](https://arc42.org/20yrs-ecosystem)、[faq.arc42.org](https://faq.arc42.org/questions/B-17/)
- **借鉴**：12 章结构化骨架（ADR、质量要求章节）作为文档-代码比对锚点

### 16. 架构适应度函数（Thoughtworks）
- **URL（已核验）**：[Dependency drift fitness function | Technology Radar](https://www.thoughtworks.com/radar/techniques/dependency-drift-fitness-function)
- **借鉴**：把架构特性写成可进 CI 的自动判定——与本产品「文档-代码漂移检测」直接对应

### 17. 轻量架构评审（未核验，无单一官方站点）

## 四、技术尽调（Technical Due Diligence）

无单一主流产品，为「方法论 + 散点工具」：
- [Persistent 技术尽调框架（PDF）](https://www.persistent.com/wp-content/uploads/2024/02/insight-extensure-framework-tech-due-diligence.pdf)
- [bluebear-io/nikui](https://github.com/bluebear-io/nikui)（LLM + 静态分析 + Git churn 热点，CodeScene 思路同源）
- [josediegorobles/rust-technical-audit-toolkit](https://github.com/josediegorobles/rust-technical-audit-toolkit)（架构/依赖/质量/风险 CLI 审计）
- **借鉴**：接手可行性评估维度（可维护性/知识集中度/依赖风险/单点）、红黄绿分级

## 五、文档-代码漂移检测 / 交付审计

- **URL（已核验相关）**：[Thoughtworks Dependency drift fitness function](https://www.thoughtworks.com/radar/techniques/dependency-drift-fitness-function)、[Architecture Drift Detection 综述](https://blog.earezki.com/ai-news/2026-06-08-architecture-drift-detection-keep-your-code-aligned-with-design/)
- **借鉴**：契约漂移比对、「只报新增漂移」基线 diff 语义；交付审计无单一专名产品（未核验）

## 出入清单（与知识版不一致处）

1. ⚠️ Structure101 现由 SonarSource 托管，大概率被收购/整合——「独立工具」描述作废；且印证「架构可视化 + 质量门禁」正在融合，与本产品「确定性架构事实 + agent 语义判断」两层定位方向一致；
2. CodeScene 仍活跃更新（新增 Rust 支持）；
3. Thoughtworks 技术雷达明确有「Dependency drift fitness function」条目——文档-代码漂移检测的强佐证；
4. Qodo 确为原 CodiumAI 改名；
5. 技术尽调没有单一主流产品，是方法论 + 散点工具并存。

## 借鉴定论 Top 5

1. **适应度函数/Dependency Drift Fitness Function**（[Thoughtworks](https://www.thoughtworks.com/radar/techniques/dependency-drift-fitness-function)）：确定性层做断言引擎（依赖图、分层违规、环、耦合阈值、漂移 diff），agent 语义层按需求+基线定义规则集；
2. **依赖矩阵 + 耦合度量**（Ce/Ca、主序列距离、热点）（[CodeScene](https://codescene.com/product/how-it-works)、[nikui](https://github.com/bluebear-io/nikui)）：确定性层算，agent 解读语境风险；
3. **Code Health 评分 + 热点识别**（[CodeScene](https://codescene.com/product/how-it-works)）：度量在确定性层，评分权重归 agent 语义层；
4. **ATAM 报告骨架**（[SEI ATAM](https://www.sei.cmu.edu/library/the-architecture-tradeoff-analysis-method-2/)）：评审节结构模板，分级命名与 SonarQube Blocker/Critical/Major 对齐；
5. **漂移检测 + 技术尽调接手框架**（[Thoughtworks drift](https://www.thoughtworks.com/radar/techniques/dependency-drift-fitness-function)、[Persistent PDF](https://www.persistent.com/wp-content/uploads/2024/02/insight-extensure-framework-tech-due-diligence.pdf)）：强化已有四类偏差与接手方案。
