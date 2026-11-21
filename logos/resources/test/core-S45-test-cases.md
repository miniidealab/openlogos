# core-S45: 企业知识沉淀与场景引用测试用例

> 场景：S45 企业知识沉淀与场景引用｜决策：C01～C06｜来源变更：enterprise-knowledge-base｜规则权威：功能规格 §2.102
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`），测试名包含对应 ID，`scenario_id="S45"`。除纯函数用例外，全部用例在 `mktemp -d` 一次性临时 git 仓库中构造：先提交一个已初始化、`core` 模块为 `launched` 的 OpenLogos 项目作为起点，夹具知识条目按 §2.102.3 的模板写入。下文「规则条目 K03」指含 `K03-R1`、`K03-R2` 两条规则的 `type=rule` 条目；「术语条目 K05」指没有「规则」表的 `type=term` 条目。

## 一、单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S45-01 | knowledge delta 类别注册且同源 | 无 | 读取 `DELTA_TO_RESOURCE`、`MERGE_SUPPORTED_DELTA_DIRS`、`MERGE_SUPPORTED_DELTA_DIRS_FOR_UI`；对 `logos/resources/knowledge/core-K01-a.md` 调用 `classifyCanonicalTargetCategory`；对提案内 `deltas/knowledge/core-K01-a.md` 与 `deltas/reference/x.md` 调用 delta 分类 | `DELTA_TO_RESOURCE.knowledge === 'logos/resources/knowledge'`；两处白名单都含 `knowledge` 且三处类别集合相等；分类器返回 `knowledge`；`deltas/knowledge/core-K01-a.md` 为 `valid` / `mergeable`；`deltas/reference/x.md` 仍为 `explicitly_ignored` |
| UT-S45-02 | 条目解析 | 四个夹具：① 规则条目 K03；② 术语条目 K05；③ 规则表在两行合法规则之外混入一行 `K09-R1`（前缀与文件 KXX 不符）；④ 缺「元数据」节 | 调用条目解析函数 | ① 条目 ID `K03` 取自文件名，H1 以 `K03` 开头；元数据 `type=rule`、`scope`、`module`、`tags`、`status`、`source` 解析正确；规则 `K03-R1`、`K03-R2` 及各自状态；② 条目 ID `K05`、规则为空；③ 条目标记 `valid=false`，缺失项点名该行（不是只忽略该行），`K03-R1` 等合法行也不能被解析为有效引用目标；④ 条目以文件名 ID 进入视图并标记 `valid=false`（缺失项为「元数据」），参与重号判定，解析其 ID 时返回「无效」而非存在 |
| UT-S45-03 | 有效知识视图合成 | 已合并 K03、K05；当前提案 `deltas/knowledge/` 含 ADDED `core-K06-x.md` 与对 K03 的 MODIFIED（新增 `K03-R3`）；另一个未合并提案目录与 archive 目录中各有一个 K07 | 调用视图构建函数 | 视图含 K03（含 R1～R3）、K05、K06；不含 K07；K03 的最终字节等于合并期合成器对同一输入的结果 |
| UT-S45-04 | 编号重复 | ① 视图中同时存在 `core-K01-refund.md` 与 `core-K01-customer-id.md`；② K03 的规则表两行都是 `K03-R1`；③ 本提案场景引用 `K01` | change-lint（JSON） | ①② 各报 violation `knowledge_id_duplicate`：以 `code` 与 `path` 判定（①的 `path` 为本提案涉及的来源文件，②为该条目文件），`message` 包含两个来源路径（②为同一文件的两行）；另以纯函数断言视图对该 ID 的解析结果为「歧义」且列出两个来源；③ 对 `K01` 只报 `knowledge_id_duplicate`，不另报 `knowledge_reference_unknown`，也不按存在放行；exit 2 |
| UT-S45-05 | 引用解析：不存在 | 视图含 K03、K05；本提案场景 delta 的「适用业务约束」表首列依次为 `K03-R1`、`K05`、`K03-R9`、`K08` | change-lint（JSON） | `K03-R1`、`K05` 通过；`K03-R9`、`K08` 各报 violation `knowledge_reference_unknown`，诊断含场景 delta 路径、行号与引用文本；exit 2 |
| UT-S45-06 | 引用已退役 | ① 已合并 K03-R2 为 `deprecated`，本提案场景引用 `K03-R2`；② 本提案把已合并 K05 的状态改为 `deprecated`，一个未改动的已合并场景仍引用 `K05` | change-lint（JSON） | 两例都在 `warnings[]` 报 `knowledge_reference_deprecated`；`violations[]` 不含知识相关码；`pass=true`、exit 0 |
| UT-S45-07 | 禁止删除已合并条目与规则 | ① 对已合并 K03 写 `REMOVED`；② 对 K03 写同锚 `MODIFIED`（去掉 K03-R2 行）+ `REMOVED-ITEMS` 点名 `K03-R2`；③ ADDED `core-K03-renamed.md` 同时 REMOVED 原 K03（改文件名）；④ 本提案 ADDED 的 `core-K06-x.md` 在合并前被删除、或重编号为 K07 | change-lint（JSON） | ①②③ 各报 violation `knowledge_removal_forbidden`，fix_hint 提示改为标 `deprecated`；④ 不报 |
| UT-S45-08 | 退役 ID 冻结 | 已合并 K03-R2 为 `deprecated`、K04 条目为 `deprecated`、无规则表的术语条目 K05 为 `deprecated`（「说明」把「结算日」定义为银行清算日）；本提案分别：① 把 K03-R2 改回 `active`；② 保留 `deprecated` 但改写 K03-R2 的规则正文；③ 改写 K04 的标题；④ 改写 K04 的 `type`；⑤ 把仍为 `active` 的 K03-R1 的阈值 5000 改为 8000；⑥ 保留 K05 的标题、`type` 与状态，只把「说明」中的定义改为自然日；⑦ 只改 K03-R2 的「例外」列 | change-lint（JSON） | ①②③④⑥⑦ 各报 violation `knowledge_retired_id_mutated`，`message` 含 ID 与已生效版本路径，`path` 为 delta 路径；⑤ 不报 |
| UT-S45-09 | 同批新增条目被新场景引用 | 已合并知识为空；本提案 ADDED `core-K01-refund.md`（含 K01-R1）与新场景 delta，场景引用 `K01-R1` | change-lint（JSON） | 不报 `knowledge_reference_unknown`；`pass=true`、exit 0 |
| UT-S45-10 | 零回归 | 项目没有 `logos/resources/knowledge/`；提案没有 `deltas/knowledge/`，场景 delta 不含「适用业务约束」章节；同一夹具在实现前的 change-lint 输出作为基线 | change-lint（JSON） | 除 `timestamp` 外与基线逐字节一致；条目解析与视图构建函数未被调用 |
| UT-S45-11 | 守恒注册范围 | ① 对 K03 写 `MODIFIED`，正文漏抄 K03-R2 行且未点名；② 场景 delta 的 MODIFIED 改写「适用业务约束」表、去掉引用 `K05` 的行 | change-lint（JSON） | ① 报 `knowledge_removal_forbidden`（已合并规则被隐式删除）；② 不因 `K05` 报 `delta_implicit_id_removal`（场景文档中的引用不是场景条目 ID） |
| UT-S45-12 | 资源索引补录 knowledge | initial 项目直接写入 `logos/resources/knowledge/core-K01-a.md`；`resource_index` 已有一条人工描述的 K02 条目 | 执行资源索引补录 | 新增 K01 的登记；K02 的描述逐字不变 |
| UT-S45-13 | init 创建目录 | 空目录 | 全新 `openlogos init` | 存在 `logos/resources/knowledge/` 与 `logos/resources/reference/knowledge/` |
| UT-S45-14 | change-lint JSON 契约 | UT-S45-04～UT-S45-08、UT-S45-18～UT-S45-20 的输出 | 校验 JSON | 五个 violation 码（含 UT-S45-19、UT-S45-20 的 `knowledge_entry_invalid`）进入 `violations[]` 且属于 `ChangeLintViolationCode` 闭合枚举；`knowledge_reference_deprecated` 只出现在 `warnings[]`，不影响 `pass` 与退出码；violation 含 `code`、`path`、`message`、`fix_hint`，warning 只含 `code`、`message`、`fix_hint` 且 `message` 写明场景文件与行 |
| UT-S45-15 | Skill 文档包含知识加载与冲突裁决 | 实现交付后的根 `skills/` | 读取 prd-writer、product-designer、scenario-architect、change-writer、test-writer 的 `SKILL.md` 与 `SKILL.en.md` | 中文版均含「加载相关企业知识」节，英文版均含对应「Load relevant enterprise knowledge」节；两版都含「录入入口」/ Intake entry point 小节，且跳过条件写明「本轮用户没有提供企业资料」/ has not provided enterprise material；scenario-architect 两版含「适用业务约束」/ applicable business constraints 章节写法；change-writer 两版含原文写入 `reference/knowledge/` 的 push 扩散提示与「预定 KXX」；test-writer 两版含「从 `KXX-Rn` 派生用例」 |
| UT-S45-16 | 合并后复跑不重放 | 活跃提案含整文件 ADDED `deltas/knowledge/core-K01-refund.md` 与引用 `K01-R1` 的场景 delta，已成功合并（有 `SPEC_MERGED`，delta 未再改动） | 再次执行 change-lint（JSON） | `pass=true`；视图直接读落盘的 K01，不因重放把整文件 ADDED 当作对已存在目标的 CREATE（不出现 `invalid-envelope` 类诊断）；不报删除、冻结类违规 |
| UT-S45-17 | 待应用修正以合并基线计算候选后态 | 同 UT-S45-16 已合并；随后修改同一 ADDED delta（给 K01 新增 `K01-R2`），形成待应用修正 | change-lint（JSON）；`merge`（修正） | change-lint 以合并基线为前态计算候选后态，`pass=true`；修正合并后落盘的 K01 与 change-lint 校验的候选后态逐字节一致，首次 CREATE 的条目保留 |
| UT-S45-18 | 撤回最后一个知识 delta 时仍拦截撤回已生效的退役 | 首次合并时本提案已把已有条目 K03 的 `K03-R2` 改为 `deprecated`（已生效），同批还有一个与知识无关的测试规格 delta（不含「适用业务约束」引用）；随后撤回唯一的知识 MODIFY delta，并删除已空的 `deltas/knowledge/` 目录，形成待应用修正（`merge-amend` 恢复集合含 K03，恢复为合并基线中的 `active`） | change-lint（JSON）；`merge`（修正） | L10 因恢复集合含知识目标而启用；报 violation `knowledge_retired_id_mutated`，`path` 为实际恢复的规范目标路径 `logos/resources/knowledge/core-K03-…md`，`message` 含 `K03-R2`；exit 2；修正 merge 拒绝、零写入，磁盘上的 `K03-R2` 仍为 `deprecated` |
| UT-S45-19 | 结构无效的新条目不能落盘也不能被引用 | 本提案整文件 ADDED `deltas/knowledge/core-K01-refund.md`，正文只有 `# K01：退款规则`；同批场景 delta 引用 `K01` | change-lint（JSON）；`merge` | 报 violation `knowledge_entry_invalid`（`path` 为该 delta，`message` 点名缺「元数据」）与对 `K01` 的 `knowledge_reference_unknown`（`message` 注明目标结构无效）；exit 2；merge 拒绝、零写入 |
| UT-S45-20 | 元数据部分缺项与规则行格式 | 本提案整文件 ADDED 七个条目，均有正确 H1、合法 `type` / `scope` / `module` / `status` 与至少一行合法规则：① 缺 `source`；② `source` 项缺 `version`；③ `source.path` 指向不存在的文件；④ 缺 `tags`（或为空列表）；⑤ 在合法规则行之外混入一行 `K09-R1`；⑥ `source.path` 写成仓库根下现存的 `README.md`（相对路径存在但在原文目录外）；⑦ `source.path` 指向 `logos/resources/reference/knowledge/` 内一个链接到 `README.md` 的 symlink；同批场景 delta 引用每个条目的 `KXX-R1`；另有一个已合并的存量条目缺 `tags` | change-lint（JSON）；`merge` | ①～⑦ 各报 violation `knowledge_entry_invalid`，`path` 为对应 delta，`message` 点名缺失项、问题行或「来源不在原文目录内」；对这七个条目的引用各报 `knowledge_reference_unknown`（注明目标结构无效）；exit 2，merge 拒绝、零写入；存量条目不因本提案报 `knowledge_entry_invalid`，仍以路径与 KXX 参与重号判定 |

