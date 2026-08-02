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

> 覆盖「纯代码级修复提案（`tasks.md` 无 `## [delta]`、含空 `## [code]` 标题，`delta_required==false`）派生：不进入 `write-delta`，但必须先完成 no-delta spec-complete，随后才进入 slice/implement」。含 OpenLogos reporter（用例名带 `UT-S09-*` / `ST-S09-*` 供抽取）。

| ID | 描述 | 覆盖 | 输入 | 操作 | 预期 |
|----|------|------|------|------|------|
| UT-S09-55 | 纯代码（无 `[delta]`）+ 空 `[code]` 标题 + 无 `SPEC_MERGED` → spec-complete-required | no-delta spec-complete 前置 | proposal/tasks 已填、无 `[delta]`、`## [code]` 标题在场、无 `SPEC_MERGED`/`SLICES_APPROVED` | derive | `proposal_step=="spec-complete-required"`；`reason=="no_delta_spec_marker_missing"`；`next_node.id!="write-delta"` 且 `next_node.id!="plan-slices"` |
| UT-S09-56 | 纯代码（无 `[delta]`）+ `[code]` 有未勾条目 + 无 `SPEC_MERGED` → spec-complete-required | no-delta spec-complete 前置 | 无 `[delta]`、`[code]` total>0 未全勾、无 marker | derive | `spec-complete-required`；非 `delta-writing` / 非 `write-delta` |
| UT-S09-57 | 纯代码（无 `[delta]`）+ no-delta `SPEC_MERGED` + 空 `[code]` → ready-to-implement / plan-slices | no-delta marker 后进入 slice | 无 `[delta]`、`SPEC_MERGED` 内容含 `type:no_delta_spec_complete`、`[code]` 空/模板、测试 ID 可解析 | derive | `ready-to-implement`；`next_node.id=="plan-slices"` |
| UT-S09-58 | 纯代码（无 `[delta]`）+ no-delta `SPEC_MERGED` + `[code]` 未全勾 + `SLICES_APPROVED` → coding | slice-exit 已消费 | 无 `[delta]`、`SPEC_MERGED`、`SLICES_APPROVED`、`[code]` 未全勾 | derive | `coding`；`next_node.id=="code"` |
| UT-S09-59 | 纯代码（无 `[delta]`）+ no-delta `SPEC_MERGED` + `[code]` 全勾 → ready-to-verify | ready-to-verify 前置 | 无 `[delta]`、`SPEC_MERGED`、`[code]` 全勾 | derive | `ready-to-verify`；`next_node.id=="verify"` |
| UT-S09-60 | 纯代码（无 `[delta]`）+ `PLAN_APPROVED` 在场 + 无 `SPEC_MERGED` → spec-complete-required | PLAN_APPROVED 不等于 spec-complete | 无 `[delta]`、`PLAN_APPROVED` 在场、无 `SPEC_MERGED` | derive | `spec-complete-required`；非 `delta-writing` / 非 `plan-slices` |
| UT-S09-61 | 回归：旧格式完全无 `## [tag]` 标题 + 任务未全勾 → 旧格式兜底不变 | 旧格式兜底 | 已填、无任何 section 标记、任务未全勾、无 marker | derive | 旧格式兜底行为不变；纯代码提案因保留 `## [code]` 标题不落入此路径 |
| UT-S09-62 | no-delta merge 写入审计型 `SPEC_MERGED` | merge no-op | 无 `[delta]`、无 delta 文件 | `merge(slug)` | 不生成 `MERGE_PROMPT.md`；写入 `SPEC_MERGED`；内容包含 `type:"no_delta_spec_complete"`、`reason`、`completed_at` |

## 八、proposal/tasks 写完后的 final 前校验测试

> 覆盖 AI/driver 在 `proposal.md` 与 `tasks.md` 已脱模板后必须确认前沿或消费 auto gate，避免把 `ready-to-delta + tasks 0/N` 误判为任务规划失败。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 用例 | 覆盖点 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|---|
| UT-S09-62 | proposal/tasks 已脱模板后 final 前识别 ready-to-delta | final 前校验 | `proposal.md` 已填、`tasks.md` 含 `[delta]` 且 checkbox `0/N`、无 `PLAN_APPROVED` | 调用 proposal lifecycle / driver 前沿校验函数 | 返回 `proposal_step=="ready-to-delta"`；`plan_ready==true`；不得返回任务规划失败 |
| UT-S09-63 | tasks checkbox 0/N 不触发规划失败 | 执行进度分层 | 同 UT-S09-62，`tasks_execution_done=0`、`tasks_execution_total>0` | 生成 final 诊断 | 诊断说明“delta 尚未执行 / plan gate pending”；不包含 blocked、planning failed 或要求重写 tasks 的语义 |
| UT-S09-64 | auto 消费 plan-exit 后继续派发 write-delta | final 前 auto 闭环 | `ready-to-delta` 提案，`next --auto` 响应含 `gate_auto_passed=true`、`next_node.id="write-delta"` | driver 消费响应 | 下一 dispatch 为 `write-delta` / change-writer；不得 final 停止在 plan gate |
| ST-S09-31 | proposal/tasks 产出端到端不被误判为 block | S09 Step 3→8 | 从新建提案到 AI 写完 proposal/tasks，`tasks.md` `[delta]` 全未勾 | 模拟 driver 完成 write-proposal/write-tasks 后读取 `status/next` | 流程进入 `ready-to-delta`；面向用户的状态为“方案待批准/auto 消费”；无“任务规划失败” |
| ST-S09-32 | 全自动下 plan gate 后进入 delta-writing | S09 + S24 联动 | 同 ST-S09-31，随后执行 `next --auto --format json` | driver 按响应继续派发 | `PLAN_APPROVED` 语义成立，下一工作单元为 `write-delta`；不出现 blocked/no-progress |

## 场景测试用例（纯代码提案）

| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S09-28 | 纯代码提案不进入 write-delta，但必须先 no-delta merge | 纯代码派生 | 纯代码修复提案（空 `## [code]`）经 plan 门后 `next` | 先返回 `spec-complete-required`，不返回 `write-delta` / `plan-slices`；执行 no-delta merge 后再进入 `ready-to-implement` |
| ST-S09-29 | 纯代码提案端到端无死锁：plan→no-delta merge→plan-slices→…→verify | 无 `[delta]` 全链路 | 纯代码修复提案 → `next` → no-delta `merge` → `next` → 写 `[code]` 脱模板 → `next --auto` → … | 全程无 `delta-writing`/`write-delta` 前沿；缺 marker 时不派 `plan-slices`；marker 就绪后进入切片规划 |

## 九、UI/UX 前置确认（proposal-ui-ux-first）单元测试用例

> 覆盖 GUI 项目提案阶段前置 UI/UX 原型确认特性（F1–F4）。原型作为 plan 节点产物、plan 阶段写入 allowlist、`ui_impact` when-flag、overlay-add 节点富对账、provenance hash 防漂移、merge 命令级强制、事务性落盘与跨会话 fail-closed。用例实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 `UT-S09-*` ID 供 verify 抽取。

