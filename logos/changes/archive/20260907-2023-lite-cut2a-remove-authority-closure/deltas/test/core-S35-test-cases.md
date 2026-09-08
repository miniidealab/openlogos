# Delta: core-S35-test-cases.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/test/core-S35-test-cases.md`

## REMOVED — S35 Authority Closure L10 测试

本节 12 个用例（UT-S35-112～120、ST-S35-19～21）验证 L10 权威闭包检查本身：fact 字段闭合、`applicability` 分支、cutover 四子字段、`tests` 引用存在性、summary 计数与诊断可归因。L10 删除后整节失去验证对象。

## REMOVED — S35 L10 authority closure 分阶段校验测试用例

本节 8 个用例中，5 个（UT-S35-121～124、ST-S35-22）验证 L10 的 plan/spec 分阶段校验强度与阶段宽严对称，随 L10 删除；另 3 个（UT-S35-125、UT-S35-126、ST-S35-23）验证的是「spec-complete 判据单点」与「marker 名单点」——与 L10 无关，原样迁至下一节，ID 与断言逐字不变。

## ADDED — S35 spec-complete 判据与 marker 名单点测试

> 承接上一节中与 L10 无关的三条：「该提案是否已完成规格阶段」只有一个判定实现，提案生命周期 marker 名只有一处定义。ID 与断言沿用不变，仅脱离 authority 语境独立成节。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S35-125 | change-lint 对 legacy MERGED 的读法与权威一致 | EX-S35-SC-1 | 提案目录仅含 legacy `MERGED`、无 `SPEC_MERGED` | 取 `change-lint` 的 post-merge 判定结论，与 `hasSpecCompleteMarker()` 比对；并观察 L8 是否被重放 | 二者结论相等（均为已 spec-complete）；L8 条目守恒**被跳过**，不对 post-merge 提案重放。修复前 `change-lint` 判「未 merge」并重放 L8——本用例即该潜伏缺陷的回归锁 |
| UT-S35-126 | marker 名与 HISTORICAL_MARKERS 单点 | EX-S35-SC-2 | 已加载 `cli/src/lib/**` 源码 | ① 统计 `HISTORICAL_MARKERS` 的定义处数量；② 统计 `SPEC_MERGED` 以裸字符串字面量出现的文件数 | ① 恰好 1 处定义，其余为 import；② 裸字面量出现在 0 个非权威文件（权威定义文件自身除外）。断言失败信息列出违规文件与行号，便于直接定位 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S35-23 | legacy MERGED 提案不被重放 L8 | Step 4→7 | 真实 CLI；一个持 legacy `MERGED`、无 `SPEC_MERGED` 的提案夹具，其 delta 与最终目标处于「守恒重放会假阳性」的形态 | 对该提案跑 `change-lint` | 走 post-merge 分支，L8 未重放，不产生守恒假阳性；对照组（同一夹具改为持 `SPEC_MERGED`）结论逐字相同——证明两种 marker 布局此后不可区分 |

### 追溯与覆盖

- AC-PLANGATE-09 spec-complete 判据单点（change-lint 一侧）：UT-S35-125、ST-S35-23。
- AC-PLANGATE-11 marker 名单点：UT-S35-126。
- 场景：S35 提案计划产物左移硬检查；架构：§四十一.4。

