# core-S35: change-lint 测试用例

> 场景：S35 提案计划产物左移硬检查 | 来源变更：change-lint-shift-left
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`）。

## 一、单元测试（UT，共享判据层 + 命令逻辑）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S35-01 | L1 正例 | tasks.md 含 `## [delta]` 标题 | 无 L1 违规 |
| UT-S35-02 | L1 反例 | tasks.md 无任何 `## [tag]` 标题 | `tasks_sections_unparsable` |
| UT-S35-03 | L2 正例 | code_required 提案含空 `## [code]` 标题（占位说明） | 无 L2 违规（空段占位合法） |
| UT-S35-04 | L2 反例 | code_required 提案缺 `## [code]` 标题 | `tasks_code_header_missing`，`flow_reason:"tasks-code-section-missing"`（JSON 断言精确 string 类型） |
| UT-S35-05 | L3 plan 级（证据 a） | `[delta]` 未全勾，任务规划 `deltas/test/` 目标 | 无 L3 违规 |
| UT-S35-06 | L3 复用声明正例 | proposal 含固定语法小节（夹具原文见 §四）且 ID 均存在于已合并规格 | 无 L3 违规 |
| UT-S35-07 | L3 反例（占位尾段） | 仅有 `UT-S99-xx` / `ST-S99-TBD` / `SMOKE-core-TODO` 字样；**尾随点号变体** `UT-S99-xx.` / `ST-S99-TBD.` / `SMOKE-core-NN.` 分别经 parser、结构化表格首列与 spec-complete 真实 CLI 三路径 | `code_change_requires_real_test_ids`（尾随点号不得绕过占位黑名单）；句末点号不影响合法 ID（`见 UT-S09-02.` 采信为 `UT-S09-02`，内部点号 `UT-S09-02.1` 照常合法、空 dot 段拒绝） |
| UT-S35-08 | L3 反例（通配族名） | 仅有 `UT-S35-*`、`ST-S35-?`、`SMOKE-core-[case]` 字样 | 整串候选拒绝、前缀不采信 → `code_change_requires_real_test_ids` |
| UT-S35-09 | L3 复用声明反例 | 夹具原文见 §四：混合合法项 + 不存在 ID + 语法非法行 + 重复 ID | **逐项**各报一条 violation（message 含该行原文），合法项不消除小节整体不判过 |
| UT-S35-09a | L3 阶段边界 | 五夹具：刚写完 tasks（plan 级过）/ 部分 delta 勾选（plan 级仍适用）/ **全部勾选但 `deltas/test/` 文件缺失（spec-complete 级 → 违规，plan 证据不得沿用）** / **全部 delta 产出条目已勾选 + 一条未勾选的非 delta 元数据 checkbox（不含 `deltas/` 路径）→ 仍判 spec-complete 级并真实读取测试 delta 文件，不得被压回 plan 级**（计数基仅含 delta 产出条目，见功能规格 §2.30）/ `SPEC_MERGED` 在场（slice 级与 flow-derive 同结论） | 阶段分类函数逐档断言 |
| UT-S35-09b | L3 slice 级 proposal-scoped 负例 | 夹具项目 `logos/resources/test/` 全局已有大量真实 ID，但当前提案**无测试 delta 且无复用清单**，`SPEC_MERGED` 在场 | slice 级仍报 `code_change_requires_real_test_ids`——全局无关 ID 不构成本提案证据（lint 与 flow-derive 两侧同断言，防共用错误全局扫描 evaluator 双绿） |
| UT-S35-09c | L3 存在性=结构化 ID 列 | 复用声明引用的 ID 仅出现在某测试规格的**散文/覆盖清单**中、不在表格首列 | 判 ID 不存在 → 违规（全文 token 命中不构成存在性） |
| UT-S35-09d | L3 corpus 兼容回归 | 从当前全部 `logos/resources/test/*.md` 表格首列构建语料（含 `ST-S01-EX-adopt`、`UT-S05-bootstrap-01`、`UT-S05-B01`、`UT-JSON-09`、`ST-JSON-21`、`UT-S09-110a-neg` 等非数字尾段形态与含连字符 module 的 SMOKE ID） | `parseTestCaseIds` 全部接受，零收窄；flow-derive 换用 parser 后既有合法提案零回归 |
| UT-S35-10 | L4 反例（缺段标记） | .md delta 无 ADDED/MODIFIED/REMOVED 标题 | `delta_missing_section_marker` |
| UT-S35-11 | L4 反例（模板骨架全变体 + 混合残留） | 覆盖**两个权威模板**（`spec/change-management.md` 的 `[新增内容标题]` 系与根 Skill 的 `[新增章节标题]` 系）× ADDED/MODIFIED/REMOVED 全部占位标题与正文变体（唯一常量表驱动）；**外加混合负例**：真实 marker 标题 + 真实正文行之间残留任一独占占位行（如 `## ADDED — 真实标题` 下含 `[新增的完整内容]` 一行再接真实说明行） | 全部命中 `delta_template_skeleton`（混合形态不因存在真实内容而放过） |
| UT-S35-11a | L4 正例（合法引用不误报） | delta 正文以行内代码/代码围栏**引用**占位字面量（如本提案 skills delta 的规则说明行）；以及真实内容 delta | 均不报 `delta_template_skeleton`；**本提案 13 份 delta 全量过 L4** |
| UT-S35-12 | L5 正反例 | 需要部署×有 `[deploy]`（过）；需要部署×无 `[deploy]`（违规） | 反例报 `deployment_decision_conflict`，JSON 断言 `flow_reason` 为**精确字符串** `"deployment_decision_conflict"`（非 boolean） |
| UT-S35-13 | L6 正例 | delta 落在 prd/test/spec/skills 已知类别 | `lintValidity=valid`，无违规 |
| UT-S35-14 | L6 分流 | `deltas/unknown/x.md` → `delta_path_invalid`；`deltas/reference/x.md` → `explicitly_ignored` 不报 | 两分支各自断言 |
| UT-S35-15 | L6 symlink | delta 为 symlink 且解析后逃逸提案目录；**根级（deltas/ 直下）边界内文件 symlink**；**边界内指向 FIFO 的 symlink**（真实 CLI + merge 投影） | `delta_path_invalid`；根级 symlink 与根级普通文件同判（真实 CLI exit 2、无未捕获 TypeError）；FIFO 目标 invalid、`contentProbeEligible:false` 不预读、不进 `scanDeltas`/merge 消费清单（与变更前 `isFile()` 过滤零漂移）；边界内普通文件 symlink 仍 mergeable+valid（对照防过度收紧） |
| UT-S35-16 | L7 只读 | 对 GUI 夹具跑纯 evaluator | 不产生 `UI_PROTOTYPE_HASHES.json`，目录零写入 |
| UT-S35-17 | L7 坏声明三新码 | 声明段缺失 / YAML 损坏 / `ui_impact: "yes"` | `ui_declaration_missing` / `ui_declaration_unparsable` / `ui_impact_not_boolean` |
| UT-S35-18 | L7 跳过 | resolver 判定 `product_type: cli` 模块 | L7 零输出 |
| UT-S35-18a | 模块解析 | proposal 头 `> module:` 与 guard 冲突（以头为准）；头缺失且 guard.activeChange==slug（回退 guard）；头缺失且 guard 指向别的 slug（不回退）；模块不在 yaml | 前三档各按规则解析；末档 `module_unresolved` fail-closed |
| UT-S35-19 | 同源锚（L3） | 同一夹具分别经 lint 与 flow-derive | 两侧 pass/fail 与结构化细节一致 |
| UT-S35-20 | 同源锚（L4/L6） | 同一夹具分别经 lint 与 merge 路径；**分类器 ioError 夹具**（chmod 000 的 category 目录）同经两侧真实 CLI | `validateMarkdownDelta` / 分类器两侧结论一致；ioError 夹具 lint 侧 `artifact_unreadable`（exit 1）、merge 侧非零退出且不写 MERGE_PROMPT/SPEC_MERGED（ioError 条目绝不被投影成 no-delta 假成功） |
| UT-S35-21 | 违规集契约 | 多违规夹具 | `code`/`path`/`fix_hint` 必填；L1→L7 再 path 字典序；code ∈ 23 码闭合注册表；`flow_reason` 仅 L2/L3/L5 出现且恒为 string |
| UT-S35-22 | 收紧回归（test-id） | 含占位串的提案走 flow-derive；spec-complete 级唯一结构化 ID 为尾随点号占位 `UT-S99-xx.` 的提案同走 flow-derive | 不再绕过 `test-id-required`（消费点同步收紧生效；与 lint 同源 evaluator 同结论拒绝） |
| UT-S35-23 | 收紧回归（模板骨架） | 模板骨架 delta 走 merge | 被拒绝；既有合法 delta（真实内容）照常合并 |
| UT-S35-24 | 零漂移回归 | unknown/reference 忽略（UT-S09-02/10 同夹具）；已知类别下任意扩展名文件与文件 symlink | merge 消费行为与现行逐字节一致（零第三类收紧） |
| UT-S35-25 | slug 边界 | 非法字符 / `.` / `..` / 绝对路径 / 路径分隔 / symlink traversal | 全部 `slug_invalid` 拒绝；合法历史目录只读兼容通过 |

