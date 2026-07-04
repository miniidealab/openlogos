# S09: 创建、合并、归档变更提案 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-01 | 扫描 delta 目录 | scanDeltas | 有 prd/test delta | change slug | 返回映射 |
| UT-S09-02 | 任务模板结构正确 | tasksTemplate | 模板生成 | slug | 含 [delta]/[code]/[deploy] |
| UT-S09-09 | 提案模板包含部署影响字段 | proposalTemplate | 模板生成 | slug | 含是否需要部署、部署原因、影响环境、数据迁移、回滚预案、是否需要 smoke |
| UT-S09-10 | 扫描 delta 时忽略 reference 目录 | scanDeltas | 存在 `deltas/reference/` | change slug | 不把 reference 文件计入可 merge delta |
| UT-S09-11 | guard-check: launched + 无 guard → 阻断 Edit | guard-check 脚本 | launched 模块，无 guard 文件 | Edit tool_input file_path=src/index.ts | exit 2，reason 含"变更管理拦截" |
| UT-S09-12 | guard-check: launched + 有 guard → 放行 Edit | guard-check 脚本 | launched 模块，有 guard 文件 | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-13 | guard-check: initial lifecycle → 放行 | guard-check 脚本 | 所有模块 initial | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-14 | guard-check: 白名单路径 logos/changes/ → 放行 | guard-check 脚本 | launched 模块，无 guard | Edit tool_input file_path=logos/changes/my-change/proposal.md | exit 0 |
| UT-S09-15 | guard-check: 白名单路径 CLAUDE.md → 放行 | guard-check 脚本 | launched 模块，无 guard | Write tool_input file_path=CLAUDE.md | exit 0 |
| UT-S09-16 | guard-check: Bash 写入命令 → 阻断 | guard-check 脚本 | launched 模块，无 guard | Bash command="sed -i 's/a/b/' src/foo.ts" | exit 2 |
| UT-S09-17 | guard-check: openlogos CLI 命令 → 放行 | guard-check 脚本 | launched 模块，无 guard | Bash command="openlogos status" | exit 0 |
| UT-S09-18 | guard-check: 非 OpenLogos 项目 → 放行 | guard-check 脚本 | 无 logos.config.json | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-19 | deployClaudeCodePlugin 部署 guard-check 脚本 | deployClaudeCodePlugin | plugin/bin/guard-check 存在 | 调用 deployClaudeCodePlugin | .claude/openlogos/bin/guard-check 存在且可执行 |
| UT-S09-20 | deployClaudeCodePlugin 注册 PreToolUse hook | deployClaudeCodePlugin | plugin/bin/guard-check 存在 | 调用 deployClaudeCodePlugin | settings.json 含 PreToolUse matcher=Edit\|Write\|Bash |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-01 | 创建提案工作区 | Step 1→2 | 无 guard | change slug | 生成提案目录 |
| ST-S09-12 | 创建后填写提案级部署决策 | Step 3→5 | 已创建提案 | AI 填写 proposal/tasks | `proposal.md` 含部署影响，`tasks.md` 的 `[deploy]` 与声明一致 |
| ST-S09-13 | 只按 delta section 产出可 merge delta | Step 6→7 | 用户已确认提案 | 产出 delta | delta 文件落入 prd/api/database/scenario/test/spec/skills 支持目录，不写入 reference 作为 merge 目标 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S09-EX-5.1 | 部署决策与 tasks 冲突 | EX-5.1 | `proposal.md` 与 `[deploy]` section 冲突 | status / next | 输出冲突警告 |

## 四、launched flow-derive 引擎单元测试用例（detectProposalStepViaFlow）

