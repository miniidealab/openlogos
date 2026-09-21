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

## S39 编排 JSON 整文件协议与类别集合单点测试

> 覆盖 `orchestration` 类别（`logos/resources/scenario/**`）纳入 non-Markdown 整文件通道后的完整判据：类别集合单点、校验入口受理分支、编排 JSON 的五层内容校验、既有类别零回归，以及「错误在准入阶段而非合成阶段暴露」这一前移承诺。场景：S39「编排 JSON 的整文件协议适用与校验入口」。测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
>
> **断言纪律（三条，均针对本次事故的成因）**：
> ① 凡涉及合法性判定的用例，**必须经公开入口 `validateAndStripNonMarkdownDelta` 求值**，不得只调内部解析函数（`duplicateAwareObject` 是内部函数，编排路径此前根本走不到它——只测内部函数会让入口缺口继续隐形）。
> ② UT-S39-72 必须断言错误**发生在 change-lint 阶段**，而不只断言「最终失败」——事故形态正是 lint 全绿、merge 才炸。
> ③ 夹具在一次性隔离项目内构造，不依赖本仓自身的 `logos/resources/scenario/`（本仓该目录为空，本次修复的是下游项目的可合并性）。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S39-70 | MODIFY：编排 JSON 整文件替换成功且落盘字节等于剥离后正文 | 隔离项目；`logos/resources/scenario/core-auth.json` **已存在**；delta 首行 `## MODIFIED — logos/resources/scenario/core-auth.json（整文件替换）` | 经公开入口求校验，再跑 merge 合成 | 校验通过并返回 payload；合成后目标字节与 delta 剥离 marker 后的正文**逐字节相等**（无重排、无重新序列化、无尾随空白归一）；模式判为 MODIFY 且未读取 `proposal.md` 任何 YAML 声明 |
| UT-S39-71 | CREATE：目标不存在时整文件新建并登记 resource_index | 同上但目标文件**不存在**；delta 首行 `## ADDED — logos/resources/scenario/core-auth.json（新文件，整文件）` | 同上 | 模式判为 CREATE；目标按 delta 正文落盘；`resource_index` 新增该条目；op 与 mode 不一致（如 CREATE 配 `MODIFIED` 首行）时拒绝并点名 mode 不一致 |
| UT-S39-72 | 裸 JSON 无 marker：**在 change-lint 阶段**即判违规 | 隔离项目；`deltas/scenario/core-auth.json` 内容为纯 JSON、无控制 marker（事故现场原形态） | ① 跑 `runChangeLint` 取完整结论；② 再跑 merge | ① `violations` 含 `non_markdown_delta_invalid`，`path` 点名该 delta 文件，exit 2——**该断言是本用例的本体**；② merge 的失败不得是该形态的**首次**暴露信号。回归对照：修复前同夹具 lint 判 PASS 且 L4 不扫该文件，本用例即该漏检的锁 |
| UT-S39-73 | 路径漂移 / JSON 语法错 / 重复键三形态逐一拒绝并点名 | 参数化三组：① marker 声明 target 与 delta 实际 canonical target 不一致；② payload 为非法 JSON；③ payload 含重复键（`{"a":1,"a":2}`） | 经公开入口求校验 | 三组均拒绝；① 点名 marker 声明值与期望的 canonical target 两者；② 点名语法错误位置；③ **由 duplicate-aware 预检拦下**并点名重复键位置——断言不得依赖 `JSON.parse`（其接受重复 key、last-wins，单靠它该组会误判通过） |
| UT-S39-74 | 编排 JSON 不套用 OpenAPI / 受控根 Schema 校验 | payload 为**合法 JSON 对象但明显不是 OpenAPI 文档**（如 `{"name":"登录","steps":[]}`），亦不符合受控根 spec/schema 形态 | 经公开入口求校验 | **通过**并返回原始 payload；断言求值过程中 OpenAPI 校验器与根 Schema 校验器**均未被调用**（对二者设哨兵），而非仅断言结果通过 |
| UT-S39-75 | 零回归锚：既有类别与 Markdown 类别行为逐字不变 | ① `logos/resources/api/**` 的 YAML/YML/JSON 合法与非法各一；② `logos/resources/database/**` 的 `.sql` 合法与非法各一（含 SQL 方言分层与适配器不可用的降级留痕）；③ 受控根 `spec/schema/*.json`；④ `prd` / `test` / `spec` / `skills` 四类 Markdown delta | 对①②③经公开入口求校验并与本次上线前基准夹具逐字比对；对④求 merge 通道选择 | ①②③的 `ok` / `message` / `tier` / `degradation` 与上线前**逐字相同**（含 SQL 降级留痕的原因与缺失项）；④ 四类**均走 Markdown 章节合成通道**、不进整文件通道；类别集合的成员恰为 `api` / `database` / `orchestration`，断言集合本身而非仅断言新成员在其中 |