## 二、场景测试（ST，真实 CLI 入口，临时项目内运行）

| ID | 用例 | 期望 |
|----|------|------|
| ST-S35-01 | 命令注册与可发现 | `openlogos --help` 含 `change-lint`；命令可执行 |
| ST-S35-02 | 默认人读输出组 | **不带 `--format json`** 各跑全过/违规/操作错误三路径：stdout 逐项 ✓/✗ 与 `PASS`/`FAIL` 摘要、stderr `Error [<code>]:` 形态（按 CLI 体验 §2.25 文本锚），**stdout 无 JSON**；exit 0/2/1 |
| ST-S35-02a | JSON envelope 输出组 | **带 `--format json`** 同三路径：全过/违规 → stdout success envelope（`pass` 真/假）；操作错误 → stderr error envelope；exit 0/2/1；断言 §3.15 字段与排序契约 |
| ST-S35-03 | slug 解析四路径 | guard 默认活跃提案 / `--slug` 显式 / 无 guard 无 slug（`no_active_proposal`）/ slug 不存在（`slug_not_found`） |
| ST-S35-03b | not_initialized 前置 | 在**未初始化**临时目录（无 `logos/logos.config.json`）分别以无参与 `--slug xxx` 两档运行：stderr `not_initialized`、exit 1；探针断言 config 探测为第一步——未读取 guard / proposal / tasks / deltas，L1–L7 均未调用（**不得落入 `no_active_proposal`**） |
| ST-S35-03a | 操作错误即终止 | 覆盖 `slug_invalid` / `slug_not_found` / `module_unresolved` / `artifact_unreadable`（分别构造 proposal.md、tasks.md、delta 文件不可读三档）：断言 exit 1、**错误确定后 L1–L7 均未被调用（spy/探针）**、错误确定后无进一步文件读取、stdout 无任何第二份结果输出；**边界内 symlink 目标 EACCES（非断链）→ `artifact_unreadable` fail-fast 且后序探针不被读取（分类结果仅含该 ioError 条目）；真正断链仍为 L6 `delta_path_invalid`（exit 2，错误码分流不误伤）**；**本地 ignored delta（`deltas/reference/r.md`、`deltas/prd/.hidden.md` 各自 chmod 000）同为操作级红线 → `artifact_unreadable`（exit 1、message 含路径、无 success envelope）——L6 `explicitly_ignored` 不豁免可读性探测；两个不可读并存时错误恒为稳定路径序首个、后序路径不出现（fail-fast 锁定）** |
| ST-S35-04 | 命令兼容三路径 | `openlogos change lint` 仍创建 slug=`lint` 的提案（S09 零改动）；`openlogos change-lint` 执行检查；`openlogos change-lint --slug lint` 可检查该提案 |
| ST-S35-04a | 双模块 L7 归属 | 双模块夹具（GUI 模块 B 为 guard 活跃 + CLI 模块 A 提案）：`--slug <A提案>` 不激活 L7；反向（guard=CLI、`--slug` 指 GUI 提案）激活 L7；无 guard 显式 slug 按 proposal 头解析 |
| ST-S35-05 | 聚合排序端到端 | 构造多违规提案，**含同一 proposal.md 内 ≥3 条复用清单逐行违规（同检查项/同 code/同 path）**，断言 violations 全序稳定：L1→L7 → path 字典序 → 源位置出现序 → code → message（精确序列断言，两次运行同序） |
| ST-S35-06 | 只读性（项目级） | 运行前后对**临时项目根全量**做文件清单 + 逐文件 sha256 快照对比，覆盖 exit 0 / 2 / 1 与 GUI `ui_impact:true/false` 五条路径：快照完全不变（含 guard/marker/`logos-project.yaml`/verify 账本）；测试框架自身临时产物一律位于项目根外（白名单列明） |

## 三、覆盖度要求

- L1–L7 每项至少一对正反例（上表已覆盖）；23 码注册表中每个 code 至少被一个用例产出或显式断言不可达；
- L3 阶段分类函数五档边界全覆盖（UT-S35-09a）+ proposal-scoped 负例（UT-S35-09b）+ 结构化 ID 列存在性（UT-S35-09c）+ corpus 兼容零收窄（UT-S35-09d）；L4 双权威模板全变体 + 混合残留占位行负例 + 合法引用不误报 + 本提案自检通过（UT-S35-11/11a）；
- 两项判据收紧各有消费点回归（UT-S35-22/23）与零漂移对照（UT-S35-24）；
- 实现批次交付时，UT/ST 与本表 ID 一一对齐，reporter 逐条上报。

## 四、L3 复用声明夹具原文（UT-S35-06 / UT-S35-09 直接采用）

UT-S35-06 正例（proposal.md 片段）：

```markdown
## 复用测试 ID

- UT-S09-02 — 覆盖 unknown 目录忽略回归
- ST-S30-04 — 覆盖 cmd-gate 端到端路径
- SMOKE-core-12 — 覆盖部署后命令可见性
```

UT-S35-09 反例（同一小节，逐项判定）：

```markdown
## 复用测试 ID

- UT-S09-02 — 合法且存在（此行判过）
- UT-S99-99 — 语法合法但规格中不存在（violation：ID 不存在）
- UT-S09-02 — 与首行重复（violation：重复项）
- 请复用登录相关的那几个用例 — 无 ID 的散文行（violation：语法非法）
- UT-S35-* — 通配族名（violation：文法拒绝）
```

## S35 围栏提取单点、可归因诊断与门禁可满足性测试

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