> 每条 UT 在并跑测试中**同时断言**「`detectProposalStepViaFlow` 返回值 == 同 fixture 下旧
> `detectProposalStep` 返回值」，再断言等于「预期输出」列的 `ProposalStep`。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-21 | proposal/tasks 仍为模板 → writing | done_when:proposal_package_filled | proposal.md 或 tasks.md 未脱模板 | detectProposalStepViaFlow | `writing` |
| UT-S09-22 | 提案已填、[delta] 未全勾 → delta-writing | section_complete:delta | proposal/tasks 已填、`[delta]` 部分勾选 | derive | `delta-writing` |
| UT-S09-23 | [delta] 全勾 → ready-to-merge | section_complete:delta | `[delta]` total>0 且全勾 | derive | `ready-to-merge` |
| UT-S09-24 | MERGE_PROMPT_GENERATED 存在 → merge-generated | any_present:[MERGE_PROMPT_GENERATED, MERGE_PROMPT.md] | 仅 `MERGE_PROMPT_GENERATED` | derive | `merge-generated` |
| UT-S09-25 | MERGE_PROMPT.md 存在 → merge-generated | any_present:[MERGE_PROMPT_GENERATED, MERGE_PROMPT.md] | 仅 `MERGE_PROMPT.md` | derive | `merge-generated` |
| UT-S09-26 | SPEC_MERGED + [code] 未全勾 → coding | any_present:[SPEC_MERGED, MERGED] + section_complete:code | `SPEC_MERGED`、`[code]` 部分勾选 | derive | `coding` |
| UT-S09-27 | 旧 MERGED marker + [code] 未全勾 → coding | any_present:[SPEC_MERGED, MERGED] | 仅旧 `MERGED`、`[code]` 部分勾选 | derive | `coding` |
| UT-S09-28 | SPEC_MERGED + [code] 全勾 → ready-to-verify | section_complete:code | `SPEC_MERGED`、`[code]` 全勾 | derive | `ready-to-verify` |
| UT-S09-29 | 纯代码提案（无 [delta]）+ [code] 全勾 → ready-to-verify | delta_required=false | 提案已填、无 `[delta]` section、`[code]` 全勾、无 merge marker | derive | `ready-to-verify` |
| UT-S09-30 | 旧格式无 section + SPEC_MERGED → ready-to-verify | section 兜底 | `SPEC_MERGED`、tasks.md 无 section 标记 | derive | `ready-to-verify` |
| UT-S09-31 | 旧格式无 section + 可 merge delta 且任务全勾 → ready-to-merge | 旧格式兜底（mergeableDelta + allTasksChecked） | 已填、无 section、存在可 merge delta、全局任务全勾、无 marker | derive | `ready-to-merge` |
| UT-S09-32 | 旧格式无 section + 任务未全勾 → delta-writing | 旧格式兜底 | 已填、无 section、任务未全勾、无 marker | derive | `delta-writing` |
| UT-S09-33 | VERIFY_PASS + 提案级无需部署 → verify-passed | resolveProposalDeploymentDecision | `VERIFY_PASS`、proposal 声明无需部署、无 `[deploy]` | derive | `verify-passed` |
| UT-S09-34 | VERIFY_PASS + 部署决策冲突 → verify-passed | deployment_decision_conflict | `VERIFY_PASS`、proposal 声明无需部署但存在 `[deploy]` section（冲突） | derive | `verify-passed` |
| UT-S09-35 | VERIFY_FAIL → verify-failed | fail_when:marker:VERIFY_FAIL | 存在 `VERIFY_FAIL` | derive | `verify-failed` |
| UT-S09-36 | VERIFY_PASS + 需部署 + [deploy] section 存在但 total=0 → ready-to-deploy | hasDeployTasks=false（非冲突）| `VERIFY_PASS`、proposal 声明需部署、`[deploy]` section **存在但 total=0** | derive | `ready-to-deploy` |
| UT-S09-50 | VERIFY_PASS + proposal 声明需部署但**缺 [deploy] section** → 部署决策冲突 → verify-passed | deployment_decision_conflict（反向）| `VERIFY_PASS`、proposal 声明需部署、**无 `[deploy]` section** | derive | `verify-passed`（冲突阻塞，不进 ready-to-deploy）|
| UT-S09-37 | VERIFY_PASS + 需部署 + DEPLOY_DONE 缺失 → ready-to-deploy | DEPLOY_DONE 缺失 | `VERIFY_PASS`、需部署、有 deploy 任务全勾、无 `DEPLOY_DONE` | derive | `ready-to-deploy` |
| UT-S09-38 | VERIFY_PASS + 需部署 + deploy 任务未全勾 → ready-to-deploy | deployTasksChecked=false | `VERIFY_PASS`、需部署、`DEPLOY_DONE` 存在但 `[deploy]` 未全勾 | derive | `ready-to-deploy` |
| UT-S09-39 | DEPLOY_DONE + 全勾 + smoke_required=false → deploy-done | smoke_required=false | `VERIFY_PASS` + `DEPLOY_DONE`、`[deploy]` 全勾、提案 smoke=否 | derive | `deploy-done` |
| UT-S09-40 | DEPLOY_DONE + 全勾 + smoke 未声明且无 smoke 用例 → deploy-done | hasSmokeCasesForProposal=false | 同上但 smoke 未声明、无 smoke 用例 | derive | `deploy-done` |
| UT-S09-41 | DEPLOY_DONE + 全勾 + smoke_required=true → ready-to-smoke | smoke_required=true | `DEPLOY_DONE`、全勾、提案 smoke=是 | derive | `ready-to-smoke` |
| UT-S09-42 | DEPLOY_DONE + 全勾 + smoke 未声明但有 smoke 用例 → ready-to-smoke | hasSmokeCasesForProposal=true | `DEPLOY_DONE`、全勾、smoke 未声明、存在 smoke 用例 | derive | `ready-to-smoke` |
| UT-S09-43 | deploy 子块内 SMOKE_PASS → smoke-passed | done_when:marker:SMOKE_PASS | `VERIFY_PASS`+`DEPLOY_DONE`、全勾、`SMOKE_PASS` | derive | `smoke-passed` |
| UT-S09-44 | deploy 子块内 SMOKE_FAIL → smoke-failed | fail_when:marker:SMOKE_FAIL | `VERIFY_PASS`+`DEPLOY_DONE`、全勾、`SMOKE_FAIL` | derive | `smoke-failed` |