### 场景测试

| ID | 场景 | 前置条件 | 操作序列 | 关键断言 |
|---|---|---|---|---|
| ST-S39-31 | 真实 CLI 下复现 toolstop 事故形态并证明其现已通过 | 真实 CLI；一次性隔离 launched 夹具项目；提案含 `deltas/scenario/core-auth.json`（带合法整文件 marker）与一份 Markdown delta | ① 对**裸 JSON 无 marker** 的形态跑 `openlogos change-lint --format json`；② 改为合法 marker 后重跑 ①；③ 对同一提案跑真实 `openlogos merge <slug>` 进程；④ 读回 canonical target 字节；⑤ 对 `api` / `database` 各一份 delta 重复②③；⑥ 在**①的裸 JSON 夹具**（独立夹具，起始无 `SPEC_MERGED`）上跑真实 `openlogos merge <slug>` | ① exit 2、`violations` 含 `non_markdown_delta_invalid` 并点名该 delta，`L4` 检查项 `violations > 0`、`data.pass=false`、**通过数恰少于总数**——**修复前同夹具为 `PASS`**，本臂即事故形态的回归锁；**不得要求本臂通过数与上线前全绿时相等**（这是一次有意的新增拒绝，该断言不可满足）；② PASS、exit 0、全部检查项 `violations` 为 0、通过数等于总数，且**检查项标识集合与总数**与上线前同夹具逐字相同（**禁止硬编码 `10/10`**）；③ 真实进程退出码 0 且写出对应本次成功合并的 `SPEC_MERGED`（不得以库内函数调用替代）；④ 目标字节等于 delta 剥离后正文，逐字节比对；⑤ 既有两类的结论与落盘字节与上线前逐字相同；⑥ **失败分支的事务边界**：真实 merge **非零退出**，结束后夹具内**仍无 `SPEC_MERGED`**，`logos/resources/` 相关目标保持**合并前字节** |

### 追溯与覆盖

