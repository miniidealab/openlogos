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

## S35 non-Markdown 类别集合单点与 fix_hint 协议派生测试

> 覆盖 change-lint 准入侧的两项收敛：① L4 的 non-Markdown 判定**枚举口径**与 merge 合成侧共用具名常量 `NON_MARKDOWN_CATEGORIES`；② `non_markdown_delta_invalid` 的 `fix_hint` 由 `NON_MD_MARKER` 协议常量派生。场景：S35「non-Markdown 类别集合单点与 fix_hint 协议派生」。夹具用一次性隔离项目构造提案与 delta，不依赖本仓自身的提案内容。测试实现必须写入 OpenLogos reporter。
>
> **断言纪律**：UT-S35-175 的 `fix_hint` 断言**必须从协议常量生成期望值**（如由 `NON_MD_MARKER` 的源串派生），**不得在测试里再抄一份文案**——在测试内复述文案会让该测试自身成为第三份副本，正是本变更要消除的形态。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-173 | L4 对 `deltas/scenario/*.json` **进入判定**（事故漏扫形态的锁） | 隔离项目；`deltas/` 下同时含 `scenario/core-auth.json`、`api/core-api.yaml`、`database/core.sql` 与若干 `.md`，其中编排 JSON 为**无 marker 的裸 JSON** | 求 `runChangeLint` 完整结论与退出码 | `violations` 含 `non_markdown_delta_invalid` 且 `path` 点名该编排 JSON；exit 2。**回归对照**：上线前同夹具 L4 只扫 `.md`、该文件零检查且整体 `PASS`——本用例即该漏检的锁。并断言 L4 实际进入判定的 delta 集合与 L6 的 `mergeable + valid` 集合在**非 `.md` 部分上不再有差集**（事故现场差集恰为 3 个） |
| UT-S35-174 | 零回归锚：检查项标识集合、总数与违规码注册表对上线前逐字同形 | **三组均为「行为不受本次修改影响」的回归夹具**：① 仅含**合法** marker 的编排 JSON delta 的提案（上线前不被 L4 检查而通过、上线后被检查且合法，故结论不变）；② 含一处与本次无关的真实违规的提案（如某 `.md` delta 缺段标记）；③ 无 delta 的纯代码提案 | ①②③ 分别取 `change-lint --format json` 输出、检查项标识集合与总数、各检查项的 `violations` 计数、`data.pass` 与退出码 | **对全部夹具恒不变的三项**：`ChangeLintViolationCode` 闭合枚举的**成员集合本身**（本次不新增违规码）、适用检查项的**标识集合**、检查项**总数**；**通过数的不变断言只适用于本用例这类行为不受影响的夹具**——三组的通过数与上线前同夹具逐字相同。**禁止硬编码 `10/10`**——总数随适用性变化，硬编码会把「某检查项意外失活」伪装成通过；基线取上线前同夹具实测值。预期行为改变的输入（裸 JSON、非法 RENAMED）**不进本用例**，其断言见 ST-S35-32 / ST-S35-33 |
| UT-S35-175 | `fix_hint` 与 `NON_MD_MARKER` 派生结果逐字相等 | 任一不合法的非 `.md` delta（参数化 CREATE / MODIFY 两种 mode） | 取该违规的 `fix_hint`，与**由协议常量生成**的期望串比对 | 两者逐字相等；期望串含正确的井号数（`##`）、破折号（`—`）与后缀（`（新文件，整文件）` / `（整文件替换）`）。**回归对照**：上线前文案为 `# ADDED\|MODIFIED <canonical target 路径>`，在这三处均不符——本用例即该漂移的锁。断言方式须为「从协议常量生成期望值」，测试内复述文案即判本用例无效 |
| UT-S35-176 | 类别集合单点：两侧同源且无第二份字面量 | 无（元测试，对实现源码与两侧行为同时求值） | ① 对同一批 canonical target 参数化求 L4 的「是否进入 non-Markdown 判定」与 merge 的「是否走整文件通道」；② 对实现施加注入式反证——**单独**修改集合常量的成员 | ① 两侧结论对每个 target **逐项一致**（含 `orchestration` 与四类 Markdown 类别）；② 修改常量后**两侧同时**改变结论——若任一侧不随之改变，说明该侧仍持有第二份判据，本用例必须变红。这是「只共享最后那次比较、各自决定进入比较的集合」这一已禁形态的结构性锁 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-32 | 真实 CLI 端到端：准入先于合成，且门禁结论零漂移 | 真实 `openlogos change-lint`，一次性隔离 launched 项目。① 构造含**裸 JSON** 编排 delta 的提案：`--format json` exit 2、`violations` 含 `non_markdown_delta_invalid` 并点名该文件（上线前同夹具为 `PASS`，本臂即事故回归锁）；② 照 `fix_hint` **逐字**补上 marker 后重跑：PASS、exit 0——证明 fix_hint 可直接据以修复，无需去读判据实现；③ 门禁口径不变、通过数按分支断言：①② 的**检查项标识集合与总数**均与上线前同夹具逐字相同（不硬编码 `10/10`），且违规码注册表不变；**通过数按分支各自断言**——① 是**预期新增拒绝**的输入，须断言 `L4` 这一检查项的 `violations > 0`、`data.pass=false`、exit 2、**通过数恰少于总数**（不得要求与上线前全绿的通过数相等，那在新增拒绝后不可满足）；② 是修复后的合法输入，须断言**全部检查项 `violations` 为 0**、通过数等于总数、exit 0；④ 对 `api` / `database` 两类既有 delta 的结论与上线前逐字相同；⑤ 全程 change-lint 项目级零写入（运行前后项目根字节快照相等） |

### 追溯与覆盖

- L4 枚举口径与 merge 同源、事故漏扫形态被拦：UT-S35-173、UT-S35-176、ST-S35-32 步骤①。
- 零回归锚（检查项计数与违规码集合）：UT-S35-174、ST-S35-32 步骤③④。
- `fix_hint` 由协议常量派生且逐字一致：UT-S35-175、ST-S35-32 步骤②。
- 场景：S35「non-Markdown 类别集合单点与 fix_hint 协议派生」；S39「non-Markdown 整文件协议的适用类别与派生结论」（集合定义归属）；来源变更：fix-orchestration-merge-and-predicate-duplication。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-175 **禁止在测试内复述 fix_hint 文案**：期望值必须由 `NON_MD_MARKER` 或其源串派生。复述即构成第三份副本，本变更的目的随之落空。
- UT-S35-174 与 ST-S35-32 步骤③ **禁止硬编码检查项数字**；基线取本次上线前同夹具的实测标识集合与总数，逐字比对。
- **「零回归」的边界（本族统一口径，不得越界）**：对**全部**夹具恒不变的只有三项——适用检查项的**标识集合**、检查项**总数**、`ChangeLintViolationCode` **注册表**。**通过数不是不变量**：本次是一次有意的新增拒绝，凡预期行为改变的输入（裸 JSON 编排 delta、非法 RENAMED 块），其所属检查项必然从零违规变为有违规，通过数必然下降；要求它与上线前全绿的通过数相等是**不可满足的断言**，只能靠继续漏检或改写统计语义来「满足」，两者都违反本提案目标。故通过数的「与上线前相同」断言**只许**用于行为不受本次修改影响的回归夹具；预期改变的输入改为断言「新增违规所属检查项失败 + `data.pass=false` + exit 2 + 通过数少于总数」，修复输入后再断言全部检查项通过。
- UT-S35-176 的注入式反证臂必须证明**单独**改动常量会让两侧**同时**变化；只断言「两侧当前一致」不算覆盖——一致可能来自两份同步的字面量，而那正是本次 bug 的成因形态。
- ST-S35-32 步骤② 必须**逐字**采用 `fix_hint` 给出的 marker 形态构造修复后的 delta，不得手工写一个「正确但与 fix_hint 不同」的形态——本臂检验的正是 fix_hint 的可用性。

## S35 锚折算、RENAMED 映射与标题扫描三处收敛测试

