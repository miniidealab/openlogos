# core-S39: 按触达目标规格闭包测试用例

> 场景：S39 baseline-on-touch｜决策：D02｜全部测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

## 一、单元测试（UT）

### 1.1 canonical target 与 cardinality

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S39-01 | 一目标一 task 正例 | 三个不同 delta path 映射三个目标 | 3 个 canonical target、3 条 task，顺序稳定 |
| UT-S39-02 | 多场景同目标聚合 | S12/S13 同时命中同一 feature spec | 1 条 task，scenarioIds 稳定去重，修改意图全部保留 |
| UT-S39-03 | 路径别名去重 | `./`、分隔符与等价规范路径 | 归一为同一 target；不允许 last-wins |
| UT-S39-04 | containment | 绝对路径、`..`、symlink escape | 拒绝，复用 delta path 安全错误；不读取越界目标 |

### 1.2 目标模式与 effective view

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S39-05 | MODIFY 正例 | 目标存在，锚存在/缺失参数化 | task=MODIFY；同一 delta 可含 MODIFIED 与 ADDED |
| UT-S39-06 | CREATE 正例 | 目标不存在，参数化 Markdown 与 API/DB non-Markdown | task=CREATE；不发明 CREATE plan/merge operation；Markdown 用 ADDED 章节，non-Markdown 用可剥离 ADDED 首行控制行 |
| UT-S39-07 | 模式漂移 | plan 后 CREATE 目标被外部创建 | spec/merge fail-closed，不覆盖、不自动换模式 |
| UT-S39-08 | effective view 叠加 | 主场景 + 当前 change 场景 delta 后生成 API | API 读取预期合并后的场景，而非旧主文档 |
| UT-S39-09 | 排除非权威输入 | archive delta、其它 change、partial staging | 三者均不进入 effective view |

### 1.3 适用性与类别完整度

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S39-10 | API/编排适用 | 时序含 HTTP/RPC/消息边界 | API=非 SKIP，orchestration 同时非 SKIP；API 从时序派生 |
| UT-S39-11 | DB 适用与 CLI SKIP | 参数化：持久化实体 / 纯内存 CLI | 前者 DB 适用；后者 DB=SKIP 且有证据，不产空 DDL |
| UT-S39-12 | 场景 CREATE 完整度 | 新场景含目标、参与者、Mermaid、步骤、异常、追溯 | 通过；逐项删除任一结构则精确失败 |
| UT-S39-13 | API CREATE 完整度 | OpenAPI 含 paths/schema/error/auth/compat | 通过 YAML/OpenAPI 与闭包检查；骨架/占位失败 |
| UT-S39-14 | DB/test/orchestration CREATE 完整度 | 三类完整/残缺参数化夹具 | 完整通过；残缺列具体 missingEvidence |

### 1.4 棕地、证据边界与无 JIT

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S39-15 | seed 三态等价可进入 | required/安全 partial/seeded 参数化，且无未终结 journal或恢复成功 | 都能计算 closure；差异仅 evidence 可用性；安全 partial staging 被排除 |
| UT-S39-16 | adopted skip 不是永久禁用 | adopted 自动 skip api，但时序含 HTTP | API 不能静默 SKIP；规划或 AMBIGUOUS |
| UT-S39-17 | 事实/意图区分 | 代码显示现状 A，proposal 要改 B | 完整文档明确现状证据与本次目标；不从代码编造 Why |
| UT-S39-18 | 禁止确认机制复活 | 扫描所有 S39 产物与建议 | 无 verified:true、confirmed_*、baseline_warnings、JIT advisory、新 gate/marker |

### 1.5 权威计划 schema、事务读取门与 non-Markdown 协议

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S39-19 | proposal targets 严格解析 | 合法 v1 与坏缩进/未知字段/未知版本/重复 YAML key 参数化 | 合法得到 typed plan；非法 `baseline_closure_malformed`，禁止 last-wins/人读表兜底 |
| UT-S39-20 | proposal canonical target 重复 | 两 target 的 delta_path 经规范化映射同一目标 | `delta_target_duplicate`；不能靠 tasks 已去重通过 |
| UT-S39-21 | touched scenario 维度完备 | touched 含 S05，逐项删除 requirement/feature/scenario/test 或任一条件 disposition | 每个缺口 `baseline_closure_target_missing`；不从 targets 并集反推 touched |
| UT-S39-22 | SKIP 证据组合 | SKIP 的 delta_path 非 null、evidence 空或 missing_evidence 非空 | `baseline_closure_malformed`；不计入合法 skip |
| UT-S39-23 | AMBIGUOUS 缺口组合 | AMBIGUOUS 的 delta_path 非 null 或 missing_evidence 空 | `baseline_closure_malformed`；合法未决才计数并阻断 plan |
| UT-S39-24 | P/T/D 集合对账 | P/T/D 数量相同但 canonical 成员不同 | plan 要求 P==T、spec 要求 P==T==D；逐差集报告，不按 count 假通过 |
| UT-S39-25 | 未终结 journal 读取硬门 | journal=`prepared|committing` 且恢复失败，对 ClosureEvaluator/EvidenceScanner 读取设哨兵 | `baseline_commit_in_progress`；哨兵调用数 0，不把 seed 降级后继续读 resources/index |
| UT-S39-26 | OpenAPI 整文件 marker | `.yaml|.yml|.json` ADDED/MODIFIED 首行、声明 target、剥离后内容参数化 | 合法内容无 marker 且 YAML/JSON+OpenAPI 3.x 校验通过；漂移/坏语法 `non_markdown_delta_invalid` |
| UT-S39-27 | DB SQL 整文件 marker | `.sql` ADDED/MODIFIED、声明 target、SQLite 合法/非法 DDL 参数化 | 合法剥离后可在空内存库事务执行并回滚；marker/target/SQL 失败 `non_markdown_delta_invalid` |

