# core-S39: merge 目标派生与 delta 协议测试用例

> 场景：S39 baseline-on-touch｜决策：D02｜全部测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

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

## S39 delta→canonical target 派生与 non-Markdown 协议测试

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
