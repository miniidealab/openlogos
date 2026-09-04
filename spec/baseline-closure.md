# 按触达目标规格闭包规范（baseline-on-touch）

> 状态：规范性｜策略标识：`on-touch-v1`｜决策：D02｜场景：S39

## 1. 目的

让 launched/存量项目无需先执行独立全局基线工作：每次 change 在规划 tasks 时识别本次触达的 feature/scenario，只补齐它实际需要的 Why → What → How 规格。目标存在则修改，目标缺失则在一份 delta 中创建完整文档；未触达区域零成本。

## 2. 规范关键词

本文中的“必须”“禁止”“应”“可”具有规范性。违反“必须/禁止”的产物不得通过 plan/spec/merge 门禁。

## 3. 术语

- **触达场景**：本次 proposal 的行为、接口、数据、验收或部署影响所涉及的稳定 scenario；可属于已有 feature，也可在本案中新建。
- **目标（target）**：delta apply 后被创建或修改的最终规格文件。
- **canonical target path**：把 delta 路径按权威目录映射、containment 与平台路径规则规范化后的目标路径；是 cardinality 唯一键。
- **最终态 delta**：应用后目标同时包含可证实的存量事实和本次增量，不依赖同 change 的另一份先行基线 delta。
- **effective view**：已合并目标与当前 change 同目标唯一 delta 的预期合并结果。
- **eager seed**：S33 对全库执行的可选逆向扫描；不是规格闭包，也不是 change 前置条件。

## 4. 核心不变量

1. 每个非 SKIP canonical target 必须恰有一个 `[delta]` task、至多一个 delta 文件和一次 apply 结果。
2. 同目标的现状补齐与增量修改必须聚合，禁止“基线 delta + 增量 delta”。
3. `CREATE`/`MODIFY`/`SKIP`/`AMBIGUOUS` 是 plan 模式，不新增同名 merge marker；Markdown 使用章节 ADDED/MODIFIED/REMOVED/REMOVED-ITEMS，API/DB 非 Markdown 文件使用既有整文件协议的首行 ADDED/MODIFIED 控制行并在落盘前剥离。
4. API 必须从 effective scenario sequence 派生；测试必须追溯 effective requirement/scenario/API/DB。
5. 代码/测试/配置只能证明现状，不能推断历史 Why；本次 proposal 是新增意图源。
6. 不新增 baseline section/task/state/gate/marker，不恢复 JIT advisory、verified 升级或 baseline warning。

## 5. Plan 输入与证据

采信顺序：当前 proposal 意图 → 已合并规格/决策 → 当前 change 已产 delta → 可重算代码/测试/配置事实 → committed/fresh seed。冲突时不得按优先级静默覆盖，而应记录 AMBIGUOUS 或在 proposal 中明确裁决。

以下输入禁止进入 effective view：baseline-seed staging/partial 未提交集合、其它 change、archive delta、临时 prompt、无法重算的 stale seed index。

### 5.1 proposal 内唯一持久计划源

`proposal.md` 的 `## 基线闭包计划` 下必须有且仅有一个 fenced YAML；其 `baseline_closure` 对象是 L9 的唯一权威计划源。人读 Markdown 表只能投影该对象，不参与解析。v1 固定形态：

```yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S05, S39]
  targets:
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "默认 next 行为被本案修改。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S39]
      mode: SKIP
      delta_path: null
      reason: "时序证明本案无跨边界 API。"
      evidence: ["scenario:S05#主时序", "scenario:S39#参与者"]
      missing_evidence: []
```

`baseline_closure` 的 v1 必填字段为示例中的十项，缺失、重复键、错误类型或未知 `schema_version` 一律 malformed。`targets` 即使为空也必须显式存在，但 `touched_scenario_ids` 非空时 targets 不得为空。

### 5.2 targets[] 字段与组合约束

每个 target 必须恰含以下七个键；v1 未声明键 fail-closed，避免拼写错误被静默忽略：

