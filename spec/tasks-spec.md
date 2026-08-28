# tasks.md 结构化格式规范

> 版本：1.0.0
>
> 本文档定义 OpenLogos 变更提案中 `tasks.md` 的结构化格式。CLI 依赖此格式对各阶段任务进行精确的状态判断。

## 格式规范

tasks.md 使用带标记的 section 组织任务，每个 section 对应提案流程中的一个阶段：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新需求文档
- [ ] 产出 delta 文件到 deltas/api/ — 更新 API YAML

## [code] 代码实现
- [ ] 实现 src/xxx 中的业务逻辑
- [ ] 编写对应测试

## [deploy] 部署任务
- [ ] 按部署方案部署到 staging
- [ ] 确认迁移、配置、服务启动和回滚预案
```

`[deploy]` section 只能在 `openlogos verify` 通过后执行。默认/手动模式下必须由人类明确确认后发起，AI 不得因为 `[deploy]` 任务存在而自动执行部署；无人值守 `openlogos next --auto` 模式下，launched flow 的 deliver 入口门 `skippable:true`，可被自动放行（向 `GATE_AUTO_PASSED` 追加审计行后执行部署，因部署目标可能是测试环境而非生产）。

**`[code]` section 的切片划分时机（split-slice-planner-stage）**：`plan` 段 `write-tasks` 只产 `[delta]` / `[deploy]`，**不再划分 `[code]` 切片**；`[code]` 切片由 **merge 之后、implement 之前**的独立 `slice` 子流程（`slice-planner` skill）撰写——以**已合并的规格 + 真实 UT/ST 测试 ID**为输入，逐片过「删后续证伪门」后写入。切片的「唯一事实源」为 slice-planner（一次定死、下游 code-implementor 忠实逐片消费）。纯文档提案（无 `[code]`）时 `slice` 子流程整段跳过（`when: code_required`）。

**提前填充的兜底（enforce-slice-stage-ordering）**：若 `write-tasks` 阶段仍把 `[code]` 提前填充，CLI 会在「进入 slice 段」的确定性动作上自动清理（auto-reset）——有 delta 提案于 `openlogos merge` 时、纯代码提案于 plan 门放行时，把 `[code]` 重置为占位并把旧内容备份到提案目录 `CODE_AUTORESET`（append-only jsonl，可追溯），随后由 merge 后 slice-planner 对真实测试 ID 重新划分。清理**不阻断流程、无人值守自愈**。详见 `spec/flow-spec.md` §12.7。

**需要代码提案的 `[code]` 标题保留与缺失诊断（fix-missing-code-section-slice-gate）**：`tasks.md` 的 `## [code]` 标题在 split-slice-planner-stage 后不仅是切片承载区，也是“本提案需要代码实现、merge 后应进入 slice-planner”的结构锚点。凡 launched 提案满足 `code_required==true`，plan 段必须保留空 `## [code] 代码实现` 标题，切片条目仍由 merge 后 `slice-planner` 填写。

必须保留空 `[code]` 标题的情况：

- 变更类型为代码级修复；
- proposal / tasks / delta 明确提到后续业务代码、测试代码、OpenLogos reporter、runner、CLI 派生或 UI/driver 消费侧实现；
- `[delta]` 会新增或修改 `UT-*` / `ST-*` / `SMOKE-*` 测试用例，且这些用例需要后续实现覆盖；
- change-writer 无法确定是否纯文档时，宁可保留空 `## [code]` 标题，让 merge 后的 slice-planner 作最终切片判断。

禁止的解释：

- 对需要代码的提案，`tasks.md` 缺失 `## [code]` 不得被解释为“无代码任务 / code remaining 为 0”。
- 对需要代码的提案，`[code]` 为空或模板占位不得被解释为“可 verify”，只能解释为“切片未规划”。

### Section 标记

Section 标题格式为 `## [<tag>] <描述>`，其中 `<tag>` 为小写英文标识符：

