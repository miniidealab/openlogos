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

## 场景 CREATE 结构化完整性回归测试

### 测试边界与事实源

本组用例追溯 S39 验收条件 8～12、功能规格 §2.35.9、S39 场景 EX-7.1～EX-10.1。测试只改变 scenario CREATE 的结构完整性判断；API/DB/编排为 SKIP，其它类别 CREATE 判据作为回归保持不变。

所有 UT/ST 实现必须使用下列真实 ID，并由项目全局 OpenLogos reporter 把结果写入 `logos/resources/verify/test-results.jsonl`。用例不得通过手工补写 JSONL 或族名占位满足覆盖率。

### 新增单元测试（UT）

| ID | 检查项 | 来源 | 输入/夹具 | 精确期望 |
|---|---|---|---|---|
| UT-S39-28 | canonical 与兼容标题矩阵 | S39-AC-08、EX-7.1 | 以同一份完整场景分别使用 h2/h3 的 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path` | 每项均识别为唯一合法步骤章节；canonical 写入样例固定为 `## 步骤说明`；不报告“缺步骤” |
| UT-S39-29 | 权威区排除散文、围栏与注释 | S39-AC-09、EX-7.2 | 无真实步骤章节；分别只在普通散文、反引号/波浪线 fence、HTML 注释、Mermaid 消息中放入“步骤”或别名 | 每个夹具均返回 `create_target_incomplete`，missing evidence 精确包含步骤章节缺失；输入字节不变 |
| UT-S39-30 | 唯一步骤章节与有序列表阈值 | S39-AC-09、EX-7.3 | 参数化：恰好 3 个非空有序项、2 项、空项、仅无序列表、重复别名章节、其它章节中的编号 | 仅恰好/多于 3 个有效有序项且章节唯一时通过；其余分别报告列表不足/空项/无有序列表/章节重复，不被其它编号蒙混 |
| UT-S39-31 | Mermaid 时序结构 | S39-AC-10、EX-7.4 | 参数化：合法 mermaid fence；普通 fence/散文中的 `sequenceDiagram`；仅 1 个 participant；无消息；HTML 注释内完整图 | 只有含 `sequenceDiagram`、至少 2 个 participant/actor 和至少 1 条消息的 Mermaid fence 通过；其余精确失败 |
| UT-S39-32 | 异常/边界与追溯非空 | S39-AC-11、EX-7.3 | 参数化：两节均有正文/列表；标题后只有空白、注释或 fence；缺失；重复标题 | 仅唯一且具有权威非空内容时通过；其它夹具返回对应缺口，稳定排序且不受样例内容干扰 |

### 新增场景测试（ST）

| ID | 场景 | 覆盖 Steps/EX | 前置条件 | 操作序列 | 精确期望 |
|---|---|---|---|---|---|
| ST-S39-14 | 四份历史 `主流程` Delta 兼容 | Step 3→7、EX-7.1 | 从 bug 报告对应归档提取 S27/S28/S31/S32 原始语义结构，标题保持 `### 主流程`，每份至少 3 个有序项 | 在隔离项目声明四个 scenario CREATE target 与一一对应 tasks/deltas，运行 `openlogos change-lint --format json` | exit 0、`data.pass=true`；四个路径均不出现 `create_target_incomplete / 缺步骤`；fixture 不被自动改名 |
| ST-S39-15 | 完整 canonical 场景贯穿 lint 与 merge 预检 | Step 1→11 | 隔离 launched 项目，目标缺失；Delta 含 canonical 标题、3+ 步、合法 Mermaid、非空异常/追溯 | 运行 change-lint，随后在测试夹具授权范围内调用 merge 预检并检查生成物 | lint 通过；merge 预检结论一致并生成预期 apply 指令；最终目标预演不含 ADDED marker |
| ST-S39-16 | 真正缺步骤时 merge 原子失败 | EX-7.2、EX-10.1 | 合法闭包计划与其它 10 个目标齐备，仅场景 CREATE 无权威步骤章节；保存项目全文件清单/哈希、guard、counter、index、marker 快照 | 先运行 change-lint，再调用 merge；捕获 exit、violations 和前后快照 | lint exit 2；merge 非零且不生成 `MERGE_PROMPT.md`；资源、guard、counter、index、`PLAN_APPROVED`、`SPEC_MERGED` 与其它 marker 字节不变 |

### Fixture 与断言约束