| 字段 | 类型 | 约束 |
|---|---|---|
| `category` | enum | `requirement|feature|architecture|scenario|api|database|test|orchestration|deployment|smoke|spec|skill|decision` |
| `scenario_ids` | string[] | 非空、去重、升序；每项匹配 `^S[0-9]+$` 且属于 `touched_scenario_ids` |
| `mode` | enum | `MODIFY|CREATE|SKIP|AMBIGUOUS` |
| `delta_path` | string|null | 非 SKIP/AMBIGUOUS 必须是项目根相对 `deltas/` 精确文件路径；SKIP/AMBIGUOUS 必须为 null |
| `reason` | string | trim 后非空，说明为何适用/不适用/未决；不得只写模式名 |
| `evidence` | string[] | MODIFY/CREATE/SKIP 至少一项；每项 trim 后非空、去重 |
| `missing_evidence` | string[] | AMBIGUOUS 至少一项；其它模式必须为空 |

组合规则：

- `MODIFY|CREATE`：`delta_path` 非 null、`evidence` 非空、`missing_evidence=[]`；磁盘存在性分别为存在/缺失。
- `SKIP`：`delta_path=null`、`evidence` 非空、`missing_evidence=[]`；不得生成 task/delta。
- `AMBIGUOUS`：`delta_path=null`、`missing_evidence` 非空；`evidence` 可列已有但互相冲突的证据；不得生成 task/delta，且 plan 必须阻断。
- 非 SKIP/AMBIGUOUS 项按 `delta_path` Unicode code point 升序；SKIP/AMBIGUOUS 置后，按 `category` 再按首个 `scenario_ids` 排序。数组顺序不改变集合语义，但非规范顺序是可修复 violation，保证序列化稳定。
- YAML 字符串包含 `:`、`#`、引号、换行或首尾空白时必须使用合法引号/块标量；禁止依赖实现差异的隐式类型。重复 YAML key 一律拒绝，而非 last-wins。

### 5.3 触达场景与维度完备性

`touched_scenario_ids` 是独立于 targets 的必填全集，来源于 proposal 变更范围与影响分析。L9 不得用 targets 的 scenario 并集反推它，否则遗漏整场景会自证通过。

对每个 touched scenario：

1. `requirement`、`feature`、`scenario`、`test` 四个强制维度必须分别至少被一个非 AMBIGUOUS target 覆盖，且不得 SKIP；共享文件可用同一 target 的 `scenario_ids` 覆盖多个场景。
2. `architecture`、`api`、`database`、`orchestration`、`deployment`、`smoke` 六个条件维度必须各有一个覆盖该场景的 `MODIFY|CREATE|SKIP|AMBIGUOUS` disposition；不能因未写 target 而默认为 SKIP。
3. `api` 为 MODIFY/CREATE 时，同场景 `orchestration` 必须为 MODIFY/CREATE；api=SKIP 时 orchestration 只能 SKIP；其它组合报不一致。
4. 任一 touched scenario 未覆盖强制/条件维度，报 `baseline_closure_target_missing`；这条独立全集检查专门防止 S05 之类权威场景从计划中整体漏掉。

proposal 级 `spec|skill|decision` 属实施方法论目标，不要求逐场景齐全，但其 scenario_ids 仍必须指向受影响场景。部署/smoke 的 disposition 还必须与 proposal 部署决策一致。

## 6. 受影响场景识别

change-writer 必须：

1. 从变更意图提取用户可观察行为与验收；
2. 在 requirements/features/scenarios/代码入口/测试中定位已有身份；
3. 无稳定身份时规划新 scenario，并在 apply 事务分配/登记；
4. 记录每个场景的现状证据路径与本次意图来源；
5. 按 Why → What → How 展开目标。

candidate 首次触达可提升为导航中的 scenario，但不得升级其 provenance `verified`。

## 7. 闭包维度与适用性