## S35 SQL 校验降级留痕的输出通道测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S35-132 | 降级留痕进 warnings 而非 violations | Step 3c→3d | 提案含一份 `.sql` delta，项目方言为 `mysql`（适配器不可用） | 跑 `change-lint` 并分别取 violations 与 warnings | L9 无 `non_markdown_delta_invalid`、整体通过；warnings 含一条降级项，其 message 点名方言、缺失项与已执行层级，且含 `fix_hint`。断言该条**不在** violations 中 |
| UT-S35-133 | 无降级时 warnings 字段整体省略（零漂移） | Step 3b→4 | 两组夹具：① 无 `.sql` delta 的提案；② 方言为 sqlite 且 `sqlite3` 可用的提案 | 取 `change-lint --format json` 输出 | 两组的输出均不含 `warnings` 字段（而非含空数组）；与本功能引入前逐字节一致。多份 `.sql` 同时降级时逐份产出 warning，不合并为一条 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S35-25 | 降级与真实违规并存时互不吞并 | Step 3a→3d | 真实 CLI；提案同时含：一份触发降级的 `.sql`（mysql 方言）与一处真实违规（如另一份 delta 缺段标记） | 跑 `change-lint --format json` | violations 含该真实违规、不含降级项；warnings 含降级项、不含该违规；整体判 FAIL 是因真实违规而非降级。修复真实违规后重跑：整体 PASS，warnings 仍保留降级项 |

### 追溯与覆盖

- AC-SQLGATE-08 留痕经 warnings 可见、不计违规、零漂移：UT-S35-132、UT-S35-133、ST-S35-25。
- 场景：S35 SQL 校验降级留痕的输出通道；功能规格：§2.52.7；架构：§四十二.2；安装态：SMOKE-core-174。

## S35 spec-complete 判据与 marker 名单点测试

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

## S35 change-lint 检查项收敛与存量 authority_impact 兼容测试

> 覆盖 L10 删除后 change-lint 的检查项集合、其余级别结论零漂移，以及存量提案中已写的 `authority_impact` 块被忽略而非报错（提案决策 C01）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-134 | 检查项集合收敛且其余级别零漂移 | 取一组既有提案夹具（含 legacy、含 required fact 历史块、含完整 delta 三类） | 对每个夹具求 `runChangeLint` 结论 | 检查项编号上界为 8（L0～L8，总数随 L7 等条件在场而变），不含任何 L9/L10 条目；`AUTHORITY_CLOSURE_ISSUE_CODES` 与 `BASELINE_CLOSURE_VIOLATION_CODES` 均不再出现在码表中；每个夹具在保留级别上的 violation 集合与各自变更前**逐条相同**（同 code、同 path、同 message） |
| UT-S35-135 | 存量 authority_impact 块被忽略而非报错 | 提案含形态各异的历史 `authority_impact` 块：完整 required、not_applicable、字段残缺、YAML 语法非法 | 求 `runChangeLint` 结论 | 四种形态**一律不产生任何 violation 或 warning**；块内容不被解析（断言不出现 fact_id/字段名相关诊断）；提案照常通过并可继续 merge |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S35-26 | 真实 CLI 下无 authority_impact 的提案全链通过 | 真实 CLI；一个 `proposal.md` **完全不含** `## Authority Impact` 小节的合规提案 | ① 跑 `change-lint --format json` 与文本形态；② 跑 `merge <slug>`；③ 用 `change` 新建一个提案并读其模板 | ① PASS，`data.violations` 为空，envelope 中不出现 `authority_closure_*` 码、无 authority 维度；文本形态列出的检查项编号上界为 9、无 L10 行（总数随 L7/L9 条件在场而变，最多 10 项）；② merge 成功并写 `SPEC_MERGED`，全程无「缺声明」类诊断；③ 模板不含 `Authority Impact` 小节与 `authority_impact` 字段 |

### 追溯与覆盖

- AC-CUT2A-01 检查项收敛且其余结论零漂移：UT-S35-134、ST-S35-26。
- AC-CUT2A-02 存量声明块忽略而非报错：UT-S35-135。
- 场景：S35 提案计划产物左移硬检查；功能规格：§2.51.2。

## S35 重复标题检查与 L8 强度测试

> 覆盖 `lint-specs` 的重复标题检查项，以及 change-lint 中 L8 条目守恒由违规降级为警告后的分级行为。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-136 | lint-specs 报告同文件内重复标题 | 构造：① 含两处字节相同 `## X` 的文件；② 仅标题级别不同但文本相同（`## X` 与 `### X`）；③ 全文件标题互不相同 | 对三例求 `lintSpecsIn` | ①② 报 `duplicate_heading` 并逐条列出各出现行号；③ 无该项发现。本检查项**不参与任何门**：同一状态下 `merge` 与 `verify` 均不因其结论阻断 |
| UT-S35-137 | L8 守恒码降级为警告且诊断不变 | 构造隐式删除 ID 的 delta 与 REMOVED-ITEMS 点名未知 ID 的 delta | 求 `runChangeLint` 结论 | 两码均出现在 `warnings`、不出现在 `violations`；退出码为 0；诊断的 code / path / message / fix_hint 与降级前**逐字相同**；`delta_section_anchor_unresolvable` 仍在 `violations` |

### 追溯与覆盖

- AC-LINT-DUP-01 重复标题可见且不参与门：UT-S35-136。
- AC-L8-WARN-01 守恒降级且诊断不变：UT-S35-137。
- 功能规格：§2.72.2、§2.73。

## S35 阻塞理由自检覆盖与一致性锚测试

> 覆盖 `change-lint` 新增检查项 L9（`ProposalBlockReason` 8/8 自检覆盖）与「阻塞理由 × 自检入口可达性」一致性锚（功能规格 §2.79；场景 S35「阻塞理由自检可达性与一致性锚」）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-138 | 8 条阻塞理由逐条可被自检检出 | 逐条构造使该理由成立的最小提案状态：`no_delta_spec_marker_missing`（纯代码提案 `[code]` 已规划而 `SPEC_MERGED` 缺失）、`test-slice-manifest-missing` / `-invalid` / `-stale` / `-unsupported`、`test-slice-assignment-ambiguous`、`slice-task-state-inconsistent`、`code_change_requires_real_test_ids` | 对每种状态求 `runChangeLint` | 8 种状态**各自**被检出并点名对应 `ProposalBlockReason`；其中 7 条进 `violations` 且退出码为 2，`test-slice-manifest-stale` 进 `warnings` 且不改退出码。**修复前仅 `code_change_requires_real_test_ids` 一条被检出，其余 7 条 lint 全部 PASS** |
| UT-S35-139 | L9 与 next/status 同判据同结论 | 同一组提案状态快照 | 依次求 `runChangeLint` 的 L9 结论与 `next` / `status` 的 `reason` 及 violations | 三者的理由取值与 violation 的 `code` / `path` / `message` / `fix_hint` **逐条相等**（集合、顺序全同）；lint 不产生下游没有的结论，也不遗漏下游有的结论。断言 lint 未自建第二套阻塞判定 |
| UT-S35-140 | 一致性锚：理由全集 × 入口可达性 | 枚举 `ProposalBlockReason` 联合类型全集（当前 8 条） | 对每条理由求「是否存在至少一个自检入口（`change-lint` L3/L9 或 `slice plan` 写入口）能在其成立时检出它」 | 全集逐条可达；断言以**类型全集**为遍历源而非硬编码名单——新增第 9 条理由而未接线时本用例必挂红。允许放宽的方向只有「接入入口」，不得放宽断言本身 |
| UT-S35-141 | 未阻塞与「判定器不适用」不误报 | ① 提案处于正常进行态（delta 未产完、`SPEC_MERGED` 尚未写入）；② 单切片计划（`deriveSliceVerificationState` 结论为 `null`） | 求 `runChangeLint` | 两种情形 L9 **均无输出**：①「delta 未产完时 marker 缺失」是正常进度不是缺陷；②「判定器按设计不适用」不是负面结论（根规范 §2.2.1）。L0～L8 的结论与本变更前逐条不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-27 | Agent 报完成前的自检闭环 | 真实 CLI，临时项目：① 构造 manifest 非法的活跃提案（绕过写入口直接放置非法在盘 manifest，模拟历史遗留态）→ `openlogos change-lint` exit 2 并点名 `test-slice-manifest-invalid`，输出含可定位的 `fix_hint`；② 同一状态下 `openlogos next` 给出的理由与 violations 与 ① **逐条一致**；③ 依 `fix_hint` 以 `openlogos slice plan --file` 重新规划为合法产物 → `change-lint` exit 0；④ 全程 `change-lint` 未写入任何文件（运行前后项目根字节快照相等，含 guard、marker、`logos-project.yaml` 与 verify 账本） |