- 编排 JSON MODIFY 可合并且字节保真：UT-S39-70、ST-S39-31 步骤③④。
- 编排 JSON CREATE 可新建并登记 index：UT-S39-71。
- 裸 JSON 在准入阶段即被拒（前移承诺）：UT-S39-72、ST-S39-31 步骤①。
- marker 声明 target 漂移被拒：UT-S39-73 形态①。
- JSON 语法错与重复键被拒并点名位置：UT-S39-73 形态②③。
- 编排 JSON 不触发 OpenAPI schema 校验：UT-S39-74。
- 回归锚·`api` / `database` 逐字不变（含 SQL 分层与降级留痕）：UT-S39-75 形态①②、ST-S39-31 步骤⑤。
- 回归锚·Markdown 类别仍走章节合成：UT-S39-75 形态④。
- 失败分支的事务边界（非零退出、不写 `SPEC_MERGED`、目标字节不变）：ST-S39-31 步骤⑥。
- 端到端复现事故形态并断言现已通过：ST-S39-31。
- 场景：S39「编排 JSON 的整文件协议适用与校验入口」、「non-Markdown 整文件协议的适用类别与派生结论」；来源变更：fix-orchestration-merge-and-predicate-duplication。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S39"`；失败不得写 pass。
- **全部合法性判定必须经公开入口** `validateAndStripNonMarkdownDelta` 求值。只测内部解析函数的用例不算覆盖——本次缺口的本体正是「内部有能力、入口不受理」，内部函数级断言对其完全不敏感。
- UT-S39-72 必须分别读取 `runChangeLint` 的 `violations` 与退出码两个真实输出，断言错误**出现在准入阶段**；仅断言「最终不可合并」不算覆盖。
- UT-S39-73 形态③ 必须构造真实重复键 payload 并断言拒绝；若实现去掉 duplicate-aware 预检而只留 `JSON.parse`，本用例必须变红。
- UT-S39-74 必须对 OpenAPI 校验器与受控根 Schema 校验器设哨兵证明未被调用，不得只断言结果通过——「通过」在两种实现下都成立，只有调用哨兵能区分。
- UT-S39-75 的「逐字相同」对照必须以本次上线前实现的输出为基准夹具，不得在测试内复述期望文案；类别集合断言须断言**成员集合本身**，集合被意外扩充同样是回归。
- ST-S39-31 步骤③⑥ 必须跑**真实 `openlogos merge` 进程**，不得以库内函数调用替代；**`SPEC_MERGED` 的断言按分支相反**——步骤③（合法 marker，成功分支）断言退出码 0 且该标记**在场**；步骤⑥（裸 JSON，失败分支，独立夹具起始无该标记）断言非零退出、该标记**仍不在场**、目标保持合并前字节。失败分支不存在合法理由产生成功标记；复用成功夹具的残留标记只会验证旧状态。
- ST-S39-31 步骤②⑤ 禁止硬编码检查项数字，基线取上线前同夹具的实测**标识集合与总数**。
- **「零回归」的边界（与 S35 测试族统一口径）**：对全部夹具恒不变的只有适用检查项的**标识集合**、检查项**总数**与违规码**注册表**；**通过数不是不变量**——本次对裸 JSON 编排 delta 是一次有意的新增拒绝，其所属检查项必然由零违规转为有违规、通过数必然下降。通过数的「与上线前相同」断言只许用于行为不受本次修改影响的回归夹具（UT-S39-75、ST-S39-31 步骤②⑤）；预期改变的输入（步骤①）改为断言「新增违规所属检查项失败 + `data.pass=false` + exit 2 + 通过数少于总数」。
- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。

## S39 Markdown 新建整文件协议测试