| 类别 | 默认 | 适用条件 | SKIP 合法依据 |
|---|---|---|---|
| requirement/feature | 必须 | 所有触达场景 | 不允许 |
| scenario sequence | 必须 | 所有触达场景 | 不允许 |
| architecture | 条件 | 边界/数据归属/进程服务/非功能约束变化 | 纯局部且已有架构覆盖 |
| API/interface | 条件 | HTTP/RPC/消息/公开协议边界 | 时序证明无接口边界 |
| database | 条件 | 持久化实体/关系/查询/迁移 | 只用内存或无持久化 |
| UT/ST | 必须 | 所有触达场景 | 不允许 |
| API orchestration | 条件 | API/interface 适用 | API 确认 SKIP |
| deployment/smoke | 条件 | proposal deployment_required=true，或满足 §7.1 的 errata 散文订正例外 | proposal 明确无需部署且不适用 §7.1 |

`bootstrap: adopted` 下由接入流程自动写入的 `skip_phases` 只豁免 Initial 完整性，不能代替本表。非 adopted 的明确架构 skip 可作为强证据；与当前意图冲突时必须 AMBIGUOUS/同案修订。

### 7.1 errata 散文订正例外（deployment/smoke 专用，受控）

proposal 明确无需部署（`deployment_required=false`）时，deployment/smoke 维度 target 仍可为 `MODIFY`，当且仅当以下判据**全部**满足（全部机器可判）：

1. **mode=`MODIFY`**：目标为既有文件；`CREATE` 一律拒绝。
2. **纯散文订正形态**：该 delta 仅含 `MODIFIED` 块；出现 `ADDED` / `REMOVED` / `REMOVED-ITEMS` 任一块即拒绝——不新增版本节/用例/部署步骤，不删除任何章节或条目。
3. **结构化 ID 守恒相等**：S37 守恒口径下，合并前后目标文件的结构化 ID 集合**完全相等**（零删除且零新增——比一般 MODIFY 的「显式删除可授权」更严）。

约束与边界：

- 判据 2/3 在 delta 在场后由 change-lint L9 与 merge 准入**同源**校验；plan 阶段按 target 声明放行到既有流程，delta 阶段收口。任一不满足按既有 fail-closed 语义拒绝（violation 携带 `code`/`path`/`message`/`fix_hint`），不降级 warning。
- `[deploy]` section 一致性检查不变：无需部署的提案仍禁止 `[deploy]` section。
- 本例外**只放宽 disposition 准入**，不豁免任何其它门（段标记、锚唯一定位、S37 守恒、模板占位、路径映射等逐字生效）；deployment/smoke 的**实质变更**仍必须发生在 `deployment_required=true` 的提案中。
- 来源与实证：`errata-single-slice-recovery-semantics` 范围裁剪说明记录的方法论缺口（SMOKE-core-178 步骤⑤与 0.14.14 部署矩阵行的订正曾因本表旧行滞留两个提案周期）；对齐测试 UT-S39-65～67、ST-S39-29、SMOKE-core-180。

## 8. 目标模式

### 8.1 MODIFY

目标文件在 plan 时存在。task 写 `[MODIFY] <delta-path>`。delta 可用 MODIFIED 改现有锚，也可用 ADDED 加缺失章节；同目标所有块必须在一个文件。MODIFIED 必须遵守 S37 整节守恒。

### 8.2 CREATE

目标文件在 plan 时缺失。task 写 `[CREATE] <delta-path>`。Markdown delta 用 ADDED 章节承载完整目标文档；API/DB 非 Markdown delta 用整文件协议首行 `## ADDED — <canonical target>（新文件，整文件）` 加完整 payload。禁止占位/TODO/“后续补充”。apply 前目标若变为存在则模式漂移失败。

### 8.2 non-Markdown API/DB 整文件规则