- Markdown scanner 的单元夹具必须同时覆盖反引号与波浪线 fence、带语言 info string、跨行 HTML 注释、h2/h3 标题和 CRLF/LF。
- 历史四份 fixture 固定来自已归档事实，不在测试中先把 `主流程` 改成 canonical 后再验证。
- missing evidence/message/fix_hint 断言使用稳定语义字段；不得只断言“数组非空”。
- ST-S39-16 的无副作用快照至少覆盖文件集合和逐文件 sha256，不能只检查 `SPEC_MERGED` 缺失。
- UT/ST 运行必须包含现有 UT-S39-12、S09/S35 change-lint 与 merge 回归，证明其它 CREATE 类别和纵深门未被放宽。

### 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|---|---|---|
| S39-AC-08 | canonical 写入与受控别名兼容读取 | UT-S39-28、ST-S39-14、ST-S39-15 |
| S39-AC-09 | 唯一步骤章节、至少 3 个非空有序项、非权威关键词不计 | UT-S39-29、UT-S39-30、ST-S39-16 |
| S39-AC-10 | Mermaid fence、参与者与消息完整 | UT-S39-31、ST-S39-15 |
| S39-AC-11 | 异常/边界和追溯唯一且非空 | UT-S39-32、ST-S39-15 |
| S39-AC-12 | lint/merge 同源、失败无副作用 | ST-S39-15、ST-S39-16 |

### 覆盖度结论

- [x] S39 新增正常验收条件全部有自动化 ST。
- [x] S39 新增异常/边界全部有 UT 或 ST。
- [x] S39 场景 EX-7.1～EX-10.1 全部有明确覆盖。
- [x] API required、DB 约束与 API 编排不适用，已由场景与 proposal 的 SKIP 证据闭环。
- [x] OpenLogos reporter 路径和真实 ID 已定稿，不能由 smoke 或旧 UT-S39-12 替代。

## 测试变更集 before/final 对账与原子固化回归

> 以下用例实现必须包含精确 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。所有 apply 失败用例必须验证第一个正式写入前失败或整批完整回滚。

### 单元测试用例补充

| ID | 描述 | 前置条件/输入 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S39-33 | change set 严格字段与 canonical hash | 合法/未知键/乱序/重复数组/错误 hash 参数化对象 | 生成并读取 `openlogos/test-change-set@1` | 合法对象精确八个顶层键，targets 精确三个键；ID/targets ASCII 升序去重；去除 sha256 后固定键序列化所得 hash 可重算；未知键或错误顺序/哈希 fail-closed |
| UT-S39-34 | before/final 语义分类 | 参数化新增、意义单元格修改、原样、删除、仅行序/对齐/外围空白变化、跨 target 迁移 | TestDefinitionDiff | 新增/真实修改/跨 target 迁移进入 C；原样及仅排版变化留在 B；删除只进入 R；C/R 去重且不相交 |
| UT-S39-35 | authority 表格与 pipe 归一化 | 普通表格、escaped pipe、inline-code pipe、CRLF/LF，以及 fence/comment/散文伪 ID | scanner + canonical record | 只采信具备表头/分隔行的 authority 数据行；合法 pipe 语义稳定；非权威 ID 忽略；列身份、顺序或意义单元格变化可检出 |
| UT-S39-36 | 解析与 identity 错误首写前失败 | before/final 任一侧重复 ID、非法 UTF-8、歧义表格、strict manifest target/before 漂移 | merge-apply 预检，正式写入口设哨兵 | 返回精确诊断且写入口调用数为 0；不生成/修改 resource、metadata、counter、index、marker |
| UT-S39-37 | resources/metadata/change set/marker 原子事务 | 多 MODIFY + CREATE + metadata，分别在每个 rename、marker 前后与后置重读点注入 fault | `applyBaselineClosureBatch()` | 成功时 marker 最后且 reader valid；任一 fault 恢复全部 MODIFY/metadata、删除 CREATE/marker，返回 rolled_back；无半提交 |
| UT-S39-38 | CREATE/MODIFY 前态与无 Git 确定性 | CREATE test target、MODIFY current bytes；移除 `.git` 并对未提交/squash/rebase 等价 fixture 重跑 | 生成 change set 两次 | CREATE `before_sha256=null`，MODIFY before hash 等于当前正式字节；source 精确为 `semantic-before-after-diff`；两次 canonical bytes/hash 相同且不调用 Git |