## MODIFIED — S35 围栏提取单点、可归因诊断与门禁可满足性测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S35-127 | 围栏提取与其余提取器同源 | Step 1→3 | 含嵌套围栏的文档：四反引号 markdown 块内示意一段 `baseline_closure` yaml，块外另有一段真实声明 | 分别取 `baseline-closure`/`clarification`/`ui-first`/`plan-package` 的围栏识别结果 | 四者对同一文档得到同一组围栏，均命中 1 个而非 2 个。裸正则实现会命中 2 个——本用例即该差异的回归锁 |
| UT-S35-129 | 门禁阶段可满足性断言 | 门禁全集 | 为每个阶段构造该阶段的合法最小提案（plan：无任何 delta；spec/merge：含全部已规划 delta、无 `[code]` 切片） | 对每道门在其阶段求判定 | 全部通过。断言失败信息须点名是哪一道门在哪个阶段不可满足——新增在其阶段不可满足的门时立刻变红 |
| UT-S35-130 | 诊断点名具体对象 | 诊断输出 | 分别构造触发各类 change-lint 违规的提案 | 收集全部诊断文本 | 每条诊断中出现导致失败的实体本身（测试 ID / 文件路径 / 字段名 / 章节锚）；断言不含「为空、非法或不在」这类无法定位的措辞组合 |
| UT-S35-131 | 测试 ID 语法单点且与已合并规格一致 | 语法权威 | 已加载 `cli/src/lib/**` 源码与 `logos/resources/test/**` | ① 统计测试 ID 语法的定义处数量；② 提取已合并测试规格中全部表格首列 ID，逐个用权威语法判定 | ① 恰好 1 处定义，其余为 import；② **每一个**表格首列 ID 都被接纳，断言失败信息列出未被接纳的 ID。修复前 11 个 `UT-JSON-*`/`ST-JSON-*` 不被接纳——本用例即语法与数据漂移的回归锁 |

### 追溯与覆盖

- AC-MERGEGATE-03 诊断点名：UT-S35-130。
- AC-MERGEGATE-04 门禁可满足性断言：UT-S35-129。
- AC-MERGEGATE-06 围栏提取单点：UT-S35-127。
- AC-MERGEGATE-08 语法单点与数据一致：UT-S35-131。
- 场景：S35 围栏提取单点、可归因诊断与门禁可满足性断言；功能规格：§2.51.3、§2.51.5～§2.51.7；架构：§四十一.6.1、§四十一.6.2。

## REMOVED-ITEMS — S35 围栏提取单点、可归因诊断与门禁可满足性测试

- UT-S35-128 — 验证对象是 `collectPlannedAuthorityCreateTargets` 的多命中诊断，该函数随 L10 删除
- ST-S35-24 — 验证对象是 plan 阶段 `authority_ref` 容错在围栏归位后恢复，该容错随 L10 删除

## ADDED — S35 change-lint 检查项收敛与存量 authority_impact 兼容测试

> 覆盖 L10 删除后 change-lint 的检查项集合、其余级别结论零漂移，以及存量提案中已写的 `authority_impact` 块被忽略而非报错（提案决策 C01）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-134 | 检查项集合收敛为 10 项且其余级别零漂移 | 取一组既有提案夹具（含 legacy、含 required fact 历史块、含完整 delta 三类） | 对每个夹具求 `runChangeLint` 结论 | 检查项恰为 L0～L9 共 10 项，不含任何 L10 条目；`AUTHORITY_CLOSURE_ISSUE_CODES` 不再出现在码表中；每个夹具在 L0～L9 上的 violation 集合与本变更前**逐条相同**（同 code、同 path、同 message） |
| UT-S35-135 | 存量 authority_impact 块被忽略而非报错 | 提案含形态各异的历史 `authority_impact` 块：完整 required、not_applicable、字段残缺、YAML 语法非法 | 求 `runChangeLint` 结论 | 四种形态**一律不产生任何 violation 或 warning**；块内容不被解析（断言不出现 fact_id/字段名相关诊断）；提案照常通过并可继续 merge |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S35-26 | 真实 CLI 下无 authority_impact 的提案全链通过 | 真实 CLI；一个 `proposal.md` **完全不含** `## Authority Impact` 小节的合规提案 | ① 跑 `change-lint --format json` 与文本形态；② 跑 `merge <slug>`；③ 用 `change` 新建一个提案并读其模板 | ① PASS，`data.violations` 为空，envelope 中不出现 `authority_closure_*` 码、无 authority 维度；文本形态列出的检查项编号上界为 9、无 L10 行（总数随 L7/L9 条件在场而变，最多 10 项）；② merge 成功并写 `SPEC_MERGED`，全程无「缺声明」类诊断；③ 模板不含 `Authority Impact` 小节与 `authority_impact` 字段 |

### 追溯与覆盖

- AC-CUT2A-01 检查项收敛为 10 项且其余结论零漂移：UT-S35-134、ST-S35-26。
- AC-CUT2A-02 存量声明块忽略而非报错：UT-S35-135。
- 场景：S35 提案计划产物左移硬检查；功能规格：§2.51.2。