- 支持 `deltas/api/**/*.{yaml,yml,json}` 与 `deltas/database/**/*.sql`；其它后缀不得套用。
- MODIFY 首行是 `## MODIFIED — <canonical target>（整文件替换）`，CREATE 首行是 `## ADDED — <canonical target>（新文件，整文件）`；声明 target 必须等于 delta 映射结果。
- evaluator/merge 只剥离首行及其行结束符，剩余 payload 原样预演；最终目标不得含控制 marker。
- API payload 做 duplicate-key-aware YAML/JSON parse、OpenAPI 3.x schema/ref/operationId 校验；SQL payload 以已合并架构/tech_stack 的方言 parser 校验，有适配器时在临时事务执行，SQLite E2E 强制真实执行。
- validator 不可用、marker/target/mode/存在性漂移、语法/执行失败均在任何正式写入前 fail-closed；混合批任一失败必须回滚全部目标/counter/index/marker。

### 8.3 SKIP

只记录在 proposal 闭包矩阵，含 category、scenario、理由、证据。不创建 checkbox/delta，不计入任务完成度。

### 8.4 AMBIGUOUS

记录缺失/冲突证据和需要的产品裁决。任一 AMBIGUOUS 使 plan 未完成；在既有 plan-exit 前一次性解决，不建立 per-target JIT 状态。

## 9. canonical target 与去重

delta path 必须经根映射得到 target，拒绝绝对路径、`..`、symlink escape 与未知类别。对 canonical target 分组；每组聚合 scenarioIds、修改意图与证据，稳定产一 task。组内出现模式冲突必须 fail-closed。

## 10. Effective view 与生成顺序

生成顺序：requirements/features → architecture/scenario → API/DB → UT/ST/orchestration → deployment/smoke → root specs/skills/decision。每一步读取此前已生成 delta 的 effective view。

专业 Skill 可生成内容或执行格式检查，但最终 delta 文件所有权归当前 change-writer；不得各自写同目标文件。

## 11. CREATE 最低完整度

- requirement/feature：身份、问题/目标、价值、范围、验收、非目标。
- scenario：目标、参与者、前后置、Mermaid sequenceDiagram、步骤、异常/边界、追溯。
- architecture：边界、数据/控制流、所有权、不变量、失败策略、实现映射。
- API：剥离整文件 marker 后为完整合法 OpenAPI/协议，含 schema、错误、鉴权、兼容/弃用且引用可解析。
- database：剥离整文件 marker 后为对应方言可解析（适配器可用时可事务执行）的完整 schema/DDL，含键、约束、索引、迁移与回滚。
- test：真实 UT/ST ID、主/异常/边界、追溯、OpenLogos reporter。
- orchestration：调用链、fixture、断言、cleanup、失败诊断、reporter。
- decision：状态、背景、决策、理由、备选、影响面、来源。

类别检查证明结构自足，不替代业务评审、语法校验或测试执行。

## 12. Plan/spec/merge 检查

- plan：严格解析唯一 YAML；校验 touched scenario/维度完备、字段组合、目标唯一、存在性、AMBIGUOUS=0、部署一致；非 SKIP targets 集合必须与 tasks canonical targets 集合完全相等。
- spec：在 plan 基础上校验 tasks 与 deltas canonical targets 集合完全相等、模式未漂移、CREATE 完整、L1–L8 继续通过。
- merge：共享 evaluator 纵深重跑；任何漂移不生成可 apply 结果。
- legacy proposal 无 policy 且无模式时只走既有检查；新模式在场但声明缺失不得逃逸。

## 13. Apply 事务

merge-executor 预计算所有目标新字节和元数据变化，非 Markdown 先剥离 marker并完成 target/语法/执行预检，备份旧字节，确认 canonical target 唯一后原子写入。CREATE 只能在目标仍缺失时落盘。scenario/decision counter 与 resource_index 在同事务更新；事后重读确认 marker 不在目标且类别校验仍通过，才写 SPEC_MERGED；失败回滚全部 MODIFY、新建文件、counter/index 与 marker。

## 14. 棕地兼容