### 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S39-17 | 生产 apply 入口原子写出事故六 ID | S39 before/final 主路径 | 用 strict manifest 经真实 merge-apply 处理事故 fixture，随后读取正式 target 与 `SPEC_MERGED` | change set C 精确为 ST-S10-44、UT-S10-129、UT-S10-137～140，12 个原样 ID 不在 C；targets/hash/source 合法；resource 与 marker 同批成功 |
| ST-S39-18 | marker 前后 fault 均完整回滚 | S39 事务失败路径 | 分别在资源、metadata、marker rename 及后置重读注入 fault，对比 apply 前后全项目快照 | 所有失败均非零且 rolled_back；正式 targets/metadata/counter/index 恢复，CREATE 与 marker 删除；重试无须人工清半态并可成功 |
| ST-S39-19 | 重启稳定与篡改拒绝 | S39 后置读取/异常路径 | 成功 apply 后退出进程并在无 `.git` 环境重读；依次篡改 marker payload/hash、target 字节和 target identity | 未篡改时跨进程 C/R 与 hash 逐字节一致；每个篡改稳定 fail-closed，不启动 runner、不写 verify/slice 状态 |

### 测试数据与断言要求

- 每个 fixture 必须记录 before/final 原始字节 SHA-256、expected C/R 与完整 target identity；禁止运行时从待测实现反推 expected。
- UT-S39-37、ST-S39-18 的快照至少覆盖文件集合、逐文件 hash、guard、counter、resource index、metadata 与全部 marker。
- 无 Git 用例必须对进程调用层设哨兵，证明未执行 `git`，而非只删除仓库目录后观察成功。
- reporter 必须逐条产生 UT-S39-33～UT-S39-38、ST-S39-17～ST-S39-19 的 PASS/FAIL 记录；族名或旧结果不能代替。

### 覆盖度校验

- [ ] schema、排序、去重与 hash：UT-S39-33
- [ ] before/final 语义与 authority parser：UT-S39-34、UT-S39-35
- [ ] 预写 fail-closed 与事务回滚：UT-S39-36、UT-S39-37、ST-S39-18
- [ ] CREATE/MODIFY、无 Git 与重启稳定：UT-S39-38、ST-S39-19
- [ ] 生产事故六 ID apply：ST-S39-17

## S39 SQL delta 分层校验与适配器路由测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S39-59 | 结构检查与方言无关且始终执行 | Step 3 | 同一份缺项 payload（分别缺 `CREATE TABLE` / 主键 / 约束 / 索引 / 迁移回滚语义） | 对 sqlite / postgresql / mysql 三种方言各求一次校验 | 每种缺项在**三种方言下**都被拒且点名同一缺项；结构层结论与方言无关。断言其在适配器不可用时同样执行——不得因降级而跳过 |
| UT-S39-60 | PostgreSQL 走权威解析器且零误拦 | Step 5→7a | `tech_stack.database: postgresql` | 对一批真实 PG 特性逐个求校验：生成列 `GENERATED ALWAYS AS ... STORED`、分区表、枚举+数组、partial 索引 `WHERE`、`USING gin` 表达式索引、`COMMENT ON`、多子句 `ALTER` | 全部通过。**修复前一律返回「适配器不可用」**——本用例即该阻断的回归锁 |
| UT-S39-61 | PostgreSQL 语法错误被拒并点名 | Step 5→7a | 同上 | 提交语法错误的 PG payload（如 `CREATE TABL`） | 拒绝，诊断含解析器给出的错误位置；证明接入的是真校验而非无条件放行 |
| UT-S39-62 | MySQL 降级为结构检查并留痕 | Step 7b | `tech_stack.database: mysql`；结构完整的 payload | 求校验 | **通过**（非拒绝），并回传降级留痕，含原因、缺失项与「已完成结构检查、未执行 mysql 语法/执行预检」。修复前返回「适配器不可用」 |
| UT-S39-63 | sqlite3 缺失时 SQLite 亦降级 | Step 5→7b | `tech_stack.database: sqlite`；PATH 中无 `sqlite3` 二进制 | 求校验 | 通过并留痕，缺失项点名 `sqlite3`。**修复前判 `SQLite validator 不可用` 并阻断**——本用例锁的是报告未覆盖的第二处同类缺陷 |
| UT-S39-64 | 层级如实自述且不跨方言冒充 | Step 7a/7b | 三种方言各一份结构完整 payload | 收集各自的层级自述；并监视 sqlite 执行路径是否被调用 | 三者层级分别为「隔离执行」「语法解析」「仅结构」，各自如实；PG/MySQL payload **未进入** sqlite 执行路径。这是 `UT-S39-27` 原意图（不冒充通过）的正向断言形态 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S39-28 | 真实 CLI 下 PG 项目可交付完整闭环 | Step 1→7 | 真实 CLI；launched 夹具项目声明 `tech_stack.database: postgresql`；含一份结构完整的 `deltas/database/*.sql` 与配套 Markdown delta | ① 跑 `change-lint`；② 对同一提案跑 merge 事务；③ 换成语法错误的 SQL 重复 ①；④ 换 `mysql` 方言重复 ① | ① L9 通过、整体 PASS；② 事务正常开启；③ L9 判 `non_markdown_delta_invalid` 并点名语法错误位置；④ L9 通过且 `warnings` 含降级留痕。证明「能交付」与「仍拦得住真错误」同时成立 |