| 标记 | 阶段 | 说明 |
|------|------|------|
| `[delta]` | delta-writing | delta 文档产出任务。该 section 全部勾选 → 可进入 ready-to-merge |
| `[code]` | coding | 代码实现任务。**由 merge 后的 `slice` 段（slice-planner）撰写切片**，再由 code-implementor 逐片实现；该 section 全部勾选 → coding 阶段完成 |
| `[deploy]` | deployment | 部署执行任务。只在 verify PASS 后展示；默认须人类确认后执行，无人值守 `--auto` 下可经 deliver 门自动放行 |

### 规则

1. **`[delta]` section 只列 delta 任务**：每条任务必须对应一个 delta 文件的产出，不得混入代码或部署任务
2. **`[code]` section 只列代码任务**：直接修改 `src/`、`test/` 等源文件的任务，不得混入 delta 或部署任务。**`[code]` 切片在 merge 后由 slice-planner 对真实测试 ID 划分**，`plan` 段 `write-tasks` 不得提前划分 `[code]`（若提前填充，CLI 在进入 slice 段时 auto-reset 并备份到 `CODE_AUTORESET`、作废，见 `spec/flow-spec.md` §12.7）
3. **`[deploy]` section 只列部署任务**：部署、迁移、发布、重启、配置检查、回滚准备等任务写入此 section，不得混入代码实现任务
4. **三个 section 均为可选**：
   - 纯代码提案（无规格变更）：只有 `[code]` section，无 `[delta]` section
   - 纯规格提案（无代码实现）：只有 `[delta]` section，无 `[code]` section（`slice` 子流程整段跳过）
   - 不需要部署的提案：不得创建 `[deploy]` section
5. **部署决策一致性**：`proposal.md` 声明无需部署时不得存在 `[deploy]` section；声明需要部署时必须存在 `[deploy]` section
6. **Section 内可有子标题**：用于分组，不影响 CLI 解析（CLI 只识别 `## [tag]` 级别的 section 边界）
7. **Section 顺序**：建议 `[delta]` 在前，`[code]` 居中，`[deploy]` 最后，与流程顺序一致

## 状态判断规则

CLI 的 `detectProposalStep()` / `detectProposalStepViaFlow()` 按以下规则判断各阶段是否完成：

| tasks.md / 标记状态 | 判断结果 |
|---|---|
| 提案模板未填写完整（`proposal.md` 或 `tasks.md` 任一未脱模板） | → `writing` |
| `proposal.md` 与 `tasks.md` 均已脱模板，但 `[delta]` 尚未开始产出且 `PLAN_APPROVED` 不存在（对应 plan 出口「批准方案」门待放行） | → `ready-to-delta` |
| `PLAN_APPROVED` 存在，且有 `[delta]` section 但尚未全部勾选 | → `delta-writing` |
| 有 `[delta]` section 且全部勾选，且未生成 MERGE_PROMPT | → `ready-to-merge` |
| 已生成 `MERGE_PROMPT.md` / `MERGE_PROMPT_GENERATED`，但未写入 `SPEC_MERGED` | → `merge-generated` |
| `code_required==true` 且缺少 `SPEC_MERGED` / `MERGED`（包括无 `[delta]` 的纯代码提案） | → `spec-complete-required` |
| spec-complete 已完成、`code_required==true`，但无法解析真实 `UT-*` / `ST-*` / `SMOKE-*` ID | → `test-id-required` |
| `SPEC_MERGED` / `MERGED` 存在、测试 ID 已稳定、`code_required==true`、`[code]` 未脱模板或缺失 | → `ready-to-implement`（前沿 `plan-slices`） |
| `SPEC_MERGED` / `MERGED` 存在、测试 ID 已稳定、`[code]` 已脱模板但 `SLICES_APPROVED` 不存在 | → `ready-to-implement`（前沿 `slice-exit`） |
| `SLICES_APPROVED` 存在，且 `[code]` section 未全部勾选 | → `coding` |
| `SPEC_MERGED` / `MERGED` 存在，且无代码需求或 `[code]` 全部勾选 | → `ready-to-verify` |
| `VERIFY_FAIL` 存在 | → `verify-failed` |
| `proposal.md` 与 `[deploy]` section 冲突 | → 阻塞态；CLI 输出 warning，不推进 deploy / smoke / archive |
| `VERIFY_PASS` 存在，提案级无需部署，且无 `[deploy]` section | → `verify-passed` |
| `VERIFY_PASS` 存在，提案级需要部署，且 `[deploy]` section 存在但 `DEPLOY_DONE` 不存在或 `[deploy]` 未全勾 | → `ready-to-deploy` |
| `DEPLOY_DONE` 存在、`[deploy]` 全部勾选，且提案级无需 smoke | → `deploy-done` |
| `DEPLOY_DONE` 存在、`[deploy]` 全部勾选，且提案级需要 smoke，但 `SMOKE_PASS` / `SMOKE_FAIL` 均不存在 | → `ready-to-smoke` |
| `SMOKE_FAIL` 存在 | → `smoke-failed` |
| `SMOKE_PASS` 存在 | → `smoke-passed` |