## 二、场景测试（ST）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S45-01 | 新录入知识与场景同批合并的全链路 | S45 Step 3～11 | 真实 CLI；活跃提案 `p1` 含 ADDED `deltas/knowledge/core-K01-refund.md`（规则 K01-R1）、ADDED `deltas/knowledge/core-K02-settle-day.md`（术语）、ADDED 新场景 delta（引用 `K01-R1` 与 `K02`）；原文已写入 `logos/resources/reference/knowledge/` | ① `change-lint --format json`；② `merge p1`；③ 读取 `logos/resources/knowledge/`、场景文件、`resource_index` 与 `SPEC_MERGED` | ① `pass=true`；② 退出码 0；③ 两个条目与场景都已落盘，`resource_index` 含两个条目与场景的登记，`SPEC_MERGED` 存在；三者出自同一次合并 |
| ST-S45-02 | 退役不复用，跨分支引用不错绑 | S45 Step 3、4、8；EX-45.6 | 起点已合并 K01（退款规则，最高号）；分支 A 的提案把 K01 改为 `deprecated` 并新增客户编号规则；分支 B 的提案新增引用 `K01` 的退款场景 | ① 分支 A 按「最大 KXX（含 deprecated）+ 1」定号，`change-lint` 后合并；② 把 A 合入 B 所在的主线后，在 B 的提案上 `change-lint --format json` 并合并；③ 读取最终知识目录 | ① 新条目为 K02，`pass=true`；② B 的 `K01` 引用解析到原退款条目，`warnings[]` 含 `knowledge_reference_deprecated`，合并成功；③ K01 文件名、标题与规则正文与起点逐字一致，状态为 `deprecated`；客户编号规则在 K02 |
| ST-S45-03 | 退役 ID 被 MODIFIED 保号改写时拒绝 | S45 Step 8、10；EX-45.5 | 起点已合并 K01，其中 K01-R2（退款二审）为 `deprecated`；分支 A 的提案用 `MODIFIED` 保留文件名、ID 与结构位置，把 K01-R2 改成客户编号校验并标 `active`；分支 B 的提案新增引用 `K01-R2` 的退款场景 | ① 在 A 的提案上 `change-lint --format json`；② `merge`；③ 在 B 的提案上 `change-lint` 并合并；④ 读取 K01 | ① violation `knowledge_retired_id_mutated`，exit 2；② merge 拒绝、零写入；③ B 的引用解析到原退款二审规则并告警 deprecated，合并成功；④ K01-R2 的正文与状态与起点逐字一致 |
| ST-S45-04 | 跨分支重号被拦截，重编号后合并 | S45 Step 3、8、10；EX-45.3 | 两个分支从空知识库各自新增 `core-K01-refund.md` 与 `core-K01-customer-id.md`；分支 A 已合并 | ① 把 A 合入 B 所在的主线后，在 B 的提案上 `change-lint --format json`；② `merge`；③ 把 B 的条目重编号为 K02 并改写本提案内的引用后重跑 `change-lint` 与 `merge` | ① violation `knowledge_id_duplicate`，`path` 为 `core-K01-customer-id.md` 对应的本提案来源，`message` 同时包含 `core-K01-refund.md` 与 `core-K01-customer-id.md`；② merge 拒绝、零写入；③ `pass=true`，合并成功，最终 K01 为退款规则、K02 为客户编号规则 |
| ST-S45-05 | 升级前已 launched 的项目首次录入 | S45 Step 1～4、9～11；EX-45.9 | 真实 CLI；项目在升级前初始化并已 launched，没有 `logos/resources/knowledge/`、`logos/resources/reference/knowledge/`；活跃提案 `p1` 按 Skill 录入入口产出：原文 `logos/resources/reference/knowledge/refund-policy.md`、ADDED `deltas/knowledge/core-K01-refund.md`（结构有效，含 K01-R1）与引用 `K01-R1` 的新场景 delta | ① `change-lint --format json`；② `merge p1`；③ 读取两个目录、场景与 `resource_index` | ① `pass=true`，K01 为视图为空时的首个编号；② 退出码 0；③ `logos/resources/knowledge/core-K01-refund.md` 由合并创建，原文仍在 `reference/knowledge/`，条目 `source` 指向原文，场景引用解析到 K01-R1，`resource_index` 含条目登记 |

