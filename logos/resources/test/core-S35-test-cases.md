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