> **纯代码提案（无 `[delta]`）绝不派生 `delta-writing`**：`delta_required==false` 时不进入 `write-delta`。但纯代码提案不再以“无 `[delta]`”自动满足 merge 前置；缺少 no-delta `SPEC_MERGED` 时必须停在 `spec-complete-required`。详见 `spec/flow-spec.md` §12.6。

> **no-delta `SPEC_MERGED`**：`openlogos merge <slug>` 在无 delta 时写入 `SPEC_MERGED`，内容建议包含 `type:"no_delta_spec_complete"`、`reason`、`completed_at`。该 marker 表示“规格阶段已完成且无文档 delta”，不是主规格被修改。

> **缺失测试 ID 的代码必需态**：代码提案进入 `plan-slices` 前必须有真实测试 ID。无法解析时，派生为 `test-id-required`，诊断 `code_change_requires_real_test_ids`；不得让 slice-planner 使用占位 ID。

> **缺失 `[code]` 的代码必需态**：`SPEC_MERGED` 在场、`code_required==true`、`tasks.md` 缺失 `## [code]` 时，派生为 `ready-to-implement`，`next_node.id=="plan-slices"`，诊断 `tasks-code-section-missing`。`SPEC_MERGED` 在场、`code_required==true`、`## [code]` 存在但未 `tasks_code_filled` 时，同样派生为 `ready-to-implement`，诊断 `slices-not-planned`。只有 `code_required==false` 且缺失 `[code]` 时，才按纯文档/退化 implement 路径推进，可跳过 slice。

> **change-flow-redesign 新增 `ready-to-delta`**：前段 `plan` 子流程（write-proposal + write-tasks）完成、`spec`（write-delta）尚未开始时的驻留态，对应 plan 出口「批准方案」门（gate_id=`plan-exit`、`skippable:true`）。其检测依据为"proposal/tasks 已脱模板、尚无 delta 产出、且 `PLAN_APPROVED` 不存在"。

> **`PLAN_APPROVED`**：`openlogos next --auto` 在 `ready-to-delta` 自动放行 `plan-exit` 时写入的 marker。该 marker 表示 plan gate 已被消费；**当提案含 `[delta]` section 时**，存在后即使尚未产出 delta 文件，也应派生为 `delta-writing` / `write-delta` 前沿。**无 `[delta]` 的纯代码提案不受此条影响**（不派生 `delta-writing`，见上）。`GATE_AUTO_PASSED` 仍为审计文件，不作为状态判断依据。

> **split-slice-planner-stage 新增 `ready-to-implement`**：spec-complete 之后、implement 之前的独立 `slice` 子流程（`plan-slices`，slice-planner）完成切片撰写、但 `slice` 出口「切片待批准」门（gate_id=`slice-exit`、`skippable:true`）尚未放行时的驻留态。检测依据为"`SPEC_MERGED` / `MERGED` 在场、测试 ID 已稳定、提案 `code_required`、`[code]` 已由 slice-planner 写定脱模板、且 `SLICES_APPROVED` 不存在"。`[code]` 切片由 merge 后对真实测试 ID 划分；`plan` 段 `write-tasks` 不再产 `[code]`。纯文档提案（无 `[code]`、`code_required==false`）时 `slice` 子流程整段跳过，merge 后直接进入 `ready-to-verify` / 退化 implement。

