# 可编排研发流程 M1 规格 —— 本轮验证记录

> 对象：`spec/flow-spec.md` + `spec/flow/initial.yaml` + `spec/flow/launched.yaml`
> 性质：spec-first 轮次（纯规格、零代码零测试），**不适用 `openlogos verify`**（无测试可验）。
> 本记录以三种方式验证规格效果：完整性矩阵 / 桌面等价推演 / 诉求覆盖走查。
> 日期：2026-06-19

---

## 1. 完整性矩阵（证明翻译无遗漏）

### 1.1 现有 13 个 PHASE_KEYS → `initial.yaml` 节点

| PHASE_KEY | initial 节点 | 条件 / 完成判定 |
|---|---|---|
| phase.1 | `prd` | when `bootstrap != adopted` / dir_nonempty |
| phase.2 | `product-design` | when `bootstrap != adopted` / dir_nonempty |
| phase.3-0 | `architecture` | when `bootstrap != adopted` / dir_nonempty |
| phase.3-1 | `scenario-modeling` | fan-out scenarios / all_present |
| phase.3-2-api | `api-design` | when `api_enabled` / dir_nonempty |
| phase.3-2-db | `db-design` | when `db_enabled` / dir_nonempty |
| phase.3-3-deployment | `deployment-design` | 无 when（始终活跃，1:1）/ dir_nonempty |
| phase.3-4a | `test-cases` | fan-out scenarios / all_present |
| phase.3-4b | `orchestration-test` | when `scenario_enabled` / dir_nonempty |
| phase.3-5 | `code` | dir_nonempty |
| phase.3-6 | `verify` | file:acceptance-report.md |
| phase.3-7-deploy | `deploy` | when `deployment_required` / file:deployment-report.md |
| phase.3-8-smoke | `smoke` | when `smoke_required` / file:smoke-report.md |

**结论**：13/13 全覆盖，无遗漏。

### 1.2 现有 ProposalStep 状态 → `launched.yaml` 节点/谓词

| ProposalStep | launched 落点 |
|---|---|
| writing | `write-proposal` 未 done（`proposal_package_filled` 为假）|
| delta-writing | `write-delta` 未 done（`section_complete:delta` 为假）|
| ready-to-merge | propose 出口 gate 后、`generate-merge-prompt` 未 done |
| merge-generated | `generate-merge-prompt` done、`apply-merge` 未 done |
| coding | `apply-merge` done（SPEC_MERGED）、`code` 未 done（`section_complete:code`）|
| ready-to-verify | `code` done、`verify` 未 done |
| verify-passed | `verify` done（VERIFY_PASS）|
| verify-failed | `verify` `fail_when: marker:VERIFY_FAIL` 命中 |
| ready-to-deploy | `verify` done + deliver 入口 gate（entry, human）+ `deploy` 未 done |
| deploy-done | `deploy` done（DEPLOY_DONE）、无 smoke |
| ready-to-smoke | `deploy` done + `smoke` 未 done |
| smoke-passed | `smoke` done（SMOKE_PASS）|
| smoke-failed | `smoke` `fail_when: marker:SMOKE_FAIL` 命中 |
| archived | `archive` done（`archived`）|
| （部署决策冲突阻塞）| §12.1 记为实现必须保留的阻塞校验 |

**结论**：13 个流转状态 + 1 个阻塞态全覆盖。

---

## 2. 桌面等价推演（证明真实状态结果一致）

### 2.1 实测对照：当前 dogfooding 项目（launched 流，本提案自身）

实际命令输出：`openlogos status` → **ready-to-verify**；`openlogos next` → **运行 openlogos verify**。

按 `launched.yaml` 手工派生当前状态（markers: SPEC_MERGED✓、MERGE_PROMPT_GENERATED✓；
tasks [delta] 3/3✓、无 [code] section；提案级无部署）：

| subflow | 节点判定 |
|---|---|
| propose | write-proposal ✓（提案+tasks 已填）、write-delta ✓（delta 3/3）；出口 gate 已过（已 merge）|
| merge | when delta_required ✓ 进入；generate-merge-prompt ✓、apply-merge ✓（SPEC_MERGED）|
| implement | code ✓（`section_complete:code`=无 [code] section 视为完成）；**verify 未 done**（无 VERIFY_PASS）|

→ 推演得到的当前节点 = **`verify`**（implement subflow）。
→ 与实测 `ready-to-verify` / "openlogos verify" **一致 ✓**。这是本轮最强的一个等价证据。

### 2.2 假设态 A：纯代码提案（无 `[delta]` section）

现状：CLI 完全跳过 merge，直达 coding/ready-to-verify（`status.ts:643`）。
推演：`write-delta` when `delta_required`=假 → 跳过；`merge` subflow when `delta_required`=假 → 整段跳过；
直接到 `code`/`verify`。→ **一致 ✓**（H2 修复点生效）。

### 2.3 假设态 B：声明"无需部署"的提案（模块默认 deployment_required: true）

现状：提案级部署决策优先，`verify-passed` 后不进入 deploy。
推演：launched 的 `deployment_required` 取**提案级** `resolveProposalDeploymentDecision()`（§8）→ false
→ `deploy`/`smoke` when 为假跳过，deliver entry gate 因全跳过而不触发。→ **一致 ✓**（H3 修复点生效）。

---

## 3. 诉求覆盖走查（证明服务了原始目标，非仅复刻）

| 原始诉求 | schema 表达 | 阶段 |
|---|---|---|
| 增 / 删 / 改节点 | overlay `op: add / skip / modify` | M1 |
| 调整节点顺序 | overlay `op: reorder` | M1 |
| 设置节点 skill | `node.skill` | M1 |
| working / review agent | `node.working_agent` / `review_agent`（不透明标签，引擎适配）| M1 |
| pre / post script 插件 | `node.pre_script` / `post_script`（信任委托宿主）| M1 |
| 连续节点设为 sub flow | `subflows[].nodes` | M1 |
| subflow 的 gate / 人类确认点 | `subflow.gate.type: human`（entry/exit）| M1 |
| 全自动化时跳过确认 | `gate.skippable` × 宿主 auto 模式（留 `GATE_AUTO_PASSED` 痕）| M1 |
| 引擎驱动 + 随时 watch 状态 | A 被动派生 + `openlogos watch`/`status`/`next`（§12）| M1 |
| loop 驱动迭代（收敛=测试绿）| `subflow.loop.until/max_iters` + 测试绿 | **M2** |
| 嵌入既有流程（CI/PR 等）| `done_when: cmd:"..."` + pre/post script | **M2**（cmd 谓词）|

**结论**：9/11 诉求 M1 即可表达；2 项（loop 真迭代、cmd 嵌入）已在 schema 预留，M2 点亮。无诉求落空。

---

## 4. 总体结论

- **完整性**：13 phases + 13 ProposalStep 状态全覆盖，翻译无遗漏。
- **等价性**：1 个实测点 + 2 个假设态推演均与现状一致；H2/H3 修复点经推演确认生效。
- **目标达成**：原始可编排诉求 M1 覆盖 9/11，余 2 项 schema 已预留。
- **遗留的决定性验证**：规格的运行时等价证明属 M1 实现轮——第一步应先写 golden/characterization
  测试，录下现有 `status --json`/`next --json` 在 fixture 矩阵上的输出当基线，再断言 flow 派生逐字节一致。

本轮（spec-first）验证通过。