## 二、场景测试（ST）

| ID | 场景 | 前置/操作 | 期望 |
|---|---|---|---|
| ST-S39-01 | 已有目标 MODIFY | 棕地项目已有需求/场景/测试，发起增量 change | 每目标唯一 MODIFY task/delta；合并预期保留存量并加入增量 |
| ST-S39-02 | 多场景共享目标 | 一案同时触达两个场景，共享主需求/feature 文件 | 共享文件各只有一 task/一 delta；无覆盖、无顺序依赖 |
| ST-S39-03 | 缺失场景/测试全量 CREATE | 代码存在行为但正式场景与测试文档缺失 | 单份 CREATE 场景含完整时序/异常；单份 CREATE 测试含真实 ID/reporter |
| ST-S39-04 | API+DB 全闭包 CREATE | 存量服务有路由与表但无规格，本次扩接口 | 顺序生成场景→OpenAPI/DB→UT/ST/编排；各 target 一文件且可独立合并 |
| ST-S39-05 | 纯 CLI 证据化 SKIP | 无网络边界、无数据库 | API/DB/编排在矩阵 SKIP；无对应 checkbox/delta；场景与 UT/ST 仍在场 |
| ST-S39-06 | 无 seed 的 adopt→change | 新 adopted，state=required，直接创建 change | plan/spec 正常完成；未触达区域零产物 |
| ST-S39-07 | committed seed 加速但不替代闭包 | seeded candidate 指向场景、正式规格缺失 | 少扫入口但仍 CREATE 正式规格；provenance verified 不变 |
| ST-S39-08 | AMBIGUOUS 一次性阻断 | proposal 未说明外部协议是否兼容 | 停在既有 plan-exit 前、一次列缺口；无 per-target confirmation |
| ST-S39-09 | plan/spec/merge 纵深一致 | 合法提案后篡改 target 存在性或增加未规划 delta | change-lint/merge 共享判据发现漂移并停止；不部分 apply |
| ST-S39-10 | 无 JIT 端到端回归 | verified:false seed + on-touch change + verify 消费 | 无 advisory/写回/warning/额外门；错误通过普通后续 change 修正 |
| ST-S39-11 | proposal→tasks→deltas 三方闭环 | proposal 显式 touched S05/S39 与完整 targets，先故意漏 S05、再补齐并产 delta | 漏场景时 plan 失败；补齐后 P==T 通过；delta 齐后 P==T==D 通过，skip/ambiguous 计数来自 proposal |
| ST-S39-12 | seed commit 崩溃一致性对闭包 | 多目标 seed commit 在 rename/index/state 各点崩溃，构造可恢复与不可恢复夹具后运行 change-lint/S39 | 可恢复后只读全旧/全新；不可恢复统一 `baseline_commit_in_progress`，不读取半新、不生成/修改 proposal/tasks/delta |
| ST-S39-13 | API+DB non-Markdown CREATE/MODIFY 原子 apply | 真实 OpenAPI YAML/JSON 与 SQLite SQL 各跑 ADDED/CREATE、MODIFIED/replace；再注入 target 漂移与坏语法 | 成功目标不含控制 marker且可解析/执行；任一失败整批回滚，既有目标/counter/index/SPEC_MERGED 均无部分变化 |

## 三、测试数据与断言要求

- 临时项目至少覆盖：纯 CLI、HTTP API + SQLite SQL、消息接口、legacy adopted、安全 partial seed、未终结 journal、seeded candidate。
- 文件系统断言必须比较 canonical target 集合、task 集合、delta 集合三者一一对应。
- CREATE 端到端测试必须检查合并后预期文件全文结构，不以“文件非空”代替完整度。
- effective view 测试必须用一个会改变下游 API/test 生成结果的场景 delta，证明读取了当前 change。
- 所有 negative fixture 断言稳定错误 code/path/fix_hint，并证明项目根字节未被 lint 改写。

## 四、覆盖度要求

- UT-S39-01…27 与 ST-S39-01…13 必须 100% 有 reporter 结果；不得用族名占位代替真实 ID。
- S09/S20/S33/S35 的交叉回归测试必须同批实现，确保改变默认路径没有破坏 lifecycle/seed/lint 既有契约。
- SMOKE-core-54…58 在真实安装包上证明用户路径与 merge CREATE，不由 UT/ST 替代。