### 追溯与覆盖

- AC-SQLGATE-01 结构检查与方言无关：UT-S39-59。
- AC-SQLGATE-02 PG 可交付：UT-S39-60、ST-S39-28。
- AC-SQLGATE-03 MySQL 降级留痕：UT-S39-62、ST-S39-28。
- AC-SQLGATE-04 sqlite3 缺失亦降级：UT-S39-63。
- AC-SQLGATE-05 PG 权威解析正反例：UT-S39-60、UT-S39-61、ST-S39-28。
- AC-SQLGATE-06 不跨方言冒充：UT-S39-64。
- AC-SQLGATE-07 层级如实自述：UT-S39-64。
- 场景：S39 SQL delta 的分层校验与适配器路由；功能规格：§2.52.2～§2.52.6；架构：§四十二.1、§四十二.2；安装态：SMOKE-core-174。

## S39 勘误散文订正通道测试（closeout-deferred-errata-and-closure-gap）

> 本节补充 deployment/smoke 维度 errata 例外的放行矩阵与 fail-closed 回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S39-65 | errata 散文订正放行矩阵 | 构造 docs-only 提案夹具（`deployment_required=false`）：deployment 与 smoke 各一个 `MODIFY` target，delta 仅含 `MODIFIED` 块、目标结构化 ID 集合合并前后完全相等 | 运行 change-lint L9 与 merge 准入同一 evaluator | 两维度 disposition 均放行、`pass=true`；不产生任何 deployment/smoke 相关 violation；`[deploy]` 一致性检查照旧生效（夹具无 `[deploy]` section） |
| UT-S39-66 | errata 判据不满足 fail-closed | 参数化违例夹具：① target mode=`CREATE`；② delta 含 `ADDED` 块（新增版本节）；③ delta 含 `REMOVED`/`REMOVED-ITEMS` 块；④ MODIFIED 块致目标 ID 集合增删（新增或缺失一个 SMOKE ID）；⑤ 无需部署提案携带 `[deploy]` section | 各自运行同一 evaluator | ①～④ 逐一 fail-closed 拒绝且 violation 含 `code`/`path`/`message`/`fix_hint` 可归因到具体 delta/target；⑤ 按既有部署决策一致性检查拒绝、语义零变化；无任何一例被降级为 warning 或静默放行 |
| UT-S39-67 | 既有路径零回归 | ① `deployment_required=true` 提案携带 deployment/smoke 实质变更 delta（含 ADDED 版本节）；② `deployment_required=false` 且 deployment/smoke 均 SKIP 的既有合法提案；③ 其余维度（requirement/feature/scenario/UT-ST 强制，architecture/API/DB/orchestration 条件）各取一代表夹具 | 运行同一 evaluator 并与 0.14.15 判定结果逐项对照 | ①②③ 判定结论与 0.14.15 逐项一致——errata 例外只影响「`deployment_required=false` + deployment/smoke MODIFY delta」这一形态，其余组合零行为变化 |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S39-29 | 真实 CLI errata 提案全链 | 临时 launched 项目：构造 docs-only 勘误提案，deployment/smoke 散文订正 delta（仅 MODIFIED、ID 守恒相等）；另构造一个 ID 增删违例变体 | 合法形态：`openlogos change-lint --format json` → `openlogos merge`；违例变体：同序重放 | 合法形态 lint exit 0、`pass=true`，merge 准入放行并进入正常合并流程；违例变体 lint exit 2、merge 拒绝，violation 精确点名违例 delta 与缺陷形态；两路均无半写态、无 marker 残留 |

### 追溯与覆盖

- AC-ERRATA-01 放行矩阵：UT-S39-65、ST-S39-29。
- AC-ERRATA-02 fail-closed 与 `[deploy]` 一致性：UT-S39-66、ST-S39-29。
- AC-ERRATA-03 既有路径零回归：UT-S39-67。
- AC-ERRATA-04/05 文本订正落地与版本身份：由本提案 deployment/smoke delta 的 S37 守恒门与安装态 SMOKE-core-180 承载。
- 场景：S39 勘误散文订正通道（EX-ERRATA-1/2）；功能规格：§2.57；根规范：`spec/baseline-closure.md` §7。
