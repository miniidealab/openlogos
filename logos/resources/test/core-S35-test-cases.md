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