### 9.1 plan 节点产物声明与写入 allowlist（F1）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-65 | GUI 原型被声明为 plan 节点正式产物 | flow-spec.md plan 节点产物列表 | GUI 项目、`ui_impact:true` | 解析 plan 节点 `produces` | plan 节点产物含 `deltas/prd/2-product-design/2-page-design/`，与 `proposal.md`/`tasks.md` 并列 |
| UT-S09-66 | guard: plan 阶段仅放行原型路径 `.html` | guard-check（plan allowlist） | launched、active guard、plan 阶段（writing/ready-to-delta） | Write `deltas/prd/2-product-design/2-page-design/core-01-home.html` | exit 0（放行） |
| UT-S09-67 | guard: plan 阶段拒绝非原型 delta | guard-check（plan allowlist） | 同上 | Write `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` | exit 2（plan 阶段仅放行 `2-page-design/*.html`，其余 `deltas/**` 拒绝） |
| UT-S09-68 | guard: plan 阶段拒绝原型目录下非 `.html` 越界 | guard-check（plan allowlist） | 同上 | Write `deltas/prd/2-product-design/2-page-design/core-01.md` | exit 2（仅 `*.html` 放行） |
| UT-S09-69 | guard: spec 阶段（plan-exit 后）恢复常规 allowlist | guard-check | launched、active guard、delta-writing 阶段 | Write `deltas/prd/2-product-design/1-feature-specs/*.md` | exit 0（plan-exit 后其余 delta 放行，plan allowlist 收窄仅 plan 阶段生效） |

### 9.2 flow-derive 判据与 `ui_impact` when-flag（F1、F2）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-70 | 仅存在原型 delta 时 flow-derive 不误判进入 spec | flow-derive.ts（原型例外） | plan 阶段、仅 `2-page-design/*.html` 已产出、无非原型规格 delta、无 plan-exit | derive | 仍判 plan 阶段（原型可见于门前）；不返回 spec/delta-writing |
| UT-S09-71 | 出现非原型规格 delta 才视为进入 spec | flow-derive.ts | 除原型外存在 `1-feature-specs/*.md` delta | derive | 进入 spec/delta-writing（原型例外仅限 `2-page-design/*.html` 叶子） |
| UT-S09-72 | `ui_impact` 派生：GUI + 声明 true → 真 | flow-derive.ts（新增 when-flag） | `proposal.md` UI/UX 声明段 `ui_impact:true` 且 `product_type∈GUI` | 派生 `ui_impact` | `ui_impact==true`（仿 `delta_required` 从声明段推导） |
| UT-S09-73 | `ui_impact` 派生：非 GUI 项目 → 假 | flow-derive.ts | `product_type` 非 GUI（CLI/API/Skills）、即使声明 `ui_impact:true` | 派生 | `ui_impact==false`（非 GUI 项目特性不启用） |
| UT-S09-74 | `ui_impact` 派生：GUI + 声明 false → 假（节点 skip） | flow-derive.ts | GUI 项目、声明 `ui_impact:false` | 派生 | `ui_impact==false`；`write-ui-prototype` 的 `when` 不满足而 skip |
| UT-S09-75 | 判定依据=已规划 `[delta]` 目标而非 delta 内容 | change-writer 判定（F2） | plan 阶段无 delta 文件、`tasks.md` `[delta]` 目标命中 `2-page-design/` | 判定「是否动界面」 | 判「动了界面」；判据为 `product_type`+意图+已规划 `[delta]` 目标，不扫描不存在的 delta 内容（无循环依赖） |

### 9.3 overlay-add 节点合法性与富对账 done_when（F1 新循环）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-76 | `write-ui-prototype` 作为 overlay-add 节点用 `cmd:` 合法 | launched.yaml overlay + §9.2 | GUI overlay `op:add` 节点 `write-ui-prototype`、`after: write-tasks`、`done_when: cmd:<check-ui-prototype>` | flow 校验 | 校验通过（overlay-add 合法使用 `cmd:` 谓词） |
| UT-S09-77 | builtin 硬编码 `cmd:` 则 FLOW_SCHEMA_INVALID | launched.yaml builtin 约束 | 把 `write-ui-prototype` 写成 builtin `launched.yaml` 节点并用 `done_when: cmd:` | flow schema 校验 | 报 `FLOW_SCHEMA_INVALID`（builtin 不得硬编码 `cmd:`，须走 overlay-add） |
| UT-S09-78 | builtin `launched.yaml` 不硬编码 UI 节点 | launched.yaml + `spec/flow/overlays/gui-ui-first.yaml` | 解析 builtin plan subflow | 检查节点集 | builtin plan subflow **不含** `write-ui-prototype`/`verify-ui-provenance`（builtin 侧无此两节点；它们仅存在于方法论 GUI overlay 真实源 `spec/flow/overlays/gui-ui-first.yaml`，由 init/sync 在 GUI 项目时注入） |
| UT-S09-79 | `check-ui-prototype` 富对账通过（`generated` 模式）→ 节点 done | check-ui-prototype 命令 | 声明段 `design_system_mode: generated`、每页均有非空原型文件、提案目录有合法非空 `design-system.json`、声明清单==产出文件、hash 已记录 | 运行 checker | `exit 0` → 节点 done → plan 子流程可完成 → plan-exit 门可放行 |
| UT-S09-80 | `check-ui-prototype` 逐页对账不全 → 未 done | check-ui-prototype 命令 | 声明 3 页仅产出 2 页（或某页空文件） | 运行 checker | 非零退出 → 节点未 done（advisory 提示清单!=产出）→ plan-exit 前阻断收敛 |
| UT-S09-81 | `generated` 模式缺 `design-system.json` → fail closed（对照组） | check-ui-prototype 命令 | 声明段 `design_system_mode: generated`、逐页原型齐全但无 `design-system.json`/无 ui-ux-pro-max 令牌 | 运行 checker | 非零退出（`generated` 承诺令牌却缺失=fail closed，无法追溯 ui-ux-pro-max）；与 `fallback` 分支（UT-S09-81a）形成对照 |
| UT-S09-81a | `fallback` 模式：无 design-system.json + 有降级原因 → exit0 不阻塞 | check-ui-prototype 命令（F2 核心） | 声明段 `design_system_mode: fallback`（无 Python3）、无 `design-system.json`、有非空 `design_system_fallback_reason`、逐页原型非空、声明清单==产出文件 | 运行 checker | `exit 0`（fallback 不要求 design-system.json、不阻塞）→ `write-ui-prototype` 节点 done → plan-exit 门可到达（验证降级不卡死=F2 核心价值） |
| UT-S09-81b | `fallback` 模式禁伪造令牌 | check-ui-prototype 命令 | 声明 `design_system_mode: fallback` 但提案目录塞入伪造 `design-system.json` 令牌 | 运行 checker | 非零退出（fallback 不得伪造 ui-ux-pro-max 令牌冒充 generated；诚实降级） |
| UT-S09-81c | 缺 `design_system_mode` 字段 → fail closed（对照组） | check-ui-prototype 命令 | 声明段完全缺 `design_system_mode` 字段、逐页原型齐全 | 运行 checker | 非零退出（模式未声明无法判定对账口径=fail closed，安全默认不放行） |