> 覆盖三处已分叉重复实现的收敛：锚文本折算单点、`RENAMED` 反向映射单点与非法块统一拒绝（C04）、Markdown 标题扫描单点与**文本视图分离**（C05，经 proposal-r1 F2 修订）。场景：S35「锚折算、RENAMED 映射与标题扫描的三处收敛」。测试实现必须写入 OpenLogos reporter。
>
> **断言纪律**：UT-S35-180 是本族的**安全锚**——它断言「辖属标题不同的场景表行不得坍缩为同一表身份」。若实现把 L8 的表身份改取规范化文本，该用例必须变红；**不得**以「两侧一致」为由放宽它。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-177 | 锚折算单点：lint 与 merge 对同一输入结论逐项一致 | 参数化锚串：多级路径（`父 > 子`）、带序数后缀（`标题 [2]`）、含空白变体、无折算命中 | 对两侧折算入口求值；并施加注入式反证——单独修改共享实现 | 两侧对每个输入**逐字相同**（序数后缀保留、不参与折算）；修改共享实现后**两侧同时**改变——若任一侧不变则仍持有副本，本用例变红 |
| UT-S35-178 | 非法 RENAMED 块统一为拒绝，且预检先报 | 参数化非法块：正文多行、正文为空、正文以 `#` 开头；每种各配一个后续块以其新标题为锚 | ① 求 `runChangeLint` 结论；② 求 merge 合成结论 | ① **lint 即拒绝**并点名该块锚与具体违反项（上线前为 `continue` 静默跳过——本用例即该放行的锁）；② merge 同样拒绝，两侧结论一致；③ 断言该形态**改前改后均不可合并**（上线前 merge 亦拒），即本次只改报错时机、不改可合并集合 |
| UT-S35-179 | 标题扫描单点且双视图同时可得 | 文档含：普通标题、含行内代码的标题（「### 业务 `正式`」）、围栏内的伪标题、缩进代码块内的伪 `#` 行、HTML 注释内的 `#` 行 | 求共享扫描结果 | 扫描**只执行一次**即同时产出 `rawText` 与 `normalizedText`；掩码行不入标题集合（围栏/缩进/注释内的 `#` 均不构成标题）；`rawText` 保留行内代码原文、`normalizedText` 为 `stripInlineCode` 结果；两个视图的行号与层级一一对应 |
| UT-S35-180 | **安全锚**：辖属标题不同的场景表行不得坍缩身份 | 基线：标题「### 业务 `正式`」下有一张场景表，数据行首列为 S01、第二列为「登录」；delta：未声明删除、未 `RENAMED`，仅把该行移到标题「### 业务 `历史`」下 | 求 `evaluateDeltaConservation` | 返回 `delta_implicit_id_removal` 并点名 **S01** 与原始表身份「业务 `正式`」。**注入式反证臂**：把 L8 辖属路径身份改取 `normalizedText`，两个辖属路径坍缩为「业务」、结论变为空集——该臂必须让本用例变红。本用例即 C05 修订后的验收条件① |
| UT-S35-181 | 锚定位消费规范化文本且与 merge 侧逐字一致 | 文档标题含行内代码；delta 以该标题为锚（分别写作含行内代码的原文与剥离后的形态） | 对 lint 的锚解析与 merge 的锚解析分别求值 | 两侧对每个输入结论**逐字相同**（命中 / 不可解析 / 多命中）；不再出现「lint 判不可解析而 merge 成功」的组合。上线前 lint 取原始文本、merge 取规范化文本，本用例即该分叉的锁 |
| UT-S35-182 | 标题保真仍取 `rawHeading`；决策章节判定视图显式选定 | ① 标题保真检查的既有夹具（含行内代码的标题）；② 决策章节判定的夹具（`change-lint` 决策小节，标题含与不含行内代码各一） | ① 求保真检查结论并与上线前逐字比对；② 求决策章节判定结论 | ① 保真检查取 `rawHeading`、**未**与规范化管道合流，结论与上线前**逐字相同**；② 决策章节判定所取视图在实现中**显式选定**（对视图取用点设哨兵断言取的是哪一个），且含行内代码的标题下结论符合该选定；未显式选定即视为未完成收敛，本用例变红 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-33 | 真实 CLI 端到端：三处收敛后预检与合成结论一致、守恒强度不降 | 真实 CLI，一次性隔离 launched 项目。① 非法 RENAMED 块提案（**独立隔离夹具，起始无 `SPEC_MERGED`**）：`openlogos change-lint` exit 2 并点名该块；随后真实 `openlogos merge` 亦**非零退出**，且结束后**仍无 `SPEC_MERGED`**、相关 canonical target 保持**合并前字节**——两侧一致，且 merge 不是该形态的首次暴露信号；② 合法 `RENAMED` + 后续块以新标题为锚的提案（**独立夹具，不复用①**）：change-lint PASS、真实 `openlogos merge` 进程退出码 0 并写出对应本次成功合并的 `SPEC_MERGED`，合并后标题与正文符合预期（既有规范写法不被误拒）；③ UT-S35-180 的守恒反例在真实 `change-lint` 下仍判 `delta_implicit_id_removal` 并点名 S01；④ 标题含行内代码的锚在 change-lint 与 merge 下解析结论一致；⑤ 门禁口径不变、通过数按分支断言：①～④ 各自的**检查项标识集合与总数**与上线前同夹具逐字相同（不硬编码 `10/10`），违规码注册表不变；**通过数按分支各自断言**——① 与 ③ 是**预期新增/保持拒绝**的输入，须断言对应检查项（① 为 L4、③ 为 L8）`violations > 0`、`data.pass=false`、exit 2、通过数恰少于总数；② 与 ④ 是行为不受影响或合法的输入，须断言通过数与上线前同夹具逐字相同；⑥ 全程 change-lint 项目级零写入 |

### 追溯与覆盖

- 锚折算单点（C03 第一处）：UT-S35-177。
- RENAMED 映射单点与非法块统一拒绝（C04）：UT-S35-178、ST-S35-33 步骤①②。
- 标题扫描单点与双视图（C05 收敛部分）：UT-S35-179。
- 辖属身份无损、守恒强度不降（C05 验收条件①，proposal-r1 F2）：UT-S35-180、ST-S35-33 步骤③。
- 锚定位与 merge 侧逐字一致（C05 验收条件②）：UT-S35-181、ST-S35-33 步骤④。
- 标题保真仍取 `rawHeading`、决策章节视图显式选定（C05 验收条件③④）：UT-S35-182。
- 门禁零漂移：ST-S35-33 步骤⑤。
- 场景：S35「锚折算、RENAMED 映射与标题扫描的三处收敛」；决策：C03 / C04 / C05；来源变更：fix-orchestration-merge-and-predicate-duplication。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-177 / UT-S35-176 族的**注入式反证臂是必需项**：只断言「两侧当前一致」不足以证明单点——两份同步的字面量同样一致，而那正是本次 bug 的成因形态。
- UT-S35-180 的反证臂必须真实地把辖属身份切到 `normalizedText` 并观察断言变红；**不得**以复述期望的表驱动替代。该用例**不得被放宽**：发现冲突时的修复方向是让身份消费方改回无损文本，而非削弱断言。
- UT-S35-178 必须同时对 `runChangeLint` 与 merge 合成两侧求真实结论，并断言上线前 merge 亦拒该形态——证明可合并集合不变、只改报错时机。
- UT-S35-182 的「逐字相同」对照必须以本次上线前实现的输出为基准夹具，不得在测试内复述期望文案；视图取用点须以哨兵断言，不得只断言最终结论。
- ST-S35-33 步骤①② 必须跑**真实 `openlogos merge` 进程**，不得以库内函数调用替代；**`SPEC_MERGED` 的断言按分支相反，不得合并表述**：
  - **步骤①（失败分支）**：隔离夹具起始**无** `SPEC_MERGED`；真实 merge **非零退出**，结束后**仍无**该标记，且相关 canonical target 保持**合并前字节**。merge 在准入存在违规时即拒绝并明示未写 `SPEC_MERGED`、counter 与 index，失败分支不存在合法理由产生成功标记；若测试借用先前成功夹具的残留标记，断言验证的是旧状态，无法证明本次失败的事务边界。
  - **步骤②（成功分支）**：**独立的合法夹具**（不复用①的夹具）跑真实 merge，**退出码为 0**，生成对应本次成功合并的 `SPEC_MERGED`，并核对合并后目标的标题与正文。
- 步骤⑤ 禁止硬编码检查项数字，且须遵守上条「零回归的边界」——通过数按分支断言。

## S35 ADDED 锚合成后唯一性 L4 前移测试

> 覆盖 `ADDED` 块「锚在合成后文档中唯一命中」这一判据由 merge 合成阶段前移到 change-lint L4 后的完整承诺：判据内容、**报错时机**、与 merge 侧同源、与 L8 守恒的边界，以及检查项与违规码集合的零改动。场景：S35「ADDED 锚合成后唯一性的 L4 前移」。测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
>
> **断言纪律（三条，均针对本族既有教训）**：
> ① 前移承诺的本体是**时机**而非结论：必须分别读 `runChangeLint` 的 `violations` 与退出码，断言错误**出现在 lint 阶段**；仅断言「最终不可合并」不算覆盖——事故形态正是 lint 全绿、merge 才炸。
> ② 同源要求必须以**调用同一导出函数**来断言；「两侧当前结论一致」不足以证明单点——两份同步的字面量同样一致，那正是本族上一次 bug 的成因形态。
> ③ 回归基线取上线前同夹具的**实测**标识集合与总数，**禁止硬编码 `10/10`**。
> ④ **通道与阶段两道边界必须各有专门用例**：本判据依赖「合并前」的 before 事实，又与本刀新增的 Markdown 整文件封装共用 `.md` 后缀与 `## ADDED` 首行；两者任一没有锁，合法输入会被误判、或已完成的合并会被倒挂成失败。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-183 | `ADDED` body 重复写与锚同名标题 → L4 判违规，**且错误在 change-lint 阶段报出** | 隔离项目；已存在的 `.md` 目标；delta 含 `## ADDED — <锚>`，body 首行又写了一遍同名标题（20260921 runlogos S81 事故原形态） | ① 跑 `runChangeLint` 取完整结论；② 再跑 merge 合成 | ① `violations` 含 `delta_section_anchor_unresolvable`，`path` 点名该 delta，`fix_hint` 指出「`ADDED` 的 body 不含章节标题本身，标题由锚发射」，exit 2——**该断言是本用例的本体**；② merge 亦拒同一形态，但其失败**不得**是该形态的首次暴露信号。回归对照：上线前同夹具 lint 判 PASS 而 merge 必炸，本用例即该漏检的锁 |
| UT-S35-184 | 合法 `ADDED`（body 不含同名标题）→ 通过，合成结果逐字不变 | 同上，但 body 不含与锚同名的标题 | 跑 `runChangeLint` 与 merge 合成 | lint 无新增违规、exit 0；合成输出与**上线前同夹具实测结果逐字相同**（以上线前输出为基准夹具，不得在测试内复述期望文案）——合法输入零行为变更 |
| UT-S35-185 | 锚在**合并前**文档已存在 → 由既有判据覆盖，本判据不重复报 | 已存在的 `.md` 目标，其中已有与 delta `ADDED` 锚同名的章节 | 跑 `runChangeLint` | 该形态仍被拒（既有判据），但**同一事实只报一次**——断言违规列表中不出现同形态双报条目；断言方式须点名违规的 `code` 与 `path` 组合的**出现次数为 1** |
| UT-S35-186 | 唯一性判定与 merge 侧**共用具名实现** | 一批输入，含合法 `ADDED`、body 重复标题、锚合并前已存在、`ADDED` 与 `RENAMED` 组合四类形态 | 分别取 lint 侧判定与 merge 侧 `verifyAgentMaterialOutcome` 的 `ADDED` 分支结论 | 两侧结论**逐一相同**；断言方式须为「**调用同一导出函数**」——在测试内另写一份期望逻辑、或仅断言「两侧当前一致」，均不算覆盖。附**注入式反证臂**：令该具名实现返回相反结论，断言 lint 与 merge 两侧**同时**翻转；若只翻转一侧，说明存在第二份实现，本臂必须变红 |
| UT-S35-187 | 回归锚：L4 检查项计数与违规码集合零改动，L8 守恒语义不动 | 上线前同夹具全集 | ① 取 `runChangeLint` 的检查项**标识集合与总数**；② 取 `ChangeLintViolationCode` 成员集合；③ 对含 `ADDED` / `RENAMED` 块的 delta 求 `evaluateDeltaConservation` | ①② 与上线前**逐字相同**（**禁止硬编码 `10/10`**，基线取实测；断言集合本身，集合被意外扩充同样是回归）；③ `ADDED` 与 `RENAMED` 仍被排除在守恒物质块之外，守恒结论与上线前逐字相同——本刀不新增违规码、不改守恒强度 |
| UT-S35-188 | 通道排除：整文件封装**不进入**本判据 | 三类输入：① 合法 Markdown 整文件 CREATE delta（`.md` 目标，首行 `## ADDED — <canonical target>（新文件，整文件）`，payload 首行为 H1）；② API/DB/编排的 non-Markdown 整文件 delta；③ 普通章节 `ADDED` delta | 跑真实 `runChangeLint`，并对本判据的具名实现设**调用哨兵** | ①② 的哨兵断言本判据**未被调用**，且 L4 **无违规、exit 0**；③ 正常进入本判据。**①是 F1 缺口的锁**：现行 `parseDeltaBlocks` 会把该首行解析成 anchor 等于「路径 + 后缀」的 `ADDED` 块，若扫描范围按 `.md` 或语义类别补集划定而不消费共享三值分流结果，该合法新建 delta 会被判「ADDED 章节没有形成唯一新增结果」，新建能力当场被 L4 掐断。断言须取**共享分流结果为 `section`** 这一条件本身，不得以后缀或类别替代 |
| UT-S35-189 | 阶段边界：`SPEC_MERGED` 之后**不重放**本判据 | 隔离项目；已存在 `# 文档` 的 `.md` 目标；delta 为 `## ADDED — 新节` + 正文（合法形态） | ① merge 前跑 `runChangeLint`；② 跑真实 merge；③ **merge 后在同一夹具重跑** `runChangeLint`；④ 对本判据的具名实现设调用哨兵 | ① 通过；② 退出码 0 并写出 `SPEC_MERGED`；③ **仍然通过、exit 0**，且运行前后项目根字节快照相等（**零写入**）；④ ③ 中哨兵断言本判据**未被调用**。**若实现把合并后的当前文件当作 before 重跑，`before.status` 必然不是 `not_found`，判定返回「ADDED 章节没有形成唯一新增结果」，一次成功合并被倒挂成失败——本用例即该回放的锁**。阶段判别须取既有 spec-complete 完成标记（含 legacy 形态），**不得**以「章节是否已存在」推断阶段 |