> **`SLICES_APPROVED`**：`openlogos next --auto` 在 `ready-to-implement` 自动放行 `slice-exit` 时写入的 marker。该 marker 表示 slice gate 已被消费；存在后即派生为 `coding` / `code` 前沿（前沿 `next_node.id == "code"`）。`GATE_AUTO_PASSED` 仍为审计文件，不作为状态判断依据；幂等——已存在 `SLICES_APPROVED` 时重复 `next --auto` 不再追加同一 `slice-exit` 审计行。

### deploy-done 命令与部署任务状态

`openlogos deploy-done` 是部署完成状态的受控写入命令。部署动作仍由部署方案、人类授权和外部命令完成；`deploy-done` 只在部署已经成功后写入 OpenLogos 状态。

规则：

1. `deploy-done` 成功前必须存在 `VERIFY_PASS`，且不得存在 `VERIFY_FAIL`。
2. `deploy-done` 成功前必须确认提案级 `deployment_required=true` 且部署决策无冲突。
3. `deploy-done` 成功前必须存在非空 `[deploy]` section 和 `logos/resources/verify/deployment-report.md`。
4. `deploy-done` 成功后必须把 `[deploy]` section 全部勾选并写入 `DEPLOY_DONE`。
5. `deploy-done` 成功后必须清理旧的 `SMOKE_PASS` / `SMOKE_FAIL`。
6. `DEPLOY_DONE` 不得由 AI skill 手写作为推荐路径；deployment-executor 应调用 `openlogos deploy-done`。

状态判断补充：

| tasks.md / 标记状态 | 判断结果 |
|---|---|
| `VERIFY_PASS` 存在、提案级需要部署、`[deploy]` 存在但缺少 `DEPLOY_DONE` | → `ready-to-deploy` |
| `VERIFY_PASS` 存在、提案级需要部署、`DEPLOY_DONE` 存在但 `[deploy]` 未全勾 | → `ready-to-deploy` |
| `VERIFY_PASS` 存在、`DEPLOY_DONE` 存在、`[deploy]` 全部勾选、提案级需要 smoke | → `ready-to-smoke` |
| `VERIFY_PASS` 存在、`DEPLOY_DONE` 存在、`[deploy]` 全部勾选、提案级无需 smoke | → `deploy-done` |

优先级规则：

1. `VERIFY_FAIL` 高于 `VERIFY_PASS`、`DEPLOY_DONE` 和 `SMOKE_PASS`
2. `SMOKE_FAIL` 高于 `SMOKE_PASS`
3. 活跃提案的 `proposal.md` 部署决策高于模块级 `deployment_required` / `smoke_required`
4. 重新运行 `openlogos verify` 且失败时，必须清理过期的 `VERIFY_PASS`、`DEPLOY_DONE`、`SMOKE_PASS`、`SMOKE_FAIL`
5. 重新部署时，必须清理过期的 `SMOKE_PASS` / `SMOKE_FAIL`
6. `proposal.md` 与 `[deploy]` section 冲突时，必须优先报告冲突，不得推进到 deploy / smoke / archive
7. 重新执行 `openlogos deploy-done` 必须清理过期的 `SMOKE_PASS` / `SMOKE_FAIL`
8. `openlogos smoke` 不得替代 `openlogos deploy-done` 写入 `DEPLOY_DONE`

## 部署与冒烟测试设计要求

当提案 `proposal.md` 的部署影响为“需要部署”时：

- `change-writer` 必须创建 `[deploy]` section
- delta-writing 阶段必须产出部署方案 delta，通常位于 `deltas/prd/3-technical-plan/3-deployment/`
- 测试设计阶段必须一并设计部署冒烟测试，建议写入 `logos/resources/test/smoke/<module>-smoke-test-cases.md`
- 部署完成后仅在提案级 `是否需要 smoke：是` 时运行 `openlogos smoke`
- smoke 通过后才能 archive；无需 smoke 的提案在部署完成后可 archive