> 覆盖 CREATE 模式 `.md` 新增的整文件受理路径：按首行显式封装分流、语义类别闸、四层内容校验、prepared 最终字节通道对测试变更账本的闭合，以及**两条既有写法的零回归**。场景：S39「Markdown 新建文档的整文件协议与显式封装分流」。测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
>
> **断言纪律（四条，均针对本轮评审点名的风险）**：
> ① 合法性判定一律经公开入口 `validateAndStripNonMarkdownDelta` 求值，不得只调内部解析函数——本次扩的正是该入口的受理范围，内部函数级断言对受理边界完全不敏感。
> ② **受理边界必须有「marker 本身合法」的负例**：只用错误 marker 构造负例会掩盖「受理范围被放宽」这一真实风险，故类别闸负例的 marker 必须逐字合法，唯一不合法处是语义类别。
> ③ **旧写法是回归锚而非被淘汰对象**：不带 `（新文件，整文件）` 后缀的 CREATE 章节 delta 必须继续通过，且合成结果与上线前逐字相同。
> ④ 账本断言必须读**真实 merge 写出的 `SPEC_MERGED`**，不得以库内 `buildTestChangeSet` 直调替代——本次风险的本体正是「分流改变后该函数根本没被喂到」。
> ⑤ **无效封装的负例必须走真实 L4 与 merge 路由**：只直调公开校验入口的负例，对「识别规则让该输入到不了校验器」这一缺口完全不敏感——缺的从来不是校验函数。
> ⑥ **不得对 payload 正文标题作章节重复判断**：控制行被剥离、H1 是文档自身标题，二者不构成重复章节；任何以「正文标题与控制行同名」为由要求拒绝的用例都与整文件语义互斥，不得写入。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S39-76 | CREATE：`.md` 整文件新建成功且 **H1 逐字保留** | 隔离项目；目标 `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S99-demo.md` **不存在**；delta 首行 `## ADDED — <该 target>（新文件，整文件）`，其后正文首行为 `# S99：演示场景` | 经公开入口求校验，再跑 merge 合成 | 校验通过并返回 payload；落盘字节与 delta 剥离 marker 后的正文**逐字节相等**（无重排、无重新序列化、无尾随空白归一）；**显式断言落盘文件首行以 `# ` 开头且等于 `# S99：演示场景`**——这是本刀的核心能力，不得仅断言 merge 成功 |
| UT-S39-77 | `invalid-envelope`：已声明封装但受理不合法 → 拒绝，且**不回退成章节锚** | 参数化三形态，**三者均为「首行已匹配 `NON_MD_MARKER` 协议形态」**：① marker 声明 target 与实际 canonical target 不一致；② CREATE 模式却写 `（整文件替换）` 后缀；③ 对**已存在**的 `.md` 目标写 `（新文件，整文件）`（mode 为 MODIFY） | **三形态各跑三遍**：（a）公开校验入口；（b）真实 `runChangeLint`；（c）真实 merge | 三形态在三条路径上**结论一致均为拒绝**并点名失败项（①点名声明值与期望 canonical target 两者，②③点名 mode 与 marker 不一致）；（b）在 L4 即报违规；（c）非零退出、**零写入**（目标文件不存在则仍不存在，存在则保持合并前字节，夹具内无 `SPEC_MERGED`）。**②是本用例的核心臂**：现行 composer 对 `## ADDED — <正确路径>（整文件替换）` 会**成功**合成出标题 `## <正确路径>（整文件替换）`，而整文件校验器对同一输入返回「首行 mode 与 CREATE 不一致」——若实现仍以「封装已经合法」为识别前提，该输入到不了校验器，(b)(c) 两臂必须变红 |
| UT-S39-78 | payload 形态三层逐一拒绝 | 参数化三形态：① 剥离 marker 后为空或只含空白；② payload 内残留控制 marker；③ payload 含模板/占位骨架 | 经公开入口求校验 | 三形态均拒绝；判据与既有 non-Markdown payload 形态判据**同源**（断言复用同一实现，不得在测试内另写一份期望逻辑） |
| UT-S39-79 | Markdown 整文件**不套用** OpenAPI / SQL / 受控根 Schema 校验 | 目标为 `logos/resources/test/core-S99-test-cases.md`；payload 为合法 Markdown，正文中**故意含 `openapi:` 字样与一段 `CREATE TABLE` 文本** | 经公开入口求校验 | **通过**并返回原始 payload；对 OpenAPI 校验器、SQL 方言校验器与根 Schema 校验器**三者均设哨兵，断言未被调用**——仅断言结果通过不算覆盖（「通过」在套与不套两种实现下都可能成立） |
| UT-S39-80 | 回归锚·MODIFY 模式 `.md` 仍走章节合成，四 op 逐字不变 | 已存在的 `.md` 目标；分别构造 `ADDED` / `MODIFIED` / `REMOVED` / `RENAMED` 四个章节 op 的 delta | 求通道选择，并跑合成 | 四者**均走 Markdown 章节合成通道**、不进整文件通道；合成输出与上线前同夹具的实测结果**逐字相同**（以上线前输出为基准夹具，禁止在测试内复述期望文案） |
| UT-S39-81 | 回归锚·`api` / `database` / `orchestration` 三类既有整文件行为不变 | ① `logos/resources/api/**` 的 YAML/YML/JSON 合法与非法各一；② `logos/resources/database/**` 的 `.sql` 合法与非法各一（含方言分层与适配器不可用的降级留痕）；③ `logos/resources/scenario/**` 的 JSON 合法与非法各一；④ 受控根 `spec/schema/*.json` | 经公开入口求校验并与上线前基准夹具逐字比对 | 四组的 `ok` / `message` / `tier` / `degradation` 与上线前**逐字相同**；`NON_MARKDOWN_CATEGORIES` 成员恰为 `api` / `database` / `orchestration`，**断言集合本身**——集合被意外扩充同样是回归 |
| UT-S39-82 | 回归锚·**旧写法仍然合法**：CREATE 模式 `.md` 写不带后缀的章节 op | 隔离项目；目标 `logos/resources/test/core-S99-test-cases.md` **不存在**；delta 为 `## ADDED — S99 夹具` + 含 `UT-S99-01` 的用例表（即既有可用形态，取现网同形夹具） | 求通道选择，并跑 CREATE 合成 | **走章节合成通道**（首行未命中完整整文件 marker）；合成成功、无违规；输出与上线前同夹具**逐字相同**。**本用例是「不淘汰旧写法」这一承诺的锁**：若实现改为按 mode 强制整文件，本用例必须变红 |
| UT-S39-83 | 残渣形态负例（真实成因）：首行 target 位写的是**章节标题而非 canonical 路径** | CREATE 模式 `.md`；实际目标 `logos/resources/decisions/core-D09-demo.md`；delta 首行为 `## ADDED — D09：某决策（新文件，整文件）`（历史残渣文档的真实成因形态） | 跑真实 `runChangeLint` 与真实 merge | 识别为封装声明（首行匹配协议形态），因 **target 与 canonical target 不一致**落 `invalid-envelope` **拒绝**，`fix_hint` 给出整文件写法；**不回退成章节锚**——断言目标文件**未被创建**、夹具内无 `SPEC_MERGED`、merge 非零退出。失败分支的证据是**无文件、无成功标记**，**不得**以「标题不含后缀」这类需要文件存在才成立的断言代替 |
| UT-S39-86 | 正例对照：payload 首行 H1 与控制行同名**不构成拒绝理由** | 同上目标；首行为 **target 正确**的 CREATE 整文件 marker；payload 仅含一个 H1（其文本与控制行的 target 加后缀逐字相同）与正文 | 经公开入口求校验，并跑真实 merge | **通过并成功落盘**：payload 非空、无 `## ADDED — ` / `## MODIFIED — ` 控制行、无模板骨架，类别/路径/mode 全合法，四层校验全过；落盘字节逐字等于剥离后正文。**断言不存在「控制行与正文标题构成重复章节」这一判据**——若实现对正文 H1 作章节重复判断，本用例必须变红 |
| UT-S39-84 | 类别闸负例：三类非 Markdown 语义类别下的 `.md` 一律不受理 | 三个目标各一份 delta，**marker 逐字合法**（op、破折号、后缀、声明 target 全部正确），正文为合法 Markdown：① `logos/resources/api/core-api.md`；② `logos/resources/database/core-db.md`；③ `logos/resources/scenario/core-auth.md` | 经公开入口求校验 | 三者**均被拒**，落整文件校验入口原有的「不支持的格式」分支；断言拒绝原因**不是** marker 形态问题而是类别不受理。**本用例覆盖「受理范围被放宽」这一风险本体**：若实现按 `.md` 后缀无类别限制地受理，三者会变成合法整文件目标、绕过各自格式契约，本用例即该放宽的锁 |
| UT-S39-85 | 三值分流判定恰一处实现，lint 与 merge 同源消费且**对三值作相同处置** | 覆盖三类输入各若干形态：未声明封装（章节写法）、声明且受理合法、声明但受理不合法（op/后缀不符、target 漂移、类别命中 `NON_MARKDOWN_CATEGORIES`） | 分别取 change-lint L4 侧与 merge prepare 侧的分流结论与后续处置 | 判定返回值恰为 `section` / `whole-file` / `invalid-envelope` **三值**，两侧**逐一相同**；断言方式须为「调用同一导出函数」，不得在测试内另写一份等价判断。**关键断言：`invalid-envelope` 在两侧都不得被降级为 `section`**——识别只看首行是否匹配 `NON_MD_MARKER` 协议形态（两种 op、两种后缀**都算声明**），四项受理条件只对已识别为封装的输入求值、其不满足的结论是**拒绝**而非「回退章节」 |
| UT-S39-87 | 交叉锚（F1）：合法 Markdown 整文件 CREATE 通过真实 L4，**章节唯一性判定不被调用** | 隔离项目；UT-S39-76 的同一份合法新建夹具（`.md` 目标、首行 `## ADDED — <路径>（新文件，整文件）`、payload 首行为 H1） | 跑真实 `runChangeLint` 取完整结论，并对 `ADDED` 锚合成后唯一性判定的具名实现设**调用哨兵** | L4 **无违规、exit 0**；哨兵断言该判定**未被调用**。**本用例是 F1 缺口的锁**：现行 `parseDeltaBlocks` 会把该首行解析为 anchor 等于「路径 + 后缀」的 `ADDED` 块，若章节预检按 `.md` 或语义类别补集划定扫描范围而不按共享分流结果排除，本合法输入会被判「ADDED 章节没有形成唯一新增结果」，UT-S39-76 与 ST-S39-32/33 的成功条件同时崩塌。**修复方向必须是按通道排除，不得给 payload 补一个路径标题去迎合章节检查** |