### 场景测试

| ID | 场景 | 前置条件 | 操作序列 | 关键断言 |
|---|---|---|---|---|
| ST-S35-34 | 真实 CLI 下证明前移承诺：事故形态在 lint 阶段即被拦 | 真实 CLI；一次性隔离 launched 夹具项目；提案含一份 `ADDED` body 重复同名标题的 `.md` delta | ① 跑 `openlogos change-lint --format json`；② 在**同一失败夹具**上跑真实 `openlogos merge <slug>`；③ 改为合法 `ADDED` 后在**独立合法夹具**上重跑 ①②；④ 读回合并后目标；⑤ **在③的成功夹具上 merge 之后重跑真实 `openlogos change-lint`** | ① exit 2、`violations` 点名该 delta 的锚，所属检查项 `violations > 0`、`data.pass=false`、**通过数恰少于总数**——上线前同夹具为 `PASS`，本臂即事故形态的回归锁；**②（失败分支）**：起始无 `SPEC_MERGED`，真实 merge 非零退出，结束后**仍无**该标记，目标保持**合并前字节**；**③（成功分支，独立夹具）**：lint PASS、exit 0 且检查项**标识集合与总数**与上线前逐字相同（**禁止硬编码 `10/10`**），真实 merge 退出码 0 并生成对应本次合并的 `SPEC_MERGED`；④ 合并后目标含且仅含一处该标题；⑤ **阶段边界闭环**：post-merge 的 `change-lint` **通过、exit 0**，运行前后夹具与本仓项目根字节快照均不变（**零写入**）——原 `ADDED` delta 仍在场，但本判据不得以合并后的当前文件充当 before 而把已完成的合并倒挂成失败 |

### 追溯与覆盖

- 判据内容与**报错时机前移**（lint 阶段而非合成阶段）：UT-S35-183、ST-S35-34 步骤①。
- 合法输入零行为变更：UT-S35-184、ST-S35-34 步骤③。
- 与既有判据的分工、同形态不双报：UT-S35-185。
- 与 merge 侧共用具名实现（含注入式反证臂）：UT-S35-186。
- 检查项计数、违规码集合与 L8 守恒语义零改动：UT-S35-187、ST-S35-34 步骤③。
- 失败分支事务边界（非零退出、不写 `SPEC_MERGED`、目标字节不变）：ST-S35-34 步骤②。
- 通道排除·整文件封装（含本刀新增的 Markdown 整文件）不进入本判据：UT-S35-188。
- 阶段边界·`SPEC_MERGED` 后不重放、post-merge 重跑 lint 通过且零写入：UT-S35-189、ST-S35-34 步骤⑤。
- 场景：S35「ADDED 锚合成后唯一性的 L4 前移」；实证：20260921 runlogos `add-workbuddy-agent-type` 199 次 merge 全失败；来源变更：add-markdown-create-whole-file-protocol。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-183 必须分别读取 `runChangeLint` 的 `violations` 与退出码两个真实输出，断言错误**出现在准入阶段**；仅断言「最终不可合并」不算覆盖。
- UT-S35-186 的**注入式反证臂是必需项**：只断言「两侧当前一致」不足以证明单点——两份同步的实现同样一致，而那正是本族上一次 bug 的成因形态。
- UT-S35-184、UT-S35-187 的「逐字相同」对照必须以本次上线前实现的输出为基准夹具，不得在测试内复述期望文案。
- UT-S35-188 必须设**调用哨兵**断言本判据未被调用；仅断言「L4 通过」不算覆盖——按 `.md` 扫描但判定恰好通过的实现同样能满足那个弱断言。该用例的修复方向是**按通道排除**，**不得**通过给整文件 payload 补一个与控制行同名的标题来迎合章节检查（那正是残渣文档的成因）。
- UT-S35-189 与 ST-S35-34 步骤⑤ 的 post-merge 重跑必须用真实 CLI，并断言运行前后项目根字节快照不变；阶段判别取既有 spec-complete 完成标记，测试内**不得**自行以目标内容推断阶段。
- ST-S35-34 必须跑**真实 `openlogos merge` 进程**，不得以库内函数调用替代；**`SPEC_MERGED` 的断言按分支相反，不得合并表述**：
  - **步骤②（失败分支）**：隔离夹具起始**无** `SPEC_MERGED`；真实 merge **非零退出**，结束后**仍无**该标记，相关 canonical target 保持**合并前字节**。失败分支不存在合法理由产生成功标记；复用先前成功夹具的残留标记只会验证旧状态。
  - **步骤③（成功分支）**：**独立的合法夹具**（不复用①②的夹具）跑真实 merge，退出码为 0 并生成对应本次成功合并的 `SPEC_MERGED`。
- **「零回归」的边界（本族统一口径）**：对全部夹具恒不变的只有适用检查项的**标识集合**、检查项**总数**与违规码**注册表**；**通过数不是不变量**——本刀对 `ADDED` body 重复标题是一次有意的新增拒绝，其所属检查项必然由零违规转为有违规、通过数必然下降。通过数的「与上线前相同」断言只许用于行为不受本次修改影响的回归夹具（UT-S35-184、UT-S35-187、ST-S35-34 步骤③）。
- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。

## S35 违规层归属单点与人类可读输出逐条可归因测试