当提案 `proposal.md` 的部署影响为“不需要部署”时：

- 不得创建 `[deploy]` section
- 不产出部署方案 delta，除非本次变更正在修改部署规则本身
- verify PASS 后直接进入 `verify-passed`，下一步为 `openlogos archive <slug>`

冒烟测试不写入 `[deploy]` section 作为可勾选任务。`[deploy]` 只表示部署执行完成；冒烟测试由 `openlogos smoke` 命令独立管理。

**提案一致性要求**：

- `proposal.md` 与 `tasks.md` 的部署结论必须一致
- 生成 `proposal.md` 和 `tasks.md` 后应先执行一致性自检
- 若自检失败，任务状态不得推进到 `delta-writing` 之后的阶段

## 向后兼容

没有 `## [tag]` 标记的旧格式 tasks.md 继续使用原有的全局勾选判断逻辑，不破坏已有提案。

## 示例

### 需求级变更（有 delta + 有代码）

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新 S03 验收条件
- [ ] 产出 delta 文件到 deltas/prd/3-technical-plan/2-scenario-implementation/ — 更新 S03 时序图
- [ ] 产出 delta 文件到 deltas/api/ — 更新 /orders API

## [code] 代码实现
- [ ] 修改 src/orders/handler.ts — 新增退款逻辑
- [ ] 编写 test/orders/refund.test.ts
```

### 纯代码修复（无 delta）

```markdown
# 实现任务

## [code] 代码实现
（本段在 plan 段留空：无 `[delta]` 时不进入 `write-delta`，但仍需执行 no-delta `openlogos merge <slug>` 写入 `SPEC_MERGED`，随后由 `slice-planner` 基于已完成 spec-complete 的规格与真实测试 ID 划分切片。）
```

保留 `## [code]` 标题是硬要求；执行 no-delta merge 是进入 `plan-slices` 的硬前置。见 `spec/flow-spec.md` §12.6。