## 三、测试数据与断言要求

- 一次性仓库与其中的全部文件在用例结束后删除；不访问网络，不配置远端。
- 「零写入」以执行前后项目全部文件与 git 索引（`git ls-files -s`）的 SHA-256 比对取证，不以「命令报错」代替。
- 流程判定以 JSON 中的结构化字段（`violations[].code`、`violations[].path`、`warnings[].code`、`pass`、退出码）断言；`message` 只做「包含两个来源路径 / 包含 ID」之类的包含性断言，不据其反推流程结果；需要结构化比对两个来源时，在纯函数用例中断言视图的重号解析结果。violation 对象沿用 §3.15 的 `code` / `path` / `message` / `fix_hint`，不读取契约未定义的字段。
- 跨分支用例（ST-S45-02～ST-S45-04）以真实 git 分支与合并构造，不手工拼接最终文件；合并阶段用例（UT-S45-16～UT-S45-18）以真实 `merge` 与修正流程构造 `SPEC_MERGED` 与合并基线，不手写近似结构。
- 条目解析与视图构建的纯函数用例（UT-S45-02、UT-S45-03）直接传入文件内容，不经过 CLI 进程；其余用例经真实 CLI 进程执行。
- UT-S45-10 的基线由同一夹具在实现前的 CLI 版本产生并作为 golden 固化。