### 场景测试

| ID | 场景 | 前置条件 | 操作序列 | 关键断言 |
|---|---|---|---|---|
| ST-S39-32 | 新建测试规格经整文件通道合并后，**测试变更账本闭合** | 真实 CLI；一次性隔离 launched 夹具项目；提案 `[delta]` 计划含 `deltas/test/core-S99-test-cases.md`（整文件写法，正文含 `UT-S99-01` 的用例表），目标文件不存在 | ① 跑真实 `openlogos merge <slug>` 进程；② 读回 canonical target 字节；③ 读回 `SPEC_MERGED`；④ 以下游消费方的读法再取一次 `test_change_set`；⑤ **merge 之后在同一夹具上重跑真实 `openlogos change-lint`** | ① 退出码 0；② 落盘字节等于 delta 剥离 marker 后的正文，逐字节比对，首行 H1 保留；③ `SPEC_MERGED.test_change_set.targets` **含 `logos/resources/test/core-S99-test-cases.md`**，`changed_test_ids` **含 `UT-S99-01`**，该 target 的 before hash 为空（CREATE）而 after hash **非空**；④ 与③读到的一致；⑤ **阶段边界闭环（F2）**：post-merge 的 `change-lint` **通过、exit 0**，且运行前后项目根字节快照相等（**零写入**）——原 CREATE 整文件 delta 仍在场，但受理判定不得因「目标现已存在」重判 mode 而把已完成的合并倒挂成失败。**本用例是「分流改变后账本不丢」与「阶段边界」两条的锁**：若实现把该目标推入 `non-markdown` 分支并 `continue`，`targets` 与 `changed_test_ids` 双双为空；若 post-merge 重放受理判定，⑤ 变红 |
| ST-S39-33 | 真实 CLI 下复现事故形态并证明新建能力可用 | 真实 CLI；一次性隔离 launched 夹具项目；提案含一份新建场景实现文档的 delta | ① 以事故原形态（`ADDED` 章节锚 + body 重复同名 H1）跑 `openlogos change-lint --format json`；② 同形态跑真实 `openlogos merge <slug>`；③ 改写为整文件封装后重跑 ①②；④ 读回落盘文档；⑤ 对一份不带后缀的章节写法 CREATE delta 重复 ①②③ | ① exit 2 且违规点名该 delta 的锚——**错误在 lint 阶段报出**（刀二前移承诺的断言点）；② 失败分支事务边界：非零退出、夹具内**仍无 `SPEC_MERGED`**、目标保持合并前字节（目标不存在则仍不存在）；③ lint PASS、exit 0，真实 merge 退出码 0 并写出 `SPEC_MERGED`；④ 落盘文档**首行为 `# ` 开头的 H1**、字节等于 delta 剥离后正文；⑤ 章节写法全程通过、结论与上线前逐字相同。**检查项标识集合与总数**取上线前同夹具实测基准，**禁止硬编码 `10/10`** |