### 纯规格变更（无代码）

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 补充非功能性需求
- [ ] 产出 delta 文件到 deltas/prd/2-product-design/1-feature-specs/ — 更新交互说明
```

## 切片完成声明与证据关系

### 任务勾选语义

`tasks.md` 的 `[code]` 切片勾选表示当前切片合同已完成：业务代码、对应 UT/ST、OpenLogos reporter 与必要 fixture/golden 已落盘。该勾选不表示全量 verify 必然通过。

### 证据分层

| 证据 | 证明内容 | 不能证明 |
|---|---|---|
| `[code]` 切片勾选 | 本片合同已完成 | 全量回归已通过 |
| `test-results.jsonl` 本片 ID pass | focused tests / reporter 通过 | 非本片测试通过 |
| `acceptance-report.md` PASS | 全量验收通过 | artifact 声明完整 |
| artifacts 列表 | agent 声明产物 | 产物一定满足切片合同 |

### 规则

- 全量 verify 失败不得自动反向取消 `[code]` 切片勾选。
- 若 artifacts / reporter 缺失，应输出当前切片未完成诊断，而不是依赖全量 verify 失败推断。
- 若本片证据完整但全量失败，应进入 repair / code，保留本片完成事实。
- driver 更正 artifacts 声明时，不应要求改写 tasks；应重新校验证据并追加 audit。

## on-touch-v1 的 delta 目标模式与唯一性

### 适用范围

proposal 声明 `baseline_closure.policy: on-touch-v1` 时，`[delta]` checkbox 必须显式写目标模式：

```markdown
- [ ] [MODIFY] `deltas/prd/.../existing.md`：聚合描述
- [ ] [CREATE] `deltas/test/new.md`：完整新目标描述
```

模式位于 checkbox 后、目标路径前，闭合枚举仅 `MODIFY|CREATE`。`SKIP` 与 `AMBIGUOUS` 不得写成 checkbox。

### proposal 权威闭包声明

tasks 不是目标全集的来源。on-touch-v1 proposal 必须按 `spec/baseline-closure.md` §5.1–5.3 持久化唯一 fenced YAML：

- `baseline_closure.schema_version: 1`；
- 独立 `touched_scenario_ids[]`；
- 规范化 `targets[]`，每项固定含 `category`、`scenario_ids`、`mode`、`delta_path`、`reason`、`evidence[]`、`missing_evidence[]`；
- `MODIFY|CREATE` 要求非空 delta_path/evidence、空 missing_evidence；`SKIP` 要求 null delta_path、非空 evidence；`AMBIGUOUS` 要求 null delta_path、非空 missing_evidence；
- 重复 YAML key、重复 canonical target、空理由、非法枚举、错误 null 组合、非规范路径或遗漏 touched scenario 的强制/条件维度一律 fail-closed。

人读“闭包结论”表不是 parser 输入。L9 必须先解析 proposal targets，再比较 tasks；不得只从已有 tasks 推断计划全集，否则被漏写的场景/目标无法被发现。

### 一文件一任务

每条 `[delta]` task 必须对应一个精确 delta 文件，不得只写目录。所有路径先映射/规范化为 canonical target：

- 同一 target 恰一条 task；多场景/多章节变化合并进该条描述。
- task 文字中的目标与实际 delta 文件路径一一对应。
- 禁止同一 target 的“建立基线”任务和“实现增量”任务并存。
- 根规格、Skills、decision 与 resources 目标遵循同一规则。

### 模式判据

- `MODIFY`：plan 时目标文件存在；同 delta 可有 MODIFIED 与 ADDED 块。
- `CREATE`：plan 时目标文件不存在；Markdown delta 用 ADDED 章节产完整文档，API/DB non-Markdown delta 用与 canonical target 一致、可剥离的 ADDED 首行控制行加完整 payload。
- plan 后存在性变化必须返回 plan/spec 修正，不能自动换模式。

non-Markdown `.yaml|.yml|.json|.sql` task 的路径仍映射同一个 canonical target；控制行不是第二个 target，也不得进入最终目标。mode/声明 target、后缀、目标存在性、剥离后语法或整文件完整度任一不符时，spec 以 `non_markdown_delta_invalid`/`create_target_incomplete` fail-closed。

### SKIP 记录

不适用目标只写在 proposal `baseline_closure.targets[]`，使用 `mode: SKIP`、`delta_path: null`、非空 `reason`/`evidence[]`、空 `missing_evidence[]`。它不出现在 `[delta]`、不参与 checkbox 总数，也不生成空文件。缺证据的 SKIP 是 malformed，不能默认为合法不适用。

### AMBIGUOUS 处理

信息不足/冲突时在 proposal target 写 `mode: AMBIGUOUS`、`delta_path: null` 与非空 `missing_evidence[]`；已有冲突事实可写入 `evidence[]`。tasks 不得为其生成猜测路径。缺 `missing_evidence[]` 的 AMBIGUOUS 是 malformed；任一合法 AMBIGUOUS 在场时 proposal/tasks 未完成，不得通过 plan-exit。

### L9 三方集合对账

设：

```text
P = proposal.targets 中 mode∈{MODIFY,CREATE} 映射后的 canonical target 集合
T = tasks.md [delta] 中 [MODIFY]/[CREATE] 路径映射后的 canonical target 集合
D = deltas/ 中可合并文件映射后的 canonical target 集合
```

- plan：必须 `P == T`，且两侧无重复；SKIP/AMBIGUOUS 不进入 T。
- spec：必须 `P == T == D`，同时逐目标 mode、delta path 与磁盘存在性一致。
- `P-T` 是漏 task，`T-P` 是未声明 task，`D-P`/`D-T` 是未规划 delta，`P-D`（任务已完成时）是漏 delta；全部差异逐项报告，不首错短路。
- `targets_total/modify/create/skip/ambiguous` 只从 proposal targets 计算；不得从 tasks/deltas 倒算 SKIP 或 AMBIGUOUS。

### 完成语义

1. 每产出一个 delta 文件，必须立即把同 task `[ ]` 改为 `[x]`；不得批末统一勾选。
2. `[x]` 表示该精确文件已存在且达到当前阶段结构要求，不是“正在处理”。
3. `[delta]` 全勾时，plan 文字不再作为 L3/L9 证据；必须有实际测试/目标 delta。
4. `[code]` 标题仍在 plan 留空，由 merge 后 slice-planner 基于真实 ID 写入。
5. `[deploy]` 继续只追踪部署执行；verify/smoke 命令不写进 tasks。

### 合法示例

```markdown
## [delta] 规格变更
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S12/S13 共享主需求的最终态修改
- [ ] [CREATE] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-payment.md`：完整场景时序与异常
- [ ] [CREATE] `deltas/test/core-S40-test-cases.md`：完整 UT/ST 与 reporter 契约

## [code] 代码实现
> merge 后由 slice-planner 填写。
```

