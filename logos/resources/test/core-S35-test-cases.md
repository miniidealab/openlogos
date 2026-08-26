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

## 五、L9 按触达规格闭包测试（S39）

> 所有 UT/ST 实现必须写入 OpenLogos reporter `logos/resources/verify/test-results.jsonl`。

### 5.1 单元测试

| ID | 检查项 | 用例 | 期望 |
|---|---|---|---|
| UT-S35-26 | legacy 不激活 L9 | proposal 无 policy、tasks 无模式 | 只执行 L1–L8；输出逐字节旧形态 |
| UT-S35-27 | 模式在场但声明缺失 | tasks 有 `[MODIFY]`，proposal 无 closure | `baseline_closure_declaration_missing` |
| UT-S35-28 | target 规范化去重 | `deltas/test/./x.md` 与 `deltas/test/x.md` | `delta_target_duplicate`，path 指向 canonical target |
| UT-S35-29 | MODIFY 目标缺失 | `[MODIFY] deltas/test/new.md` | `delta_target_mode_mismatch` |
| UT-S35-30 | CREATE 目标已存在 | `[CREATE]` 映射到既有目标 | `delta_target_mode_mismatch` |
| UT-S35-31 | AMBIGUOUS 阻断 | closure 矩阵含 API=AMBIGUOUS | `baseline_closure_ambiguous`，fix_hint 列缺失证据 |
| UT-S35-32 | plan 阶段未完成 task 不误报文件缺失 | `[delta]` 未全勾、delta 未产 | 不报 `delta_target_unplanned`；其它 plan 检查照常 |
| UT-S35-33 | 完成 task 缺文件 | task 已 `[x]`、同路径文件不存在 | `delta_target_unplanned` |
| UT-S35-34 | 实际 delta 无 task | deltas 中有 mergeable 文件但 tasks 未规划 | `delta_target_unplanned` |
| UT-S35-35 | CREATE 场景不完整 | 新场景 delta 无 sequenceDiagram/异常 | `create_target_incomplete`，列出缺失结构 |
| UT-S35-36 | CREATE 完整正例 | 场景含目标/参与者/时序/步骤/异常/追溯 | L9 通过；仍继续 L4/L6/L8 |
| UT-S35-37 | code 注册表闭合与排序 | 枚举所有既有 26 + 新 9 code | 恰 35 个；无表外字符串；排序 L1→L9/path/code 稳定 |
| UT-S35-38 | malformed/重复 YAML key | 参数化：坏缩进、双 `targets` key、未知 schema_version、未知字段 | `baseline_closure_malformed`；parser 禁止 last-wins |
| UT-S35-39 | proposal 重复 canonical target | targets 两项 delta_path 规范化后相同 | `delta_target_duplicate`；即使 tasks 只有一项也失败 |
| UT-S35-40 | touched scenario 漏强制维度 | `touched_scenario_ids:[S05]` 但 targets 无 S05 scenario/test | 每个缺口返回 `baseline_closure_target_missing` |
| UT-S35-41 | touched scenario 漏条件 disposition | S05 无 api/database/orchestration 等 MODIFY/CREATE/SKIP/AMBIGUOUS 记录 | `baseline_closure_target_missing`，不得默认为 SKIP |
| UT-S35-42 | SKIP 缺 evidence | mode=SKIP、delta_path=null、evidence=[] | `baseline_closure_malformed`，不得计入合法 skip |
| UT-S35-43 | AMBIGUOUS 缺 missing_evidence | mode=AMBIGUOUS、missing_evidence=[] | `baseline_closure_malformed`；不得仅靠 mode 字样生成 ambiguous 计数 |
| UT-S35-44 | proposal/tasks 集合差异 | P-T 与 T-P 各一项 | 分别报漏 task/未声明 task，逐 target 输出；计数相同也不得通过 |
| UT-S35-45 | API/DB 整文件协议预检 | 参数化合法/非法首行、声明 target 漂移、marker 未剥离、YAML/JSON/SQL 解析失败 | 非法均 `non_markdown_delta_invalid`；合法夹具进入完整度检查 |

### 5.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S35-07 | 新提案 plan PASS | 合法 on-touch-v1 proposal/tasks，无 delta | text/JSON PASS、exit 0，L9 在检查列表 |
| ST-S35-08 | 重复目标 plan FAIL | 两任务映射同 canonical target | exit 2；JSON violation code/path/fix_hint 完整 |
| ST-S35-09 | spec 双向对账 | 全部 task 勾选，但缺一 delta且多一未规划 delta | 稳定返回两条 `delta_target_unplanned`，顺序固定 |
| ST-S35-10 | CREATE 完整度矩阵 | 分别构造 scenario/API/DB/test/orchestration 完整与残缺夹具 | 残缺精确失败；完整通过类别检查 |
| ST-S35-11 | legacy JSON 零回归 | 对现有 legacy fixture 跑 text/JSON | 与能力上线前逐字节一致，无 L9 violation |
| ST-S35-12 | 项目级只读 | 对 exit 0/2/1 路径前后做全项目文件/哈希快照 | 文件集合和字节完全不变，无 marker/hash/tasks 改写 |
| ST-S35-13 | proposal schema 反例矩阵 | 依次运行 malformed、重复 key/target、漏场景维度、SKIP 缺证据、AMBIGUOUS 缺 missing_evidence | text/JSON 同一 violations 集合、exit 2；skip/ambiguous/targets 计数只来自合法 proposal 对象 |
| ST-S35-14 | P/T/D 三方差集 | 构造 P、T、D 数量相同但成员各有一项不同 | plan 在 P!=T 失败；spec 在 P!=T 或 T!=D 失败；逐成员报告，不以计数相等假通过 |
| ST-S35-15 | non-Markdown API/DB CREATE/MODIFY 预检 | 使用真实 `.yaml`/`.json` OpenAPI 与 SQLite `.sql` 夹具，覆盖 ADDED/MODIFIED、目标漂移和坏语法 | 合法首行被预演剥离后可解析/执行且无 marker；任一失败 exit 2、项目字节不变 |