### 9.4 provenance 载体向后兼容（F3、F4）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-82 | `writePlanApproved()` 空写仍合法 | next.ts writePlanApproved | 无 provenance body | 空写 `PLAN_APPROVED` | 写入成功；存在性语义不变（门已过）；不破坏现有空写路径 |
| UT-S09-83 | 可选 JSON body 不破坏仅存在性读取 | PLAN_APPROVED 读取者 | `PLAN_APPROVED` 带 `{ui_prototype_rendered,pages,hashes}` body | 仅存在性读取者读取 | 判「门已过」不受影响；provenance 为可选叠加字段，缺失/空 body ⇒ 安全默认「不宣称 UI 已确认」 |
| UT-S09-84 | legacy 空 marker（无曾渲染证据）经 `verify-ui-provenance` 节点 exit0 达成放行 | `verify-ui-provenance` 的 `openlogos check-ui-hash-match`（F3/F6 legacy-advisory 分支） | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 为**空 marker**、无 `ui_prototype_rendered`、无「曾渲染确认」证据 | 到 `verify-ui-provenance` 节点运行 `done_when: cmd:<check-ui-hash-match>` | 不宣称 UI 已确认、**记 advisory 后 `exit 0`**→节点 **done**（非绕过节点，而是经该节点求值达成）→ merge 可达（无 provenance ≠ 漂移，保留向后兼容）；对照 UT-S09-87（match→0）与 UT-S09-88（partial/失配→fail），构成 F6 三分支 |
| UT-S09-85 | provenance 绑定 hash 记录批准时刻内容 | PLAN_APPROVED body | 渲染面板批准时写 body | 读取 body | 含 `ui_prototype_rendered:true` + `pages:[...]` + `hashes:{<file>:<sha256>}`（逐文件内容 hash） |

### 9.4a 声明页清单结构化与 basename 集合对账（F3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-85a | 声明页清单为结构化条目 | 声明段 pages 结构（F3） | 声明段 pages 每项含 `id`+`prototype`+`description` | 解析声明段 | 每页解析为结构化条目 `{id, prototype: core-NN-<slug>.html（basename）, description}`；非裸字符串列表 |
| UT-S09-85b | 多页 basename 集合对账通过 | check-ui-prototype basename 集合比较（F3） | 声明 3 页、`2-page-design/` 恰产出同 3 个 basename 文件 | 运行 checker | 声明 `prototype` basename 集合 == 产出文件 basename 集合 → 对账通过 |
| UT-S09-85c | 重复 basename → 失败 | check-ui-prototype basename 比较 | 声明两条目 `prototype` basename 相同（重复） | 运行 checker | 非零退出（basename 集合出现重复，清单非法） |
| UT-S09-85d | 额外文件（产出多于声明）→ 失败 | check-ui-prototype basename 比较 | `2-page-design/` 存在声明清单外的额外 `.html` | 运行 checker | 非零退出（产出 basename 集合 ⊋ 声明集合，额外文件不对账） |
| UT-S09-85e | 缺失文件（声明多于产出）→ 失败 | check-ui-prototype basename 比较 | 声明 3 页仅产出 2 个 basename | 运行 checker | 非零退出（声明 basename 集合 ⊋ 产出集合，缺失） |
| UT-S09-85f | slug 含特殊字符 → 失败 | check-ui-prototype basename 校验 | 声明 `prototype` basename slug 含非法特殊字符 | 运行 checker | 非零退出（basename 不符 `core-NN-<slug>.html` 命名，拒绝） |
| UT-S09-85g | 声明 `prototype` 含 `..` 路径穿越 → 失败 | check-ui-prototype 路径安全（F3） | 声明 `prototype: ../../etc/x.html` 或含 `..` 段 | 运行 checker | 非零退出（`prototype` 须为纯 basename，含 `..`/目录分隔=路径穿越，拒绝） |
| UT-S09-85h | `PLAN_APPROVED.pages`/`hashes` 键与声明 basename 一致 | PLAN_APPROVED basename 键复用（F3） | 批准时写 body | 读取 `pages`/`hashes` | `pages` 与 `hashes` 键均为声明 `prototype` basename（`core-NN-<slug>.html`）；与声明清单 basename 集合逐一对齐、无第二套键空间 |

### 9.5 verify-ui-provenance 成功路径与阻断（F4 R4）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-86 | `verify-ui-provenance` 置于 merge 之前 | launched.yaml overlay | overlay-add 节点 `verify-ui-provenance`、`before: generate-merge-prompt`、`when: ui_impact` | flow 校验 | 节点位置在 merge 之前（原型落盘 resources 前拦截漂移） |
| UT-S09-87 | F6 match 分支：完整 provenance 且 hash 匹配 → 经 `verify-ui-provenance` 节点 exit0 done 放行 | `verify-ui-provenance` 的 check-ui-hash-match 命令 | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 含完整 provenance（`ui_prototype_rendered:true`+`hashes`）、`2-page-design/` 现值 hash == `PLAN_APPROVED.hashes` | 运行 `done_when: cmd:<check-ui-hash-match>` | `exit 0` → 节点 done → merge 放行前进（成功路径经该节点求值达成、非单 fail_when 卡死）；F6 三分支之 match→0 |
| UT-S09-88 | hash 失配未 done 阻断 | check-ui-hash-match 命令 | 原型批准后被改、现值 hash != `PLAN_APPROVED.hashes` | 运行 checker | 非零 → 节点未 done（active/pending）→ 前向阻断（不前进） |
| UT-S09-88a | F6 partial 分支：部分 provenance（`ui_prototype_rendered:true` 但缺 hashes）→ 经 `verify-ui-provenance` 节点 fail closed 未 done 阻断 | `verify-ui-provenance` 的 check-ui-hash-match 命令（F6 partial 分支） | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 含 `ui_prototype_rendered:true` **但缺 `hashes`**（部分 provenance，非空 marker、非完整） | 运行 `done_when: cmd:<check-ui-hash-match>` | **非零退出 → 节点未 done → 阻断（fail closed）**：曾宣称渲染却缺 hashes 无法追溯，不得放行；与 UT-S09-84（空 marker→advisory→0）区分——部分 provenance 非 legacy，不享 advisory；F6 三分支之 partial→fail |
| UT-S09-89 | 单 `done_when: cmd:` 合法（非双 cmd:） | §9.2 决策 B | overlay-add `verify-ui-provenance` 仅设 `done_when: cmd:`、无 `fail_when: cmd:` | flow 校验 | 校验通过（overlay-add 单 cmd: 合法，规避决策 B 禁同节点 done/fail 均 cmd:） |
| UT-S09-90 | 失配后显式重入 plan 刷新 hashes → 再匹配放行 | 状态转换（诚实边界） | 失配阻断后，显式重入 plan、重跑 producer 产原型、plan-exit 重批刷新 `PLAN_APPROVED.hashes` | 再到 `verify-ui-provenance` | hash 匹配 `exit 0` → done → 放行（非引擎自动 rewind，为显式重入刷新） |