### 必覆盖边角（与上表共属同一引擎，独立列出以强调非对称/空 section 语义）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-45 | ① VERIFY_FAIL 全局最先：即便提案未填/有 SPEC_MERGED 仍判 verify-failed | marker 全局优先 | `VERIFY_FAIL` 与 `SPEC_MERGED` 并存、且 proposal 未脱模板 | derive | `verify-failed`（不返回 writing/coding） |
| UT-S09-46 | ② SMOKE 非全局优先：有 SMOKE_PASS/FAIL 但缺 DEPLOY_DONE → 仍 ready-to-deploy | marker 非对称 | `VERIFY_PASS`、需部署、deploy 任务全勾、`SMOKE_PASS`（或 `SMOKE_FAIL`）存在但**无 `DEPLOY_DONE`** | derive | `ready-to-deploy`（不返回 smoke-passed/failed） |
| UT-S09-47 | ② SMOKE 非全局优先：有 SMOKE_PASS/FAIL + DEPLOY_DONE 但 deploy 任务未全勾 → 仍 ready-to-deploy | marker 非对称 | `VERIFY_PASS` + `DEPLOY_DONE`、`SMOKE_PASS`（或 `SMOKE_FAIL`）存在但 `[deploy]` 未全勾 | derive | `ready-to-deploy` |
| UT-S09-48 | ③ present-but-empty `[code]`（total=0）不算完成 → coding | section_complete legacy（total>0&&checked===total） | `SPEC_MERGED`、`[code]` section 存在但无任何条目（total=0） | derive | `coding`（空 `[code]` 不视为已完成） |
| UT-S09-49 | ③ present-but-empty `[delta]`（total=0）不算完成 → delta-writing | section_complete legacy | 提案已填、`[delta]` section 存在但 total=0、无 merge marker | derive | `delta-writing`（空 `[delta]` 不视为已完成） |

## 五、测试期「ViaFlow == 旧 detectProposalStep」并跑等价场景测试用例

> 以下 ST **仅存在于测试期**：对同一 fixture 同时跑 `detectProposalStepViaFlow` 与旧
> `detectProposalStep`，断言两者返回的 `ProposalStep` 相等。**不进入生产 CLI 路径。**
> 断言矩阵覆盖全部 `ProposalStep` 态与三处必覆盖边角。