- baseline_seed_state/coverage/provenance/baseline-seed 命令保留；三态均允许 change。
- next/status 可展示可选 seed 信息，但主 action 不由 seed state 决定，活跃 proposal 优先。
- 安全 open run / 未提交 staging 不采信，可排除后继续；未终结 commit journal 必须先恢复，失败硬报 `baseline_commit_in_progress` 并禁止读取半新 resources/index/coverage。
- 不批量迁移 skip/seed/资源，不回填未触达场景。

## 15. 无 JIT 确认红线

禁止：`verified:true`、confirmed_* 写入、逐区域确认提示、baseline_warnings、human-verified 覆盖门、新 plan/baseline gate 或 marker。事实有误时用普通后续 change 修正。

## 16. 验收

- 多场景同目标稳定得到一 task/一 delta。
- 无 seed 项目能完成首次 on-touch change。
- 缺失场景/API/DB/test 在适用时得到全量 CREATE；不适用时有证据 SKIP。
- plan/spec/merge 对模式、cardinality 与完整度结论一致且只读/原子。
- 未触达区域无产物；全流程无 JIT/verified/baseline warning 回归。

## 17. 场景 CREATE Markdown 结构完整性合同

### 17.1 适用范围与单一事实源

本节规范 `category: scenario, mode: CREATE` 的最低完整性判定，替代 scenario 分支对整段 payload 的关键词正则。`ScenarioCreateCompletenessContract` 与 Markdown authority scanner 由 baseline closure evaluator 统一持有；change-lint、merge、proposal lifecycle 只能调用该 evaluator，不得各自复制别名、阈值或围栏解析。

本节只证明目标文档结构自足，不判断业务语义是否正确，不改变 requirement/API/database/test/orchestration/decision 等其它类别的完整性合同。

### 17.2 canonical 写入与兼容读取

新建场景文档必须使用以下 canonical 二级章节：

```text
# SXX：场景名称
## 场景目标
## 参与者
## 前置条件
## 成功后置条件
## 时序图
## 步骤说明
## 异常与边界
## 追溯
```

步骤读取端接受去除首尾空白后、大小写不敏感的完整标题文本：`步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path`。其中 `main path` 保留旧校验器已有兼容。兼容标题可位于 h2～h6 ATX 标题，但新写入只能使用 `## 步骤说明`；不接受子串、模糊词干或任意包含“步骤”的标题。

### 17.3 权威 Markdown 扫描

scanner 按行维护 fenced code 与 HTML comment 状态，并输出 ATX 标题、章节范围、有序列表项和 fenced block：

- 反引号/波浪线 fence 中的标题、列表、关键词和 `sequenceDiagram` 均不属于普通 Markdown 权威结构；只有 info string 精确为 `mermaid` 的完整 fence 可作为时序候选。
- `<!-- ... -->` 单行或跨行注释中的全部内容忽略。
- 普通散文、表格、链接文字、inline code 和 Mermaid 消息中的步骤别名不作为标题。
- 未闭合 fence/comment 或 scanner 无法确定边界时 fail-closed，不退回全文正则。
- LF/CRLF 归一化只影响解析，不改写输入字节。

### 17.4 步骤章节判定

1. 受控别名命中的权威步骤章节必须恰好一个；零个为缺失，两个及以上为重复。
2. 章节范围内必须有一个连续有序列表，合计至少 3 个列表项；每项移除有序 marker 后正文 trim 非空。
3. 普通段落、无序列表、其它章节中的编号、代码 fence 内列表均不计入。
4. 标题合法但无列表、少于 3 项或存在空项分别产生精确 missing evidence，不压缩为笼统“步骤”缺失。

### 17.5 Mermaid、异常与追溯判定

- 至少一个合法 Mermaid fence 的有效正文包含 `sequenceDiagram`，并至少包含 2 条 `participant` 或 `actor` 声明和 1 条消息箭头；普通 fence/散文/注释中的相同字符串无效。
- 异常/边界章节与追溯章节必须各自唯一；章节内容排除空白、注释和 fence 样例后，至少有一段非空正文或一个非空列表项。
- 目标、参与者、前置与成功后置继续是 scenario CREATE 必需维度；本节的结构判定不得导致既有维度被移除或放宽。