> 覆盖「违规的层归属恰有一处来源」「人类可读输出逐条可归因」「计数与可打印集合不一致时 fail-loud」三条契约，以及 `--format json`、检查项计数、违规码集合、exit code 与文案的零回归。场景：S35「违规层归属单点与人类可读输出的逐条可归因」。测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
>
> **断言纪律（四条，均针对本次缺陷的成因）**：
> ① **断言对象必须是命令实际打印的文本**（捕获 stdout）。现有 2270 个用例全绿却漏掉本缺陷，正是因为它们只断言 `runChangeLint` 返回的 `violations` 数组——内容一直是对的，丢的是呈现。只验 API 返回值的用例在本族等同于没写。
> ② **跨层共存必须专门立用例**：同一 code 现已横跨 L4 与 L8，这正是反推映射失效的输入；只测单层会让「碰巧对得上」的实现继续通过。
> ③ **fail-loud 必须以受控注入触发**：静默跳过不报错、不影响 exit code，无法从正常输入观察到；不注入就测不到这条契约。
> ④ **零回归基线取本刀实现之前的实测输出**，禁止在测试内硬编码 `10/10` 之类字面量——检查项总数会随后续变更合法变化，硬编码会把回归锚变成噪声源。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-190 | 事故形态直接回归锚：L4 违规在**人类可读输出**中逐条打印 | 隔离项目；夹具**只含一条 L4 违规**——命中「`ADDED` 锚合成后不唯一」（20260921 runlogos `add-workbuddy-agent-type` 原形态），该违规登记在 L4，其 code 亦为 L8 所用但本次输入**在 L8 无违规**（守恒检查排除 `ADDED` 块） | 以默认格式跑 `change-lint` 命令层渲染，**捕获 stdout 全文** | ① stdout 含 `✗ L4` 行，该层下打印该违规的 `code`、`message`、`path`、`fix_hint` **四项俱全**，且**恰打印一次**；② `result.checks` 中 **L8 计数为零**，stdout **保留 `✓ L8`**——L8 无违规时打勾是正确行为，**不得**在 L8 下打印或计入这条 L4 违规；③ `L4` 行**不得**缺席。回归对照：本刀之前同夹具 stdout 中 L4 整行消失、只剩 `FAIL（9/10，1 项违规，1 warning）`——错的是 L4 消失，不是 L8 打勾。**断言对象必须是 stdout 文本**，断言 `violations` 数组不算覆盖。L4 与 L8 同时有违规的输入由 UT-S35-191 独立覆盖 |
| UT-S35-191 | 同一 code 跨层共存：两条 `delta_section_anchor_unresolvable` 分属 L4 与 L8 | 隔离项目；同一次 lint 同时产出登记在 L4 与登记在 L8 的同码违规各至少一条 | 同上，捕获 stdout 全文 | 两条各自打印在**自己登记的层**下：L4 行下恰有那条 L4 违规，L8 行下恰有那条 L8 违规；**不串层、不丢失、不重复打印**；两层的 `✗` 条目数分别等于 `result.checks[].violations` 的对应计数。本用例是「从 code 反推层号」的**结构性反证臂**：任何以 code 为唯一入参的归属实现都无法同时满足两侧 |
| UT-S35-192 | fail-loud：某层计数非零却筛不出可打印违规 → **显式报异常** | 隔离项目；以受控方式注入不一致（令某检查项 `violations > 0` 而该层的可打印违规集合为空） | 跑命令层渲染 | **显式抛出异常**并点名该检查层与其计数；**禁止**静默跳过、禁止以聚合结论代替、禁止打印出「既无 `✓` 也无 `✗`」的空层。回归对照：本刀之前该组合走 else 分支、循环体零次，整行消失且不报错、不影响 exit code，缺陷因此隐蔽存在（C02） |
| UT-S35-193 | 零回归锚：`--format json` 输出**逐字节不变** | 同 UT-S35-190 的失败夹具与一份通过夹具 | 跑 `change-lint --format json`，捕获 stdout | 与**本刀实现之前**同夹具的实测输出**逐字节相同**：`violations` 数组内容、每条的字段集合（不出现层号字段）、排序、warnings 的出现/省略形态全部不变。层号止于命令层的呈现路径，不得漏进对外 JSON 契约（C03）；runlogos driver 的 `parseChangeLintEnvelope` 消费形态因此零影响 |
| UT-S35-194 | 零回归锚：检查项、违规码集合、exit code 与结论文案零改动 | 一组覆盖 PASS 与 FAIL 两类结论的夹具，基线取本刀实现**之前**的实测输出 | ① 取 `runChangeLint` 的检查项**标识集合与总数**；② 取 `ChangeLintViolationCode` 成员集合；③ 取命令退出码；④ 取 stdout 末行文案 | ①②③④ 与基线**逐字相同**（**禁止硬编码 `10/10`**，基线取实测；断言集合本身，集合被意外扩充同样是回归）；`PASS（…）` / `FAIL（…，N 项违规[，M warning]）` 文案形态不变。本刀只改「已判定的结论如何被打印」，判定链不动 |
| UT-S35-195 | 无违规时输出形态不变，且每层至少一行 | 隔离项目；一份全部检查通过的合法提案 | 跑命令层渲染，捕获 stdout | 每个检查项恰打印一行 `✓ L<id> <label>`、末行 `PASS`，与本刀之前**逐字相同**——本刀不新增任何行；并断言 stdout 的检查项行数等于 `result.checks.length`，即「每层至少一行」在通过路径上同样成立 |

### 场景测试

| ID | 场景 | 前置条件 | 操作序列 | 关键断言 |
|---|---|---|---|---|
| ST-S35-35 | 真实 CLI 下证明「看到 FAIL 就能知道错在哪」 | 真实 CLI；一次性隔离 launched 夹具项目；夹具甲含命中 L4 `ADDED` 锚不唯一的 delta，夹具乙为合法提案 | ① 在夹具甲跑真实 `openlogos change-lint --slug <slug>`（默认人类可读格式），捕获 stdout 与退出码；② 在夹具甲跑真实 `openlogos change-lint --slug <slug> --format json`，捕获 stdout；③ 在夹具乙跑 ①②；④ 比对运行前后夹具与本仓项目根字节快照 | ① stdout 含 `✗ L4` 行及该违规的 code / message / path / fix_hint 四项，退出码 2，末行 `FAIL（…）`——**使用者仅凭 stdout 即可定位到具体 delta 与修法**；② JSON 输出与本刀之前同夹具实测**逐字节相同**；③ 夹具乙 stdout 为全 `✓` 行 + `PASS`、退出码 0，形态与本刀之前逐字相同；④ 运行前后字节快照均不变（**零写入**）。本用例必须跑**真实进程**并读其 stdout，不得以库内函数调用与返回值替代——替代即重蹈「只验 API 返回值」的覆辙 |

### 追溯与覆盖

- 契约一·层归属恰有一处来源（禁止从 code 反推）：UT-S35-191、UT-S35-190。
- 契约二·逐条可归因（code / message / path / fix_hint 四要素打印）：UT-S35-190、ST-S35-35 步骤①。
- 契约三·fail-loud（计数非零而可打印集合为空时显式报异常）：UT-S35-192。
- JSON 契约零漂移（层号不进对外输出）：UT-S35-193、ST-S35-35 步骤②。
- 判定链零改动（检查项集合与总数、违规码注册表、exit code、结论文案）：UT-S35-194。
- 每层至少一行 / 无违规形态不变：UT-S35-195、ST-S35-35 步骤③。
- 场景：S35「违规层归属单点与人类可读输出的逐条可归因」；实证：20260921，0.15.12 对 runlogos 提案 `add-workbuddy-agent-type`——判定正确而 L4 整行消失、只剩聚合结论（L8 本次无违规，其 `✓` 行本身正确）；来源变更：fix-lint-violation-check-attribution。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- **UT-S35-190、UT-S35-191、UT-S35-192、UT-S35-195 与 ST-S35-35 的断言对象一律是命令实际打印的文本**（捕获 stdout）。断言 `runChangeLint` 返回的 `violations` 数组**不算覆盖**——本缺陷期间该数组内容始终正确，2270 个现存用例全绿而缺陷仍在，正是这条纪律缺席的后果（C04）。
- UT-S35-191 是**结构性反证臂，必需项**：同一 code 同时登记在 L4 与 L8，任何以 code 为唯一入参的归属实现都无法同时打印正确；只测单层的用例对「碰巧对得上」的实现无鉴别力。
- UT-S35-192 的不一致必须以**受控注入**构造（令某层计数与其可打印集合失配），不得依赖真实输入碰巧触发；断言是**显式异常**，不是「输出里少了一行」。
- UT-S35-193、UT-S35-194、UT-S35-195 的「逐字/逐字节相同」对照必须以**本刀实现之前**的实测输出为基准夹具，**禁止在测试内复述期望文案、禁止硬编码 `10/10` 之类字面量**。
- ST-S35-35 必须跑**真实 `openlogos change-lint` 进程**并读其 stdout；夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。
- 「零回归」的边界（本族统一口径）：本刀对判定链**不作任何有意变更**，故检查项标识集合、总数、违规码注册表、退出码、`PASS` / `FAIL` 文案与 `--format json` 输出**全部为不变量**；唯一允许变化的是人类可读 stdout 中**违规条目的出现与否**——由「整行消失」变为「逐条打印」，这正是本刀的交付内容。

## S35 后态测试 ID 重复判据同源前移测试