### 9.6 merge 命令级强制与跨会话 fail-closed（F4 R5、R7）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-91 | 直接 `openlogos merge` 命令级强制不可绕过 | merge.ts pre-merge hash gate | `ui_impact:true`、`PLAN_APPROVED` 含 provenance、原型漂移 | 直接执行 `openlogos merge <slug>`（不经 driver flow） | 拒绝 merge：非零退出 + 明确错误；**不生成 MERGE_PROMPT**（命令级 = 真强制点，driver 流与直调均不可绕过） |
| UT-S09-92 | F4 R7：批准记录含 UI provenance → 永久 fail closed | merge.ts / 强制语义键 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true`+`hashes`、`ui_impact:true` | merge 时 `hashes` 缺失/损坏/失配 | 一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）；判据键=持久化 `PLAN_APPROVED` 内容，非消费时会话 capability |
| UT-S09-93 | 模式选择读会话 capability，强制语义不读 | 模式/强制分离（F4 R7） | plan-exit 前读 `.session-capabilities.json` 选模式；plan-exit 后 merge/落盘/复核 | 分别在两阶段 | plan-exit 前：capability 就绪→渲染确认模式、缺失→降级模式；plan-exit 后：一律以 `PLAN_APPROVED` provenance 为准，**不读** session capability |
| UT-S09-94 | 对照组：GUI+ui_impact 空 marker（无曾渲染证据）经 `verify-ui-provenance` 节点 advisory exit0 达 merge | F3/F6 legacy-advisory 分支 | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 空 marker、无任何「曾渲染确认」证据 | 经 `verify-ui-provenance` 节点运行 `check-ui-hash-match` 后 merge | 记 advisory 后 **`exit 0` → 节点 done → merge 可达**（不要求 `hashes`、不阻断）；**经该节点求值达成、非绕过节点**；与 UT-S09-88a（部分 provenance→fail closed）对照，共同界定 F6 legacy-advisory 与 fail-closed 边界 |
| UT-S09-95 | `commitVerifiedPrototypes()` 落盘入口亦 fail closed | commitVerifiedPrototypes（事务门） | `PLAN_APPROVED` 含 UI provenance、staged 原型 hash 失配 | 事务落盘门 | 在写入任何文件前 abort、拒绝落盘、resources 零残留、不写 `SPEC_MERGED`（不止提示前检查，落盘入口同样 fail closed） |

### 9.7 事务性落盘：单一入口 / staged 校验 / 崩溃恢复（F1 R2、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-96 | `commitVerifiedPrototypes()` 为原型落盘唯一入口 | merge.ts commitVerifiedPrototypes | 原型资产落盘 | 调用 merge | 原型落盘仅经此命名函数（复用现有路径映射，但为新代码路径）；merge-executor 绝不触碰原型资产（只应用 markdown 规格 delta）；无第二条落盘路径 |
| UT-S09-96a | advisory 分支也经 `commitVerifiedPrototypes()` 同一入口 | commitVerifiedPrototypes（advisory） | capability 缺失/降级会话、原型资产需落盘 | 调用 merge（advisory 放行） | 原型仍仅经 `commitVerifiedPrototypes()` 落盘（advisory 分支只是不做严格 hash 校验）；无第二条绕过路径；merge-executor 仍不触碰原型资产 |
| UT-S09-97 | 三段事务：全量校验先于任何写入 | verify-all→stage→commit | 多原型、其一 hash 失配 | 执行落盘 | 全量校验阶段任一不符即在写入任何文件前 abort；无部分落盘 |
| UT-S09-98 | 校验 staged 字节而非源，消除 TOCTOU | staged 字节校验 | 源原型在校验后再被改动 | 落盘 | 对 staged 副本算 hash 比对 `PLAN_APPROVED.hashes`，原子 rename 提交的正是已校验 staged 字节；「已校验字节==已提交字节」，源后续变更不影响 |
| UT-S09-99 | commit journal 崩溃恢复：前滚 | intent journal + 启动恢复 | 提交中途崩溃、journal 残留（部分 rename 已完成） | 下次 merge/启动检测残留 journal | 依 journal 前滚补完未完成的 rename → 一致的全有态；恢复后清 journal |
| UT-S09-100 | commit journal 崩溃恢复：回滚 | intent journal + 启动恢复 | 提交中途崩溃、需回滚 | 下次 merge/启动检测残留 journal | 用 backup 还原已改动、删 staging → 一致的全无态；恢复后清 journal |
| UT-S09-101 | 失败回滚零残留 | 失败语义 | 任一阶段失败 | 落盘失败 | resources 回到 merge 前状态（无部分落盘、无未获批内容）、`SPEC_MERGED` 不写、流程标记失败并阻断 |
| UT-S09-102 | apply-merge 后复核 hash（双保险） | apply-merge 后复核 | 落盘完成 | 复核 resources 中原型 hash | == `PLAN_APPROVED.hashes`；不符则阻断流程前进（不进 slice/code） |

### 9.8 前置能力门与 capability 输入闭环（F2 R6、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-103 | 前置能力门两源模板 surface capability | plugin/bin/openlogos-phase + plugin-codex/session-start.sh | `.session-capabilities.json` 含 `ui_prototype_render:true` | 执行两 SessionStart 入口 | 两源均在上下文追加 `capabilities` 段、一致 surface；改源模板非部署副本（`.claude/openlogos/bin/openlogos-phase` 为 sync 副本不直接改） |
| UT-S09-104 | `status`/`next` JSON 承载 `capabilities` 字段 | cli-json-output.md | 同上 capability 文件存在 | `openlogos status --format json` / `next --format json` | 含 `capabilities` 字段，与上下文 `capabilities` 段一致 |
| UT-S09-105 | 能力文件缺失 = 降级模式 | capability 输入闭环 | 无 `logos/.session-capabilities.json` | 读取 capability | 判缺失→降级模式（不 claim UI 确认、advisory 不阻断） |
| UT-S09-106 | runlogos 写文件 → openlogos 读并 surface 闭环 | 输入通道 | runlogos 会话建立时写 `{"ui_prototype_render":true}` | openlogos-phase 钩子与 status/next 读该文件 | 据以生成上下文 `capabilities` 段与 JSON `capabilities` 字段（runlogos 写→openlogos 读并 surface→plan-exit 前定模式） |

### 9.9 writing 阶段冲突消解与三层指令资产（F2 R6、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-107 | writing 阶段 GUI+ui_impact 放行 page-design 原型 delta | openlogos-phase writing 分支 | GUI 项目、`ui_impact:true`、writing 阶段 | 执行 SessionStart hook | 注入文本含「例外：GUI + 触及 UI 时允许在 plan 阶段产 page-design 原型 delta」；不与「不得写 delta」注入冲突（F2 R6） |
| UT-S09-108 | ready-to-delta 阶段同例外放行原型 delta | plugin-codex/session-start.sh ready-to-delta 分支 | 同上、ready-to-delta 阶段 | 执行 SessionStart hook | 同样注入 GUI+ui_impact 例外；其余 delta 仍禁于 plan 阶段 |
| UT-S09-109 | 非 GUI 或 ui_impact:false 时不放行原型例外 | 两源 writing/ready-to-delta 分支 | 非 GUI 项目或 `ui_impact:false` | 执行 hook | 不注入例外文案，保持「不得写 delta」原语义（例外仅 GUI+ui_impact） |
| UT-S09-110 | 三层指令资产齐备 | L1/L2/L3 交付物 | 已 sync 的 GUI 项目 | 检查交付物 | (L1) `change-writer`/`product-designer`/`merge-executor` SKILL + checker 说明；(L2) `sync` 重生成的 `AGENTS.md`/`CLAUDE.md` 承载 UI-first 工作流；(L3) **读取真实文件 `spec/flow/overlays/gui-ui-first.yaml`**、经现有 overlay parser/schema 校验为合法 overlay 片段且含两个 `op:add`（`write-ui-prototype`/`verify-ui-provenance`）——而非检索 Markdown 示例文本；三层缺一即指令链断 |
| UT-S09-110a | GUI overlay 唯一源真实存在、含两个合法 `op:add`，且 `done_when` 命令实际可求值 | `spec/flow/overlays/gui-ui-first.yaml`（唯一源）+ 真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match` | 已 sync 的 GUI 项目；准备①合法 `generated` 提案（逐页原型齐全 + 合法 `design-system.json`/令牌 + hash 已记录）与②合法 `fallback` 提案（逐页原型齐全 + `design_system_fallback_reason`、无令牌） | 读取真实文件经 overlay parser/schema 校验；再**实际执行**两个 `done_when` 后端子命令 | 文件存在、解析为合法 overlay 片段；恰含两个 `op:add`——① `write-ui-prototype`（`after: write-tasks`、`when: ui_impact`、`produces: 2-page-design/`、`done_when: cmd:<check-ui-prototype>`）；② `verify-ui-provenance`（`before: generate-merge-prompt`、`when: ui_impact`、`done_when: cmd:<check-ui-hash-match>`）；两节点均合法（overlay-add 允许 `cmd:`）。**不止校验 schema 接受 `cmd:`**：`done_when` 后端为真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match`，对上述合法 generated 与 fallback 提案实际求值 → 两命令均 `exit 0` |
| UT-S09-110a-neg | `done_when` 命令不存在或仍含字面占位符 → 必须失败（负向） | overlay `done_when` 后端可执行性 | 已 sync 的 GUI 项目 | ①将 `done_when: cmd:` 后端指向**不存在的子命令**求值；②或 overlay 仍保留字面 `<check-ui-prototype>`/`<...>` 占位符未被真实子命令名替换 | 运行/求值 `done_when` | **必须失败**（非零退出/校验失败）：命令不存在无法求值即节点不可 done；overlay 仍含字面 `<...>` 占位=未落地为真实可执行命令，判非法（保证 `cmd:` 后端确为真实子命令而非示意文本） |
| UT-S09-110b | init/sync 对 GUI 项目注入 overlay 到项目实例 `launched.yaml` | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，该模块值 ∈ GUI={`web`,`desktop`,`mobile`}（即项目含 ≥1 GUI 模块） | 运行 init/sync | `spec/flow/overlays/gui-ui-first.yaml` 两个 `op:add` 被并入项目实例 `logos/flow/launched.yaml` 顶层 `overlay:`（该实例 `extends: builtin:launched@v1`）；注入后 plan subflow 含 `write-ui-prototype`、merge subflow 前含 `verify-ui-provenance`（product_type 唯一源 = `logos-project.yaml modules[].product_type`，非凭空给定） |
| UT-S09-110c | 非 GUI 项目不注入 GUI overlay | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，全部模块值 ∈ 非 GUI={`cli`,`api`,`library`,`skills`}（项目无任何 GUI 模块） | 运行 init/sync | **不注入** gui-ui-first overlay；项目实例 `launched.yaml` 不含 `write-ui-prototype`/`verify-ui-provenance`；特性零启用、流程零改动 |
| UT-S09-110d | `product_type` 字段缺失 → 按非 GUI、overlay 不注入 | project-init/sync overlay 注入（缺字段默认） | 真实 `logos-project.yaml` 的 `modules[]` 条目**完全缺 `product_type` 字段** | 运行 init/sync | 缺失=非 GUI（安全默认）；**overlay 不注入**；项目实例 `launched.yaml` 不含 `write-ui-prototype`/`verify-ui-provenance`；对应 GUI 模块存在时该缺字段模块节点 skip（`ui_impact` 不因缺字段模块置真） |
| UT-S09-110e | 多模块（一 GUI 一非 GUI）：节点参与由活跃提案 module 的 `product_type` 决定 | module-aware `ui_impact` 派生 | 真实 `logos-project.yaml` 含两模块——`moduleA.product_type=web`（GUI）、`moduleB.product_type=cli`（非 GUI） | 活跃提案分别归属两模块时派生 `ui_impact` | 活跃提案属**非 GUI 模块 B** → `ui_impact==false`、`write-ui-prototype`/`verify-ui-provenance` 节点 skip；活跃提案属 **GUI 模块 A** → `ui_impact==true`、两节点参与（overlay 项目级注入因项目含 ≥1 GUI 模块成立，但**节点参与由 module-aware `ui_impact`＝活跃提案所属 module 的 product_type 决定**，非项目级一刀切） |
| UT-S09-111 | Python3 缺失时通用风格兜底并写 `fallback` 声明 | change-writer 降级 | GUI 项目、`ui_impact:true`、无 Python3 | 产出原型 | 以通用风格兜底；声明段写 `design_system_mode: fallback` + 非空 `design_system_fallback_reason`（如「无 Python3，未走设计系统」）；不产 `design-system.json`、不伪造令牌；`check-ui-prototype` exit0（不阻塞、不报错），与 UT-S09-81a 端到端一致 |

### 9.9a 存量项目 `product_type` 回填与 overlay 迁移（F1）

> 覆盖已 `launched` 存量 GUI 项目的可达性迁移：`module set-product-type` 幂等回填、`PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断、`--auto` 安全默认、`sync` 正反向幂等注入/移除且保留用户自定义 overlay ops。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-115 | `module set-product-type` 幂等回填 `modules[].product_type` | module set-product-type 命令（F1 回填） | 已 `launched` 项目、`logos-project.yaml` 某 module 缺 `product_type` | `openlogos module set-product-type core web` | 写 `modules[].product_type=web`、`exit 0`；再次执行同值=no-op（幂等，不重复写、`exit 0`） |
| UT-S09-116 | `set-product-type` 非法枚举 → 报错 | module set-product-type 校验（F1） | 已 launched 项目 | `openlogos module set-product-type core gui`（非 `web|desktop|mobile|cli|api|library|skills|service`） | 非零退出 + 明确错误；**不写** `logos-project.yaml` |
| UT-S09-117 | `set-product-type` 未知 module → 报错 | module set-product-type 校验（F1） | `logos-project.yaml` 无 `nope` 模块 | `openlogos module set-product-type nope web` | 非零退出 + 明确错误（未知 module-id）；不写文件 |
| UT-S09-117a | `set-product-type` 缺参 → 报错 | module set-product-type 校验（F1） | 已 launched 项目 | `openlogos module set-product-type core`（缺 enum）/ `openlogos module set-product-type`（缺 module+enum） | 非零退出 + 用法错误；不写文件 |
| UT-S09-118 | 存量缺字段 → `sync`/`status`/`next` 发 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` | sync/status/next 缺字段检测（F1 诊断） | 已 `launched`、`modules[]` 缺 `product_type` | 运行 `openlogos sync` / `status` / `next` | 三者均输出机器可读 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`（列缺字段 module、指向 `module set-product-type`）；安全默认「缺字段=非 GUI」维持、overlay 不注入 |
| UT-S09-118a | 回填后诊断消失 | sync/status/next（F1 幂等） | UT-S09-118 之后 `set-product-type core web` | 再运行 `sync`/`status`/`next` | 不再输出 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`（该 module 已有字段） |
| UT-S09-119 | 回填 GUI 后 `sync` 幂等注入 overlay | sync overlay 注入（F1 正向幂等） | `set-product-type core web` 后（项目含 ≥1 GUI 模块） | 运行 `openlogos sync`；再运行一次 | 首次把 `gui-ui-first` 两 op:add 并入项目实例 `launched.yaml`（plan subflow 含 `write-ui-prototype`、merge 前含 `verify-ui-provenance`）；**重复 sync 不重复注入**（按 node id 去重、no-op） |
| UT-S09-120 | 拒绝确认 / 设为 `cli` → 保持非 GUI、不注入 | set-product-type + sync（F1 安全默认） | 存量缺字段项目 | 用户不回填（保持缺字段）或 `set-product-type core cli` 后 `sync` | 保持非 GUI；`sync` **不注入** `gui-ui-first`；`launched.yaml` 不含 `write-ui-prototype`/`verify-ui-provenance`；`ui_impact` 恒假 |
| UT-S09-121 | 多模块（一 web 一 cli）回填后仅 web 提案 `ui_impact` 真 | module-aware `ui_impact` + 回填（F1） | 回填 `moduleA=web`、`moduleB=cli`；项目含 ≥1 GUI 模块故 overlay 已注入 | 活跃提案分属两模块时派生 `ui_impact` | 提案属 **web 模块 A** → `ui_impact==true`、可推进 UI-first；提案属 **cli 模块 B** → `ui_impact==false`、两节点 skip（overlay 项目级注入但节点参与由活跃提案 module 的 `product_type` 决定） |
| UT-S09-122 | 反向移除：唯一 GUI 模块改 `cli` → `sync` 移除 overlay ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块 `core=web`（overlay 已注入）、`launched.yaml` 另含**用户自定义 overlay op** `custom-user-node` | `set-product-type core cli` 后 `openlogos sync`；再运行一次 | 按 node id 移除 `write-ui-prototype`/`verify-ui-provenance`；**用户自定义 `custom-user-node` 保持不变**（不被 sync 删除）；重复 sync 幂等（已移除即 no-op） |
| UT-S09-122a | 反向移除：删最后一个 GUI 模块 → `sync` 移除 overlay ops 且保留用户 ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块（overlay 已注入）、`launched.yaml` 另含用户自定义 overlay op | 删除该 GUI 模块后 `openlogos sync` | 项目不再含任何 GUI 模块 → 按 node id 移除 `gui-ui-first` 两节点；**同一 `launched.yaml` 内用户自定义 overlay op 保持不变** |
| UT-S09-123 | `--auto` 缺字段模块不被自动判 GUI、输出诊断、不注入 | `--auto` 安全默认（F1） | 已 `launched`、`modules[]` 缺 `product_type` 的 GUI 意图项目、无人值守 | `openlogos next --auto`（含 sync/推进链） | **绝不**自动判为 GUI；保持安全默认（非 GUI、不注入 overlay）；照常暴露 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为 next action；仅显式 `set-product-type` 后才注入 |
| UT-S09-124 | `service` 为合法枚举且判非 GUI | `PRODUCT_TYPE_ENUM` 尾部扩展 `service`（add-product-type-service） | 已 launched 项目 | `openlogos module set-product-type core service`；重复设同值；`openlogos sync`；读 `status --format json` | 写入成功且幂等（`modules[core].product_type=="service"`，重设同值 no-op）；`isValidProductType('service')===true` 且 `isGuiProductType('service')===false`、`ui_impact` 恒假；`sync` **不注入** `gui-ui-first` overlay；缺字段诊断 `next_action.enum` 为固定顺序 8 值、尾部为 `"service"`（既有 7 值前缀逐字不变） |

### 9.10 双阶段发布状态与跨仓依赖（F2 R7）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-112 | 跨仓两仓缺一核心价值不成立 | 交付闭环（F2 R2） | 仅 openlogos 契约发布、无 runlogos 实现 | 判定发布状态 | 核心视觉确认价值不成立；保持 contract-ready（capability-disabled），不得 claim「UI/UX 确认已前移」已启用 |
| UT-S09-113 | `ui-ux-first-panel` 具名依赖登记 | 具名依赖（F2 R3） | 契约 merge 后 | 检查依赖登记 | runlogos 关联件登记为具名 change `ui-ux-first-panel`；本提案 §5/契约表以此 slug 引用；非「默认其存在」 |
| UT-S09-114 | 双阶段发布状态由验收机器判定 | 发布状态（F2 R7） | contract-ready 已达 / 跨仓 smoke 结果 | 判定 feature-enabled | contract-ready=OpenLogos npm+文档站发布即达；feature-enabled 当且仅当 `ui-ux-first-panel` 已部署且跨仓端到端 smoke 全绿；由验收结果机器判定，非人工声称 |

## 十、UI/UX 前置确认场景测试用例（proposal-ui-ux-first）

> 场景级端到端验收，尤其 F4 R7 跨会话 fail-closed。测试实现写入 OpenLogos reporter，测试名含 `ST-S09-*` ID。

| ID | 描述 | 覆盖 Steps / 场景 | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-33 | GUI 项目提案阶段产出原型并在 plan 门前可见 | S09 Step 3→6（plan 门前） | GUI 项目、`ui_impact:true`、driver 派发 change-writer | plan 节点判 ui_impact→dispatch change-writer（ui-ux-pro-max）产逐页原型+`design-system.json`（写 `2-page-design/`，guard 放行）→ `check-ui-prototype` 富对账 | 原型在 plan-exit 门前产出且可见；富对账通过节点 done；flow-derive 不因原型 delta 误判进入 spec |
| ST-S09-33a | 场景级降级贯通：Python3 缺失 → fallback 原型 → checker exit0 → plan-exit 可达 | S09 A3→plan-exit（F2 降级贯通） | GUI 项目、`ui_impact:true`、**无 Python3**（ui-ux-pro-max 令牌不可得）、driver 从 A3 派发 change-writer | ①A3 派发 change-writer→检测无 Python3 走 `fallback`（通用原型、**无令牌**、逐页原型非空、声明段写 `design_system_mode: fallback` + 非空 `design_system_fallback_reason`、不产 `design-system.json`）→写 `2-page-design/`（guard 放行）；②运行 `openlogos check-ui-prototype`；③`write-ui-prototype` 节点收敛；④继续推进至 plan-exit | `check-ui-prototype` **`exit 0`**（fallback 不要求 design-system.json/令牌、不阻塞）→ `write-ui-prototype` 节点 **done** → **一路推进至 plan-exit 可达**（非仅单测 checker，而是 A3→plan-exit 端到端降级不卡死＝F2 核心价值）；对照：`generated` 模式承诺令牌却缺失时端到端 **fail closed**（checker 非零、`write-ui-prototype` 未 done、plan-exit 前阻断），与本 fallback 通路形成对照 |
| ST-S09-34 | 批准即 UI 确认：面板渲染写 provenance | S09 Step 6→7（批准门） | 渲染面板、原型已产出 | 面板渲染原型→用户批准→写 `PLAN_APPROVED` body（`ui_prototype_rendered:true`+`pages`+`hashes`） | 「批准==UI 已确认」仅当面板实际渲染成立；provenance 记录批准时刻原型清单与逐文件 hash |
| ST-S09-35 | 批准后原型漂移经 verify-ui-provenance 阻断 | merge 前拦截（F4 R4） | 已写带 hashes 的 `PLAN_APPROVED`、原型批准后被改 | 到 `verify-ui-provenance` 节点重算 hash | 失配→节点未 done→前向阻断（原型未 merge 进 resources）；显式重入 plan 刷新 hashes 后再匹配放行 |
| ST-S09-36 | **跨会话验收**：删 capability 文件+重启+改原型+直调 merge 必须拒绝 | F4 R7 跨会话 fail-closed | ①渲染批准写带 `hashes` 的 `PLAN_APPROVED`；②删 `logos/.session-capabilities.json`；③重启进程；④改动原型 | 直接 `openlogos merge <slug>` | **必须拒绝**：不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`；当前会话 capability 缺失不得降级（「曾渲染确认」证据固化于批准记录）；**同时覆盖 `commitVerifiedPrototypes()` 落盘入口**——事务门亦 fail closed、resources 零残留 |
| ST-S09-37 | 对照组：旧空 marker 纯 CLI 项目 advisory 放行 | F3 向后兼容对照 | 纯 CLI 项目、`PLAN_APPROVED` 空 marker、无「曾渲染确认」证据 | 直接 `openlogos merge <slug>` | advisory 放行（不要求 hashes、不阻断），与 ST-S09-36 严格分支形成对照 |
| ST-S09-38 | 崩溃注入：事务落盘崩溃后恢复到全有或全无 | 崩溃恢复（F1 R3） | 多原型落盘、提交中途注入崩溃 | 崩溃→下次 `openlogos merge`/启动检测残留 journal→前滚或回滚 | 恢复到一致的全有或全无态；无部分落盘/未获批残留；恢复后清 journal；随后 apply-merge 后复核 hash 一致 |
| ST-S09-39 | 跨仓端到端发布状态两态可区分 | 双阶段发布（F2 R7，契约侧） | 契约已发布 | 缺 `ui-ux-first-panel` 时判态；`ui-ux-first-panel` 部署且跨仓 smoke 全绿时判态 | 前者=contract-ready（如实声明功能未启用/降级）；后者=feature-enabled；两态可由验收结果区分（跨仓端到端 smoke 由 `ui-ux-first-panel` 承载，边界见 smoke 用例） |
| ST-S09-40 | 非 GUI 项目特性不启用、流程零改动 | 非 GUI 回归 | 纯 CLI/API/Skills 项目 | 走完整 S09 变更流程 | `ui_impact` 恒假、`write-ui-prototype`/`verify-ui-provenance` skip、plan allowlist 不收窄、merge 无 hash gate；流程与现状逐字节一致（无回归） |
| ST-S09-41 | **存量 GUI 项目迁移端到端**：缺字段→诊断→回填→sync 注入→UI-first 可达 | S09 F1 存量迁移贯通 | 旧 `launched` GUI fixture：`logos-project.yaml` 的 `modules[]`（含 `core`）**缺 `product_type`**；overlay 未注入（原不可达） | ①`openlogos sync`（或升级路径）→ 收到 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断（列 `core`、指向 set-product-type）；②`openlogos module set-product-type core web`（幂等回填）；③`openlogos sync`（幂等注入 overlay）；④针对 `core` 模块的提案声明 `ui_impact:true` 并派生 | ①诊断如实列缺字段 module、安全默认非 GUI 维持、overlay 仍未注入；②回填成功、`modules[].product_type=web`；③`gui-ui-first` 两 op:add 注入项目实例 `launched.yaml`、重复 sync 不重复注入（幂等）；④**仅 `core`（web）模块的提案 `ui_impact` 可真、可推进到 UI-first**（`write-ui-prototype`/`verify-ui-provenance` 参与）；同一 fixture 若另有 cli 模块，其提案 `ui_impact` 仍假 |
| ST-S09-42 | 存量迁移反向：GUI→非 GUI / 删最后 GUI 模块 → sync 移除 overlay、保留用户 ops | S09 F1 反向移除贯通 | 已回填 GUI 且 overlay 已注入的 `launched.yaml`，另**含用户自定义 overlay op** `custom-user-node` | ①`set-product-type core cli`（或删最后一个 GUI 模块）→ `openlogos sync`；②再 `sync` | 项目不再含 GUI 模块 → `sync` 按 node id 移除 `write-ui-prototype`/`verify-ui-provenance`；**同一 `launched.yaml` 内用户自定义 `custom-user-node` 保持不变、绝不被删除**；重复 sync 幂等（no-op）；随后 GUI 相关节点全 skip、流程回落至非 GUI 零改动 |
| ST-S09-43 | `--auto` 无人值守缺字段不猜测升级 GUI | S09 F1 `--auto` 安全默认 | 旧 `launched` GUI 意图 fixture、`modules[]` 缺 `product_type`、无人值守 | `openlogos next --auto`（含 sync/推进链，无人工干预） | 缺字段模块**绝不被自动判 GUI**；保持安全默认（非 GUI、overlay 不注入、`ui_impact` 假）；照常输出 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为 next action；未显式 `set-product-type` 前不注入 overlay、不推进 UI-first |