### 17.6 诊断、顺序与原子性

外层 violation code 保持 `create_target_incomplete`。evaluator 一次收集全部结构缺口，按“目标/参与者/前后置/时序/步骤/异常边界/追溯”的固定维度顺序返回，并在 `message`、`missing_evidence`、`fix_hint` 中区分具体原因。

change-lint 对失败返回 exit 2 且项目字节不变。merge 在生成 `MERGE_PROMPT.md` 或任何 apply 输入前纵深重跑同一 evaluator；失败返回非零且不得写资源、guard、counter、resource_index、`SPEC_MERGED` 或其它 marker。任何 parser 异常都按不完整处理，不得因兼容需要放弃 fail-closed。

### 17.7 验收矩阵

- canonical 标题与全部受控别名、h2/h3、LF/CRLF 正例通过。
- 散文、fence、HTML 注释、样例中的关键词不能假通过。
- 空/重复步骤章节、少步骤、空项、无序列表不能通过。
- 伪 Mermaid、参与者不足或无消息不能通过。
- 空异常/边界或追溯不能通过。
- 四份历史 `主流程` fixture 通过；真实缺步骤的 change-lint/merge 失败且无副作用。

## 18. 测试变更集原子固化

### 18.1 事务边界与协议分层

baseline closure 的严格 Agent 输入继续精确使用 `openlogos/baseline-merge-apply@1`。`MERGE_APPLY_MANIFEST.json` 的顶层、prepared target 与 metadata target 字段合同不得为测试变化扩展；Agent 不填写 changed/removed ID，也不拥有正式测试记录的语义差异。

只有 `openlogos merge-apply` 同时掌握已验证 before/current 字节与 prepared final 字节，因而由它在首写前为 category=`test` targets 计算 `openlogos/test-change-set@1`，嵌入最终 `SPEC_MERGED.test_change_set`，并将完整 marker 字节加入同一 `applyBaselineClosureBatch()`。`SPEC_MERGED` 必须最后写入。

### 18.2 before/final 事实

- MODIFY：before 是与 strict manifest `before_sha256` 匹配的当前正式目标原始字节；final 是已验证 `content_base64` 解码字节。
- CREATE：语义 before 是空态，change-set `before_sha256` 必须为 `null`；final 是已验证解码字节。
- SKIP/AMBIGUOUS：不得进入 apply 批次或 change-set targets。
- 未触及 category=`test`：本批 change set 的 targets/C/R 为空。

TestDefinitionDiff 必须按 `spec/test-slice-manifest.md` 的 authority scanner 在所有测试 targets 上构建全局 before/final 记录映射，得到新增或语义修改集合 C、删除集合 R 与原样记录集合。整份 Delta 中原样携带的已有测试不能进入 C；正式 target 路径属于规范化记录，跨 target 移动必须进入 C。

### 18.3 预写校验

生成 marker 前必须完成：

1. strict apply manifest 既有 L1～L9、P=T=D、source/before/final hash 与路径 containment 校验；
2. before/final UTF-8、Markdown authority 表格和全局测试 ID 唯一性校验；
3. change-set 精确字段、排序、集合、target identity 与 canonical payload hash 自校验；
4. `change`、`module`、guard、baseline plan、strict manifest 和 marker 身份一致性校验。

任一步失败都必须在第一个正式目标写入前返回非零；不得写 resources、metadata、counter、index、marker 或恢复性 slice manifest。Git 仓库、commit、parent、branch、squash/rebase 状态不得参与计算。

### 18.4 原子 apply、复核与回滚

批事务按既有规范备份 MODIFY/metadata，跟踪本批 CREATE，并以 marker 为最后写入。写入后必须从磁盘重读全部 category=`test` targets 与 `SPEC_MERGED`，复核：