### 非法示例

```markdown
- [ ] 建立 S40 基线
- [ ] 修改 S40 增量
- [ ] [SKIP] API
- [ ] [CREATE] `deltas/test/`
```

原因依次为：同目标双任务、SKIP 误入完成度、路径不是文件。

### Legacy 兼容

未声明 on-touch-v1 且任务无模式的历史提案按原格式解析。任何任务已使用 `[MODIFY]`/`[CREATE]` 时，proposal 缺策略声明视为结构错误，不能退回 legacy。

## [code] 切片与 TEST_SLICE_MANIFEST 映射

### 结构职责

`tasks.md` 的 `[code]` section 继续承载人读任务、父子 checkbox 与实现进度；`TEST_SLICE_MANIFEST.json` 承载机器稳定的 `slice_id`、测试唯一归属、runner selector 和 fingerprint。两者互相校验，但 verify 与宿主不得从 task 自然语言临时重建归属。

### 顶层切片映射

- manifest 的 `slices[]` 数量和顺序必须与 `[code]` 顶层 checkbox 一致。
- 每个 manifest slice 的 `task_text` 等于对应顶层 checkbox 去除列表/checkbox 语法后的规范化文本。
- 每个顶层 task 对应唯一 `slice_id`；缩进 checkbox 属于父切片，不生成独立 slice ID。
- `slice_id` 在 checkbox 勾选、空白格式化和重试时保持稳定；切片语义文本变化必须刷新 task fingerprint 并触发 stale 校验。

### fingerprint

`task_fingerprint` 对 `[code]` section 的规范化结构计算 SHA-256：保留顶层顺序、规范化 task 文本与父子关系；忽略 checkbox 的 checked 状态、行尾空白和无语义空行。这样勾选进度不会使 manifest 失效，重切片或改写语义会使其 stale。

`spec_fingerprint` 由 manifest 声明的测试规格目标及其规范化内容计算，必须覆盖 owned ID 的定义。任何测试新增、删除、重命名或语义内容变化均触发重建；测试结果 JSONL 不参与 fingerprint。

### 完成判定

```text
slices_planned = code_section_has_real_top_level_tasks ∧ manifest_valid
slice_task_done(slice) = parent_checked ∧ every(child_checked)
slice_checkpoint_done(slice) = current_manifest_has_PASS_checkpoint(slice_id)
ready_for_final = every(slice_task_done) ∧ every(slice_checkpoint_done)
```

任务完成与 checkpoint 完成是独立事实；前者不能代替后者。父 checkbox 先勾选但 checkpoint 未通过时，OpenLogos 仍以该 slice 为 attempted。

### 恢复约束

恢复模式只能写 manifest，不得修改 `[code]` 文本、顺序、父子结构或 checkbox。若既有 tasks 无法为测试建立唯一归属，slice-planner 必须返回歧义，不能为通过 validator 而偷偷重切。初次规划同时写 tasks 与 manifest；恢复重建只替换 manifest。

### Legacy