## 十一、UI/UX 前置确认异常测试用例（proposal-ui-ux-first）

> 覆盖非法 delta、判定容错与降级异常路径。测试实现写入 OpenLogos reporter，测试名含 `ST-S09-EX-*` ID。

| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S09-EX-9.1 | 非法 `.md` delta 缺段标记报错不覆盖 | F3 防静默覆盖 | `deltas/**/*.md` 规格/skill delta 缺 `ADDED/MODIFIED/REMOVED` 段标记 | merge / merge-executor 应用 | 一律判为非法 delta 并报错停下；**绝不静默整份覆盖**主文档（整份 create/replace 仅限 `2-page-design/` 等资产目录 `.html`/`.png`/`.svg`） |
| ST-S09-EX-9.2 | 声明清单 != 产出文件 → 节点未收敛（advisory） | 三方对账不一致 | 声明段声明 3 页、`2-page-design/` 仅产 2 页 | `check-ui-prototype` 对账 | 节点未收敛、advisory 提示不一致；plan-exit 前阻断（可交付 done_when 不满足） |
| ST-S09-EX-9.3 | hash 损坏/缺失（含 UI provenance）→ fail closed | F4 R7 强制 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true` 但 `hashes` 损坏或缺失 | merge / 落盘 / 落盘后复核三处 | 三处一致拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）；不因会话 capability 缺失降级 |
| ST-S09-EX-9.4 | 空原型文件不满足可交付 done_when | F1 R5 收紧存在性 | 声明页对应文件存在但为空（0 字节） | `check-ui-prototype` | 未收敛（逐页非空判据不满足）；「存在」不等于「可交付」 |
| ST-S09-EX-9.5 | 提示前 / 落盘时 / 落盘后三处判据一致 | 纵深防御一致性 | 含 UI provenance 的漂移原型 | 分别命中 merge.ts 提示前、`commitVerifiedPrototypes()` 落盘时、`apply-merge` 后复核 | 三处均 fail closed，**不复用同一「capability 缺失即降级」错误分支一致放行**；形成纵深防御 |

## 十二、Windows 外部归档 watcher 握手测试用例（win32-archive-watcher-handshake）

> 覆盖仅 Windows 的 archive watcher 握手（功能规格 §2.31 / S09 EX-10.1~10.7）。协议逻辑（路径解析、租约快照、prepare/ACK 轮询、去递归 token、稳定错误码、三态调和）以纯函数 + 注入式 fs/platform/env 单测，不依赖真实 Windows；平台分支用 `process.platform` 注入或 skipIf 门控。用例实现含 OpenLogos reporter，测试名含对应 ID。编号顺延既有最大（UT-S09-124 / ST-S09-43 / ST-S09-EX-9.5）。

### 12.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-125 | 协议路径解析确定性 + 兼容向量 | §2.31 | 给定项目根 | 解析 instances/requests/acks/result 路径 | 与固定兼容向量逐一相等；`..`/symlink 越界被拒 |
| UT-S09-126 | 租约快照只纳入未过期+projectId 匹配+capabilities 含 prepare | §2.31 | instances/ 混合租约各一 | 快照函数 | 仅合格入快照；PID 存活不替代租约判定 |
| UT-S09-127 | runtime 目录缺失=空快照非错误 | EX-10.1 | `logos/.runtime/` 不存在 | 快照函数 | 返回空快照不抛错；调用方走快路径 |
| UT-S09-128 | prepare 原子写含 expectedInstances | §2.31 | 快照 2 实例 | 写 prepare | 临时文件+原子 rename 落盘，expectedInstances=快照集合，含 deadlineAt |
| UT-S09-129 | ACK 轮询屏障：全 released 才放行 | EX-10.2 | expectedInstances=2，acks 渐现 | 轮询函数 | 未齐放行=false；全 released 才 true；任一 failed 立返 failed+稳定 reason |
| UT-S09-130 | 去递归 token 严格校验 | EX-10.5 | 注入 env token | 一致/project 不符/slug 不符/过期 各一 | 仅一致者跳过握手；其余拒绝跳过 |
| UT-S09-131 | 稳定错误码映射 | §2.31 | prepare 失败/ACK 超时/实例 failed/三态矛盾 | 错误码映射 | 得 `ARCHIVE_WATCH_PREPARE_FAILED`/`ACK_TIMEOUT`/`INSTANCE_FAILED`/`STATE_INCONSISTENT`，均非零退出 |
| UT-S09-132 | 过期请求/租约清理幂等 | §2.31 | 含过期项 | 清理函数 | 过期清、未过期留、重复幂等；清理失败不反转归档 |
| UT-S09-133 | 三态调和：命令报错但磁盘已归档→成功 | EX-10.6 | live 已移走、archive 存在、guard 已删，命令非零 | 三态裁决 | archived+`reconciledFromDisk`；live 在则可恢复；矛盾则 inconsistent fail-closed |
| UT-S09-134 | 未知主版本/能力不足按不可协调处理 | EX-10.4(b) | 主版本高于认知或 capabilities 缺 prepare | 判定函数 | 不纳入可 ACK 快照，标记「存在不可协调监听者」，调用方 fail-closed 提示升级 |

### 12.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-44 | 单实例 ACK 后才 rename | Step 13→14 | 注入 win32；快照 1 实例；rename 打桩计数 | 先不写 ACK 再写 released | released 前 rename=0；released 后 rename 1 次，删 guard，写 archived result |
| ST-S09-45 | 多实例必须全 ACK | Step 13→14 | 注入 win32；快照 2 实例 | 一个 released 另一超时 | rename=0，fail-closed，`ARCHIVE_WATCH_ACK_TIMEOUT`，guard 留，写 not-archived result |
| ST-S09-46 | 快照空走快路径归档 | EX-10.1 | 注入 win32；runtime 不存在 | 运行 archive | 不写 prepare、无等待，rename 成功，删 guard，等同无协议 |
| ST-S09-47 | single-flight：同 project+slug 仅一请求在途 | §2.31 | 注入 win32；已有未过期 prepare | 再次 archive | 共享结果或返回 archive-in-flight，不重复 pause |

### 12.3 异常测试用例补充

| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|---------|---------|---------|---------|
| ST-S09-EX-10.1 | 旧版持句柄致 rename EPERM 的明确诊断 | EX-10.4(a) | 注入 win32；快照空；rename 打桩抛 EPERM | 运行 archive | fail-closed 不动 guard、不自动重试；输出「可能有旧版 RunLogos 或其他程序正在监听，请升级或关闭后重试」 |
| ST-S09-EX-10.2 | 看得见但不可协调实例 fail-closed | EX-10.4(b) | 注入 win32；快照仅含 capabilities 缺 prepare/未知高版本 | 运行 archive | 不 rename、不动 guard；提示升级 CLI 或关闭该实例；不当作无监听者 |
| ST-S09-EX-10.3 | CLI 崩溃 result 缺失后重跑三态调和 | EX-10.6 | 注入 win32；rename 已完成但无 result | 重跑 archive | 三态裁决 archived+`reconciledFromDisk`，不重复 rename，不反转磁盘真相 |
| ST-S09-EX-10.4 | 非 Windows 完全不启用协议 | EX-10.7 | 注入 darwin/linux；即使存在 runtime 与租约 | 运行 archive | 不读/写/监听协议文件、不校验 token、不等待；直接 rename 归档，与现状逐字节一致 |

### 12.4 覆盖度校验补充

- [ ] 路径解析确定性+兼容向量+越界拒绝：UT-S09-125
- [ ] 租约快照判据：UT-S09-126、UT-S09-134
- [ ] runtime 缺失=空快照 + 快路径归档：UT-S09-127、ST-S09-46
- [ ] prepare 原子写与稳定屏障：UT-S09-128
- [ ] ACK 轮询屏障：UT-S09-129、ST-S09-44、ST-S09-45
- [ ] 去递归 token 校验：UT-S09-130
- [ ] 稳定错误码映射：UT-S09-131
- [ ] 过期清理幂等：UT-S09-132
- [ ] 三态调和 reconciledFromDisk：UT-S09-133、ST-S09-EX-10.3
- [ ] 旧版 EPERM 诊断不自动重试：ST-S09-EX-10.1
- [ ] 不可协调监听者 fail-closed：UT-S09-134、ST-S09-EX-10.2
- [ ] single-flight：ST-S09-47
- [ ] 非 Windows 不启用协议：ST-S09-EX-10.4

## 存量逆向基线：确认机制已移除的反向回归（brownfield-adopter）

| 用例 ID | 名称 | 覆盖点 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| UT-S09-B01 | seeded 项目触碰逆向区域时 next / change-writer 不再给 JIT 确认提示 | 确认机制移除反向回归 | `bootstrap: adopted`、`seeded`、活跃 change 目标区域仅 `verified:false` 逆向 spec | 执行 `openlogos next`；change-writer 产 delta | `next` 输出**不含** JIT advisory / 「确认现状」提示；change-writer **不**建议在 delta 内把 `## 逆向基线来源` 置 `verified:true`、**不**产确认相关 advisory；该区域 `verified` 保持 `false`、覆盖率不变 |

> 说明：原 `UT-S09-B02`/`UT-S09-B03`、`ST-S09-B01`/`ST-S09-B02`（advisory 存在判定 / 单份最终态 delta 承载确认 / merge 后覆盖率前移）随人工确认机制删除一并移除；本节只保留一条**反向回归**（`UT-S09-B01` 复用），断言确认提示不再产生。