- 正式目标字节哈希等于 change-set `after_sha256`；
- marker 中 change set 可由 TestChangeSetReader 完整读取，payload hash 正确；
- targets 精确等于 baseline plan 中 category=`test` 的 canonical targets；
- marker 的 `manifest_sha256` 继续只绑定严格 apply manifest，未被 change-set payload 替代。

任一写入、fault injection、fsync/rename 或后置复核失败时，必须恢复所有 MODIFY/metadata/counter/index，删除本批 CREATE 与 marker，并返回 `rolled_back=true`。不得留下只有资源或只有 change set 的半提交状态。

### 18.5 no-delta 与历史兼容

`type=no_delta_spec_complete` 且磁盘确无 mergeable Delta 的既有 marker 可由读取器可信派生空 C/R；不得为此改写旧 marker，也不得扫描正式规格声称存在本提案变化。

新 baseline apply marker 缺少 `test_change_set` 是完整性错误。历史 marker 的兼容读取必须由明确 marker 类型和可证 no-delta 条件约束；含测试 Delta、身份不一致、未知 schema 或 target 哈希漂移时一律 fail-closed，不从 Delta 或 Git 补算。

### 18.6 验收

- before/final 的新增、语义修改、原样、删除与跨 target 移动分类准确且确定；
- 严格 apply manifest 字段合同保持逐字不变；
- resources、metadata 与带 change set 的 marker 全有或全无；
- 重启和无 Git 环境读取结果一致；篡改 target 或 marker 必须稳定拒绝；
- S32 所有消费者只读取同一 change set，`O = C`，R 不进入切片归属。

## 合并事务中的 baseline closure

### 单一事务边界

当一次合并触碰受 baseline 管理的正式目标时，canonical resources 与由 OpenLogos 生产的 metadata 必须属于同一个 `merge transaction`。事务目标闭包由 seal 前的 canonical target set 加确定性 metadata expansion 得出；任何消费者不得在 seal 后增删目标。

闭包至少覆盖：

- proposal 声明的所有 canonical resource targets；
- 这些目标触发的 `logos-project.yaml` 场景计数器、资源索引及 ownership 元数据；
- OpenLogos 仓内 dogfood 镜像；
- `SPEC_MERGED` 或等价完成 marker；
- completed receipt 本身及其持久化索引。

### 内容槽与身份冻结

每个需要 Agent 合成的资源目标对应一个声明式 `content_slot`。slot 身份至少包含 `slot_id`、`delta_path`、`target_path`、`mode`、`source_sha256` 与 `before_sha256`；Agent 只提交最终字节。metadata 目标由核心根据 sealed resources 确定性生成，不开放 Agent 可写 slot。

`seal` 必须在任何正式写入前验证：目标集合唯一、路径位于允许根、delta/source hash 匹配、MODIFY 的 before hash 匹配、CREATE 不存在、全部必需 slot 已填充且内容 hash 可复算。校验失败不得产生正式目标副作用。

### 原子 apply 与恢复

核心事务 writer 必须先预演完整闭包，再以全有或全无方式提交 resources、metadata、dogfood 与 marker。崩溃恢复以持久化 transaction journal 和 seal hash 为依据：

- 未开始正式写入时可安全重试 apply；
- 已完成全部写入但 receipt 未持久化时，复核目标 hash 后补写同一 receipt；
- 任一目标与 sealed hash 不符时进入 `failed`，给出稳定 classification，不得将部分态标为 completed；
- 对 completed 事务重复 apply 必须返回同一 receipt，且不重写目标。

### no-delta 与历史边界

no-delta 事务的 resource target set 可以为空，但 metadata closure、seal、apply 与 receipt 规则不变。历史 manifest 只可作为迁移诊断输入，不能充当 0.14.0 新事务的写入授权或成功证明。本节优先于本文件中任何“逐目标 apply 后再补 metadata/marker”的旧描述。

### 完成判定

只有同时满足以下条件才可进入 `completed`：sealed closure 完整、所有 after hash 已复核、metadata 与 resources 属于同一提交、marker 指向同一 transaction id、completed receipt 已持久化且通过 `openlogos/merge-transaction@1` 校验。

