# 03 确定性层：依赖清单解析（package.json/pom.xml/CMakeLists）

Status: needs-triage

## 描述

新增 `lib/manifests.mjs`：解析构建清单，产出第三方库与版本的依赖清单——package.json（dependencies/devDependencies，JSON 现成）、pom.xml（dependency 坐标+版本，用已有 xmldom）、CMakeLists.txt（find_package/target_link_libraries/子目录启发式）。聚合输出：清单条目（名称/版本/来源文件/类型）。

## 建议处置

- 无新重量级依赖（xmldom 已在依赖树）；
- 版本缺失时保留空版本字段，不猜测；
- 车端 C 项目的 CMake 只做文本启发式，明确标注为启发式结果。

## 验收标准

- smoke 通过；三个清单格式的 fixture 均提取出预期条目。
