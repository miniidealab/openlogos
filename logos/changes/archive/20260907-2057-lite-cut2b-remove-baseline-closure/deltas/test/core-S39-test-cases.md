# Delta: core-S39-test-cases.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`logos/resources/test/core-S39-test-cases.md`

## REMOVED — 一、单元测试（UT）

本节 27 个用例中，21 个验证 L9 的闭包规划与求值：一目标一 task、多场景聚合、effective view 叠加与非权威输入排除、维度适用性判定、CREATE 完整度、seed 三态、targets 严格解析与排序、canonical target 重复、touched 四维完备、SKIP/AMBIGUOUS 证据组合、P/T/D 对账、模式漂移、未终结 journal 读取哨兵。L9 删除后整组失去验证对象——其中「模式漂移」（plan 后目标被外部创建）在新模型下**结构上不可能发生**，因为模式在 merge 时刻按磁盘事实判定。

另 6 个（UT-S39-03～06、UT-S39-26～27）验证的是路径映射判据与 non-Markdown 整文件 marker 协议，与闭包规划无关，原样迁至下一节；其中 UT-S39-05/06 的表述由「plan 阶段声明模式」改为「merge 时刻按磁盘事实派生模式」，判据强度不变。

## REMOVED — 二、场景测试（ST）

本节 13 个用例中，12 个验证闭包规划的端到端（已有目标 MODIFY、多场景共享、全量 CREATE、API+DB 全闭包、证据化 SKIP、adopt→change、seed 加速、AMBIGUOUS 阻断、纵深一致、无 JIT 回归、三方闭环、seed commit 崩溃一致性），随 L9 删除。

ST-S39-13（API+DB non-Markdown CREATE/MODIFY 原子 apply）与闭包规划无关，原样迁至下一节。

## REMOVED — 三、测试数据与断言要求

本节的断言纪律全部围绕闭包夹具（touched 场景构造、evidence/missing_evidence 组合、seed 三态），随 L9 删除。新节的断言纪律见其自身小节。

## REMOVED — 四、覆盖度要求

本节按闭包维度组织覆盖度要求，随 L9 删除。

## REMOVED — 场景 CREATE 结构化完整性回归测试

本节 8 个用例验证新建场景/需求/测试文档必须含目标、参与者、Mermaid 时序、步骤、异常、追溯等结构。该完整度检查是 L9 的 `createCompletenessProblems`，随 L9 删除——文档结构是否完整，由人在评审时判断，不再由 lint 门强制。

## REMOVED — S39 勘误散文订正通道测试（closeout-deferred-errata-and-closure-gap）

本节 4 个用例验证 L9 对 deployment/smoke 维度的 errata 散文订正例外。该例外是 L9 disposition 一致性检查的附属规则，随 L9 一并删除。

## ADDED — S39 delta→canonical target 派生与 non-Markdown 协议测试

> 覆盖 merge 目标集由 `deltas/` 目录派生的完整判据：路径映射、模式即时判定、不可映射 fail-closed，以及 non-Markdown 整文件 delta 的 marker 协议。ID 全部沿用不变（UT-S39-03～06、UT-S39-26～27、ST-S39-13），新增 UT-S39-68/69 与 ST-S39-30。
>
> **断言纪律**：UT-S39-68 必须断言 merge **全程未读取** `proposal.md` 的 YAML 声明——只断言目标集正确不足以证明派生源已切换。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S39-03 | 路径别名去重 | `./`、分隔符与等价规范路径 | 归一为同一 target；不允许 last-wins |
| UT-S39-04 | containment | 绝对路径、`..`、symlink escape | 拒绝，复用 delta path 安全错误；不读取越界目标 |
| UT-S39-05 | MODIFY 派生 | 目标文件已存在，delta 含 MODIFIED/ADDED 块参数化 | 模式判为 MODIFY；同一 delta 可含多个块；不读 proposal 任何 YAML 声明 |
| UT-S39-06 | CREATE 派生 | 目标文件不存在，参数化 Markdown 与 API/DB non-Markdown delta | 模式判为 CREATE；Markdown 正文即整份新文档，non-Markdown 按整文件 marker 协议剥离后落盘 |
| UT-S39-68 | 目标集 = deltas 的无逻辑投影 | 提案含 3 个不同类别的可 merge delta，proposal 中**故意保留**一段与之矛盾的历史 `baseline_closure` 块（声明 5 个目标） | 目标集恰为 3 个、与 delta 一一对应，与历史块声明的 5 个无关；断言 merge 全程未解析该块（对 proposal 注入语法非法的 YAML 亦不影响结果） |
| UT-S39-69 | 不可映射 delta 在写入前 fail-closed | 分别构造：绝对路径、`..` 上跳、symlink escape、未知类别目录下的 delta | 各自非零退出并点名该 delta 文件；`logos/resources/` 全部目标的字节与 mtime **均不变**；不写 `SPEC_MERGED` |
| UT-S39-26 | OpenAPI 整文件 marker | `.yaml|.yml|.json` ADDED/MODIFIED 首行、声明 target、剥离后内容参数化 | 合法内容无 marker 且 YAML/JSON+OpenAPI 3.x 校验通过；漂移/坏语法 `non_markdown_delta_invalid` |
| UT-S39-27 | DB SQL 整文件 marker | `.sql` ADDED/MODIFIED、声明 target、SQLite 合法/非法 DDL 参数化 | 合法剥离后可在空内存库事务执行并回滚；marker/target/SQL 失败 `non_markdown_delta_invalid` |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S39-13 | API+DB non-Markdown CREATE/MODIFY 原子 apply | 真实 OpenAPI YAML/JSON 与 SQLite SQL 夹具各一 | 各跑 ADDED/CREATE 与 MODIFIED/replace；再注入 target 漂移与坏语法 | 成功目标不含控制 marker且可解析/执行；任一失败整批回滚，既有目标/counter/index/SPEC_MERGED 均无部分变化 |
| ST-S39-30 | 真实 CLI 下无 baseline_closure 的提案全链通过 | 真实 CLI；一个 `proposal.md` **完全不含** `## 基线闭包计划` 小节的提案，`deltas/` 下含 Markdown 与 API/DB non-Markdown 各一 | ① 跑 `change-lint`；② 跑 `merge <slug>`；③ 读回各 canonical target | ① PASS，检查项编号上界为 8、无 L9 行，`data.baseline_closure` 不在场；② merge 成功并写 `SPEC_MERGED`；③ Markdown 目标按章节合并、non-Markdown 目标按整文件剥离落盘，字节与预期一致 |

### 追溯与覆盖

- AC-DERIVE-01 目标集为 delta 的无逻辑投影：UT-S39-68、ST-S39-30。
- AC-DERIVE-02 模式按磁盘事实即时判定：UT-S39-05、UT-S39-06。
- AC-DERIVE-03 不可映射 fail-closed：UT-S39-04、UT-S39-69。
- AC-DERIVE-04 存量声明块被忽略：UT-S39-68。
- non-Markdown 整文件协议：UT-S39-26、UT-S39-27、ST-S39-13。
- 场景：S39 delta→canonical target 派生；功能规格：§2.71。