## 消费者可提交闭包与无环 hash


### 集合定义

`payload_paths` 是 apply 产生的非自引用正式内容集合，等于 changed_paths 与 created_paths 的去重并集。`final_hashes` 必须逐项覆盖 payload_paths。

`protocol_artifact_paths` 固定为公共 receipt 与 `SPEC_MERGED` marker；`artifact_hashes` 必须逐项覆盖该集合。`commit_paths` 等于 payload_paths 与 protocol_artifact_paths 的去重并集。

### 守恒不变量

- final_hashes 与 artifact_hashes 的 path 不得重叠；
- 两者 path 并集必须精确等于 commit_paths；
- 所有 path 均为规范化项目根相对路径、稳定排序、无逃逸和 symlink；
- content、Agent staging、临时文件、backup、journal、私有 transaction state 永不进入 commit_paths；
- receipt_sha256 是排除自身字段后的 canonical receipt payload identity；
- receipt/marker 文件 hash 只位于 completed projection 外层，禁止自引用。

### 阶段门

seal 冻结 payload 输入；apply 验证 payload 后写 receipt/marker；completed projector 最后计算 artifact hashes。任何集合或 hash 不变量失败都不能写 completed。

上述集合相等、互斥、稳定排序、计数守恒与 canonical identity 由 `openlogos/merge-transaction-semantic@1` 校验；JSON Schema 负责结构、类型、枚举和可表达的阶段条件。生产者与消费者必须同时执行两层校验，不得把 Schema 通过等同为事务合同通过。

## 19. Seal-bound Preflight 与 Test-change-set 归因


### 19.1 Preflight 输入与纯度

merge transaction在seal前以冻结Delta source、正式before和全部candidate final bytes构建`openlogos/merge-preflight@1`内部view。builder必须纯只读：不得写phase、journal、staging、backup、receipt、marker或正式target，也不得调用带恢复/清理副作用的apply入口。

### 19.2 Canonical View

view至少包含：

- transaction ID、plan hash、target-set hash；
- planned/derived targets的canonical path、mode、producer、before/final SHA-256；
- after测试定义严格扫描与`test-change-set` SHA-256；
- metadata/counter/index、dogfood/prototype绑定；
- 最终target path集合；
- view自身SHA-256。

数组ASCII排序去重，object固定键序列化。`completed_at`、临时路径、进程ID等非确定性值不得进入view。

### 19.3 Seal 与 Apply

新`seal_sha256`绑定content hashes和`preflight_sha256`。apply首个可变动作前重算view并逐项相等；metadata/before/derived/path集合漂移均fatal，禁止基于新基线静默rebase。apply成功的receipt确定性payload必须来自sealed view。

### 19.4 Test-change-set 结构化错误

after侧继续严格拒绝列数不一致、重复ID、非法UTF-8；before侧历史兼容不变。scanner/builder内部错误至少携带`code,target_paths[],producer,retryable`。跨target duplicate只有明确列出全部责任targets且全部唯一映射到可修复Agent slots时才可共同reopen；无法确定责任集合则fatal。

### 19.5 Legacy 事务

缺preflight record的0.14.1 sealed事务在apply首写前生成ephemeral view。pass则保持legacy seal完成apply；attributable fail则reopen。reopen后下一次seal使用新view/new seal。completed、applying或任何journal/receipt/marker/正式新字节不兼容迁移。

### 19.6 Reopen 与闭包守恒

reopen先原子持久化collecting：外层seal null、全部sealed hash null、rejected submitted hash null、其它submitted hash不变；之后才清理rejected私有字节。正式闭包、metadata和marker在该路径零写。只有completed receipt的final/artifact/commit paths构成可提交闭包。

### 19.7 验收

UT-S39-56～58、ST-S39-27与SMOKE-core-160～162必须覆盖歧义after、metadata drift、多target归因、legacy fixture、崩溃窗口、残留私有字节和RunLogos真实事务。