## 四、覆盖度校验

- S45-AC-01（条目结构与编号）：UT-S45-02、UT-S45-19、UT-S45-20、ST-S45-02、ST-S45-05。
- S45-AC-02（原始资料同仓存放）：UT-S45-13、UT-S45-15、UT-S45-20、ST-S45-05。
- S45-AC-03（按条目或规则引用）：UT-S45-05、ST-S45-01。
- S45-AC-04（同批新录入可被引用）：UT-S45-03、UT-S45-09、UT-S45-16、UT-S45-17、ST-S45-01、ST-S45-05。
- S45-AC-05（Skill 加载并写明依据）：UT-S45-15。
- S45-AC-06（冲突交用户裁决）：UT-S45-15。
- S45-AC-07（引用不存在或已退役）：UT-S45-05、UT-S45-06、UT-S45-14。
- S45-AC-08（编号重复）：UT-S45-04、ST-S45-04。
- S45-AC-09（只能退役不能删除）：UT-S45-07、UT-S45-11。
- S45-AC-10（退役 ID 冻结）：UT-S45-08、UT-S45-18、ST-S45-03。
- S45-AC-11（跨分支引用不错绑）：ST-S45-02、ST-S45-03。
- S45-AC-12（原子合并与登记）：UT-S45-01、UT-S45-12、UT-S45-16、UT-S45-17、ST-S45-01。
- S45-AC-13（零回归）：UT-S45-10。