### 追溯与覆盖

- AC-LINT-BLOCK-01 8 条阻塞理由逐条可被自检检出：UT-S35-138、ST-S35-27 步骤①。
- AC-LINT-BLOCK-02 L9 与 `next` / `status` 同判据同结论（无第二套判定）：UT-S35-139、ST-S35-27 步骤②。
- AC-LINT-BLOCK-03 一致性锚以类型全集遍历，新增理由未接线即挂红：UT-S35-140。
- AC-LINT-BLOCK-04 强度分级：仅 stale 为 warning，其余为 violation：UT-S35-138。
- AC-LINT-BLOCK-05 未阻塞态与判定器不适用不误报：UT-S35-141。
- AC-LINT-BLOCK-06 只读红线不变（项目级零写入）：ST-S35-27 步骤④。
- 功能规格：§2.30、§2.79；场景：S35「阻塞理由自检可达性与一致性锚」；根规范：`spec/test-slice-manifest.md` §2.2.1、§8。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-140 的遍历源必须是 `ProposalBlockReason` 类型全集的运行期投影，禁止在测试内复制一份理由名单——复制即等于把「新增理由要记得同步测试」变回纪律，正是本用例要消除的形态。
- UT-S35-139 的对照必须调用真实的 `next` / `status` 派生路径取基准值，不得在测试内复述期望 violations。

## S35 表格首列 manual 标记统一读法与首格可提取性前移测试

> 覆盖表格首列提取读法容忍并剥离 manual 标记、语义变更集定义解析入口的统一（§2.37.3）、lint-specs 的 manual 容忍与递归扫描、change-lint 首格可提取性前移检查、一致性锁行级扩展（UT-S35-131 系）与 verify manual 排除语义不变式对照（来源变更 fix-table-test-id-manual-marker；功能规格 §2.82、§2.51.7、§2.37.3、§2.70.1）。
> 除 UT-S35-146 的真实语料臂**必须递归读取实际 `logos/resources/test/**`（含 `smoke/`）**外，其余夹具用一次性隔离项目构造测试规格与 delta、不依赖本仓自身的规格内容。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-142 | 表格首列提取容忍并剥离 manual 标记，各消费方**分别**断言合法输出 | 规格夹具 ID 表首格五形态：`SMOKE-core-14 [manual]`、`UT-S13-70 [manual/windows]`、裸 `UT-S09-02`（正例组）；散文首格「待补 ID」、占位尾段 `UT-S99-xx`（反例组，修复前后同拒） | 分别求各消费方结果：① 表格首列提取读法本体；② 语义变更集定义解析入口（`scanTestDefinitionCandidates`，前后态语义 diff）；③ 切片清单 `spec_target` 定义校验；④ `extractDefinedVerificationIds` | ①②③ 对正例组均以**裸 ID**识别该行（标记剥离、大小写不敏感，判定与剥离经 `MANUAL_MARKER_RE` 单点）：② manual 新增行以裸 ID 进入 `changed_test_ids`、同 ID 标记增减判为修改而非删除+新增；③ `SMOKE-core-14 [manual]` 首格被接纳为 spec_target 内已定义；④ 按既有资格规则筛选——manual UT/ST 行与 SMOKE **不进入**验证定义集合（各消费方分别断言合法输出，**不要求输出同一集合**）；反例组在 ①②③ 照常不提取/不识别——既有被拒形态零放宽 |
| UT-S35-143 | lint-specs 对合法 manual 行不误报 | 规格夹具含 `SMOKE-core-14 [manual]` 与 `UT-S13-70 [manual/windows]` 首格行，另含一对「同裸 ID 分别以裸形态与带标记形态出现」的行 | 求 lint-specs 结论 | 合法 manual 行不报 `invalid_test_id`；首格剥离标记后按裸 ID 判重——裸/带标记同 ID 两行仍报重复 ID（剥离不吞掉重复检查） |
| UT-S35-144 | lint-specs 递归扫描 smoke/ 子目录 | 隔离项目 `logos/resources/test/smoke/` 内构造：重复 ID 文件、列数不一致文件；顶层另有一处对照错误 | 求 lint-specs 结论 | `smoke/` 内两类问题均被报告并点名子目录内文件与行号（修复前顶层扫描整体漏过）；顶层对照错误照常报告（递归不丢顶层） |
| UT-S35-145 | change-lint 首格可提取性前移检查（L4 族），表头口径不缩小 | 活跃提案含 `deltas/test/` 的 `.md` delta；表头三形态 × 首格三形态矩阵：表头分别为 `ID`、`用例 ID`、`用例ID`（对齐既有结构化提取口径），各表内数据行首格分别为 ① `SMOKE-core-77 [manual]`（合法）、② 散文「待补 ID」（不可提取）、③ 占位尾段 `UT-S99-xx`（黑名单拒绝） | 求 `runChangeLint` 结论 | **三种表头下**：① 均无该项违规（合法 manual 行放行）；②③ 均各报一条 `delta_test_table_id_unextractable`（进 violations、exit 2），message 点名文件、行号与首格原文——`用例 ID` / `用例ID` 表头的表不得绕过检查（零误报不得靠缩小扫描集合实现）；该码进入闭合码表（注册表断言以权威码表为源）；散文、非 ID 表、代码围栏内引用不参与判定（零误报对照） |
| UT-S35-146 | 一致性锁行级扩展：真实语料逐行 + 静默跳过即失败 | 双臂。真实语料臂：递归读取实际 `logos/resources/test/**`（含 `smoke/` 子目录）；隔离正反例臂：隔离规格集注入一行首格带 manual 标记（合法）与一行首格不可提取（非法） | 行级一致性断言：**数据行枚举独立于「ID 是否提取成功」**（先按结构化 ID 表表头识别并枚举全部数据行，再逐行调用权威读法判定），断言每一行都能提取出被权威语法接纳的裸 ID，报告文件、行号与首格原文 | 真实语料臂：当前已合并规格全部 ID 表数据行逐行通过（含 smoke/ 内带 manual 标记首格）——日后新增提取不出的真实规格行时本用例必挂红；隔离臂：带标记行被提取出裸 ID 计入集合（不再静默跳过），不可提取行使断言失败并点名定位。修复前 UT-S35-131 的 `mergedTableIds()` 先用提取正则过滤、不匹配行不进集合——本用例即该盲区的回归锁（UT-S35-131 原 ID 级断言保留，行级断言叠加其上且不得复用「提取成功才入集合」的枚举方式） |
| UT-S35-147 | verify manual 排除语义不变式对照（含切片两模式） | 三臂。无切片臂：UT-S13-70/72 同构夹具（首格分别带 `[manual]` 与 `[manual/<平台>]`）+ 结果账本；slice-checkpoint 臂与 final 臂：有效切片验证夹具（合法 change set + manifest），规格含带标记 UT/ST 行，账本另注入一条 manual ID 的结果记录 | 修复前后分别求 verify 的 defined / executed / `eligible_test_ids` 集合与 manual 排除判定 | 三臂排除集合与判定结果**逐字不变**：manual 行不进 defined/executed，也**不进切片模式的 `eligible_test_ids`**（`extractDefinedVerificationIds` 在统一提取之上仍经同源 manual 判定过滤——仅过滤 smoke 目录与非 UT/ST 前缀不够，本臂即该泄漏路径的回归锁）；manual 结果入账仍被拒绝（`manual_test_result_id`），不得先被 defined 接纳；manual 判据单一事实源仍只认首格标记（S13 不变量 1）；SMOKE 仍不进 verify 可选集 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-28 | manual 首格规格下 slice plan 端到端转绿（真实变更集 + 归属对账） | 真实 CLI，一次性隔离项目复刻下游缺陷现场：提案测试 delta 新增 `SMOKE-core-14 [manual]` 首格行（S13 认可形态），执行**真实 `openlogos merge`** 生成 `SPEC_MERGED.test_change_set`——断言 `SMOKE-core-14` 以裸 ID 进入真实 `changed_test_ids`；随后以**启用切片验证的多切片夹具**（≥2 切片，归属对账 `O = C` 生效）跑 `openlogos slice plan --file`，含该 ID 的 `owned_test_ids` 不再报 `SLICE_PLAN_UNKNOWN_TEST_ID`（含写入侧「owned_test_ids 含非本提案变更 ID」对账），切片清单成功落盘且 `owned_test_ids` 记录裸 ID——**不得用单切片跳过归属对账来证明修复**；对照组：`owned_test_ids` 引用规格中不存在的 ID 仍被构造性拒绝（收紧回归零放宽） |