> 覆盖后态 `test-change-set-duplicate-id` 全部触发形态（单目标内重复、触及目标间重复）在 change-lint L4 族的同源前移（新码 `delta_test_id_duplicate`：lint 侧对触及 test 目标集合以同一 `composeOpenLogosMarkdown` 求后态、调用同一 `buildTestChangeSet`），以及「凡后态以该码拒的集合、预检必先报」的一致性锁扩展（功能规格 §2.85、§2.84.5；场景 S35「后态测试 ID 重复判据的同源前移」；来源变更 lint-modified-sibling-section-collision）。夹具用一次性隔离项目与合成 delta 构造，不依赖本仓自身的提案内容。**合法下沉反例臂是本组测试的核心**——proposal r1 评审以两个已运行反例证明「标题形态」不能作判据，只验证事故形态必红而不验证这些形态必绿，会把一个行为回归锁进预期。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-196 | 事故形态必红（修复前 PASS） | 合成目标 `logos/resources/test/core-S09-test-cases.md`：五个并列 H2（`S09: … — 测试用例` 导言、`一、单元测试用例`、`二、场景测试用例`、`三、覆盖度校验`、`四、追溯`），ID 表含 `UT-S09-01`～`UT-S09-03` 与 `ST-S09-01`；delta 只有一个 `## MODIFIED — S09: … — 测试用例` 块，正文把整份文档抄一遍（正文内含四个与锚同级的 `##` 标题） | 求 `runChangeLint` 结论 | `delta_test_id_duplicate` 进 `violations`、exit 2、L 层归属为 L4；`path` 为该 **delta 文件**相对路径；`message` 同时含：后态目标路径与重复 ID 的两处后态行号（带「合并后态行号」标注）、重复裸 ID、该 ID 在 delta 内的行号、诊断信号文本「疑似整篇改写吞并兄弟章节「一、单元测试用例」」；`fix_hint` 含「为每个被改写的同级章节各写一个 `## MODIFIED — <章节标题>` 块」。**修复前该形态 change-lint 报 PASS 而 merge 在 `buildTestChangeSet` 抛 `test-change-set-duplicate-id`——本用例即该「预检全绿 / merge 必炸」组合的回归锁** |
| UT-S35-197 | 拆块版本必绿 | 同 UT-S35-196 的目标；delta 改为五个同锚 MODIFIED 块（`## MODIFIED — S09: … — 测试用例`、`## MODIFIED — 一、单元测试用例`……各只携带该章节自己的正文，锚文本与目标标题逐字一致） | 求 `runChangeLint` 结论；并以同一合成器求后态、调用 `buildTestChangeSet` | 零 `delta_test_id_duplicate`；后态 ID 集合 == 前态 ID 集合（逐一比对，不只比数量）；`buildTestChangeSet` 通过——证明 fix_hint 指向的写法足以在本节点自修闭环 |
| UT-S35-198 | 合法下沉反例必绿（前移集合未扩大到后态接受的形态） | 四个独立夹具（各含目标 + delta）：① **跨父链同名**——目标 `## 模块甲 > ### 行为` 与 `## 模块乙 > ### 事件与最终态交互`（后者定义 `UT-S09-01`），delta `## MODIFIED — 模块甲 > 行为` 正文含 `### 事件与最终态交互` 定义 `UT-S09-02`；② **同父链同名不同 ID**——目标 `## 导言` 与 `## 单元测试`（定义 `UT-S09-01`），delta `## MODIFIED — 导言` 正文含 `## 单元测试` 定义 `UT-S09-02`；③ **序数锚下正文重复锚自身根标题**——delta 为 `## MODIFIED — 一、单元测试用例 [1]`，正文首行重复 `## 一、单元测试用例` 后接该节全量表格（ID 不变；既有序数锚使合成后同名 H2/H3 并存时 MODIFIED 身份复验仍唯一）；④ **正文仅含更深子标题**——锚 H2、正文只有 `###` / `####` 小节与原 ID 表 | 对四夹具分别求 `runChangeLint` 结论，并与同夹具合并后态的 `buildTestChangeSet` 结论对照；读回合成后态 | 四者**零** `delta_test_id_duplicate`，且 `composeOpenLogosMarkdown` 合成成功、后态 `buildTestChangeSet` **通过**；① 合成后 `事件与最终态交互` 在 `模块甲 > 行为` 下为 H4、`模块乙` 原 H3 与 `UT-S09-01` 保留；② 合成后 `单元测试` 在 `导言` 下为 H3、原 `## 单元测试` 与 `UT-S09-01` 保留；③ 合成后 `一、单元测试用例` 为 H2 且其下有同名 H3、ID 集合不变。**本用例是 proposal r1 评审两反例的回归锁**：任何以「正文含与锚同级标题且目标范围外存在同名标题」为判据的实现（含补同父链的收窄版）都会在 ①② 上误红 |
| UT-S35-199 | 一致性锁按码整族双向比对（任一侧单独收紧即失败） | 夹具集合覆盖 `test-change-set-duplicate-id` **全部**触发形态——单目标内：整篇吞并兄弟章节（UT-S35-196 形态）、同一目标两个章节各自新增同 ID、新增 ID 与保留章节既有 ID 重复；触及目标间：两个 `deltas/test/` delta 各自新增同 ID、章节 CREATE 目标（新文件 ADDED）与 MODIFY 目标同 ID、**Markdown 整文件 CREATE（首行 `## ADDED — <target>（新文件，整文件）`）的 payload 内两条同 ID 行**、**整文件 CREATE 与章节 MODIFY 跨目标同 ID**；另备各夹具「已修正」版本（拆块 / 改名）；并纳入 UT-S35-198 四个合法下沉夹具与 §2.84.1 三处对齐点反例 | 逐夹具双向比对：一侧喂 `runChangeLint`（delta 形态），一侧以同一合成器求后态后喂 `buildTestChangeSet`（历史兼容开关关闭的正常路径） | 两侧结论逐夹具一致——后态以 `duplicate-id` 拒的夹具预检必报 `delta_test_id_duplicate`（触及目标间形态对涉事 delta **各报一条**；整文件两臂的后态侧按 merge 口径以既有封装校验器剥离 payload 后送入 `buildTestChangeSet`），反之亦然；**已修正版本与合法下沉夹具两侧均通过**（证明前移不是无差别收紧）。**注入式反证臂**：单独把预检侧改为逐目标调用（不按集合）时，触及目标间两夹具必红，证明锁覆盖的是集合口径。**边界断言**：`test-change-set-target-duplicate` / `-overlap` 夹具**不纳入**比对且不因此判红（§2.84.5 仍排除）；`allowDuplicateIds` 等历史基线兼容路径不纳入 |
| UT-S35-200 | 阶段边界、通道闸与不双报 | 四夹具：① UT-S35-196 形态的提案已完成真实合并（`SPEC_MERGED` 在场、目标已为合并后字节、原 delta 仍在场）；② 集合中一个 delta 锚不可解析（`## MODIFIED — 不存在的章节`）、另一个 delta 为 UT-S35-196 形态；③ UT-S35-196 形态且其 ID 表某行少写一个管道符（后态同时 ambiguous-table）；④ 封装合法的 Markdown 整文件 CREATE delta（首行 `## ADDED — <target>（新文件，整文件）`）payload 内含两条同 ID 行；⑤ 封装不合法的整文件 delta（如 target 与 canonical 不一致）payload 内含两条同 ID 行；⑥ 普通锚 `## MODIFIED — 一、单元测试用例` 正文首行重复该根标题（合成器既有复验拒绝的形态） | 对六夹具分别求 `runChangeLint` 结论 | ① **零**该码（不重放，与 ADDED 锚判据、L8 守恒同一完成标记判据；且判别不以「目标是否已含该 ID」推断）；② 锚不可解析的 delta 只报 `delta_section_anchor_unresolvable`，集合中另一 delta 照常报 `delta_test_id_duplicate`（因他因失败的目标不纳入集合、其余目标照判）；③ 只报 `delta_test_table_column_mismatch`、**不报**本码（不双报）；④ **本码必报**——ID 检查集合不按通道排除整文件，payload 经与 merge 同一的封装校验器剥离后送入 `buildTestChangeSet`（修复前整文件通道对内容层 ID 零判据，本用例锁定前移集合与 merge 同口径）；⑤ 只报 `non_markdown_delta_invalid`、**不报**本码（不纳入集合）；⑥ 该目标合成失败（`MODIFIED 章节身份不守恒`）不纳入集合、**不报**本码，且**不得**为此放宽合成器锚唯一性复验（同夹具 `composeOpenLogosMarkdown` 仍抛该错） |
| UT-S35-201 | 诊断信号与判定正交、delta 侧归属精确 | 三夹具：① UT-S35-196 形态（同父链同级同名命中）；② 跨父链同名且新增 ID 恰与目标既有 ID 重复（如 UT-S35-198 ① 把新增 ID 改为 `UT-S09-01`）；③ UT-S35-196 形态但目标兄弟标题被同 delta `## RENAMED` 改名，正文使用新名 | 取各违规的 `message`，并取 `toPublicViolation` 投影后的公开键集合 | ① message 含「疑似整篇改写吞并兄弟章节」与碰撞标题文本；② **违规照报**但 message **不含**该提示（信号未命中不影响判定）；③ 按 RENAMED 折算后文本命中信号；三者 message 中的 delta 侧归属均为该 ID 在 **delta 内的 1 基行号**（从 message 解析，按夹具已知值精确断言，不得只断言「含数字」），ID 在 delta 内多次出现时逐行列出，并同时含「合并后态行号」标注；**公开 violation 键集合恒为 `code` / `path` / `message` / `fix_hint`（+ 可选 `flow_reason`），不得新增 `line` 等字段** |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-36 | 事故端到端复现：整篇改写型 MODIFIED 在 write-delta 节点即闭环 | 真实 CLI，一次性隔离 launched 项目复刻 token-agent 现场（五 H2 测试用例目标 + 单块整篇 MODIFIED delta，其余 delta 与 tasks 全部合法）。① `openlogos change-lint --slug <slug> --format json`：exit 2、`data.pass=false`、`violations` 含 `delta_test_id_duplicate`，其 `path` 指向该 delta 文件、`message` 含该 ID 的 delta 内行号与「合并后态行号」标注、`fix_hint` 含拆块指引，且每条 violation 的键集合与上线前逐字相同（**修复前此步为 PASS——即事故的盲点**）；② 续跑**真实 `openlogos merge <slug>`**：非零退出、stderr 首行为「change-lint 未通过（N 项违规），拒绝 merge」预检出口并逐条打印该违规，结束后**无** `SPEC_MERGED`、目标保持合并前字节（**修复前此步退出于合成期 `Error: merge 失败（test-change-set-duplicate-id）`，即 audit run `drv-muqfnr6p-fola` 的停点**）；③ 按 fix_hint 拆块后重跑 `change-lint`：exit 0、PASS；续跑真实 `openlogos merge`：退出码 0、生成 `SPEC_MERGED`，合并后目标 ID 集合与合并前逐一一致、无重复；④ **合法下沉臂**：另取同构提案，其 delta 为 UT-S35-198 ① 形态（跨父链同名 H3 相对子节、不同 ID），`change-lint` PASS 且真实 `openlogos merge` 成功、合并后该标题为 H4 子节——证明前移未拒合法写法；⑤ 全程 `change-lint` 项目级零写入（运行前后项目根字节快照相等） |

### 追溯与覆盖

- 主修·后态判据同源前移（事故形态旧实现必红）：UT-S35-196、ST-S35-36 步骤①②。
- 主修·fix_hint 写法足以自修闭环：UT-S35-197、ST-S35-36 步骤③。
- 防伪臂·**合法下沉写法零误报**（评审两反例 + 归档旧写法）：UT-S35-198、UT-S35-199 合法夹具、ST-S35-36 步骤④。
- 一致性锁·按码整族（单目标内 / 触及目标间，含注入式反证臂与排除断言）：UT-S35-199。
- 边界·阶段 / 通道闸 / 不双报 / 他因失败不纳入：UT-S35-200。
- 主修·诊断可归因（delta 内行号、诊断信号正交、RENAMED 折算）：UT-S35-201、ST-S35-36 步骤①。
- 功能规格：§2.85.1～§2.85.4、§2.84.5、§2.84.4；场景：S35「后态测试 ID 重复判据的同源前移」；来源变更：lint-modified-sibling-section-collision。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT-S35-198 与 UT-S35-199 的双向比对必须调用两侧**真实实现**（`runChangeLint` 与 `composeOpenLogosMarkdown` + `buildTestChangeSet`），不得以复述期望的表驱动替代；UT-S35-198 必须同时断言「后态确实接受」，证明前移集合的扩大部分**恰为后态已拒形态**、未新拒后态接纳的形态。
- UT-S35-199 的注入式反证臂须证明**单独改为逐目标调用**会让触及目标间夹具变红，证明锁覆盖的是集合口径而非仅单目标扫描。
- UT-S35-201 的行号断言必须对**夹具已知的精确 delta 内行号**比对——可归因正是本变更的语义本体；行号**从 message 文本解析**，不得通过新增公开 JSON 字段满足（`--format json` 字段集合与排序逐字不变，与 §2.85.4 零回归边界一致）。
- UT-S35-199 / UT-S35-200 的整文件臂，后态侧必须按 merge 口径调用既有封装校验器剥离 payload 后再送入 `buildTestChangeSet`，不得以手工拼接的 payload 替代。
- ST-S35-36 步骤②③④ 必须跑**真实 `openlogos merge`** 进程并断言退出码、stderr 出口形态与 `SPEC_MERGED` 在场性，不得以库内函数调用替代。

