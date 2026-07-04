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
| `proposal.md` 与 `tasks.md` 均已脱模板，但 `[delta]` 尚未开始产出（无 delta 文件、`[delta]` 未勾）且 `PLAN_APPROVED` 不存在（对应 plan 出口「批准方案」门待放行） | → `ready-to-delta` |
| `PLAN_APPROVED` 存在，且有 `[delta]` section 但尚未全部勾选 | → `delta-writing` |
| 有 `[delta]` section、已开始产出 delta 文件但未全部勾选 | → `delta-writing` |
| 有 `[delta]` section 且全部勾选，且未生成 MERGE_PROMPT | → `ready-to-merge` |
| 已生成 `MERGE_PROMPT.md` / `MERGE_PROMPT_GENERATED`，但未写入 `SPEC_MERGED` | → `merge-generated` |
| （`SPEC_MERGED` 存在 **或** 无 `[delta]` section（纯代码提案 `spec`/`merge` 空过））、提案 `code_required`、`[code]` 切片尚待批准（slice-planner 已写定但 `SLICES_APPROVED` 不存在；对应 slice 出口「切片待批准」门待放行） | → `ready-to-implement` |
| `SLICES_APPROVED` 存在（或提案无需 slice 门），且 `[code]` section 未全部勾选 | → `coding` |
| （`SPEC_MERGED` 存在 **或** 无 `[delta]` section（纯代码提案 `spec`/`merge` 空过）），且无 `[code]` section 或 `[code]` 全部勾选 | → `ready-to-verify` |
| `VERIFY_FAIL` 存在 | → `verify-failed` |
| `proposal.md` 与 `[deploy]` section 冲突 | → 阻塞态；CLI 输出 warning，不推进 deploy / smoke / archive |
| `VERIFY_PASS` 存在，提案级无需部署，且无 `[deploy]` section | → `verify-passed` |
| `VERIFY_PASS` 存在，提案级需要部署，且 `[deploy]` section 存在但 `DEPLOY_DONE` 不存在或 `[deploy]` 未全勾 | → `ready-to-deploy` |
| `DEPLOY_DONE` 存在、`[deploy]` 全部勾选，且提案级无需 smoke | → `deploy-done` |
| `DEPLOY_DONE` 存在、`[deploy]` 全部勾选，且提案级需要 smoke，但 `SMOKE_PASS` / `SMOKE_FAIL` 均不存在 | → `ready-to-smoke` |
| `SMOKE_FAIL` 存在 | → `smoke-failed` |
| `SMOKE_PASS` 存在 | → `smoke-passed` |

> **纯代码提案（无 `[delta]`）绝不派生 `delta-writing`**（fix-nodelta-proposal-routing）：`tasks.md` 无 `## [delta]` section（`delta_required==false`）时，`spec`/`merge` 子流程整段空过（无 delta 待合并、不等 `SPEC_MERGED`），派生直接按上表 `ready-to-implement`/`coding`/`ready-to-verify` 三行（其 `SPEC_MERGED` 前置对纯代码提案以「空过」满足）推进。此类提案在**任何** `[code]`/`SLICES_APPROVED`/`PLAN_APPROVED` 组合下 `proposal_step` 均不为 `delta-writing`、前沿不为 `write-delta`。前提是纯代码提案 `tasks.md` 保留 `## [code]` 标题（见「格式规范」）；完全无 `## [tag]` 标题的旧格式 `tasks.md` 仍走「向后兼容」的全局兜底。详见 `spec/flow-spec.md` §12.6。

> **缺失 `[code]` 的代码必需态**：`SPEC_MERGED` 在场、`code_required==true`、`tasks.md` 缺失 `## [code]` 时，派生为 `ready-to-implement`，`next_node.id=="plan-slices"`，诊断 `tasks-code-section-missing`。`SPEC_MERGED` 在场、`code_required==true`、`## [code]` 存在但未 `tasks_code_filled` 时，同样派生为 `ready-to-implement`，诊断 `slices-not-planned`。只有 `code_required==false` 且缺失 `[code]` 时，才按纯文档/退化 implement 路径推进，可跳过 slice。

> **change-flow-redesign 新增 `ready-to-delta`**：前段 `plan` 子流程（write-proposal + write-tasks）完成、`spec`（write-delta）尚未开始时的驻留态，对应 plan 出口「批准方案」门（gate_id=`plan-exit`、`skippable:true`）。其检测依据为"proposal/tasks 已脱模板、尚无 delta 产出、且 `PLAN_APPROVED` 不存在"。

> **`PLAN_APPROVED`**：`openlogos next --auto` 在 `ready-to-delta` 自动放行 `plan-exit` 时写入的 marker。该 marker 表示 plan gate 已被消费；**当提案含 `[delta]` section 时**，存在后即使尚未产出 delta 文件，也应派生为 `delta-writing` / `write-delta` 前沿。**无 `[delta]` 的纯代码提案不受此条影响**（不派生 `delta-writing`，见上）。`GATE_AUTO_PASSED` 仍为审计文件，不作为状态判断依据。

> **split-slice-planner-stage 新增 `ready-to-implement`**：merge 之后（含纯代码提案的**空过 merge**）、implement 之前的独立 `slice` 子流程（`plan-slices`，slice-planner）完成切片撰写、但 `slice` 出口「切片待批准」门（gate_id=`slice-exit`、`skippable:true`）尚未放行时的驻留态。检测依据为"（`SPEC_MERGED` 在场 **或** 无 `[delta]`（spec/merge 空过））、提案 `code_required`、`[code]` 已由 slice-planner 写定脱模板、且 `SLICES_APPROVED` 不存在"。`[code]` 切片由 merge 后对真实测试 ID 划分；`plan` 段 `write-tasks` 不再产 `[code]`。纯文档提案（无 `[code]`、`code_required==false`）时 `slice` 子流程整段跳过，merge 后直接进入 `ready-to-verify` / 退化 implement。

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
（本段在 plan 段留空；无 `[delta]` 时 `spec`/`merge` 整段空过，切片由 `slice-planner` 在 merge 之后对现有/已合并规格 + 真实测试 ID 划分填入。保留 `## [code]` 标题，勿删。）
```

> 保留 `## [code]` 标题是**硬要求**：删除后 `tasks.md` 无任何 `## [tag]` section，派生降级为旧格式兜底、把纯代码提案误判为 `delta-writing`（错误派到 `write-delta` 节点）。见 `spec/flow-spec.md` §12.6。

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