### 追溯与覆盖

- 主修·提取读法统一（含语义变更集定义解析入口，§2.37.3）：UT-S35-142、ST-S35-28。
- 主修·消费边界（统一解析层 ≠ 同一输出集合）：UT-S35-142、UT-S35-147。
- 辅修·lint-specs（manual 容忍 + 递归）：UT-S35-143、UT-S35-144。
- 辅修·change-lint 前移检查（表头口径不缩小）：UT-S35-145。
- 辅修·一致性锁行级扩展（真实语料）：UT-S35-146。
- 不变式·verify manual 排除语义（含切片两模式）：UT-S35-147。
- 功能规格：§2.82（§2.51.7、§2.37.3、§2.70.1 同步修订）；场景：S35「表格首列 manual 标记统一读法与首格可提取性前移」；来源变更：fix-table-test-id-manual-marker。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-142 / UT-S35-146 的判定必须调用真实的表格首列读法与一致性断言实现，不得在测试内复制一份正则——复制即再造第二份读法，正是本变更要消除的形态。

## S35 L7 缺段警告化与判定源统一测试

> 覆盖 change-lint L7 缺段（`ui_declaration_missing`）由 fail-closed 违规降为警告 + 消费侧派生 `ui_impact:false` 安全默认，以及降门的零回归防伪臂（功能规格 §2.83、§2.26.2、§2.30；场景 S35「L7 缺段警告化与 warning 输出通道」；来源变更 fix-ui-declaration-source-skew-and-missing-degate）。夹具用一次性隔离项目构造，不依赖本仓自身的提案内容。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-148 | 缺段降为警告 + 派生 `ui_impact:false`（20260914 事故形态旧实现必红回归） | GUI 夹具（模块 `product_type: desktop`）；提案 `proposal.md` **完全不含**「UI/UX 变更声明」段，其余合法 | 求 `runChangeLint` 结论；另取消费侧派生的 `ui_impact` 值 | `ui_declaration_missing` 出现在 `warnings`（含 `code` / `message` / `fix_hint`，fix_hint 指引补回脚手架声明段）、**不出现在 `violations`**；退出码不因缺段为 2（无其它违规时 exit 0）；派生 `ui_impact === false`（与 `parseUiUxDeclaration` 安全默认同口径，断言不存在第二处派生判定）。**修复前该码进 violations 且 exit 2——本用例即 20260914 merge 硬停形态的回归锁** |
| UT-S35-149 | 防伪臂：在场但损坏 / 非布尔仍 fail-closed 逐字不变 | GUI 夹具三形态：① 声明段标题在场但**无 fenced YAML block**；② fenced YAML **语法损坏**；③ YAML 合法但 `ui_impact: "yes"` | 对三形态分别求 `runChangeLint` 结论 | ①② 报 `ui_declaration_unparsable`、③ 报 `ui_impact_not_boolean`——三者均进 `violations`、exit 2；诊断的 code / path / message / fix_hint 与降门前**逐字相同**；三形态均**不产生**任何 `ui_declaration_missing` warning（缺段与写坏是互斥形态，不得双报） |
| UT-S35-150 | 防伪臂：`ui_impact:true` 逐页对账逐字不变 | GUI 夹具：声明段合法、`ui_impact: true`，声明清单与 `2-page-design/` 产出分别构造**一致 / 缺失 / 额外 / 重复** 四态 | 求 `runChangeLint` 的 L7 对账结论 | 一致态通过；缺失 / 额外 / 重复三态照旧判失败——对账判据（声明清单 basename 集合 == 产出文件 basename 集合）与降门前逐字不变；缺段派生的 `ui_impact:false` **不触发**逐页对账（对账仅对结构合法且声明 `true` 的提案执行） |
| UT-S35-151 | 防伪臂：非 GUI 不激活 + `module_unresolved` fail-closed 不变 | ① 模块 `product_type: cli` 的提案（同样不含声明段）；② proposal 头无 `> module:` 且 guard 不指向本 slug 的提案 | 对两形态分别求 `runChangeLint` 结论 | ① L7 零输出：无违规**且无任何 `ui_declaration_missing` warning**（非 GUI 缺段不是缺陷，降门不得把 L7 泄漏到非 GUI 模块）；② 仍为操作错误 `module_unresolved`（exit 1，fail-closed）——**不得**因缺段已降门而静默按非 GUI 跳过 |
| UT-S35-152 | 警告不入 merge 准入违规集合 + warnings 通道零漂移 | ① 仅缺段警告、无任何违规的 GUI 提案；② 缺段警告与一处真实违规（如另一 delta 缺段标记）并存的提案；③ 声明段完整合法的 GUI 提案 | ①② 分别走 merge 准入消费点（与 lint 同源完整结论）；③ 取 `change-lint --format json` 输出 | ① merge 准入放行（violations 为空，warning 不改变准入结论）；② violations 含该真实违规、不含缺段项，warnings 含缺段项、不含该违规，互不吞并——merge 因真实违规拒绝而非因缺段；③ 输出**不含** `warnings` 字段（非空才出现，与降门前逐字节一致） |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-29 | 20260914 事故端到端复现：缺段提案 merge 不再硬停 | 真实 CLI，一次性隔离 GUI 项目（`product_type: desktop`）复刻事故现场：活跃提案 `proposal.md` 被整篇重写为**不含**「UI/UX 变更声明」段、其余 delta 与 tasks 全部合法。① `openlogos change-lint --format json`：exit 0、`data.pass=true`、`violations` 为空、`warnings` 含 `ui_declaration_missing`（含可定位 fix_hint）；② **真实 `openlogos merge`** 不再被缺段挡停——merge 准入通过并继续既有流程（**修复前此步确定性 fail-closed 拒绝，即 audit run `drv-mu0svxrh-64i2` 的 `merge-failed` 停点**）；③ 对照臂（fail-closed 保留）：同构提案改为「段在场但 YAML 损坏」→ `change-lint` exit 2 报 `ui_declaration_unparsable`，merge 拒绝、不写 `SPEC_MERGED`；④ 全程 change-lint 项目级零写入（运行前后项目根字节快照相等） |

### 追溯与覆盖