### 5.3 交叉判据回归

- 相同夹具在 change-lint 与 merge 消费点得到同一 canonical target、mode/完整度结论。
- L9 不替代 L4 模板骨架、L6 路径、L7 UI、L8 守恒；可与它们并发返回 violations。
- warnings[] 的 S38 决策提示语义不变；L9 全部为 violation，不新增 JIT/baseline warning。
- 操作错误读取顺序与 exit 1 契约不变。

> 全部实现必须由 OpenLogos reporter 逐 ID 写入 `logos/resources/verify/test-results.jsonl`；不得用文件存在、旧结果或手写 PASS 补齐。

### 单元测试

| ID | 检查项 | 用例 | 期望 |
|---|---|---|---|
| UT-S35-100 | locale section registry | 中文/英文全部 canonical 标题 | 同一语义 ID 集，标题各 locale 唯一 |
| UT-S35-101 | proposal missing/duplicate/empty | 三类参数化 summary fixture | 对应三个稳定 code，含 path/section/expected/fix_hint |
| UT-S35-102 | placeholder/type/deployment | 占位残留、非法类型、重复/非法部署字段 | 精确 issue；不得被其它正文掩盖 |
| UT-S35-103 | clarification/baseline/UI 聚合 | 三个共享 evaluator 分别失败 | L0 聚合但不复制判据，问题排序稳定 |
| UT-S35-104 | tasks plan 模板残留 | 中英文 delta scaffold 未替换 | plan_filled=false，模板行可定位 |
| UT-S35-105 | code 三态 | 空锚点、提前 checkbox、缺标题、merge 后真实切片 | plan/code-required/code-slices 四 fixture 精确结论 |
| UT-S35-106 | L0 exit 分层 | ready false/true/读取错误 | exit 2/0/1；success/error envelope 分层不变 |
| UT-S35-107 | wrapper 委托单一 evaluator | 调用旧 proposal/tasks API | 结果来自同一 evaluation，无独立字符串规则 |
| UT-S35-108 | issue 去重与 canonical 排序 | 多 evaluator 返回同问题及多行问题 | 稳定去重；check/path/line/section/code 顺序固定 |
| UT-S35-109 | plan 前沿等价范围 | plan、已有 Delta、PLAN_APPROVED、SPEC_MERGED 参数化 | 仅 plan fixture 强制四方等价；历史不回退 |
| UT-S35-110 | 只读问题不自修 | summary/code 两错误 | evaluator 前后文件/marker hash 不变 |
| UT-S35-111 | completion/asset contract 绑定 | dispatch contract 与过期 manifest | 合法声明可执行；过期时要求 sync/new session |

### 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S35-16 | 现场事故完整复现 | proposal 把 summary 改为核心设计，tasks 保留代码模板行；运行四消费者 | change-lint exit 2 且返回两类精确 issue；status/next/flow 均不 ready，用户不可见“可写 Delta” |
| ST-S35-17 | 修复后四方同时全绿 | 按 issues 新增 canonical summary、删除模板行保留空 code；重跑 | lint pass/plan package/status/next/flow 全部 ready，next ready-to-delta |
| ST-S35-18 | 项目级只读与历史兼容矩阵 | 对 success/fail/error/history/zh/en fixture 前后快照 | 所有只读路径零写；历史 marker 不回退；文本/JSON issue 集合一致 |

### 问题码与覆盖要求

- proposal：required section missing/duplicate/empty、placeholder、type、deployment、clarification。
- tasks：template remaining、code entry before spec-complete、code section missing。
- 组合：同一 fixture 一次返回全部可修问题；操作错误仍 fail-fast。
- L0 不替代 L1～L9；L0 PASS 后现有检查继续执行，既有 35 码及顺序零回归。

### 验收追溯

- S35-AC-Plan-01 proposal 精确问题：UT-S35-100～UT-S35-103、ST-S35-16。
- S35-AC-Plan-02 tasks 三态：UT-S35-104～UT-S35-105、ST-S35-16～ST-S35-17。
- S35-AC-Plan-03 exit 与四方等价：UT-S35-106～UT-S35-109、ST-S35-17。
- S35-AC-Plan-04 只读/历史/资产：UT-S35-110～UT-S35-111、ST-S35-18。