单切片代码提案、docs-only 提案和已越过 final 的历史提案可以没有 manifest，并沿用既有 tasks 解析。处于多切片 implement 的历史提案缺 manifest 时，`slices_planned` 不视为完整，进入 `plan-slices` 恢复动作，但保留当前 checkbox。

### launched 初始模板

需要规格与代码的 launched change 初始 tasks 形态为：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 更新需求文档的场景和验收条件
- [ ] 更新产品设计文档的功能规格

## [code] 代码实现
```

`[delta]` 行是必须由 change-writer 替换的 scaffold；`[code]` 是代码必需锚点，不得生成 `实现代码变更` 或其它 checkbox。纯规格 change 删除 `[code]`；纯代码 change 保留空 `[code]` 并走 no-delta spec-complete。

### 三个独立谓词

| 谓词 | 适用阶段 | 完成条件 |
|---|---|---|
| `tasks_plan_filled` | plan | `[delta]/[deploy]` 无模板残留、目标唯一、部署决定一致 |
| `tasks_code_required` | plan 及以后 | proposal/tasks/delta 表明需业务代码、测试、runner、reporter 或 UI/driver 实现 |
| `tasks_code_slices_filled` | spec-complete 后 | `[code]` 至少一个真实切片，非模板占位，引用真实测试 ID |

### 非法状态与修复

- plan 阶段 `[code]` 出现 checkbox：`tasks_code_entry_before_spec_complete`，删除条目但保留代码必需标题。
- 代码必需但缺 `[code]`：`tasks_code_section_missing`，补空标题。
- plan scaffold 行未替换：模板残留，plan 不 ready。
- merge 后空 `[code]`：不是 plan 失败，而是 `plan-slices` 尚未完成。

### 兼容

旧格式 tasks 的 post-plan 前沿保持历史兼容；仍在 writing 的 launched change 按新合同诊断。只读命令不执行 auto-reset；既有 merge/slice auto-reset 边界不变。

## Delta closure 与 merge transaction 目标身份

### 三方身份对账

进入 merge transaction 前，proposal canonical target set、tasks `[delta]` 条目与磁盘 Delta 必须继续满足 `P = T = D`。核心据此创建不可变 target identity；每项至少包含：

- `delta_path` 与 canonical `target_path`；
- `mode=CREATE|MODIFY`；
- category/root ownership；
- 原始 Delta 的 `source_sha256`；
- MODIFY 的 `before_sha256`，CREATE 则明确目标不存在；
- 唯一 `slot_id`。

缺项、重复 target、路径越界、mode 与事实不符或 hash 漂移时不得创建可 seal 的事务。

### checkbox 语义

`[x] [delta]` 只表示该 Delta 已按当前目标基线写完、读回并通过 change-lint；它不表示内容已经进入正式 target。正式合并完成只由 completed receipt 证明。事务 collecting 阶段可消费已勾选任务建立 slot，但不得反向修改 tasks 来伪造 slot 完成。

### content slot 与职责

每个需要语义合成的 Delta 恰好对应一个资源 content slot。Agent 只能提交 slot 最终字节及其 hash；事务核心验证 slot identity，生成 metadata closure，并拥有所有正式写入。tasks 不得要求 Agent 创建/填写外部 manifest、写 metadata、写 `SPEC_MERGED` 或直接修改 canonical target。

### merge 后 `[code]` 切片

仅当事务 phase=`completed` 且 receipt 校验通过时，slice-planner 才能基于合并后的正式规格生成 `[code]`。每个切片必须引用正式规格中真实存在的 UT/ST ID；不得从未合并 Delta、Agent 回报或外部 manifest 推断测试集合。

### no-delta 与兼容

no-delta 仍创建空资源集合事务并生成 receipt；tasks 应明确记录 SKIP 理由，不能把无 `[delta]` 条目等同于 merge completed。历史任务可只读展示旧协议，但 0.14.0 新任务若要求 manifest/Base64 apply 必须被 lint 拒绝。本节覆盖本文档中与此冲突的旧任务模板。
