# 11 unresolved 四分类归口（通配→包级边、外部→计数、static→忽略）

Status: ready-for-agent

## 描述

原实现把所有解析失败的引用灌进 unresolved（2000 封顶），JDK/第三方/通配/静态导入噪音打满清单，依赖图完整性不可判定（hutool 轮次2 实测 unresolved=2000 封顶）。归口四分类：

1. **项目内引用** → 解析为边（含 Maven 后缀匹配）；
2. **通配导入**（`cn.foo.*`）→ 定位包目录后产**包级模块边**（kind `wildcard`），不再算未解析；未定位包目录则记录 wildcard_imports 含 module=目标目录串；
3. **JDK/第三方/系统头**（java./javax./jakarta./jdk./sun.、其它非相对包名、C 系统头）→ `external` 聚合计数（group: jdk/third-party/system，prefix 首段，按 count 排序取前 100）；
4. **静态导入**（Java `static `）→ 忽略，仅计数 `static_imports`。

unresolved 只留**真问题**：相对路径（`./`/`../`）与本地头（`"..."`）应能定位却未定位的引用。

## 验收标准

- smoke 场景 5：react→external(third-party) 且不在 unresolved；java.*→external(jdk)；`./nope.js`→unresolved；通配导入→module_edges 出现 kind=wildcard 的包级边。