- 主修·缺段警告化 + 派生安全默认（旧实现必红）：UT-S35-148、ST-S35-29 步骤①②。
- 防伪臂·在场但损坏 / 非布尔 fail-closed 逐字不变：UT-S35-149、ST-S35-29 步骤③。
- 防伪臂·`ui_impact:true` 逐页对账逐字不变：UT-S35-150。
- 防伪臂·非 GUI 不激活 + `module_unresolved` fail-closed：UT-S35-151。
- 防伪臂·警告不入 merge 准入违规集合 + 零漂移：UT-S35-152。
- 功能规格：§2.83、§2.26.2、§2.30；场景：S35「L7 缺段警告化与 warning 输出通道」；来源变更：fix-ui-declaration-source-skew-and-missing-degate。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-148 / UT-S35-152 的通道断言必须分别读取 `violations` 与 `warnings` 两个真实输出字段，不得只断言「码出现在输出中」——通道归属正是本变更的语义本体。
- UT-S35-149 的「逐字相同」对照必须以降门前实现的诊断输出为基准夹具，不得在测试内复述期望文案。

## S35 行级形态判据前移与预检-门一致性锁测试

> 覆盖后态 `test-change-set-ambiguous-table` 全部触发形态（数据行列数不一致、表头重复）的判据与**枚举口径**双重单点化，及其在 change-lint L4 族的前移（`delta_test_table_column_mismatch` / `delta_test_table_duplicate_header`），以及「凡后态以该码拒的形态、预检必先报」的一致性锁（功能规格 §2.84.1～§2.84.2、§2.84.5；场景 S35「行级形态判据前移与预检-门一致性锁」；来源变更 fix-merge-preflight-parity-and-bare-throw）。夹具用一次性隔离项目与合成 delta 构造，不依赖本仓自身的提案内容。**枚举口径的反例臂是本组测试的核心**——只验证整数比较而不验证「哪些行进入比较」，会把 delta-r1 F1 的两个漏扫盲点锁进预期。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-153 | 列数判据前移必红（20260914 事故形态旧实现必绿） | 合成 `deltas/test/core-S10-test-cases.md`：ADDED 块内 ID 表表头 6 列，`UT-S10-187` 行因少写一个管道符实为 5 列（复刻事故行形态），其余行合法 | 求 `runChangeLint` 结论 | `delta_test_table_column_mismatch` 进 `violations`、exit 2、L 层归属为 L4；**修复前该形态 change-lint 报 PASS（10/10）而 merge 在 `buildTestChangeSet` 抛 `test-change-set-ambiguous-table`——本用例即该「预检全绿 / merge 必炸」组合的回归锁** |
| UT-S35-154 | 首格合法而列数不一致必被拒，且与首格码不双报 | 合成 delta 三形态：① 首格合法裸 ID + 列数不一致；② 首格合法 `UT-S10-188 [manual]` 标记形态 + 列数不一致；③ 首格非法（散文）+ 列数同时不一致 | 对三形态分别求 `runChangeLint` 结论 | ①② 均报 `delta_test_table_column_mismatch`（manual 标记不豁免列数判定，首格剥离标记后按裸 ID 判身份）；③ **只报** `delta_test_table_id_unextractable`、**不报** 列数码——首格非法的行不构成 ID 行，两检查正交不重复报 |
| UT-S35-155 | 枚举口径对齐：两个漏扫盲点必红 + 真正合法表零误报 | 合成 delta 四形态：① **表头措辞非 `TEST_ID_HEADER_RE`**（表头为「编号 / 操作 / 断言」三列）而数据行首格为合法测试 ID、该行仅两列（delta-r1 F1 反例一）；② **无首尾管道外形**的两列表，数据行只剩一个裸合法 ID、整行不含管道符（delta-r1 F1 反例二）；③ 完全合法的 ID 表（含 manual 标记行与含行内代码、长文案的单元格）；④ 表格含列数不一致行但**无任何合法测试 ID 首格数据行** | 对四形态分别求 `runChangeLint` 结论，并与同形态合并后态的 `buildTestChangeSet` 结论对照 | ①② **必报** `delta_test_table_column_mismatch`——后态正是按数据行首格判身份、按空行定边界，两者均被后态以 `test-change-set-ambiguous-table` 拒；**修复前前移侧因表头措辞限制与「不含管道符即收束」的块边界而整表 / 整行漏扫，本用例即这两个盲点的回归锁**；③④ 零该码（④ 后态亦不抛，其列数问题由 `lint-specs` 只读诊断承担）。四形态两侧结论必须一致 |
| UT-S35-156 | 诊断可归因：点名 delta 文件与 **delta 内行号** | 合成 delta：已知某不一致行位于 delta 文件第 N 行（ADDED 标记行之后若干行），表头 6 列、本行 5 列 | 取该违规的 `path` / `line` / `message` | `path` 为该 **delta 文件**相对路径（非合并后态 canonical target）；`line` 恰为 **delta 内 1 基行号 N**（按夹具已知值精确断言，不得只断言「行号非空」）；`message` 同时含表头列数 `6`、本行列数 `5` 与该行首格 ID——足以直接定位到要改的那一行 |
| UT-S35-157 | 一致性锁：后态 `test-change-set-ambiguous-table` 全码族，预检必先报（任一侧单独收紧即失败） | 夹具集合覆盖该码**全部**触发形态：列数不一致（表头多列 / 少列、行尾多余管道、行内缺管道、manual 标记行）、**表头重复**，并**必须含 delta-r1 F1 两反例**（非 `TEST_ID_HEADER_RE` 表头的测试定义表、数据行不含管道符导致前移侧提前收束）；每个夹具同时具备 delta 形态与其合并后态，另备各夹具「已修正」版本 | 逐夹具双向比对：一侧喂 `runChangeLint`（delta 形态），一侧喂 `buildTestChangeSet`（合并后态，历史兼容开关关闭的正常路径） | 两侧结论逐夹具一致——后态被拒的夹具预检必报对应违规（列数 → `delta_test_table_column_mismatch`，表头重复 → `delta_test_table_duplicate_header`），反之亦然；**已修正版本两侧均通过**（证明前移不是无差别收紧）。**注入式反证臂**：单独放宽预检侧枚举（恢复表头措辞限制或「不含管道符即收束」的块边界）时本断言必红，证明锁覆盖的是枚举口径而非仅整数比较。**边界断言**：`test-change-set-duplicate-id` / `-target-duplicate` / `-overlap` 夹具**不纳入**比对且不因此判红——其需合并后态全局视角，在 delta 片段上不可判定（§2.84.5）；`allowAmbiguousRows` 等历史基线兼容路径同样不纳入 |
| UT-S35-158 | 表头重复前移（同码另一半触发形态） | 合成 delta：测试定义表的表头含两个同名单元格（如两列都叫「断言」），数据行列数与表头一致、首格为合法测试 ID | 求 `runChangeLint` 结论，并与同形态合并后态的 `buildTestChangeSet` 结论对照 | 预检报 `delta_test_table_duplicate_header`（进 violations、exit 2、L 层归属 L4），message 点名 delta 文件与**表头行的 delta 内行号**及重复的表头文本；后态同形态以 `test-change-set-ambiguous-table` 拒——两侧一致。**修复前预检对此形态零信号**，与列数盲点同属一个错误码的两半 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-30 | 20260914 事故端到端复现：少一个管道符在 write-delta 节点即闭环 | 真实 CLI，一次性隔离项目复刻事故现场：活跃提案的 `deltas/test/core-S10-test-cases.md` 中 `UT-S10-187` 行少写一个管道符，其余 delta 与 tasks 全部合法。① `openlogos change-lint --slug <slug> --format json`：exit 2、`data.pass=false`、`violations` 含 `delta_test_table_column_mismatch`，其 `path` 指向该 delta 文件、`line` 为 delta 内行号（**修复前此步为 PASS 10/10——即事故的盲点**）；② 按诊断补齐该管道符后重跑 `change-lint`：exit 0、PASS，证明诊断足以在本节点自修闭环；③ 续跑**真实 `openlogos merge`**：成功合并、写入 `SPEC_MERGED`（**修复前此步确定性退 1 硬停，即 audit run `drv-mu1d875x-7ooq` 的 `merge-failed` 停点**）；④ 对照臂（后态判据不放宽）：另取同构提案绕过预检直接构建合并后态，`buildTestChangeSet` 仍以 `test-change-set-ambiguous-table` fail-closed 拒绝——前移不等于放宽；⑤ **枚举盲点臂**：另取同构提案，其病灶行改为「表头措辞非 `TEST_ID_HEADER_RE` 的测试定义表中列数不一致的数据行」，重跑步骤①——同样 exit 2 并报该码（修复前此形态整表绕过预检、照样在 merge 硬停）；⑥ 全程 `change-lint` 项目级零写入（运行前后项目根字节快照相等） |