## S35 后态对目标既有测试欠债的继承口径测试

> 覆盖功能规格 §2.86（原样继承判据：列数不一致行按三元组计次预算、重复 ID 按字节多重集；唯一继承判定由后态构建器与 L4 列数检查共用）、§2.84.2 / §2.84.5 / §2.85.3 的边界订正；场景 S35「后态测试 ID 重复判据的同源前移」异常与边界、不变量 5；来源变更 fix-inherited-test-debt-merge-block（缺陷报告 `runlogos/logos/resources/reference/BUGREPORT-merge-legacy-table-debt-blocks-unrelated-proposal.md`）。
>
> **夹具口径**：一律在一次性隔离项目内构造目标测试规格与 delta，不依赖本仓或宿主仓自身内容。「欠债行」指首格为合法测试 ID、列数与表头不一致的数据行（夹具统一用表头 4 列、该行 5 列）；「欠债表」指含欠债行的测试定义表。**每条用例必须同时断言两侧**：一侧求 `runChangeLint` 结论（delta 形态），一侧以与 merge 同一合成器 `composeOpenLogosMarkdown` 求后态后调用 `buildTestChangeSet`（正常路径，非历史兼容开关）。测试实现必须写入 OpenLogos reporter，`scenario_id="S35"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-202 | 事故形态：目标既有欠债行 + 纯 ADDED 两侧均通过 | 目标 `logos/resources/test/core-S68-test-cases.md` 的场景测试表表头 4 列，`ST-S68-05`、`ST-S68-06` 两行各 5 列（复刻宿主现场）；delta 只有一个 `## ADDED` 块，新增章节内的表格全部合规 | 求两侧结论 | `change-lint` 零 `delta_test_table_column_mismatch`、零 `delta_test_id_duplicate`；`buildTestChangeSet` 不抛错；`changed_test_ids` 恰为 ADDED 块新增的 ID 集合（不含 `ST-S68-05` / `ST-S68-06`）。**修复前该形态 change-lint PASS 而后态抛 `test-change-set-ambiguous-table`——本用例即缺陷报告主问题的回归锁** |
| UT-S35-203 | 目标既有同文件重复 ID + 纯 ADDED 两侧均通过 | 目标含同一 ID `UT-S37-01` 的两条记录（单元格内容不同，复刻宿主 S37 形态）；delta 只有一个合规的 `## ADDED` 块 | 求两侧结论 | 零 `delta_test_id_duplicate`；`buildTestChangeSet` 不抛错；`UT-S37-01` 不进 `changed_test_ids`、不进 `removed_test_ids`。**修复前 change-lint 报 `delta_test_id_duplicate`（message 写「重复来自目标既有内容或另一 delta」）而 fix_hint 只指向 delta 写错——本用例锁定该误报消失** |
| UT-S35-204 | 本提案新增的列数不一致行两侧均拒绝 | 目标无欠债；delta `## ADDED` 块的表格中一行列数比表头多 1 | 求两侧结论 | `change-lint` 报 `delta_test_table_column_mismatch`，message 中 delta 内行号、表头列数、本行列数与修复前逐字一致；后态抛 `test-change-set-ambiguous-table`。另备「目标含无关欠债行」变体：结论相同（宽容不外溢到新增行） |
| UT-S35-205 | 本提案新增 ID 与目标既有 ID 重复两侧均拒绝 | 目标含 `UT-S68-01`（单条、合规）；delta `## ADDED` 块新增一行同为 `UT-S68-01`；另备变体：目标本就含 `UT-S37-01` 两条，delta 再新增第三条 `UT-S37-01` | 求两侧结论 | 两夹具均报 `delta_test_id_duplicate`、后态均抛 `test-change-set-duplicate-id`（变体中后态记录多一条，多重集不等） |
| UT-S35-206 | 改动欠债行本身两侧均拒绝 | 目标欠债表含欠债行 `ST-S68-05`；delta `## MODIFIED` 整节替换该章节，把 `ST-S68-05` 的某个单元格文字改动（列数仍不一致） | 求两侧结论 | `change-lint` 报 `delta_test_table_column_mismatch` 且行号指向 delta 内该行；后态抛 `test-change-set-ambiguous-table`（新三元组前态预算为零） |
| UT-S35-207 | 同表 MODIFIED 只改合法行、原样携带欠债行两侧均通过（评审 F1 夹具） | 目标某章节表头 3 列：`UT-S01-01` 一行 4 列（欠债），`UT-S01-02` 一行 3 列、描述为「旧描述」；delta `## MODIFIED` 整节替换该章节，只把 `UT-S01-02` 的描述改为「新描述」，`UT-S01-01` 逐字节原样携带 | 求两侧结论 | `change-lint` **零** `delta_test_table_column_mismatch`（修复前此处必报——即 F1 反例）；后态不抛；`changed_test_ids` 恰为 `UT-S01-02`，不含 `UT-S01-01`。断言过滤由共享继承判定完成：把 L4 侧替换为不接入继承判定的旧实现时本用例必红 |
| UT-S35-208 | 新增同字节副本不得复用既有豁免（评审 F2 夹具） | 目标欠债表含 1 条欠债行 r；delta `## MODIFIED` 整节替换该章节，保留 r 并在同表再追加一条与 r 逐字节相同的行 | 求两侧结论 | 两侧均拒绝：`change-lint` 报 `delta_test_table_column_mismatch`（该键全部按本提案引入，两条行号均列出或逐行各报，不臆断哪条是新增）；后态抛 `test-change-set-ambiguous-table`。另备「副本追加到同目标另一张同表头表」变体：结论相同（计次键不含位置） |
| UT-S35-209 | 前态多份相同欠债：数量不变与减少两侧均通过 | 目标欠债表含 2 条逐字节相同的欠债行 r；两个 delta 变体：① `## MODIFIED` 整节替换、r 仍为 2 条，同时改动同表一条合法行；② `## MODIFIED` 整节替换、删去一条 r（保留 1 条） | 对两变体分别求两侧结论 | 两变体均零 `delta_test_table_column_mismatch`、后态不抛；变体 ② 证明计次规则为「后态次数 ≤ 前态次数」而非「必须相等」（允许欠债减少） |
| UT-S35-210 | 既有重复 ID 中一条被改动两侧均拒绝 | 目标含 `UT-S37-01` 两条记录 a、b；delta `## MODIFIED` 整节替换所在章节，a 原样、b 的一个单元格被改动 | 求两侧结论 | 报 `delta_test_id_duplicate`；后态抛 `test-change-set-duplicate-id`（后态多重集 {a, b'} 与前态 {a, b} 不等）。对照臂：a、b 均原样携带时两侧均通过 |
| UT-S35-211 | 跨目标重复 ID 按多重集判定 | 两个目标 T1、T2 各含一条 `UT-S70-01`（前态即跨目标重复）；四个 delta 变体：① 只给 T1 写合规纯 ADDED；② 给 T1、T2 各写合规纯 ADDED；③ 在 ② 的双目标 delta 基础上，保留 T1 的合规 ADDED，同时以 `## MODIFIED` 改动 T2 中 `UT-S70-01` 的一个单元格（两目标均被实际触及）；④ **只**给 T2 写 `## MODIFIED` 改动其 `UT-S70-01` 的一个单元格（T1 未触及，不在本次目标集合） | 对四变体分别求两侧结论（目标集合按 merge 口径收集：只含本次 delta 触及的目标） | ①② 两侧均通过、`UT-S70-01` 不进 `changed_test_ids`；③ 两侧均拒绝（`delta_test_id_duplicate` / `test-change-set-duplicate-id`：前态 {T1 记录, T2 记录} 与后态 {T1 记录, T2 改动后记录} 多重集不等）；④ **放行对照臂**——两侧均通过、`UT-S70-01` 进 `changed_test_ids`（目标集合内前后态各只有一条记录，属合法修改），并断言 T1 未被读取或送入 `buildTestChangeSet`，防止实现扫描未触及的目标。断言前态记录只取本次目标集合内目标的合并前字节 |
| UT-S35-212 | 一致性锁新边界双向比对（任一侧单独收紧或放宽即失败） | 夹具集合 = UT-S35-202～UT-S35-211 全部夹具与变体；另备残差臂夹具：表头重复的既有表（目标某表表头两列同名）+ 纯 ADDED | 逐夹具双向比对：一侧 `runChangeLint`，一侧同一合成器 + `buildTestChangeSet` | 夹具集合内两侧结论逐夹具一致（§2.84.5 锁在新边界上成立）。**残差臂单列、不纳入比对**（§2.86.1 已知残差）：表头重复夹具后态仍抛 `test-change-set-ambiguous-table`（表头形态不在宽容范围），预检侧结论如实记录为通过——本臂锁定「宽容未外溢到表头形态」，并在残差被另案修复时随之翻转。**注入式反证臂**：① 把后态侧的继承判定改为「存在匹配」（不计次）时 UT-S35-208 必红；② 把 L4 侧改为不接入继承判定时 UT-S35-207 必红——证明两侧共用同一判定、计次规则在位 |
| UT-S35-213 | 原样继承场景下变更集结论与无欠债基线一致 | 两组对照夹具：A 组目标含欠债（欠债行与重复 ID 各若干），B 组为 A 组目标去掉全部欠债记录后的同构文件；两组施加同一个合规 delta（含 ADDED、MODIFIED 改合法行、删除一条合法 ID） | 分别求 `buildTestChangeSet`，取 `changed_test_ids` / `removed_test_ids` | 两组的 `changed_test_ids` 与 `removed_test_ids` 逐项相等（欠债 ID 不出现在任何一组的集合里）；`SPEC_MERGED.test_change_set` 字段集合与 schema 不变。修正臂：delta 把一条欠债行改为合规行 → 该 ID 进 `changed_test_ids` |
| UT-S35-214 | 零回归：其余码与 lint-specs 不变 | 四夹具：① `test-change-set-target-duplicate` 形态；② `-overlap` 形态；③ 非 UTF-8 目标（`-invalid-utf8`）；④ 含欠债行与重复 ID 的已合并基线（无活跃提案） | ①②③ 调用 `buildTestChangeSet`；④ 运行 `lint-specs` 实现 | ①②③ 抛出的错误码与 message 与本变更前逐字一致；④ `lint-specs` 仍报出该欠债（`table_column_mismatch` 等既有诊断），输出与退出码与本变更前逐字一致——宽容只作用于预检与 merge 的阻断结论，可观测性不丢 |
| UT-S35-215 | L4 列数检查的合并后阶段边界（delta-r1 F1） | 提案含一个测试 delta：`## MODIFIED` 整节替换欠债表所在章节（只改同表合法行、原样携带欠债行 `ST-S68-05`）+ 一个合规 `## ADDED` 章节；已完成真实合并（`SPEC_MERGED` 在场、目标为合并后字节、原 delta 仍在场）；对照夹具：同一提案 `SPEC_MERGED` 不在场 | 对两夹具分别求 `runChangeLint` 结论；对已合并夹具记录合成器调用次数与项目根字节快照 | 已合并夹具：**零** `delta_test_table_column_mismatch`（不重放、不回退到只扫 delta 片段的严格扫描）、零 `delta_test_id_duplicate`、合成器调用 0 次（不以当前目标为 before 重合成，不报「ADDED 章节已存在或不唯一」）、项目根字节快照前后相等；`delta_test_table_duplicate_header` / `delta_test_table_id_unextractable` 对注入的对应形态照常报出（不依赖前态的检查保持原合同）；未合并对照夹具：零 `delta_test_table_column_mismatch`（继承判定生效）。**注入式反证臂**：去掉 L4 列数检查的完成标记闸时已合并夹具必红 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-37 | 事故端到端：目标既有欠债不再阻断无关提案，新增欠债仍被拒 | 真实 CLI，一次性隔离 launched 项目复刻宿主现场（`core-S68-test-cases.md` 含 5 列欠债行 `ST-S68-05` / `ST-S68-06`、`core-S37-test-cases.md` 含同文件重复 ID）。① 提案 P1 对两文件各写一个合规纯 ADDED 块：`openlogos change-lint --slug P1 --format json` exit 0、`data.pass=true`；续跑**真实 `openlogos merge P1`** 退出码 0、生成 `SPEC_MERGED`，合并后两文件中欠债行与重复记录逐字节保留（**修复前此步在合成期退 1：`Error: merge 失败（test-change-set-ambiguous-table）`，即 run `drv-muuiqcpr-8jmu` 的停点**）；② 提案 P2 对 S68 写 `## MODIFIED` 整节替换，只改同表一条合法行、原样携带欠债行：`change-lint` exit 0，真实 `openlogos merge` 退 0；③ 提案 P3 在 P2 基础上再追加一条与 `ST-S68-05` 逐字节相同的行：`change-lint` exit 2 且 violations 含 `delta_test_table_column_mismatch`；真实 `openlogos merge` 非零退出于预检出口，结束后无 `SPEC_MERGED`、目标保持合并前字节；④ 全程 `openlogos lint-specs` 对两文件的既有欠债报出结论与运行前逐字一致；⑤ `change-lint` 项目级零写入（运行前后项目根字节快照相等）；⑥ **合并后再次 lint**（delta-r1 F1）：提案 P4 含 S68 的 `## MODIFIED` 整节替换（原样携带欠债行）+ 一个合规 `## ADDED` 章节，`change-lint` exit 0 → 真实 `openlogos merge P4` 退 0 → 再次运行真实 `openlogos change-lint --slug P4 --format json`：exit 0、`violations` 不含 `delta_test_table_column_mismatch`、stderr 无「ADDED 章节已存在或不唯一」，运行前后项目根字节快照相等 |

### 追溯与覆盖

- 主修·事故形态两侧放行（纯 ADDED、既有列数欠债 / 既有重复 ID）：UT-S35-202、UT-S35-203、ST-S35-37 步骤①。
- 主修·L4 接入共享继承判定（MODIFIED 整节替换原样携带，评审 F1）：UT-S35-207、ST-S35-37 步骤②。
- 防伪臂·计次预算（新增同字节副本拒绝、数量不变与减少放行，评审 F2）：UT-S35-208、UT-S35-209、ST-S35-37 步骤③。
- 防伪臂·本提案引入或改动的欠债照旧严格：UT-S35-204、UT-S35-205、UT-S35-206、UT-S35-210。
- 跨目标重复的多重集口径：UT-S35-211。
- 一致性锁新边界（双向比对 + 注入式反证 + 表头重复不在宽容范围）：UT-S35-212。
- 变更集结论不变：UT-S35-213。
- 零回归（其余码、lint-specs 可观测性）：UT-S35-214、ST-S35-37 步骤④⑤。
- 阶段边界·合并完成后 L4 列数检查不重放、不回退严格扫描（delta-r1 F1）：UT-S35-215、ST-S35-37 步骤⑥。
- 目标集合口径·只按本次触及目标判跨目标重复（delta-r1 F2）：UT-S35-211 变体 ③④。
- 功能规格：§2.86.1～§2.86.4（含 §2.86.3 阶段边界）、§2.84.2、§2.84.5、§2.85.3；场景：S35「后态测试 ID 重复判据的同源前移」；来源变更：fix-inherited-test-debt-merge-block。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- 每条 UT 的两侧必须调用**真实实现**（`runChangeLint` 与 `composeOpenLogosMarkdown` + `buildTestChangeSet`），不得以复述期望的表驱动替代。
- UT-S35-212 的注入式反证臂必须对真实实现做最小注入（替换继承判定的计次规则或 L4 的过滤接入），证明对应夹具变红；不得以断言「判定函数被调用」替代结论比对。
- UT-S35-208 中同字节副本的行号断言须对夹具已知的精确 delta 内行号比对。
- UT-S35-215 的合成器调用计数须对真实 `composeOpenLogosMarkdown` 做计数包装取得，不得以断言阶段标记被读取替代。
- ST-S35-37 步骤①②③⑥必须跑**真实 `openlogos merge`** 进程并断言退出码、出口形态与 `SPEC_MERGED` 在场性，不得以库内函数调用替代。

## S35 L5 部署方案覆盖判定测试

> 覆盖功能规格 §2.90（适用范围、两种满足方式、结论与违规码、实现单点与 Plan Package 投影、零回归边界）、CLI 交互设计 §2.42、场景 S35「L5 部署方案覆盖判定」全部步骤与 EX-L5D-1～EX-L5D-5；来源变更 deploy-plan-gate-release-0-15-19（决策 C02、C03；评审 F1）。
>
> **夹具口径**：一律在一次性隔离 launched 项目内构造提案目录与 `logos/resources/prd/3-technical-plan/3-deployment/`，不读本仓 `logos/changes/` 与本仓部署方案。「需要部署提案」指 `proposal.md`「部署影响」段六个字段齐全、`是否需要部署：是`、`tasks.md` 有非空 `[deploy]` section 的提案；其余字段与章节按 canonical scaffold 填写为可通过 L0～L4、L6、L7 的最小形态，使 L5 成为唯一变量。部署方案夹具 `core-01-deployment-plan.md` 含唯一的 `## OpenLogos 9.9.1 发布方案（夹具）`、两个版本章节下各一个 `### 本机全局部署`，以及一个代码围栏内的 `## 围栏内标题`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-216 | 缺部署方案报 `deployment_plan_missing` | 需要部署提案；`[delta]` 只有测试规格任务；无 `deltas/prd/3-technical-plan/3-deployment/` 目录；部署影响段无「部署方案依据」 | 运行 `runChangeLint`（JSON） | `pass=false`；`violations` 恰有两条：一条 `check_layer=5`、`code=deployment_plan_missing`，另一条 `check_layer=0`、`code=tasks_deployment_plan_missing`（同一缺口的 Plan Package 投影，L0 不去重）；L5 那条`path` 为提案 `proposal.md` 的项目相对路径，message 与 fix_hint 与功能规格 §2.90.3 逐字一致（fix_hint 同时给出 `[delta]` 任务示例与「部署方案依据」示例）；无 `deployment_plan_reference_unresolved`；退出码 2 |
| UT-S35-217 | (a) `[delta]` 部署方案任务即覆盖 | 同 UT-S35-216，四个变体：① `[delta]` 增加未勾选条目，文字含 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`；② 同一条目已勾选；③ 该路径只出现在 `[deploy]` 条目中；④ 该路径只出现在 `[delta]` 下的非 checkbox 说明文字中 | 对四个变体分别运行 `runChangeLint` 与 `evaluateDeploymentPlanCoverage` | ①② `status=covered_by_delta`，L5 无新违规；③④ `status=missing`，报 `deployment_plan_missing` |
| UT-S35-218 | (a) 已有部署方案 delta 文件即覆盖，且复用 L6 分类器 | 同 UT-S35-216，`[delta]` 无部署方案任务，四个变体：① `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 为合规普通文件；② 该目录只有一个指向项目根外的 symlink；③ 该目录为空；④ 该目录下只有一个子目录 | 分别求 `evaluateDeploymentPlanCoverage`，并对同一文件求共享 delta 分类器结论 | ① `covered_by_delta`；②③④ `missing`；每个变体中「是否算覆盖」与分类器对该文件的 `mergeable` 结论一致（②的 symlink 分类为非 mergeable） |
| UT-S35-219 | (b) 引用逐字唯一命中即覆盖 | 同 UT-S35-216，部署影响段增加「部署方案依据」，四个变体：① `OpenLogos 9.9.1 发布方案（夹具）`；② `「OpenLogos 9.9.1 发布方案（夹具）」`；③ 用反引号包裹同一标题；④ 值前后带空格 | 分别求 `evaluateDeploymentPlanCoverage` 与 `runChangeLint` | 四个变体均 `status=covered_by_reference`，`reference` 为去包裹后的标题，`hits=1`；L5 无新违规，退出码 0 |
| UT-S35-220 | (b) 引用无法解析的三种形态与围栏、目录边界 | 同 UT-S35-216，「部署方案依据」五个变体：① `OpenLogos 9.9.2 发布方案`（不存在）；② `本机全局部署`（命中 2 处）；③ 同一字段写两行，值都是可唯一命中的标题；④ `围栏内标题`（只在代码围栏中出现）；⑤ 删除整个 `3-deployment/` 目录后引用 ① 的唯一标题 | 分别运行 `runChangeLint` 与 `evaluateDeploymentPlanCoverage` | 五个变体均 `status=reference_unresolved`，L5 恰报一条 `deployment_plan_reference_unresolved`、无 `deployment_plan_missing`；`reference_problem` 依次为 `not_found`、`ambiguous`（message 含「命中 2 处标题」）、`duplicate`（message 含「出现了 2 次」）、`not_found`、`not_found`；⑤ 不报操作错误、退出码 2 |
| UT-S35-221 | 先 (a) 后 (b)：delta 覆盖时不解析引用 | 同 UT-S35-217 变体 ①（`[delta]` 有部署方案任务），部署影响段另写「部署方案依据：本提案 `[delta]` 新增「OpenLogos 0.15.19 发布方案」章节」（说明文字，不是标题） | 运行 `evaluateDeploymentPlanCoverage` 与 `runChangeLint`，并统计判定期间对部署方案目录的读取次数 | `status=covered_by_delta`；无 `deployment_plan_reference_unresolved`；部署方案目录读取 0 次（不解析引用）。对照臂：删除部署方案任务后同一提案 `status=reference_unresolved`（`not_found`） |
| UT-S35-222 | 不适用与冲突判定回归 | 五个夹具：① `是否需要部署：否`、无 `[deploy]`；② 部署影响段缺失、`tasks.md` 有非空 `[deploy]`（回退 source=tasks）；③ 部署影响段缺失、无 `[deploy]`（legacy-fallback）；④ `是否需要部署：否` 但有 `[deploy]`（既有冲突）；⑤ `是否需要部署：是`、无 `[deploy]`、无部署方案覆盖（EX-L5D-1） | 运行 `runChangeLint`，并与本变更前实现在同一夹具上的输出逐字比对（①～④） | ①②③ `status=not_applicable`，L5 输出、`violations` 与退出码与本变更前逐字一致；④ 只报 `deployment_decision_conflict`，message 与 fix_hint 逐字不变；⑤ L5 同时报 `deployment_decision_conflict` 与 `deployment_plan_missing` 两条，L0 另有 `tasks_deployment_conflict` 与 `tasks_deployment_plan_missing` 两条；全部夹具 L5 通过时人读行恰为 `✓ L5 部署决策一致`，与本变更前相同 |
| UT-S35-223 | Plan Package 投影与 change-lint 收敛，历史提案边界 | 四个夹具：① UT-S35-216 形态（非历史）；② UT-S35-220 变体 ① 形态（非历史）；③ UT-S35-219 变体 ① 形态（覆盖）；④ 夹具 ① 加 `PLAN_APPROVED` marker（历史） | 对每个夹具求 `evaluatePlanPackage`、`runChangeLint`，并以真实入口求 `next --format json` 的 `proposal_step` | ① `plan_package.ready=false`，`tasks.issues` 含 `tasks_deployment_plan_missing`（`section_id=delta`），next 不为 `ready-to-delta`；② `proposal.issues` 含 `proposal_deployment_plan_reference_unresolved`（`section_id=deployment`，`actual` 为引用值），`ready=false`；③ 不追加任何部署方案问题，`ready` 与去掉本判定时相同；④ Plan Package 不追加问题、前沿不回退，change-lint 仍报 `deployment_plan_missing`（EX-L5D-2）。①②③ 中「lint 是否有新违规」与「Plan Package 是否有对应问题」两两一致 |
| UT-S35-224 | 判定单点、只读与操作错误 | UT-S35-216～UT-S35-223 的全部夹具；另备部署方案目录中一个 `.md` 设为不可读（EX-L5D-3） | ① 对每个夹具分别求 change-lint L5 结论与 Plan Package 结论，并把 `evaluateDeploymentPlanCoverage` 替换为恒返回 `covered_by_delta` 的注入实现后重求；② 每次运行前后取项目根字节快照；③ 对不可读夹具运行 `runChangeLint` | ① 注入后两个消费方对 UT-S35-216 夹具同时转为无部署方案问题，证明两者都只经同一判定，不各自解析；② 快照前后相等（零写入）；③ 操作错误 `artifact_unreadable`、exit 1，不降级为 `not_found` |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S35-38 | 事故端到端：`sync-claude-response-language` 原始提案在提案阶段被拦下 | 真实 CLI，一次性隔离 launched 项目，复刻事故提案在部署节点被拒前的计划产物（仓库内固定夹具，由本提案的实现切片按原始文本落盘）：`proposal.md`「部署影响」为「是否需要部署：是」「影响环境：npm 发布 / 本机全局安装」「是否需要 smoke：否」，无「部署方案依据」；`tasks.md` 的 `[delta]` 为 4 条（`core-01-requirements.md`、`core-01-feature-specs.md`、`core-S08-sync.md`、`core-S08-test-cases.md`），`[deploy]` 为 1 条「随下一个 openlogos 版本发布并本机全局安装……」；夹具部署方案只含其它版本章节。① `openlogos change-lint --slug <slug> --format json` exit 2，`violations` 含 `deployment_plan_missing`。本用例在未实现新判定的代码上必红（旧 L5 对该夹具通过、exit 0）；② 在 `[delta]` 追加部署方案任务后重跑 exit 0；③ 撤回 ②，改为在部署影响段写夹具部署方案中唯一存在的版本章节标题作为「部署方案依据」，重跑 exit 0；④ 再把依据改为不存在的标题，重跑 exit 2、`violations` 含 `deployment_plan_reference_unresolved`；⑤ 每次运行前后项目根字节快照相等 |
| ST-S35-39 | 真实 CLI 人读输出、JSON 信封与 next 投影（沿用既有输出合同） | 同 ST-S35-38 步骤 ① 的夹具（非历史、非 GUI 项目）。① 默认人读输出依次含 `✗ L0 [tasks_deployment_plan_missing]` 与 `✗ L5 [deployment_plan_missing]`，每条其下依次为「缺什么：」「在哪补：」「补成什么样：」三行，L5 那条的三行分别为功能规格 §2.90.3 的 message、提案 `proposal.md` 相对路径与 fix_hint；末行为 `FAIL（7/9，2 项违规）`；② `--format json` 的 stdout 为 success envelope，`data.pass=false`，`data.violations` 恰两项，`code` 分别为 `tasks_deployment_plan_missing` 与 `deployment_plan_missing`，每个违规对象的键集合恰为 `code`、`path`、`message`、`fix_hint`，**不含** `check_layer`（与 UT-S35-193 的公开字段合同一致）；③ 真实 `openlogos next --format json` 的 `proposal_step` 不为 `ready-to-delta`，`status --format json` 中 `plan_package.ready=false` 且 issues 含 `tasks_deployment_plan_missing`；④ 按 ST-S35-38 ② 修复后，人读输出中 L0 行恰为 `✓ L0 Plan Package 完成合同`、L5 行恰为 `✓ L5 部署决策一致`，末行为 `PASS（9/9）`，next 进入 `ready-to-delta`；⑤ 对照：同一修复后夹具在本变更前实现上的人读输出与 ④ 逐字相同（以仓库内固定快照比对，快照取自本变更前实现的实际输出） |

### 追溯与覆盖

- 缺方案报违规与 fix_hint：UT-S35-216、ST-S35-38 ①、ST-S35-39 ①②。
- (a) delta 覆盖（任务 / 文件，复用 L6 分类器）：UT-S35-217、UT-S35-218、ST-S35-38 ②。
- (b) 引用覆盖与三种未解析形态、围栏与目录边界（EX-L5D-4、EX-L5D-5）：UT-S35-219、UT-S35-220、ST-S35-38 ③④。
- 先 (a) 后 (b)：UT-S35-221。
- 不适用与冲突回归（C03、EX-L5D-1）：UT-S35-222。
- Plan Package 投影收敛与历史提案边界（评审 F1、EX-L5D-2）：UT-S35-223、ST-S35-39 ③④。
- 判定单点、只读、操作错误（EX-L5D-3）：UT-S35-224、ST-S35-38 ⑤。
- 安装态：SMOKE-core-224。
- 功能规格：§2.90；CLI 交互设计：§2.42；场景：S35「L5 部署方案覆盖判定」；来源变更：deploy-plan-gate-release-0-15-19。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`；失败不得写 pass。
- UT 一律调用真实实现（`runChangeLint`、`evaluateDeploymentPlanCoverage`、`evaluatePlanPackage`），不得以复述期望的表驱动替代；UT-S35-222 的「与本变更前逐字一致」以仓库内固定的预期输出快照比对，快照内容取自本变更前实现对同一夹具的实际输出。
- UT-S35-224 的注入式反证必须对真实消费方做最小注入（替换判定函数），证明结论随之变化；不得以断言「判定函数被调用」替代结论比对。
- ST-S35-38、ST-S35-39 必须以 `cli/dist` 真实 CLI 进程执行并断言退出码与 stdout；夹具文件提交入库，断言中不硬编码主机路径与墙上时钟。