| ID | 描述 | 覆盖 fixture | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-14 | writing / delta-writing / ready-to-merge 等价 | propose 子流程 | 模板态 / `[delta]` 部分勾 / `[delta]` 全勾 | 并跑 ViaFlow 与旧 detectProposalStep | 三态返回值逐一相等 |
| ST-S09-15 | merge-generated 等价（两种 marker） | merge 子流程 | `MERGE_PROMPT_GENERATED` / `MERGE_PROMPT.md` | 并跑 | 两 fixture 均返回 merge-generated 且相等 |
| ST-S09-16 | coding 等价（SPEC_MERGED 与旧 MERGED） | implement | `SPEC_MERGED` / 旧 `MERGED`、`[code]` 未全勾 | 并跑 | 两 fixture 均 coding 且相等 |
| ST-S09-17 | ready-to-verify 等价（纯代码无 [delta] / 旧格式无 section） | implement 兜底 | 纯代码提案 [code] 全勾 / 旧格式 SPEC_MERGED | 并跑 | 均 ready-to-verify 且相等 |
| ST-S09-18 | verify-passed 等价（无需部署 / 部署决策冲突） | deliver 决策 | VERIFY_PASS+无需部署 / VERIFY_PASS+冲突 | 并跑 | 均 verify-passed 且相等 |
| ST-S09-19 | verify-failed 等价（VERIFY_FAIL 全局优先） | 全局 marker | VERIFY_FAIL（含与 SPEC_MERGED/未填提案并存） | 并跑 | 均 verify-failed 且相等 |
| ST-S09-20 | ready-to-deploy 等价（无 deploy 任务 / DEPLOY_DONE 缺 / 任务未全勾） | deliver | 三种 ready-to-deploy 触发条件 | 并跑 | 三 fixture 均 ready-to-deploy 且相等 |
| ST-S09-21 | deploy-done 等价（smoke_required=false / 无 smoke 用例） | deliver | DEPLOY_DONE+全勾、smoke=否 / smoke 未声明无用例 | 并跑 | 均 deploy-done 且相等 |
| ST-S09-22 | ready-to-smoke 等价（smoke_required=true / 有 smoke 用例） | deliver | DEPLOY_DONE+全勾、smoke=是 / 未声明但有 smoke 用例 | 并跑 | 均 ready-to-smoke 且相等 |
| ST-S09-23 | smoke-passed / smoke-failed 等价 | deliver deploy 子块 | DEPLOY_DONE+全勾、SMOKE_PASS / SMOKE_FAIL | 并跑 | 各自相等（SMOKE_FAIL 优先于 SMOKE_PASS） |
| ST-S09-24 | 旧格式兜底等价（mergeableDelta + allTasksChecked） | propose 旧格式 | 无 section、可 merge delta + 任务全勾 / 未全勾 | 并跑 | ready-to-merge / delta-writing 各自相等 |
| ST-S09-25 | 边角①②③ 等价 | 边角集 | UT-S09-45/46/47/48/49 对应 fixture | 并跑 | ViaFlow 与旧逻辑在三处边角逐一相等 |
| ST-S09-26 | golden 基线零漂移：launched 提案 status/next 输出不变 | golden | 各 ProposalStep 态 launched 提案 fixture | 跑 golden-baseline.test.ts | status / next JSON 与基线逐字节一致 |