### 追溯与覆盖

- 主修·列数判据前移（旧实现必红）：UT-S35-153、ST-S35-30 步骤①②。
- 主修·**枚举口径与后态对齐**（delta-r1 F1 两反例必红）：UT-S35-155 形态①②、UT-S35-157 反证臂、ST-S35-30 步骤⑤。
- 主修·表头重复前移（同码另一半）：UT-S35-158、UT-S35-157。
- 主修·前移与后态判据同源、正交不双报：UT-S35-154。
- 防伪臂·真正合法表与无测试 ID 表零误报：UT-S35-155 形态③④、ST-S35-30 步骤⑥。
- 主修·诊断可归因（点名 delta 文件与 delta 内行号）：UT-S35-156、ST-S35-30 步骤①。
- 一致性锁·预检-门可满足性（按错误码定边界，含注入式反证臂与不可判定形态的排除断言）：UT-S35-157、ST-S35-30 步骤④。
- 功能规格：§2.84.1、§2.84.2、§2.84.4、§2.84.5、§2.84.6；场景：S35「行级形态判据前移与预检-门一致性锁」；来源变更：fix-merge-preflight-parity-and-bare-throw。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-156 的行号断言必须对**夹具已知的精确 delta 内行号**比对，不得只断言「有行号」——可归因正是本变更的语义本体。
- UT-S35-157 的双向比对必须调用两侧**真实实现**（`runChangeLint` 与 `buildTestChangeSet`），不得以复述期望的表驱动替代；注入式反证臂须证明**单独放宽预检侧枚举口径**（而非仅判据）会让断言变红。
- UT-S35-155 形态①② 与 UT-S35-158 必须同时断言「后态确实拒绝」，以证明前移集合的扩大部分**恰为后态已拒形态**、未新拒后态接纳的形态。
- ST-S35-30 步骤③ 必须跑**真实 `openlogos merge`** 进程并断言退出码与 `SPEC_MERGED` 在场，不得以库内函数调用替代。

## S35 变更类型 ↔ delta 层面观测 warning 测试

