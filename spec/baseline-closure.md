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
| deployment/smoke | 条件 | proposal deployment_required=true | proposal 明确无需部署 |

`bootstrap: adopted` 下由接入流程自动写入的 `skip_phases` 只豁免 Initial 完整性，不能代替本表。非 adopted 的明确架构 skip 可作为强证据；与当前意图冲突时必须 AMBIGUOUS/同案修订。

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