## 六、AI 宿主 SessionStart guard 范围测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-51 | Codex SessionStart：writing 阶段只允许 proposal/tasks | plugin-codex/session-start.sh | launched 项目，有 active guard，`status --format json` 返回 `active_change=feat`、`proposal_step=writing` | 执行 SessionStart hook | 注入文案包含 `proposal.md` 与 `tasks.md`，不包含允许写入 `deltas/**` 或源码的表述 |
| UT-S09-52 | Codex SessionStart：delta-writing 阶段允许 deltas/tasks | plugin-codex/session-start.sh | launched 项目，有 active guard，`status --format json` 返回 `active_change=feat`、`proposal_step=delta-writing` | 执行 SessionStart hook | 注入文案包含 `logos/changes/feat/deltas/**` 与 `logos/changes/feat/tasks.md`，且不包含 `Only modify files within the scope of logos/changes/feat/proposal.md` |
| UT-S09-53 | openlogos-phase：delta-writing 阶段允许 deltas/tasks | plugin/bin/openlogos-phase | launched 项目，有 active guard，`status --format json` 返回 `active_change=feat`、`proposal_step=delta-writing` | 执行 `openlogos-phase` | additionalContext / plain 输出包含 `deltas/**` 与 `tasks.md`，不得固定到 `proposal.md` 单文件 |
| UT-S09-54 | guard 回退文案不得固定到 proposal.md | SessionStart fallback | `status --format json` 不可用，但 `logos/.openlogos-guard` 存在 `activeChange=feat` | 执行 SessionStart hook | 注入文案说明当前提案范围以 `openlogos status` / `openlogos next` 为准，不输出只允许修改 `proposal.md` 的句子 |

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-27 | 用户从 ready-to-delta 批准后，SessionStart 不再卡 proposal.md | S09 Step 7→8 | 提案已填，用户批准方案，`next --auto` 后状态为 `delta-writing` | 重新开启 Codex/OpenLogos 会话 | 会话上下文允许 AI 继续写 `logos/changes/<slug>/deltas/**` 并更新 `tasks.md`，不会因 `proposal.md` 单文件范围拒绝执行 delta 任务 |

## 七、纯代码提案（无 `[delta]`）派生用例（fix-nodelta-proposal-routing）

> 覆盖「纯代码级修复提案（`tasks.md` 无 `## [delta]`、含空 `## [code]` 标题，`delta_required==false`）派生：`spec`/`merge` 空过、直连 slice/implement，**任何组合下 `proposal_step` 不为 `delta-writing`、`next_node.id` 不为 `write-delta`**」。规则见 `spec/flow-spec.md` §12.6、`spec/tasks-spec.md`「状态判断规则」。含 OpenLogos reporter（用例名带 `UT-S09-*` / `ST-S09-*` 供抽取）。
>
> 关键不变量：`detectProposalStepViaFlow` 与旧 `detectProposalStep` 对同一无 `[delta]` fixture 必须返回**相等**结果（1:1 等价不破，故两函数须同步修改）。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-55 | 纯代码（无 [delta]）+ 空 `[code]` 标题 + 无 SPEC_MERGED + 无 SLICES_APPROVED → ready-to-implement | flow-spec §12.6 | proposal/tasks 已填、无 `[delta]`、`## [code]` 标题在场且 total=0、无 `SPEC_MERGED`/`SLICES_APPROVED` | derive | `proposal_step==ready-to-implement`；`next_node.id=="plan-slices"`；**非 `delta-writing`/`write-delta`** |
| UT-S09-56 | 纯代码（无 [delta]）+ `[code]` 有未勾条目 + 无 SPEC_MERGED + 无 SLICES_APPROVED → ready-to-implement | flow-spec §12.6 | 无 `[delta]`、`[code]` total>0 未全勾、无 marker | derive | `ready-to-implement`；`next_node.id=="plan-slices"` |
| UT-S09-57 | 纯代码（无 [delta]）+ `[code]` 未全勾 + SLICES_APPROVED → coding | flow-spec §12.6 | 无 `[delta]`、`[code]` 未全勾、`SLICES_APPROVED` 在场、无 `SPEC_MERGED` | derive | `coding`；`next_node.id=="code"` |
| UT-S09-58 | 纯代码（无 [delta]）+ PLAN_APPROVED 在场 + 空 `[code]` + 无 SPEC_MERGED → ready-to-implement（PLAN_APPROVED 不逼出 delta-writing） | flow-spec §12.4(2) carve-out | 无 `[delta]`、`PLAN_APPROVED` 在场、`## [code]` 标题 total=0、无 `SPEC_MERGED`/`SLICES_APPROVED` | derive | `ready-to-implement`（**非 `delta-writing`**）；`next_node.id=="plan-slices"` |
| UT-S09-59 | 纯代码（无 [delta]）+ `[code]` 全勾 → ready-to-verify（回归 UT-S09-29，无 SPEC_MERGED 亦成立） | flow-spec §12.6 | 无 `[delta]`、`[code]` 全勾、无 `SPEC_MERGED`/marker | derive | `ready-to-verify`；`next_node.id=="verify"` |
| UT-S09-60 | 无 [delta] 提案任意组合都不派 write-delta（红线断言） | fix-nodelta 不变量 | 遍历 UT-S09-55..59 全部 fixture | derive | 每个 fixture：`proposal_step != "delta-writing"` 且 `next_node.id != "write-delta"` |
| UT-S09-61 | 回归：旧格式**完全无** `## [tag]` 标题 + 任务未全勾 → delta-writing（兜底不变，UT-S09-32 不破） | 旧格式兜底 | 已填、无任何 section 标记、任务未全勾、无 marker、无可 merge delta | derive | `delta-writing`（纯代码提案因保留 `## [code]` 标题不落入此路径） |