> 覆盖 change-lint 新增 warning `change_type_delta_layer_mismatch`：声明类型经 `resolveChangeType` 解析（歧义 → `null` → 静默）、实际层级取 `classifyProposalDeltas()` 的 `mergeable + valid` 有效条目、超出免计集合即报，只走既有 `warnings[]` 通道（需求「S35/S09: 防过度设计的规模信号」验收条件 1–6；场景 S35「变更类型 ↔ delta 层面观测 warning」；来源变更 anti-overdesign-scale-signals）。夹具用一次性隔离项目构造提案与 delta，不依赖本仓自身的提案内容。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-159 | 主链路：声明代码级而实有 `prd` delta → 产 warning，exit code 不变 | 隔离项目；提案「变更类型」正文为 `代码级`，`deltas/prd/3-technical-plan/...` 下有一个合法 delta，其余合法 | 求 `runChangeLint` 完整结论与退出码 | `change_type_delta_layer_mismatch` 出现在 `warnings`（含 `code` / `message` / `fix_hint`）、**不出现在** `violations`；无其它违规时 exit **0**——与本能力上线前同夹具的退出码逐字相同 |
| UT-S35-160 | 免计边界·代码级 + 仅 `test` delta → **不告警** | 同上，声明 `代码级`，delta 只有 `deltas/test/core-SXX-test-cases.md` | 同上 | 本 warning 通道零输出。依据：方法论「代码 + 重新验收」允许回归测试规格随行，`change-writer` 亦允许代码级提案带 delta。**本用例是「下界不是上限」定性的守门用例**，若实现把传播规则当上限即必红 |
| UT-S35-161 | 免计边界·接口级 + `api` / `database` / `scenario` delta → 不告警 | 声明 `接口级`，三类 delta 各一 | 同上 | 零输出；改为追加一个 `prd/2-product-design` delta 后即产 warning，且 message 只点名 `prd/2-product-design` 一项（不含已免计的三类） |
| UT-S35-162 | 免计边界·需求级恒不告警 | 声明 `需求级`，delta 覆盖全部八类各一 | 同上 | 本 warning 通道零输出（需求级免计集合为全部层） |
| UT-S35-163 | `decisions` 与层级正交：任一声明类型下均不告警 | 四组夹具，声明分别为代码级 / 接口级 / 设计级 / 需求级，delta 均**只含** `deltas/decisions/core-DXX-*.md` | 四组分别求结论 | 四组均零输出——决策留痕是变更自身的元数据、非规格产物 |
| UT-S35-164 | `spec` / `skills` 归设计级及以上 | 四组夹具（代码级 / 接口级 / 设计级 / 需求级），delta 为 `deltas/spec/*.md` 与 `deltas/skills/*.md` 各一 | 四组分别求结论 | 代码级、接口级两组产 warning 且 message 点名 `spec` 与 `skills`；设计级、需求级两组零输出 |
| UT-S35-165 | `prd` 子目录粒度与未知子目录 | 声明 `设计级`；三组 delta 分别落在 `prd/1-product-requirements` / `prd/2-product-design` / `prd/<未注册子目录>` | 三组分别求结论 | `prd/2-product-design` 组零输出；`prd/1-product-requirements` 组与未知子目录组均产 warning，message 点名具体子目录路径而非笼统的 `prd`——证明判定取自 `relativePath` 的子目录粒度而非一级 `category` |
| UT-S35-166 | `resolveChangeType`·剥括号后唯一命中（zh） | 「变更类型」正文为 `代码级（不涉及设计级或需求级变更）`，delta 含一个 `prd` 条目 | 直接对 `resolveChangeType` 求值，并求 `runChangeLint` 结论 | 解析为**代码级**（括号内的「设计级」「需求级」不参与匹配）；据此产 warning。**若实现按首个/末个匹配或不剥括号，会解析成设计级或需求级而漏报——本用例即该误判的锁** |
| UT-S35-167 | `resolveChangeType`·歧义两通道同时静默（zh） | 「变更类型」正文为 `设计级 / 代码级`，delta 含一个 `prd/1-product-requirements` 条目 | 求 `resolveChangeType` 与 `runChangeLint` 完整结论 | `resolveChangeType` 返回 `null`；`warnings` **不含** `change_type_delta_layer_mismatch`；`violations` **不含** `proposal_change_type_invalid`（该正文通过既有包含式合法性检查，本就合法）——断言**两条通道同时静默**，不得因歧义而任一侧报错 |
| UT-S35-168 | `resolveChangeType`·英文括号与歧义对称行为（en） | en locale 两组：① `code level (not a design or requirements level change)`；② `design / code level`，delta 均含一个 `prd` 条目 | 两组分别求 `resolveChangeType` 与 `runChangeLint` | ① 解析为 code 并产 warning；② 返回 `null` 且两通道静默——与 zh 行为逐项对称。英文正则更宽松（任何含 `code` 的说明文字都命中），本用例锁死剥括号与唯一性判定同样作用于 en |
| UT-S35-169 | 有效条目口径：`explicitly_ignored` / `invalid` 不计入 | 声明 `代码级`；`deltas/` 下构造 ① `reference/` 条目、② 隐藏文件、③ 路径非法（L6 判 `invalid`）条目、④ 根下直放文件，**无任何** mergeable+valid 的规格层条目 | 求 `runChangeLint` 完整结论 | 本 warning 通道零输出（有效条目集合为空 → 恒不越界）；既有 L6 对 ③④ 的既有诊断逐字不变——证明两者互不吞并、同一形态不被二次报成层级越界 |
| UT-S35-170 | 零回归锚：`proposal_change_type_invalid` 逐字节不变 | 覆盖既有判定的全部分支：zh/en × 合法单类型 / 合法多类型 / 完全不含类型词 / 空段 / 仍含模板占位 | 对每组求 `evaluateProposalStructure` 诊断，与本能力上线前的基准夹具逐字比对 | 该码的出现与否、`code` / `path` / `message` / `fix_hint` / `section_id` / `actual` / `expected` 全部逐字相同——`isValidChangeType` 提取导出后语义零回归。**对照必须以上线前实现的输出为基准夹具，不得在测试内复述期望文案** |
| UT-S35-171 | 零回归锚：违规码集合与门禁计数对上线前逐字同形 | ① 仅命中本 warning、无任何违规的提案；② 本 warning 与一处真实违规（如另一 delta 缺段标记）并存的提案；③ 无 delta 的纯代码提案 | ①②③ 分别取 `change-lint --format json` 输出、检查项集合与计数、`data.pass` 与退出码 | `ChangeLintViolationCode` 闭合枚举的成员集合与上线前逐字相同（断言集合本身，不只断言「新码不在其中」）。**三组各自的检查项集合、总数与通过数均与上线前同夹具逐字相同**——不得硬编码 10/10：总数随适用性（如 GUI 项目才激活的 L7）变化，通过数按无违规检查项计。① `pass=true`、exit 0；② **`pass=false`、exit 2、通过数少于总数**——新增 warning **不得**把真实违规的失败结果改成通过；③ 与上线前同形。② 中 violations 含该真实违规、不含本 warning 码，warnings 含本 warning 码、不含该违规，互不吞并 |
| UT-S35-172 | 可归因与零漂移 | ① 同时越界两层（如 `prd/1-product-requirements` 与 `spec`）的提案；② 完全不越界且无其它 warning 的提案 | ① 取 warning 的 `message` / `fix_hint` 文本；② 取 `--format json` 输出 | ① message **逐项列出**声明类型与两个实际越界的层（不是仅给计数、不是只给首项），fix_hint 指引「确认类型声明是否准确，或说明本次为何需要触及这些层」；且 message 与 fix_hint **均不含**「违反方法论」及等价断言措辞；② 输出**不含** `warnings` 字段（非空才出现，与上线前逐字节一致） |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-31 | 真实 CLI 端到端：观测 warning 出数而不改变任何门禁结论 | 真实 `openlogos change-lint`，一次性隔离项目。① 构造「声明代码级 + 含 `prd` delta」的活跃提案：`openlogos change-lint --format json` **exit 0**、`data.pass=true`、`violations` 为空、`warnings` 含 `change_type_delta_layer_mismatch` 且 message 逐项点名越界层；② **措辞断言**：message 与 fix_hint 均不含「违反方法论」「违规」「不合规」类断言性措辞（本规则是观测启发式，传播规则给的是下界）；③ 对照臂·免计形态（**独立夹具**）：新建提案，声明代码级、delta 只有 `deltas/test/` → 同一命令 exit 0 且输出**不含** `warnings` 字段；④ 对照臂·歧义（**独立夹具，不得复用③**）：新建提案，delta **恢复为含 `deltas/prd/1-product-requirements/`**，「变更类型」正文为 `设计级 / 代码级` → exit 0、无本 warning、亦无 `proposal_change_type_invalid`。**夹具必须带 prd/1 delta 才有鉴别力**：该层既不在设计级也不在代码级的免计集合内，故实现若错误地把歧义解析成两者中任一个都会告警而使本臂红；沿用③的「只有 test」夹具则因 test 对所有类型均免计而恒绿，无法检出错误解析；⑤ **门禁不变**：三臂各自的检查项集合、总数与通过数均与本能力上线前同夹具逐字相同（不硬编码 10/10），三臂 `pass=true`、exit 0，且 `openlogos merge` 准入结论与上线前一致（warning 不进准入违规集合）；⑥ 全程 change-lint 项目级零写入（运行前后项目根字节快照相等） |

### 追溯与覆盖

- 主链路·越界即报且不改退出码：UT-S35-159、ST-S35-31 步骤①。
- 免计层级表逐类：UT-S35-160（代码级 + test）、UT-S35-161（接口级）、UT-S35-162（需求级）、UT-S35-163（decisions 正交）、UT-S35-164（spec / skills）、UT-S35-165（prd 子目录粒度）。
- `resolveChangeType` 解析与歧义静默：UT-S35-166（zh 剥括号）、UT-S35-167（zh 歧义两通道静默）、UT-S35-168（en 对称）、ST-S35-31 步骤④。
- 有效条目口径：UT-S35-169。
- 零回归锚：UT-S35-170（`proposal_change_type_invalid` 逐字节）、UT-S35-171（违规码集合 + 检查项计数对上线前同形 + 真实违规仍 FAIL）、ST-S35-31 步骤⑤。
- 可归因、零漂移与措辞约束：UT-S35-172、ST-S35-31 步骤②③。
- 需求：`core-01-requirements.md`「S35/S09: 防过度设计的规模信号」验收条件 1–6；场景：S35「变更类型 ↔ delta 层面观测 warning」；来源变更：anti-overdesign-scale-signals。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-159 / UT-S35-171 的通道断言必须分别读取 `violations` 与 `warnings` 两个真实输出字段，不得只断言「码出现在输出中」——通道归属正是本能力的语义本体。
- UT-S35-170 的「逐字节相同」对照必须以本能力上线前实现的诊断输出为基准夹具，不得在测试内复述期望文案。
- UT-S35-171 必须断言 `ChangeLintViolationCode` 的**成员集合**本身，而不仅断言新码不在其中——集合被意外扩充同样是回归。
- UT-S35-171 与 ST-S35-31 步骤⑤ **禁止硬编码检查项数字**（如 `10/10`）：基线取本能力上线前同夹具的实测集合与计数，逐字比对。检查项总数随适用性变化，硬编码会把「某检查项意外失活」伪装成通过。
- ST-S35-31 的③④必须是**两个独立夹具**，④ 的 delta 必须含 `deltas/prd/1-product-requirements/`。复用③的「只有 test」夹具会使④恒绿——test 对所有声明类型均免计，错误解析也检不出来；④的全部鉴别力来自「该层对设计级与代码级都不免计」。
- **自触发是预期行为**：本提案自身（声明设计级、含 `prd/1-product-requirements` delta）会命中该 warning，UT-S35-165 的对应臂即该形态的锁。后续不得为消除本仓自身的告警而收窄免计层级表——收窄与否由观测期数据决定。