### 追溯与覆盖

- CREATE `.md` 整文件新建成功且 H1 逐字保留：UT-S39-76、ST-S39-32 步骤②、ST-S39-33 步骤④。
- 声明自洽性失败拒绝且不回退成章节锚：UT-S39-77。
- payload 形态（空 / 残留 marker / 模板骨架）拒绝：UT-S39-78。
- Markdown 整文件不套 OpenAPI / SQL / 根 Schema 校验：UT-S39-79。
- 回归锚·MODIFY 模式四个章节 op 逐字不变：UT-S39-80。
- 回归锚·`api` / `database` / `orchestration` 三类既有整文件行为不变：UT-S39-81。
- 回归锚·**旧写法（不带后缀的 CREATE 章节 op）仍然合法**：UT-S39-82、ST-S39-33 步骤⑤。
- 残渣形态（锚带后缀却按章节写）被拒、后缀不再写进标题：UT-S39-83。
- 类别闸·三类非 Markdown 类别下的 `.md` 不受理（marker 合法的负例）：UT-S39-84。
- `invalid-envelope` 不得回退成章节锚（经真实 L4 与 merge 双路验证、零写入）：UT-S39-77 三臂、UT-S39-83。
- 残渣真实成因（首行 target 位写章节标题）被拒且不落盘：UT-S39-83。
- 正文 H1 与控制行同名不构成拒绝理由：UT-S39-86。
- 三值分流判定单点、两侧处置相同：UT-S39-85。
- 交叉锚·合法整文件 CREATE 通过真实 L4 且章节唯一性判定未被调用：UT-S39-87。
- 阶段边界·merge 后重跑 change-lint 通过且零写入：ST-S39-32 步骤⑤。
- 测试变更账本闭合（`test_change_set.targets` / `changed_test_ids`）：ST-S39-32。
- 端到端复现事故形态并断言新建能力可用：ST-S39-33。
- 场景：S39「Markdown 新建文档的整文件协议与显式封装分流」、「non-Markdown 整文件协议的适用类别与派生结论」；来源变更：add-markdown-create-whole-file-protocol。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S39"`；失败不得写 pass。
- **全部合法性判定必须经公开入口** `validateAndStripNonMarkdownDelta` 求值；只测内部解析函数的用例不算覆盖。
- UT-S39-79 必须对三个校验器设调用哨兵，不得只断言结果通过。
- UT-S39-80、UT-S39-81、UT-S39-82 的「逐字相同」对照必须以**本次上线前实现的输出**为基准夹具，不得在测试内复述期望文案。
- UT-S39-84 的三份 delta 其 marker 必须逐字合法——以错误 marker 构造的负例**不计入**本条覆盖。
- UT-S39-77 与 UT-S39-83 **必须经真实 `runChangeLint` 与真实 merge 两条路由求值**；只直调 `validateAndStripNonMarkdownDelta` 的臂**不计入**这两条的覆盖——本次缺口的本体是「识别规则让该输入到不了校验器」，直调校验器对其完全不敏感。
- UT-S39-83 的失败分支断言必须是**无文件、无 `SPEC_MERGED`、非零退出**；禁止使用任何以「文件已落盘」为前提的断言（如检查落盘标题文本）。
- UT-S39-86 与 UT-S39-79 共同锁定「正文即最终字节」：**任何对 payload 标题文本的判断都不得成为拒绝理由**；若实现新增此类判断，二者必须变红。
- UT-S39-87 必须对章节唯一性判定的具名实现设**调用哨兵**，断言其未被调用；仅断言「L4 通过」不算覆盖——按 `.md` 扫描但判定恰好通过的实现同样能满足那个弱断言。
- ST-S39-32 步骤⑤ 的 post-merge 重跑必须用**真实 CLI**，并断言运行前后夹具与本仓项目根字节快照均不变。
- ST-S39-32、ST-S39-33 必须跑**真实 `openlogos merge` 进程**，不得以库内函数调用替代；`SPEC_MERGED` 的断言按分支相反：成功分支断言其**在场**，失败分支（独立夹具，起始无该标记）断言其**仍不在场**且目标保持合并前字节。
- ST-S39-32 的账本断言必须读真实 merge 写出的 `SPEC_MERGED` 文件内容，**不得**改为直调 `buildTestChangeSet` 自行喂参——那样绕过的恰是本次要验的分流路径。
- **「零回归」的边界（与 S35 测试族统一口径）**：对全部夹具恒不变的只有适用检查项的**标识集合**、检查项**总数**与违规码**注册表**；通过数不是不变量。本刀对残渣形态（UT-S39-83）是一次有意的新增拒绝，其所属检查项必然由零违规转为有违规；通过数的「与上线前相同」断言只许用于行为不受本次修改影响的回归夹具（UT-S39-80～82、ST-S39-33 步骤⑤）。
- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。