| ID | 描述 | 覆盖 fixture | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-28 | ViaFlow == 旧 detectProposalStep 在无 [delta] fixture 等价 | 纯代码派生集 | UT-S09-55..59 各 fixture | 并跑 `detectProposalStepViaFlow` 与旧 `detectProposalStep` | 每个 fixture 两者返回的 `ProposalStep` 逐一相等（1:1 不变量保持） |
| ST-S09-29 | 纯代码提案端到端无死锁：plan→(spec/merge 空过)→plan-slices→…→verify | 无 [delta] 全链路 | 纯代码修复提案（空 `## [code]`），经 plan 门 | `next`（指 plan-slices）→ 写 `[code]` 脱模板 → `next`（停 slice-exit）→ `--auto` → … → `ready-to-verify` | 全程无 `delta-writing`/`write-delta` 前沿；无 `blocked(no-progress)`；最终达 `ready-to-verify` |
| ST-S09-30 | golden 零漂移：有 [delta] 常规提案 status/next 输出不变 | 回归 | 各态有 `[delta]` 提案 fixture | 跑 golden-baseline | 常规提案 status/next JSON 与基线逐字节一致（本变更只影响无 `[delta]` 分支） |

## 八、proposal/tasks 写完后的 final 前校验测试

> 覆盖 AI/driver 在 `proposal.md` 与 `tasks.md` 已脱模板后必须确认前沿或消费 auto gate，避免把 `ready-to-delta + tasks 0/N` 误判为任务规划失败。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 用例 | 覆盖点 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|---|
| UT-S09-62 | proposal/tasks 已脱模板后 final 前识别 ready-to-delta | final 前校验 | `proposal.md` 已填、`tasks.md` 含 `[delta]` 且 checkbox `0/N`、无 `PLAN_APPROVED` | 调用 proposal lifecycle / driver 前沿校验函数 | 返回 `proposal_step=="ready-to-delta"`；`plan_ready==true`；不得返回任务规划失败 |
| UT-S09-63 | tasks checkbox 0/N 不触发规划失败 | 执行进度分层 | 同 UT-S09-62，`tasks_execution_done=0`、`tasks_execution_total>0` | 生成 final 诊断 | 诊断说明“delta 尚未执行 / plan gate pending”；不包含 blocked、planning failed 或要求重写 tasks 的语义 |
| UT-S09-64 | auto 消费 plan-exit 后继续派发 write-delta | final 前 auto 闭环 | `ready-to-delta` 提案，`next --auto` 响应含 `gate_auto_passed=true`、`next_node.id="write-delta"` | driver 消费响应 | 下一 dispatch 为 `write-delta` / change-writer；不得 final 停止在 plan gate |
| ST-S09-31 | proposal/tasks 产出端到端不被误判为 block | S09 Step 3→8 | 从新建提案到 AI 写完 proposal/tasks，`tasks.md` `[delta]` 全未勾 | 模拟 driver 完成 write-proposal/write-tasks 后读取 `status/next` | 流程进入 `ready-to-delta`；面向用户的状态为“方案待批准/auto 消费”；无“任务规划失败” |
| ST-S09-32 | 全自动下 plan gate 后进入 delta-writing | S09 + S24 联动 | 同 ST-S09-31，随后执行 `next --auto --format json` | driver 按响应继续派发 | `PLAN_APPROVED` 语义成立，下一工作单元为 `write-delta`；不出现 blocked/no-progress |
