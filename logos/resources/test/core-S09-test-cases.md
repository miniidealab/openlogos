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
| UT-S09-231 | proposal/tasks 已脱模板后 final 前识别 ready-to-delta | final 前校验 | `proposal.md` 已填、`tasks.md` 含 `[delta]` 且 checkbox `0/N`、无 `PLAN_APPROVED` | 调用 proposal lifecycle / driver 前沿校验函数 | 返回 `proposal_step=="ready-to-delta"`；`plan_ready==true`；不得返回任务规划失败 |
| UT-S09-63 | tasks checkbox 0/N 不触发规划失败 | 执行进度分层 | 同 UT-S09-231，`tasks_execution_done=0`、`tasks_execution_total>0` | 生成 final 诊断 | 诊断说明“delta 尚未执行 / plan gate pending”；不包含 blocked、planning failed 或要求重写 tasks 的语义 |
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
| UT-S09-78 | builtin `launched.yaml` 不硬编码 UI 原型节点 | launched.yaml + `spec/flow/overlays/gui-ui-first.yaml` | 解析 builtin plan subflow | 检查节点集 | builtin plan subflow **不含** `write-ui-prototype`（builtin 侧无此两节点；它们仅存在于方法论 GUI overlay 真实源 `spec/flow/overlays/gui-ui-first.yaml`，由 init/sync 在 GUI 项目时注入） |
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
| UT-S09-84 | legacy 空 marker（无曾渲染证据）经 `openlogos check-ui-hash-match` 判 exit0 | `verify-ui-provenance` 的 `openlogos check-ui-hash-match`（F3/F6 legacy-advisory 分支） | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 为**空 marker**、无 `ui_prototype_rendered`、无「曾渲染确认」证据 | 到 `verify-ui-provenance` 节点运行 `done_when: cmd:<check-ui-hash-match>` | 不宣称 UI 已确认、**记 advisory 后 `exit 0`**→节点 **done**（非绕过节点，而是经该节点求值达成）→ merge 可达（无 provenance ≠ 漂移，保留向后兼容）；对照 UT-S09-87（match→0）与 UT-S09-88（partial/失配→fail），构成 F6 三分支 |
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

### 9.6 merge 命令级强制与跨会话 fail-closed（F4 R5、R7）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-91 | 直接 `openlogos merge` 命令级强制不可绕过 | merge.ts pre-merge hash gate | `ui_impact:true`、`PLAN_APPROVED` 含 provenance、原型漂移 | 直接执行 `openlogos merge <slug>`（不经 driver flow） | 拒绝 merge：非零退出 + 明确错误；**不生成 MERGE_PROMPT**（命令级 = 真强制点，driver 流与直调均不可绕过） |
| UT-S09-92 | F4 R7：批准记录含 UI provenance → 永久 fail closed | merge.ts / 强制语义键 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true`+`hashes`、`ui_impact:true` | merge 时 `hashes` 缺失/损坏/失配 | 一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）；判据键=持久化 `PLAN_APPROVED` 内容，非消费时会话 capability |
| UT-S09-93 | 模式选择读会话 capability，强制语义不读 | 模式/强制分离（F4 R7） | plan-exit 前读 `.session-capabilities.json` 选模式；plan-exit 后 merge/落盘/复核 | 分别在两阶段 | plan-exit 前：capability 就绪→渲染确认模式、缺失→降级模式；plan-exit 后：一律以 `PLAN_APPROVED` provenance 为准，**不读** session capability |
| UT-S09-94 | 对照组：GUI+ui_impact 空 marker（无曾渲染证据）经 `openlogos check-ui-hash-match` 判 advisory exit0 | F3/F6 legacy-advisory 分支 | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 空 marker、无任何「曾渲染确认」证据 | 经 `verify-ui-provenance` 节点运行 `check-ui-hash-match` 后 merge | 记 advisory 后 **`exit 0` → 节点 done → merge 可达**（不要求 `hashes`、不阻断）；**经该节点求值达成、非绕过节点**；与 UT-S09-88a（部分 provenance→fail closed）对照，共同界定 F6 legacy-advisory 与 fail-closed 边界 |
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
| UT-S09-110 | 三层指令资产齐备 | L1/L2/L3 交付物 | 已 sync 的 GUI 项目 | 检查交付物 | (L1) `change-writer`/`product-designer`/`merge-executor` SKILL + checker 说明；(L2) `sync` 重生成的 `AGENTS.md`/`CLAUDE.md` 承载 UI-first 工作流；(L3) **读取真实文件 `spec/flow/overlays/gui-ui-first.yaml`**、经现有 overlay parser/schema 校验为合法 overlay 片段且含两个 `op:add`（`write-ui-prototype`）——而非检索 Markdown 示例文本；三层缺一即指令链断 |
| UT-S09-110a | GUI overlay 唯一源真实存在、含一个合法 `op:add`，且 `done_when` 命令实际可求值 | `spec/flow/overlays/gui-ui-first.yaml`（唯一源）+ 真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match` | 已 sync 的 GUI 项目；准备①合法 `generated` 提案（逐页原型齐全 + 合法 `design-system.json`/令牌 + hash 已记录）与②合法 `fallback` 提案（逐页原型齐全 + `design_system_fallback_reason`、无令牌） | 读取真实文件经 overlay parser/schema 校验；再**实际执行**两个 `done_when` 后端子命令 | 文件存在、解析为合法 overlay 片段；恰含两个 `op:add`——① `write-ui-prototype`（`after: write-tasks`、`when: ui_impact`、`produces: 2-page-design/`、`done_when: cmd:<check-ui-prototype>`）；② `verify-ui-provenance`（`before: generate-merge-prompt`、`when: ui_impact`、`done_when: cmd:<check-ui-hash-match>`）；两节点均合法（overlay-add 允许 `cmd:`）。**不止校验 schema 接受 `cmd:`**：`done_when` 后端为真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match`，对上述合法 generated 与 fallback 提案实际求值 → 两命令均 `exit 0` |
| UT-S09-110a-neg | `done_when` 命令不存在或仍含字面占位符 → 必须失败（负向） | overlay `done_when` 后端可执行性 | 已 sync 的 GUI 项目 | ①将 `done_when: cmd:` 后端指向**不存在的子命令**求值；②或 overlay 仍保留字面 `<check-ui-prototype>`/`<...>` 占位符未被真实子命令名替换；运行/求值 `done_when` | **必须失败**（非零退出/校验失败）：命令不存在无法求值即节点不可 done；overlay 仍含字面 `<...>` 占位=未落地为真实可执行命令，判非法（保证 `cmd:` 后端确为真实子命令而非示意文本） |
| UT-S09-110b | init/sync 对 GUI 项目注入 overlay 到项目实例 `launched.yaml` | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，该模块值 ∈ GUI={`web`,`desktop`,`mobile`}（即项目含 ≥1 GUI 模块） | 运行 init/sync | `spec/flow/overlays/gui-ui-first.yaml` 两个 `op:add` 被并入项目实例 `logos/flow/launched.yaml` 顶层 `overlay:`（该实例 `extends` 等于 `builtin:launched@${BUILTIN_VERSIONS.launched}`——由 loader 映射派生，断言不得固化具体版本号）；注入后 plan subflow 含 `write-ui-prototype`、merge subflow 前含 `verify-ui-provenance`（product_type 唯一源 = `logos-project.yaml modules[].product_type`，非凭空给定） |
| UT-S09-110c | 非 GUI 项目不注入 GUI overlay | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，全部模块值 ∈ 非 GUI={`cli`,`api`,`library`,`skills`}（项目无任何 GUI 模块） | 运行 init/sync | **不注入** gui-ui-first overlay；项目实例 `launched.yaml` 不含 `write-ui-prototype`；特性零启用、流程零改动 |
| UT-S09-110d | `product_type` 字段缺失 → 按非 GUI、overlay 不注入 | project-init/sync overlay 注入（缺字段默认） | 真实 `logos-project.yaml` 的 `modules[]` 条目**完全缺 `product_type` 字段** | 运行 init/sync | 缺失=非 GUI（安全默认）；**overlay 不注入**；项目实例 `launched.yaml` 不含 `write-ui-prototype`；对应 GUI 模块存在时该缺字段模块节点 skip（`ui_impact` 不因缺字段模块置真） |
| UT-S09-110e | 多模块（一 GUI 一非 GUI）：节点参与由活跃提案 module 的 `product_type` 决定 | module-aware `ui_impact` 派生 | 真实 `logos-project.yaml` 含两模块——`moduleA.product_type=web`（GUI）、`moduleB.product_type=cli`（非 GUI） | 活跃提案分别归属两模块时派生 `ui_impact` | 活跃提案属**非 GUI 模块 B** → `ui_impact==false`、`write-ui-prototype` 节点 skip；活跃提案属 **GUI 模块 A** → `ui_impact==true`、两节点参与（overlay 项目级注入因项目含 ≥1 GUI 模块成立，但**节点参与由 module-aware `ui_impact`＝活跃提案所属 module 的 product_type 决定**，非项目级一刀切） |
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
| UT-S09-120 | 拒绝确认 / 设为 `cli` → 保持非 GUI、不注入 | set-product-type + sync（F1 安全默认） | 存量缺字段项目 | 用户不回填（保持缺字段）或 `set-product-type core cli` 后 `sync` | 保持非 GUI；`sync` **不注入** `gui-ui-first`；`launched.yaml` 不含 `write-ui-prototype`；`ui_impact` 恒假 |
| UT-S09-121 | 多模块（一 web 一 cli）回填后仅 web 提案 `ui_impact` 真 | module-aware `ui_impact` + 回填（F1） | 回填 `moduleA=web`、`moduleB=cli`；项目含 ≥1 GUI 模块故 overlay 已注入 | 活跃提案分属两模块时派生 `ui_impact` | 提案属 **web 模块 A** → `ui_impact==true`、可推进 UI-first；提案属 **cli 模块 B** → `ui_impact==false`、两节点 skip（overlay 项目级注入但节点参与由活跃提案 module 的 `product_type` 决定） |
| UT-S09-122 | 反向移除：唯一 GUI 模块改 `cli` → `sync` 移除 overlay ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块 `core=web`（overlay 已注入）、`launched.yaml` 另含**用户自定义 overlay op** `custom-user-node` | `set-product-type core cli` 后 `openlogos sync`；再运行一次 | 按 node id 移除 `write-ui-prototype`；**用户自定义 `custom-user-node` 保持不变**（不被 sync 删除）；重复 sync 幂等（已移除即 no-op） |
| UT-S09-122a | 反向移除：删最后一个 GUI 模块 → `sync` 移除 overlay ops 且保留用户 ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块（overlay 已注入）、`launched.yaml` 另含用户自定义 overlay op | 删除该 GUI 模块后 `openlogos sync` | 项目不再含任何 GUI 模块 → 按 node id 移除 `gui-ui-first` 两节点；**同一 `launched.yaml` 内用户自定义 overlay op 保持不变** |
| UT-S09-123 | `--auto` 缺字段模块不被自动判 GUI、输出诊断、不注入 | `--auto` 安全默认（F1） | 已 `launched`、`modules[]` 缺 `product_type` 的 GUI 意图项目、无人值守 | `openlogos next --auto`（含 sync/推进链） | **绝不**自动判为 GUI；保持安全默认（非 GUI、不注入 overlay）；照常暴露 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为 next action；仅显式 `set-product-type` 后才注入 |
| UT-S09-124 | `service` 为合法枚举且判非 GUI | `PRODUCT_TYPE_ENUM` 尾部扩展 `service`（add-product-type-service） | 已 launched 项目 | `openlogos module set-product-type core service`；重复设同值；`openlogos sync`；读 `status --format json` | 写入成功且幂等（`modules[core].product_type=="service"`，重设同值 no-op）；`isValidProductType('service')===true` 且 `isGuiProductType('service')===false`、`ui_impact` 恒假；`sync` **不注入** `gui-ui-first` overlay；缺字段诊断 `next_action.enum` 为固定顺序 8 值、尾部为 `"service"`（既有 7 值前缀逐字不变） |

### 9.9b overlay extends 版本单一权威与存量有条件迁移（fix-sync-yaml-and-overlay-version）

> 覆盖 overlay 写入端从字面量版本号改为读取 loader 版本映射，以及存量落后 overlay 的有条件迁移。
>
> **断言纪律**：期望值一律引用 `BUILTIN_VERSIONS[lifecycle]`，**禁止在 fixture 或期望值中固化任何具体版本号**——既有 `cli/test/s09-ui-sync.test.ts` 的三处 `builtin:launched@v1` fixture 正是把错误形态固化成了断言，使写入端与 loader 映射失同步长期不可见。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-275 | 注入器写出的 `extends` 取自 loader 映射 | overlay 注入 Step 3→4a | GUI 项目，`logos/flow/launched.yaml` 不存在或缺 `extends` | 运行注入 | 写出的 `extends` 严格等于 `builtin:launched@${BUILTIN_VERSIONS.launched}`；产物中不存在任何字面量版本号（对产物做「不含硬编码版本」的负向检查） |
| UT-S09-276 | 写出的 overlay 自解析无版本告警 | overlay 注入 Step 7 自检 | 同上，注入已完成 | 对写出文件执行 `applyOverlay()` | `warnings[]` **不含** `FLOW_VERSION_MISMATCH`；该自检即「写者产出不得立即触发本进程告警」这一不变量的机器判据 |
| UT-S09-277 | 存量落后且引用全部可解析 → 自动提升并保留用户 ops | overlay 迁移 Step 4b-1 | 既有 `launched.yaml` 的 `extends` 版本落后于映射值，其引用的全部 node id 在新版本内置模板中均可解析，且文件含用户自定义 op `custom-user-node` | 运行 `openlogos sync`；再运行一次 | 首次把 `extends` 提升为映射值并输出已迁移提示；`custom-user-node` 与其它 overlay 操作**逐字节保留**、顺序不变；仅 `extends` 一个字段变化；第二次为 no-op（幂等） |
| UT-S09-278 | 存量落后但存在失效 node id → 保持原值并继续告警（负向） | overlay 迁移 Step 4b-2 | 既有 `launched.yaml` 版本落后，且其 overlay 引用了一个在新版本内置模板中**已不存在**的 node id | 运行 `openlogos sync`，随后解析该 overlay | `extends` **保持原值不变**；`warnings[]` 仍含 `FLOW_VERSION_MISMATCH`；命令不因此中断。此为迁移判据的关键负向：不得为消音告警而无条件 bump |

#### 9.9b 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-108 | GUI 项目 sync 后端到端无假告警 | Step 1→8 | 含 ≥1 GUI 模块（`product_type` ∈ web/desktop/mobile）的 launched 项目 | `openlogos sync` → `openlogos flow show --resolved --lifecycle launched` | sync 报告 overlay 已注入；紧接着的 `flow show` 输出 **不含** `FLOW_VERSION_MISMATCH`。此为上游 Bug 报告「前后两条命令」复现路径的等价用例，两条命令必须使用同一 CLI 版本 |

#### 9.9b 追溯与覆盖

- AC-YAMLW-06 写入端单一权威：UT-S09-275、UT-S09-276、ST-S09-108。
- AC-YAMLW-07 存量有条件迁移：UT-S09-277（正向）、UT-S09-278（负向）。
- 场景：S09 GUI overlay extends 版本取值与存量有条件迁移；功能规格：§2.47.4～§2.47.5；架构：§三十八.2、§三十八.4；方法论规格：`spec/flow-spec.md` §10.1；安装态：SMOKE-core-169。

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
| ST-S09-36 | **跨会话验收**：删 capability 文件+重启+改原型+直调 merge 必须拒绝 | F4 R7 跨会话 fail-closed | ①渲染批准写带 `hashes` 的 `PLAN_APPROVED`；②删 `logos/.session-capabilities.json`；③重启进程；④改动原型 | 直接 `openlogos merge <slug>` | **必须拒绝**：不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`；当前会话 capability 缺失不得降级（「曾渲染确认」证据固化于批准记录）；**同时覆盖 `commitVerifiedPrototypes()` 落盘入口**——事务门亦 fail closed、resources 零残留 |
| ST-S09-37 | 对照组：旧空 marker 纯 CLI 项目 advisory 放行 | F3 向后兼容对照 | 纯 CLI 项目、`PLAN_APPROVED` 空 marker、无「曾渲染确认」证据 | 直接 `openlogos merge <slug>` | advisory 放行（不要求 hashes、不阻断），与 ST-S09-36 严格分支形成对照 |
| ST-S09-38 | 崩溃注入：事务落盘崩溃后恢复到全有或全无 | 崩溃恢复（F1 R3） | 多原型落盘、提交中途注入崩溃 | 崩溃→下次 `openlogos merge`/启动检测残留 journal→前滚或回滚 | 恢复到一致的全有或全无态；无部分落盘/未获批残留；恢复后清 journal；随后 apply-merge 后复核 hash 一致 |
| ST-S09-39 | 跨仓端到端发布状态两态可区分 | 双阶段发布（F2 R7，契约侧） | 契约已发布 | 缺 `ui-ux-first-panel` 时判态；`ui-ux-first-panel` 部署且跨仓 smoke 全绿时判态 | 前者=contract-ready（如实声明功能未启用/降级）；后者=feature-enabled；两态可由验收结果区分（跨仓端到端 smoke 由 `ui-ux-first-panel` 承载，边界见 smoke 用例） |
| ST-S09-40 | 非 GUI 项目特性不启用、流程零改动 | 非 GUI 回归 | 纯 CLI/API/Skills 项目 | 走完整 S09 变更流程 | `ui_impact` 恒假、`write-ui-prototype` skip、plan allowlist 不收窄、merge 无 hash gate；流程与现状逐字节一致（无回归） |
| ST-S09-41 | **存量 GUI 项目迁移端到端**：缺字段→诊断→回填→sync 注入→UI-first 可达 | S09 F1 存量迁移贯通 | 旧 `launched` GUI fixture：`logos-project.yaml` 的 `modules[]`（含 `core`）**缺 `product_type`**；overlay 未注入（原不可达） | ①`openlogos sync`（或升级路径）→ 收到 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断（列 `core`、指向 set-product-type）；②`openlogos module set-product-type core web`（幂等回填）；③`openlogos sync`（幂等注入 overlay）；④针对 `core` 模块的提案声明 `ui_impact:true` 并派生 | ①诊断如实列缺字段 module、安全默认非 GUI 维持、overlay 仍未注入；②回填成功、`modules[].product_type=web`；③`gui-ui-first` 两 op:add 注入项目实例 `launched.yaml`、重复 sync 不重复注入（幂等）；④**仅 `core`（web）模块的提案 `ui_impact` 可真、可推进到 UI-first**（`write-ui-prototype` 参与）；同一 fixture 若另有 cli 模块，其提案 `ui_impact` 仍假 |
| ST-S09-42 | 存量迁移反向：GUI→非 GUI / 删最后 GUI 模块 → sync 移除 overlay、保留用户 ops | S09 F1 反向移除贯通 | 已回填 GUI 且 overlay 已注入的 `launched.yaml`，另**含用户自定义 overlay op** `custom-user-node` | ①`set-product-type core cli`（或删最后一个 GUI 模块）→ `openlogos sync`；②再 `sync` | 项目不再含 GUI 模块 → `sync` 按 node id 移除 `write-ui-prototype`；**同一 `launched.yaml` 内用户自定义 `custom-user-node` 保持不变、绝不被删除**；重复 sync 幂等（no-op）；随后 GUI 相关节点全 skip、流程回落至非 GUI 零改动 |
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

## 五、openlogos change 模块归属 fail-closed 用例（issue #17）

### 5.1 单元测试用例（resolveModule / 文案）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-140 | 显式 --module 存在 → 归属该模块 | resolveModule | 多模块，含 module-b | `--module module-b` | 返回 `module-b` |
| UT-S09-141 | 显式非法 --module → 非零退出 + **合法 id 清单（在场且按 modules[] 顺序）** | resolveModule | 多模块 `[module-a, module-b]` | `--module nope` | exit 1；stderr **逐字含 `module-a`、`module-b`** 且 `module-a` 先于 `module-b`（code-r1 F1：不得以「运行 module list」提示命令冒充清单） |
| UT-S09-142 | 单模块（**非 core**）未传 --module → 自动归属该唯一模块 | resolveModule | 恰 1 个模块 `payments`（无 core） | 无 --module | 返回 `payments`（**非硬编码 core**），文案「自动挂靠，当前只有一个模块」 |
| UT-S09-143 | 多模块含 core 未传 --module → 默认 core | resolveModule | 模块 `[a, core, b]` | 无 --module | 返回 `core`；文案「归属模块：core（默认挂靠 core…）」与实选一致 |
| UT-S09-144 | 多模块无 core 未传 --module → fail-closed + 逐候选可执行命令 | resolveModule | 模块 `[module-a, module-b]`，无 core，slug=`s1` | 无 --module | **非零退出**；**不返回 modules[0]**；stderr 含原因 + **每个合法 id 一条完整命令**（`openlogos change s1 --module module-a` 与 `openlogos change s1 --module module-b` 均逐字在场、按 modules[] 顺序）；**输出不含字面 `<id>`** |
| UT-S09-145 | 文案一致性：无「实选 modules[0] 却称默认 core」 | i18n / resolveModule | 多模块无 core | 无 --module | 输出**不**出现「归属模块：module-a（默认挂靠 core…）」式不一致 |
| UT-S09-146 | 英文 locale 无 core 错误文案在场且可诊断 | i18n（`en`） | `locale: en`，模块 `[module-a, module-b]` 无 core，slug=`s1` | 无 --module | 非零退出；英文错误含原因、全部候选，且 `openlogos change s1 --module module-a` 与 `openlogos change s1 --module module-b` 两条完整命令逐字在场；**不显示裸 i18n key 名**、不含字面 `<id>` |

### 5.2 场景测试用例（真实 CLI 端到端 + 原子性）

> code-r1 F3：本节全部用例经**真实 CLI 入口** `spawnSync(process.execPath, [dist/index.js, ...argv])` 执行，断言 OS 退出码 + stdout/stderr + 磁盘零残留（函数直调仅作 UT）。code-r1 F4：候选命令按 `modules[]` 顺序做**精确序列**断言（提取 stderr 中 `openlogos change` 开头行 `toEqual` 完整期望数组）。

| ID | 描述 | 覆盖 | 前置条件 | 操作序列 | 预期结果 |
|----|------|------|---------|---------|---------|
| ST-S09-50 | 多模块无 core 未传 --module → 拒绝 + 逐候选可执行命令 + 零残留 | EX-9.6 | 多模块项目无 core（`[module-a, module-b]`），无活跃 guard | `openlogos change test-change` | 非零退出；stderr 为**每个合法 id 各一条**完整命令 `openlogos change test-change --module module-a` / `--module module-b`（按 modules[] 顺序、逐字可执行、**无字面 `<id>`**）；**未创建** `logos/changes/test-change/`、**未写** `.openlogos-guard`、无残留 |
| ST-S09-51 | 补 --module 后成功归属 | 决策表#1 | 同上 | `openlogos change test-change --module module-b` | exit 0；guard.module 与 proposal `> module:` 均为 `module-b` |
| ST-S09-52 | 多模块含 core 默认挂靠零回归 | 决策表#4 | 多模块含 core | `openlogos change c1` | exit 0；guard/proposal 均为 `core`；文案与实选一致 |
| ST-S09-53 | 单模块（**非 core**）自动挂靠归属该唯一模块 | 决策表#3 | 单模块 `payments`（无 core） | `openlogos change c2` | exit 0；输出模块、`guard.module`、proposal `> module:` **全部等于 `payments`**（证伪「单模块仍硬编码返回 core」）；单 core 主路径由既有 ST-S09-01 作对照 |
| ST-S09-54 | 英文 locale 多模块无 core 端到端 fail-closed | 决策表#5（`en`） | `locale: en`，多模块无 core（`[module-a, module-b]`） | `openlogos change s1` | 非零退出；英文 stderr 含原因 + 每个合法 id 一条完整命令（`openlogos change s1 --module module-a` / `--module module-b` 逐字在场、按 modules[] 顺序）；无残留目录/guard；不显示裸 key、无字面 `<id>` |
| ST-S09-55 | **裸 `--module`（缺值）→ 非零退出 + 用法、零残留（code-r1 F2）** | 决策表#2 前提校验 | 多模块 `[core, module-b]` | `openlogos change probe --module`（末尾缺值） | 非零退出；stderr 含 `--module requires a module id` + `Usage`；**不得**折叠成未传参数而创建 `core` 提案；未创建 `logos/changes/probe/`、未写 guard |
| ST-S09-56 | **显式非法 --module → 非零退出 + 合法 id 清单（顺序）+ 零残留（code-r1 F1，真实 CLI）** | 决策表#2 | 多模块 `[module-a, module-b]` | `openlogos change probe --module nope` | 非零退出；stderr 含 `模块 'nope'` + 逐字 `module-a`、`module-b`（`module-a` 先于 `module-b`）；未创建 change 目录、未写 guard |

## S09 ZCode SessionStart 与 PreToolUse guard 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S09-188 | 兼容字段归一化 | 仅 camelCase 或仅 snake_case 事件 | 得到同一规范事件与决策输入 |
| UT-S09-189 | 别名冲突 | 两套同义字段值不一致 | fail-closed deny，不任选其一 |
| UT-S09-190 | SessionStart 上下文 | launched 项目有/无 guard | 输出当前 slug、阶段、范围、禁止动作与下一确认点 |
| UT-S09-191 | delta-writing allowlist | 当前提案在 delta-writing | 仅本提案 `deltas/**` 与对应 `tasks.md` 写入可放行 |
| UT-S09-192 | ready-to-merge 收紧 | `[delta]` 已全勾 | 后续 delta 写入 deny，并提示 merge 人类确认点 |
| UT-S09-193 | 缺 guard 阻断 | launched 项目无 guard，请求写源码 | deny 且 reason 明确要求创建提案 |
| UT-S09-194 | 路径/符号链接逃逸 | 表面合法路径解析到 allowlist 外 | deny；目标文件不变 |
| UT-S09-195 | 损坏 JSON | 空输入、非法 JSON、字段类型错误 | stdout 仍为合法 deny 响应并采用 exit 2；详情进 stderr |
| UT-S09-196 | ZCode 输出映射 | 共享决策分别为 allow/deny | 映射为 `permissionDecision`；deny 带 reason 与阻断退出语义 |
| UT-S09-197 | stdout/stderr 纪律 | 开启诊断日志后执行 Hook | stdout 仅一条协议 JSON，日志只写 stderr |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S09-73 | 新会话上下文注入 | 真实/仿真 ZCode 启动新 session，触发 SessionStart | ZCode 获得与磁盘 `proposal_step` 一致的 additionalContext |
| ST-S09-74 | 允许 delta、拒绝源码 | delta-writing 下依次写本提案 delta 和 `src/**` | 前者执行，后者在 PreToolUse 被 exit 2 阻断且源码哈希不变 |
| ST-S09-75 | 阶段变化不使用旧缓存 | 同一 session 内把 tasks 推进到 ready-to-merge 后再次请求 delta 写入 | 决策立即收紧并 deny；新 session 显示最新上下文 |
| ST-S09-76 | Hook 配置/运行时故障 | 缺 runtime、非法 hooks JSON 或决策服务抛错 | 安装预检或运行时 fail-closed；任何写工具均不执行 |

### 自动化与证据要求

- fixture 同时覆盖 `sessionId/session_id`、`hookEventName/hook_event_name`、`toolName/tool_name`、`toolInput/tool_input`。
- deny 用例必须同时断言协议体、reason、exit code 2 和目标文件无变化；不能只断言标准错误。
- 实现测试时必须内嵌 OpenLogos reporter，将本节全部 ID 写入 `logos/resources/verify/test-results.jsonl`，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S09"`，失败含 `error`。
- ST-S09-76 不允许把一般非零退出当成安全阻断成功；必须观察 ZCode 不执行工具。

## S09 Qoder SessionStart 与 PreToolUse hard guard 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S09-198 | 官方公共字段解析 | 合法 `session_id/cwd/hook_event_name` | 归一化为宿主无关事件，原始字段不进入领域服务 |
| UT-S09-199 | PreToolUse 字段解析 | 合法 `tool_name/tool_input/tool_use_id` | 工具、输入和关联 id 正确映射 |
| UT-S09-200 | 输入 fail-closed | 空/超长/非法 JSON、尾随对象、缺字段、类型错误 | 合法 deny 响应、非空 reason、exit 2，详情进 stderr |
| UT-S09-201 | SessionStart 上下文 | launched 项目有/无 guard | hookEventName 正确，additionalContext 含 slug/阶段/范围/确认点 |
| UT-S09-202 | delta-writing allowlist | 当前提案为 delta-writing | 仅本提案 deltas 与 tasks 写入 allow |
| UT-S09-203 | ready-to-merge 重读 | 同 session 内 tasks 全勾 | 下一次 PreToolUse 立即 deny 后续 delta，提示 merge 确认点 |
| UT-S09-204 | 路径安全 | 源码、提案外、`..`、绝对路径、symlink 逃逸 | 全部 deny，规范化目标不执行 |
| UT-S09-205 | 未知/间接写工具 | 未知工具、Bash 重定向/移动/删除、可疑 MCP | 无法证明只读时 deny，不按 matcher 漏放 |
| UT-S09-206 | Qoder 输出与退出语义 | 共享 allow/deny/异常 | allow=exit0；deny/异常=permissionDecision deny + reason + exit2；exit1 不计通过 |
| UT-S09-207 | stdout/stderr 纪律 | 开启诊断并触发各分支 | stdout 只有一条协议 JSON，日志只在 stderr |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S09-77 | Qoder 新会话上下文 | 真实/仿真 CLI 装载 plugin 后触发 SessionStart | additionalContext 与磁盘 lifecycle/proposal_step 一致；协议字段符合 Qoder |
| ST-S09-78 | 允许 delta、拒绝源码 | delta-writing 下依次请求允许目标与源码写入 | 前者执行；后者 permissionDecision=deny、exit2，源码哈希不变 |
| ST-S09-79 | 同会话状态即时收紧 | 启动后把阶段推进到 ready-to-merge，再请求 delta 写入 | 不使用 SessionStart 缓存，立即 deny；新 session 展示最新上下文 |
| ST-S09-80 | runtime/协议故障闭环 | 缺 runtime、非法 hooks、服务抛错或 stdout 污染 | 安装预检或运行时 fail-closed；任何潜在写工具不执行 |

### 自动化与证据要求

- 合同 fixture 使用 Qoder 官方 snake_case；不得把 ZCode/Claude camelCase 兼容当作 Qoder 权威输入。
- 所有 deny 用例同时断言响应体、permissionDecisionReason、exit code 2 和候选目标 SHA-256；一般非零不能计为 hard deny PASS。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，字段含 `status`、`timestamp`、`duration_ms`、`scenario: "S09"`，失败含 `error`。
- ST-S09-77～80 的合同层可自动化模拟宿主；真实 Qoder CLI 证据由 SMOKE-core-111～113 复验，二者不可互相替代。

## WorkBuddy SessionStart 与 PreToolUse 测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-208 | SessionStart 合法输出 | `hookEventName=SessionStart`、`additionalContext` 非空、stdout 单一 JSON、exit 0 |
| UT-S09-209 | SessionStart 磁盘事实 | 包含 module、slug、proposal_step、精确范围与确认点，不读取原生记忆 |
| UT-S09-210 | CLI 工具名归一化 | `Write`/`Edit`/`Bash` 映射到共享动作 |
| UT-S09-211 | 桌面工具名归一化 | `write_to_file`/`replace_in_file`/`execute_command` 映射正确 |
| UT-S09-212 | 字段归一化 | snake_case/camelCase 输入在无冲突时得到同一规范事件 |
| UT-S09-213 | allow 合同 | allow 决策输出 `permissionDecision=allow` 且 exit 0 |
| UT-S09-214 | deny 合同 | deny 输出非空 reason、`permissionDecision=deny` 且 exit 2 |
| UT-S09-215 | proposal_step allowlist | delta-writing 只允许当前提案 delta/tasks，ready-to-merge 立即收紧 |
| UT-S09-216 | 每次调用重读 | 同一 session 修改磁盘状态后下一次决策采用新事实，不使用缓存 |
| UT-S09-217 | 路径与未知工具 fail-closed | traversal、symlink 逃逸和未知潜在写工具均 deny |
| UT-S09-218 | 损坏输入与异常封装 | 空/超限/非法 JSON、缺字段、状态或决策异常均协议 deny + exit 2；exit 1 不算通过 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-81 | 新 WorkBuddy session 上下文 | 从真实项目磁盘派生阶段信息，原生记忆夹具不被读取或修改 |
| ST-S09-82 | 允许当前 delta 写入 | 合法路径 allow 后工具执行，reporter 记录证据 |
| ST-S09-83 | 阻断源码/越界/路径逃逸 | 工具不执行、目标哈希不变、deny reason 可操作、exit 2 |
| ST-S09-84 | 同会话阶段跃迁与异常 | delta-writing→ready-to-merge 立即收紧；解析/状态异常 fail-closed |

### 自动化与证据要求

- 使用真实 runtime 子进程，通过 stdin/stdout/stderr 与真实退出码断言；不得直接调用内部函数替代 ST。
- 对 allow/deny 前后目标哈希、guard/tasks 快照和原生记忆不透明证据留档。
- 每个用例通过 OpenLogos reporter 写入 `test_id`、`scenario_id="S09"`、`status`、`duration_ms`、`evidence`；只有 deny 协议与 exit 2 同时成立才可 pass。

## TRAE hard guard 不成立的负向契约测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S09-219 | 无 TRAE guard normalizer | 枚举宿主 Hook normalizer/协议映射 | 不含 `trae`、TRAE 工具名或字段映射；既有宿主映射不变 |
| UT-S09-220 | 软控制不得注册 hard guard | 仅发现 Rules、Skills、Agent、MCP、Hooks UI 或配置文件 | capability 判定不能成为 deployable/PASS，不能调用共享 `GuardDecisionService` 冒充真实宿主拦截 |
| UT-S09-221 | 用户信任状态非授权输入 | 工作区 `enabled_folders` 缺失、存在或冲突 | Adapter 不读取/静默修改该状态，不从中派生 OpenLogos allow/deny |
| UT-S09-222 | TRAE 用户资产零触达 | 预置 Hooks、Rules、Skills、Agents、MCP、settings、账号占位和不透明记忆 | 不进入 OpenLogos 状态输入、资产计划、备份、回滚或清理集合 |
| UT-S09-223 | 既有 fail-closed 回归 | 执行已支持宿主的 allow/deny/异常合同 | 每次重读磁盘；deny reason 非空、协议/退出码正确、目标哈希不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-85 | 不把 TRAE wrapper 直调当作 hard guard | 即使测试脚本可直接返回 deny，也不得产生 deployable 注册、TRAE capability PASS 或真实宿主通过记录 |
| ST-S09-86 | TRAE 项目资产保持外部所有 | 变更生命周期跨 writing/delta-writing/ready-to-merge，预置 `.trae/**` 与不透明记忆的清单和 SHA-256 始终不变 |
| ST-S09-87 | 现有宿主 hard guard 回归 | 对当前已支持宿主执行允许写与源码/越界/异常拒绝；目标执行结果、reason、退出码和哈希满足原合同 |

### 真实 capability 证据边界

- 国际版 `3.5.91` 与 CN `3.3.93` 的基础 deny 已由真实客户端证明失败：内置写工具执行、Hook stdin 证据缺失、拒绝理由缺失、目标 SHA-256 改变。
- 上述真实失败是提案决策证据，不得在自动化 UT/ST 中伪造 PASS；未来只有独立提案完成双客户端完整矩阵后才能新增 TRAE 正向 guard 用例。
- Rules、prompt、MCP 拒绝、人工确认、Hooks UI、配置存在或 wrapper 直调都不能满足“工具不执行 + 非空理由 + 目标哈希不变”。

### 自动化与 reporter

- UT/ST 必须枚举真实 Registry、normalizer 注册表、生命周期状态输入和 ManagedAsset 计划，并对外部 TRAE fixture 留存前后哈希。
- 每个用例通过 OpenLogos reporter 写入 `test_id`、`scenario_id="S09"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。

## S09 merge 准入判定与 change-lint 同源测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-283 | merge 准入与 change-lint 结论逐字同源 | Step 3→5 | 两组夹具：① change-lint PASS 的合规提案；② 含任一违规的提案 | 对同一提案目录分别取 `runChangeLint` 的 violations 与 merge 的准入结论 | ① lint 无违规 → merge 放行；② lint 有违规 → merge 拒绝。二者结论在两组夹具上均一致；**不存在 lint 红而 merge 绿的组合** |
| UT-S09-284 | 无 baseline_closure 信号的提案同样经预检 | Step 3 | 提案不含 `baseline_closure` 声明，`[delta]` 任务也不用 `[MODIFY]`/`[CREATE]` 标记，且 `deltas/` 下存在一个缺段标记的 `.md` delta | 发起 merge | 判 `delta_missing_section_marker` 并拒绝；此前该形态的提案整道预检不做、直接放行。诊断中点名该 delta 的具体路径；不写 `SPEC_MERGED`、不生成 `MERGE_PROMPT.md` |
| UT-S09-285 | 拒绝时逐条输出可归因诊断 | Step 5b | 提案含 ≥2 条不同类型的违规 | 捕获 merge 的 stderr | 每条违规单独成行，各含 `code`、文件路径、具体字段与 `fix_hint`；不得只出现「L1-L9 未全过」这类聚合结论；诊断中出现导致失败的实体本身 |
| UT-S09-286 | test-change-set 捕获此前不可见的 ID | test-change-set 写入 | test delta 中含 `UT-JSON-09` 形态的表格首列 ID | 求本次变更 ID 集合 | 该 ID 被捕获。同时断言集合只增不减——原有严格形态 ID 全部仍在 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S09-110 | 真实 CLI 下 merge 与 change-lint 可预测一致 | Step 1→6 | 真实 CLI；launched 夹具项目；一份含任一 change-lint 违规（如 delta 缺段标记）的提案 | ① 跑 `change-lint` 记录退出码与违规集；② 跑 `merge` 记录退出码与输出；③ 修正该违规后重复①② | ①② 两者结论逐条一致——lint 判违规则 merge 必拒、且拒绝理由是同一批 code；③ 修正后两者同时放行。用户可仅凭 `change-lint` 预知 merge 是否会被拒 |

### 追溯与覆盖

- AC-MERGEGATE-01 准入同源与无条件预检：UT-S09-283、UT-S09-284。
- AC-MERGEGATE-02 阻断逐条可归因：UT-S09-285。
- AC-MERGEGATE-05 可预测性：ST-S09-110。
- AC-MERGEGATE-09 捕获集扩大：UT-S09-286。
- 场景：S09 merge 准入判定与 change-lint 同源；功能规格：§2.51.2、§2.51.5；架构：§四十一.6.1；安装态：SMOKE-core-173。

## Cursor sessionStart 与部分强度门禁测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-293 | sessionStart 上下文生成 | 输出含 module、active change、proposal_step、可写范围、下一确认点；仅来源于磁盘事实 |
| UT-S09-294 | sessionStart 静默降级 | CLI 不可用或项目未初始化时输出空对象，不报错、不注入伪状态 |
| UT-S09-295 | beforeShellExecution allow | 提案范围内 shell 写入返回 permission allow；安全白名单（含 `git push`）语义与既有 guard 一致 |
| UT-S09-296 | beforeShellExecution deny | 越界 shell 写入 deny，输出含事实四要素（change/step/范围/目标）+ 恢复动作，非空原因 |
| UT-S09-297 | afterFileEdit 越界报告 | 报告含编辑路径、允许范围与固定「未被阻断（Cursor 文件编辑仅经 afterFileEdit 事后报告，IDE 与 CLI 均无事前阻断）」声明；报告文本不得出现「preToolUse 硬拦」或暗示 IDE 侧可事前阻断的表述（guard-versioned-content-scope C11）；范围内编辑静默 |
| UT-S09-298 | 每次调用重读状态 | proposal_step 变化后下一次 hook 判定立即反映，无缓存 |
| UT-S09-299 | stdin 解析失败 fail-closed | shell 路径 deny；编辑路径产出「无法安全判断」报告 |
| UT-S09-300 | guard 缺失 fail-closed | 提案目录存在但 guard 缺失时 shell deny，提示先运行 openlogos change |
| UT-S09-301 | 决策服务异常 fail-closed | 抛异常时同 stdin 失败路径，退出码不伪装成功 |
| UT-S09-302 | cursor 协议字段转换 | 事件名（sessionStart / beforeShellExecution / afterShellExecution / afterFileEdit）/permission 字段/退出码符合 .cursor/hooks.json 契约；各接线共用同一共享决策服务实例逻辑 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-112 | 新 session 注入 → 越界 shell deny | 端到端：sessionStart 注入后越界 shell 写入被阻断且原因完整 |
| ST-S09-113 | 越界编辑事后检测 | 原生编辑越界后收到检测报告；文件确已修改（未阻断）且报告如实声明 |
| ST-S09-114 | proposal_step 收敛链路 | delta-writing → merge 后各步的允许范围随磁盘状态收敛，三接线判定一致 |
| ST-S09-115 | 异常态全链 fail-closed | guard 损坏/不可读时 shell 全拒、编辑全报告，无静默放行 |

### 自动化与证据要求

- Hook 合同测试以 stdin/stdout JSON 直接驱动接线脚本，保存输入输出与退出码证据。
- 每个用例必须通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。

## guard-check 工作目录收敛与 fail-closed 测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-313 | fail-closed 边界 | CLAUDE_PROJECT_DIR 指向不可进入目录 → exit 2 + 可读 reason；变量缺失且 cwd 为项目子目录 → exit 2 + 诊断（不再静默 exit 0）；变量缺失且 cwd 为项目根 → 按 cwd 判定（0.14.20 兼容不回归）；变量指向的根确无 logos.config.json → exit 0 放行（真非 OpenLogos 项目分支保持） |
| UT-S09-314 | 子目录 cwd 判定一致性 | 子目录 cwd + 变量在场：launched 无提案的 Edit/Write/Bash 阻断（exit 2 + 既有 reason 结构）、有提案范围内放行、`git push` 等 BASH_SAFE_PATTERNS 白名单放行、Edit 绝对 file_path realpath 归一化——逐项与项目根 cwd 结果一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-120 | 子目录 cwd 端到端拦截与放行 | 以 stdin JSON + env 模拟 Claude Code hook 调用（cwd=项目子目录）：无提案 Edit 源码 → exit 2 且 stdout reason 含变更管理指引；创建提案（guard 文件在场）后同一调用 → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。

## guard-check 管辖边界与阻断输出双通道测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-315 | 项目外路径放行（管辖边界） | launched 无提案 + 变量在场：Edit/Write `file_path` 为项目根之外目标（`~/.claude/projects/x/memory/a.md` 形态、另一临时目录绝对路径、`../other-repo/src/x.ts` 相对穿越）→ 一律 exit 0 放行；Bash 命令重定向项目外目标 → 放行；同批断言项目内非白名单源码仍 exit 2（边界收窄不外溢）；python3/node 归一化分支与 bash 兜底分支（PATH 中屏蔽 python3/node）行为一致 |
| UT-S09-316 | 阻断 reason 双通道输出 | launched 无提案 Edit 项目内源码 → exit 2；stdout 为 `{"reason":…}` 合法 JSON 且字面结构与旧版一致；**stderr 非空**且含「变更管理拦截」与 `openlogos change` 指引；Step 0 两处 fail-closed（变量指向不可进入目录 / 变量缺失且 cwd 非项目根）→ exit 2 且 stdout JSON 与 stderr 诊断同时在场；全部放行路径（exit 0）stderr 不新增噪音输出 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-121 | 项目外放行与项目内双通道拦截端到端 | 以 stdin JSON + env + cwd 模拟 Claude Code hook 调用真实 guard-check 脚本：① launched 无提案写项目外目标（用户级 `~/.claude` 形态路径于临时 HOME 下构造）→ exit 0、目标可由后续写入落盘；② 同一项目写项目内源码 → exit 2、stderr 含变更管理指引、stdout JSON 可解析且 reason 与 stderr 文本语义一致；③ 创建提案（guard 文件在场）后重放② → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），同时捕获并断言 stdout 与 stderr 两通道，不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。

## guard-check Bash 写命令路径级管辖判定测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-317 | Bash 写命令全外路径放行（回归锚：误拦必红→放行必绿） | launched 无提案 + 变量在场：`rm -rf <项目外绝对路径>`（session scratchpad 形态）、`cp <项目外→项目外>`、`mv <项目外→项目外>`、`mkdir <项目外>`、`touch <项目外>` → 一律 exit 0 放行；选项 flag（`-rf`、`-p`、`--`）被跳过不当作路径；既有 `>`/`>>` 重定向项目外目标放行不回归；**该组用例在修复前的 guard-check 上必须失败（无条件拦截 exit 2），修复后必须通过**——作为缺陷回归锚 |
| UT-S09-318 | 任一路径在内拦截 + 解析不出保守臂 + 三运行时一致（安全面零放宽） | ① `rm <项目内源码>`、混合形态 `cp <项目外> <项目内非白名单>`、`mv <项目内> <项目外>` → exit 2 且 stderr 含变更管理指引、stdout `{"reason":…}` JSON 结构不变；② 白名单目标（如 `touch logos/changes/x/a.md`）放行；③ 解析不出形态（`rm $VAR`、`rm $(cmd)`、`rm a.txt && rm b.txt`、反引号、管道复合）→ exit 2 维持现行拦截，不放宽；④ `BASH_SAFE_PATTERNS`（含 `git push`）先判放行优先级不变；⑤ 同批断言在 python3 归一化、node 归一化与 bash 兜底（PATH 屏蔽 python3/node）三运行时下结论一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-122 | Bash 写命令项目外放行与项目内拦截端到端 | 以 stdin JSON + env + cwd 模拟 Claude Code hook 调用真实 guard-check 脚本：① launched 无提案对项目外目标（临时 HOME 下 `~/.claude` 形态路径与临时 scratchpad 目录）执行 `rm -rf`/`cp` → exit 0、后续写入可落盘；② 同一项目 `rm <项目内源码>` → exit 2、stderr 含变更管理指引、stdout JSON 可解析且 reason 与 stderr 文本语义一致；③ 解析不出形态（含 `$VAR` 与 `&&` 复合）→ exit 2；④ 创建提案（guard 文件在场）后重放② → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），同时捕获并断言 stdout 与 stderr 两通道，不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- `UT-S09-318` 单例在 verify 沙箱内实测 5.2–5.7s（三运行时矩阵 × 五类形态串行驱动 `spawnSync`），逼近 10s 全局上限，故按仓库既有先例（`ST-S19-22`、`ST-S37-01`～`03`）为其单独设 `{ timeout: 120_000 }`。该放宽只作用于 harness 资源上限，**不放宽任何断言**：五类形态的 exit code、双通道输出与三运行时一致性判据逐条不变。

## S09 archive 链条 fail-closed 校验测试

> 覆盖 `openlogos archive` 的完成链条校验：`VERIFY_PASS` 必备；需部署提案还须 `DEPLOY_DONE`；需 smoke 提案还须 `SMOKE_PASS`。拒绝时零副作用（不移动目录、不删 guard、不建握手），无需部署提案零回归。
>
> 背景：20260907 事故中 `cli/src/commands/archive.ts` 不检查上述任何一个 marker，带 `DEPLOY_DONE` 缺口的提案被成功归档并固化进 audit-only 归档记录。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-319 | 缺 `VERIFY_PASS` 时拒绝归档且零副作用 | EX-9.13 | 活跃提案 `VERIFY_PASS` 缺失（或 `VERIFY_FAIL` 在场） | 执行 `openlogos archive <slug>` | 非零退出；stderr 含稳定错误码 `ARCHIVE_VERIFY_NOT_PASSED` 与补救命令 `openlogos verify`；提案目录**未移动**至 `logos/changes/archive/`、`logos/.openlogos-guard` **未删除**、未建立 Windows 握手请求目录 |
| UT-S09-320 | 需部署提案缺 `DEPLOY_DONE` 时拒绝归档 | EX-9.14 | `VERIFY_PASS` 在场、`deployment_required=true`、`DEPLOY_DONE` 缺失；**且 `SMOKE_PASS` 在场**（20260907 孤儿状态） | 执行 `openlogos archive <slug>` | 非零退出；`ARCHIVE_DEPLOY_NOT_DONE`；message 含 `openlogos deploy-done`；**smoke 结论不得反推部署完成**——`SMOKE_PASS` 在场也照常拒绝；零副作用同 UT-S09-319 |
| UT-S09-321 | 需 smoke 提案缺 `SMOKE_PASS` 时拒绝归档 | EX-9.15 | `VERIFY_PASS` + `DEPLOY_DONE` 在场、`smoke_required=true`、`SMOKE_PASS` 缺失（或 `SMOKE_FAIL` 在场） | 执行 `openlogos archive <slug>` | 非零退出；`ARCHIVE_SMOKE_NOT_PASSED`；message 含 `openlogos smoke`；零副作用同 UT-S09-319 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-123 | 链条逐级补齐后归档放行 | Step 13→15 | 真实 CLI；提案需部署需 smoke，起点为「仅 `VERIFY_PASS` 缺失」 | ① `archive` → ② 置 `VERIFY_PASS` 后 `archive` → ③ `openlogos deploy-done` 后 `archive` → ④ smoke 通过写 `SMOKE_PASS` 后 `archive` | ①`ARCHIVE_VERIFY_NOT_PASSED`；②`ARCHIVE_DEPLOY_NOT_DONE`；③`ARCHIVE_SMOKE_NOT_PASSED`；④归档成功——目录移入 `logos/changes/archive/`、guard 释放、输出与修复前一致；①②③每步均零副作用 |
| ST-S09-124 | 无需部署提案零回归 | Step 13→15 | 提案 `deployment_required=false`（文档-only），`VERIFY_PASS` 在场、无 `DEPLOY_DONE`/`SMOKE_PASS` | 执行 `openlogos archive <slug>` | 归档**成功**——链条只到 ①；`deployment_decision_conflict=true` 的提案照旧不得作为主动作（既有语义不变）；Windows 握手协议在校验通过后才进入，顺序为「链条校验 → 握手 → rename」 |

### 追溯与覆盖

- AC-ARCHIVE-FC-01 `VERIFY_PASS` 必备：UT-S09-319、ST-S09-123 步骤①。
- AC-ARCHIVE-FC-02 需部署提案 `DEPLOY_DONE` 必备（smoke 结论不得反推）：UT-S09-320、ST-S09-123 步骤②。
- AC-ARCHIVE-FC-03 需 smoke 提案 `SMOKE_PASS` 必备：UT-S09-321、ST-S09-123 步骤③。
- AC-ARCHIVE-FC-04 拒绝零副作用（不移动、不删 guard、不建握手）：UT-S09-319～321 与 ST-S09-123。
- AC-ARCHIVE-FC-05 无需部署提案零回归：ST-S09-124。
- 场景：S09「archive 链条 fail-closed 校验」；功能规格：§2.67.2；根规格：`spec/change-management.md` archive 前置链条语义。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- 零副作用断言必须以**磁盘事实**取证（提案目录仍在 `logos/changes/<slug>/`、`logos/.openlogos-guard` 仍在盘、握手协议目录无新增），不得只断言退出码。
- 全部断言在一次性临时项目中构造，不得触碰本仓或用户其它项目的活跃提案与 guard。

## S09 merge 直接合并与 lint-specs 测试

> 覆盖 `openlogos merge` 一次调用完成合并、失败零副作用与整批回滚、`SPEC_MERGED` 结构化字段零回归，以及 `openlogos lint-specs` 独立结构检查且不参与任何门。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-340 | 一次调用完成合并且 SPEC_MERGED 结构化字段零回归 | 构造 3 个 delta 目标（含 ADDED / MODIFIED / REMOVED 三种块）→ 一次 `merge` 调用后：三个 canonical target 均为最终态、章节锚正确定位、标题层级 rebase 正确；`SPEC_MERGED` 在场且含 `type: merge_complete`、`completed_at`、**`test_change_set`（schema 与字段口径与事务时代逐字段一致）**；提案目录**无** `MERGE_TRANSACTION.json` / `MERGE_RECEIPT.json` / `merge-staging/` / `merge-content/` 任一残留 |
| UT-S09-341 | 失败零副作用与整批回滚 | 分别构造：delta 缺段标记、章节锚解析到 0 处、章节锚解析到多处、P≠T≠D、`SPEC_MERGED` 已在场 → 各自非零退出并报对应稳定错误码（`MERGE_DELTA_INVALID` / `MERGE_TARGET_MISMATCH` / `MERGE_ALREADY_COMPLETE`）；每种情形下**全部** canonical target 的字节与 mtime 均不变、`SPEC_MERGED` 不被创建；错误 message 含 `git checkout logos/resources/` 回滚提示 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-140 | 合并 → 回滚重来 → lint-specs 不参与门的端到端 | 真实 CLI：① `openlogos merge <slug>` 一次调用合并多目标成功，`SPEC_MERGED` 在场 → ② 模拟「发现 delta 有误」：`git checkout logos/resources/` 回滚 + 删除 `SPEC_MERGED`，修正 delta 后重跑 `merge` 成功（**无需 reopen / abort 通道**）→ ③ 在测试规格中植入重复 ID，`openlogos lint-specs` 非零退出并点名该 ID 与位置 → ④ **同一状态下 `openlogos merge` 与 `openlogos verify` 均不因 lint-specs 的结论而阻断**（证明它不参与任何门）|

### 追溯与覆盖

- AC-MERGE-DIRECT-01 一次调用完成合并：UT-S09-340、ST-S09-140 步骤①。
- AC-MERGE-DIRECT-02 SPEC_MERGED 结构化字段零回归：UT-S09-340。
- AC-MERGE-DIRECT-03 失败零副作用与整批回滚：UT-S09-341。
- AC-MERGE-DIRECT-04 回滚后重来无需 reopen 通道：ST-S09-140 步骤②。
- AC-LINT-SPECS-01 独立结构检查可用：ST-S09-140 步骤③。
- AC-LINT-SPECS-02 不参与任何门：ST-S09-140 步骤④。
- 场景：`core-S09-change-lifecycle.md`「S09 merge 直接合并时序」；功能规格：§2.69、§2.70；JSON 契约：`spec/cli-json-output.md`。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。

## S09 章节锚序数消歧测试

> 覆盖 delta 章节锚的可选序数后缀：重复标题下按文档序精确定位，无后缀时行为逐字节不变。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-342 | 序数在重复标题下精确定位 | 目标主文档含两处**字节完全相同**的 `## 契约` 标题，各自正文不同 | 分别以 `契约 [1]` 与 `契约 [2]` 为锚求解析 | 各命中对应文档序的那一处；合成结果只改动被点名的那一节，另一节字节不变 |
| UT-S09-343 | 无后缀语义零漂移与越界 fail-closed | 参数化：① 同名候选恰 1 处、无后缀；② 同名候选 2 处、无后缀；③ 同名候选 2 处、后缀 `[3]`；④ 候选 1 处、后缀 `[1]`；⑤ 路径锚 + 后缀 | 逐例求解析 | ① 命中且与本变更前逐字节一致；② `ambiguous` 并点名两处行号（与变更前一致）；③ `not_found` 并说明实际候选数为 2；④ 命中；⑤ 先按路径锚过滤候选再按序数选取 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S09-141 | 真实 CLI 下用序数锚删除重复标题壳 | 真实 CLI；主文档含一处空的 `## X` 壳与其后内容完整的 `## X` | ① 以 `X [1]` 为锚发 REMOVED delta；② 跑 `merge` | 合并成功；第 1 处壳被删除、第 2 处内容完整保留且字节不变；证明此前不可寻址的章节现已可精确操作 |

### 追溯与覆盖

- AC-ANCHOR-01 序数精确定位：UT-S09-342、ST-S09-141。
- AC-ANCHOR-02 无后缀零漂移与越界 fail-closed：UT-S09-343。
- 功能规格：§2.72。

## S09 三处形态订正测试

> 覆盖决策澄清由判定改为文档、UI provenance 由阻断门改为警告、seed 恢复门由硬阻塞改为隔离并继续。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-344 | 决策澄清不再参与任何判定 | 构造四类提案：① 无「## 决策澄清」小节；② 小节存在但 YAML 语法非法；③ `decisions[].id` 不匹配 `C\d+`；④ 完整合法 | 求 `evaluatePlanPackage` 与 `runChangeLint` | 四者均无 `proposal_clarification_invalid` / `clarification_contract_invalid`；`plan_state` 不含 `clarification` 字段；提案模板仍生成该小节 |
| UT-S09-345 | UI provenance 失配降为告警 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true` 与 hashes，原型文件在批准后被改动（hash 漂移） | 发起 `merge` | **零退出**并写 `SPEC_MERGED`；输出含 provenance 告警；`check-ui-hash-match` 单独运行时**仍如实报失配并非零退出**（诊断能力不减） |
| UT-S09-346 | 损坏 seed journal 被隔离而非阻塞 | adopted 项目，`<run>/commit-journal.json` 内容损坏（非法 JSON / schema 非法 / 必填字段缺失 三种参数化） | 依次运行 `status` / `next` / `change-lint` | 三者均**零退出**并给出告警；损坏 journal 被重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且**内容逐字节保留**；原路径不再存在；可恢复路径与读锁竞争语义逐字不变 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S09-142 | 真实 CLI 下无决策澄清小节的提案全链通过 | 真实 CLI；`proposal.md` **完全不含**「## 决策澄清」小节 | ① `change-lint`；② `merge` | ① PASS 且输出无 clarification 相关诊断；② merge 成功写 `SPEC_MERGED` |
| ST-S09-143 | GUI overlay 仅剩原型节点 | 真实 CLI；GUI 项目 `ui_impact:true` 的 launched 提案 | 读 `spec/flow/overlays/gui-ui-first.yaml` 与注入后的项目实例 flow | overlay 恰一个 `op:add`（`write-ui-prototype`）；**不含** `verify-ui-provenance`；`check-ui-prototype` 与 `check-ui-hash-match` 两命令照常可用 |

### 追溯与覆盖

- AC-DEGATE-01 决策澄清不参与判定：UT-S09-344、ST-S09-142。
- AC-DEGATE-02 UI provenance 降警告且诊断不减：UT-S09-345、ST-S09-143。
- AC-DEGATE-03 seed 门隔离并继续：UT-S09-346。
- 功能规格：§2.74。

## S09 delta RENAMED op 测试

> 覆盖第五个 delta op `RENAMED`（`spec/change-management.md`「Delta `RENAMED` op：章节标题更名」、架构 §五十、需求 AC-RENAMED-01～07）。它是唯一能改写标题行、也是唯一能作用于文档级 H1 的 op。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-347 | `RENAMED` 解析与应用（含 H1、含层级/正文/位置不变量） | 构造含多级标题与表格条目的目标文档 | 参数化：① 对 H2 小节更名；② 对**文档级 H1** 更名；③ 以标题路径锚（`父 > 子`）更名；④ 以序数锚（`<标题> [2]`）在重复标题中精确更名；⑤ 同一 delta 内 `RENAMED` 后再以**新标题**为锚 `MODIFIED` 该节正文 | ①～④ 标题文本被替换、**`#` 数量不变**（H1 仍 H1）、章节正文与子章节**逐字节不变**、章节在文档中的偏移不变（非「删后追加到文末」）；⑤ 两块按序生效，最终标题为新名、正文为 MODIFIED 后内容 |
| UT-S09-348 | `RENAMED` 的 fail-closed 反例（拒绝时零改写） | 同上 | 参数化：① 锚命中 0 个；② 锚命中多个（未用序数锚消歧）；③ 块正文为空；④ 块正文多行；⑤ 块正文以 `#` 开头 | 五例**均拒绝**并给出可定位诊断（锚类走 `delta_section_anchor_unresolvable` 既有码）；目标文档**字节不变**；`change-lint` 与 `merge` 两侧结论一致（同判据同结论） |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S09-144 | 含 `RENAMED` 的提案端到端 merge | 真实 CLI，临时项目；提案含一个 `RENAMED` 块（目标文档 H1 更名）与一个常规 `MODIFIED` 块 | ① `openlogos change-lint`；② `openlogos merge <slug>`；③ 读回被更名文档与 `SPEC_MERGED` | ① lint 接纳含 `RENAMED` 的 delta（**不判缺段标记**、不产生守恒违规——`RENAMED` 不增删条目）；② merge 一次调用成功并写 `SPEC_MERGED`；③ 目标文档 H1 为新名且层级仍为 H1，正文与其余各节逐字节不变；另一目标的 `MODIFIED` 照常生效 |

### 追溯与覆盖

- AC-RENAMED-01/02/03 语法、层级不变、正文与位置不变：UT-S09-347 ①②。
- AC-RENAMED-04 锚定语义与既有 op 同源（路径锚 / 序数锚）：UT-S09-347 ③④、UT-S09-348 ①②。
- AC-RENAMED-05 块正文形态非法即拒绝且零改写：UT-S09-348 ③④⑤。
- AC-RENAMED-06 lint 接纳 + merge 正确应用 + 两侧同源：ST-S09-144 ①②。
- AC-RENAMED-07 不产生条目守恒判定：ST-S09-144 ①。
- 规范：`spec/change-management.md`「Delta `RENAMED` op」；架构：§五十；需求：「Delta RENAMED op（文档标题更名）需求」。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- 「正文逐字节不变」必须直接比对**磁盘字节**（含子章节），不得只断言标题行——`RENAMED` 的全部风险恰在于顺手改到正文。

## S09 ADDED 标题保真测试

> 覆盖「规范化形式不得充当产出内容」在合并引擎上的兑现（架构 §五十一、功能规格 §2.80、`spec/change-management.md`「Delta op 的标题保真规则」）。该缺陷已静默发生两次，故守卫必须落在**复验**上——既有复验与产出共用同一条剥离管道，对标题损坏天然盲。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-349 | 含行内代码的 `ADDED` 标题原样落盘 | 构造含多级标题的目标文档 | 参数化：① 顶层 `ADDED`，锚为 ``Delta `RENAMED` op：章节标题更名``；② 锚含多段行内代码（``3.17 `a_field` 与 `b_field` 投影``）；③ 标题路径锚 ``父 > 子 `x` ``（子章节带行内代码）；④ 对照组：锚不含行内代码 | ①～③ 落盘标题**逐字等于**锚原文（反引号与字段名全部保留），层级按既有规则（顶层 level 2 / 路径锚为父级+1）；④ 落盘结果与本变更前**逐字节一致**（零回归）。**修复前 ①～③ 的标题会被吞掉行内代码段**（实证：`Delta  op：…`、`3.17  对账投影字段…`） |
| UT-S09-350 | 复验对「写下的 != 落盘的」必须报错（反向锚） | 同上 | 构造一份「标题被剥离后落盘」的 final 文本（模拟修复前行为），交 `verifyAgentMaterialOutcome` 复验 | **判失败**并点名该 `ADDED` 锚；诊断须区分「章节不存在」与「章节标题不符」。同时断言：复验比较**不经** `stripInlineCode`——用剥离后的两侧比较会恒相等，那正是两次损坏静默通过的机制（架构 §51.2） |

### 边界与零回归

| 情形 | 期望 |
|---|---|
| 锚不含行内代码 | `rawAnchor === anchor`，产出与定位结果逐字节不变 |
| 锚含行内代码，用于**定位**（`MODIFIED` / `REMOVED` / `RENAMED` 的锚） | 匹配语义不变——`` `X` `` 与 `X` 继续等价命中 |
| 序数锚 `<标题> [n]` 含行内代码 | 序数解析在剥离侧进行不变；产出标题仍取原文（不含 `[n]` 后缀） |

### 追溯与覆盖

- AC-TITLE-FIDELITY-01 `ADDED` 落盘标题逐字等于锚原文：UT-S09-349 ①②③。
- AC-TITLE-FIDELITY-02 不含行内代码时零回归：UT-S09-349 ④。
- AC-TITLE-FIDELITY-03 复验拦截标题损坏且不共用剥离管道：UT-S09-350。
- 架构：§五十一；功能规格：§2.80；规范：`spec/change-management.md`「Delta op 的标题保真规则」；安装态 smoke：SMOKE-core-207。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- UT-S09-349 的断言必须比对**落盘文本的标题行原始字节**，不得先做任何规范化——检查者与被检查者共用规范化管道时，检查恒真（本缺陷的成因）。

## S09 canonical scaffold 与 plan 三态测试用例

> 所有测试实现必须写 OpenLogos reporter；中英文 fixture 均从真实 `openlogos change` scaffold 起步。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S09-224 | 中文 proposal canonical 章节齐全 | S09 Step 2→3 | locale=zh | `proposalTemplate` | reason/type/scope/deployment/summary/clarification 各恰一次 |
| UT-S09-225 | 英文 proposal 共享语义 ID | S09 Step 2→3 | locale=en | `proposalTemplate` + registry | 英文 canonical 标题映射同一语义集合 |
| UT-S09-226 | launched tasks 生成空 code 锚点 | S09 Step 3 | 中文/英文 launched | `tasksTemplate` | 有 `[delta]` scaffold 与空 `[code]`；无代码 checkbox |
| UT-S09-227 | plan 三态相互独立 | tasks 合同 | 空 code、真实 code slices、纯规格三 fixture | evaluator | plan_filled/code_required/code_slices_filled 精确组合 |
| UT-S09-228 | summary 改名不能被详细设计替代 | EX-6.1 | 删除 summary，保留核心设计 | evaluator | summary missing，expected 为 locale canonical 标题 |
| UT-S09-229 | plan code checkbox 精确拒绝 | EX-3.1 | `[code]` 含模板或真实 checkbox | evaluator | code-entry-before-spec-complete；空标题正例通过 |
| UT-S09-230 | 历史 marker bypass | 历史兼容 | 四类 marker 参数化 | lifecycle derive | 不回退 writing；只允许非阻塞 warning |
| UT-S09-232 | 历史 before 重复/歧义、after 唯一可收敛 | merge-apply test change set | before 同一 ID 有两条定义且另有列数歧义行；after 保留一条、重编号另一条并修正歧义行 | `buildTestChangeSet` | 不抛 before duplicate/ambiguous；保留 ID unchanged，新 ID 与修复行进入 changed；after 重复/歧义反例仍拒绝 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S09-88 | 中英文 change→fill→lint→next 全链 | Step 1→8 | 两个 launched fixture | change、按 scaffold 填充、双检查 | 两者 lint PASS、next ready-to-delta，code section 仍空 |
| ST-S09-89 | 现场双错误一次返回并可修复 | EX-3.1、EX-6.1 | summary 改名 + code 模板行 | lint→按 issues 修复→重跑 | 首轮精确两类 issue；修复后四方一致，无额外人工决定 |
| ST-S09-90 | 历史重复基线可经真实 merge-apply 原子收敛 | merge apply bootstrap | 正式测试 target 的 before 含重复 ID，manifest after 唯一 | 生成 test change set 并执行受控 apply | apply 成功、after ID 唯一、marker changed/removed 集合准确；after 重复负例零写回滚 |

### 追溯与覆盖

- S09-AC-Plan-01 canonical scaffold：UT-S09-224～UT-S09-226、ST-S09-88。
- S09-AC-Plan-02 tasks 三态：UT-S09-227、UT-S09-229。
- S09-AC-Plan-03 现场错误收敛：UT-S09-228、ST-S09-89。
- S09-AC-Plan-04 历史不回退：UT-S09-230。
- S09-AC-Plan-05 merge 自举收敛：UT-S09-232、ST-S09-90。

## S09 merge 内部错误稳定失败语义测试

> 覆盖 `runDirectMerge` 失败出口由「默认放行未登记错误类」改为「默认兜底」：任何逃出 `mergeDirect` 的内部错误（含 `test-change-set` 族与未来新增错误类）均以稳定四要素形态收束，绝不裸抛 Node 未捕获异常堆栈；**且状态声明按已确认阶段分三档（A 未提交 / B 已回滚 / C 已提交或不可确认），绝不无条件断言零残留**（功能规格 §2.84.3～§2.84.4、§2.69.1；场景 S09「merge 内部错误的稳定失败语义」EX-9.23、EX-9.24；来源变更 fix-merge-preflight-parity-and-bare-throw）。夹具用一次性隔离项目构造，真实 CLI 臂以子进程运行并捕获 stdout / stderr / 退出码。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-351 | 默认兜底：任何内部错误类均映射稳定形态 + **状态声明取档 A**（旧实现必红） | 桩化 `mergeDirect` 在**落盘原语调用之前**分别抛出：① `MergeDirectError`；② `TestChangeSetBuildError('test-change-set-ambiguous-table', …)`；③ 合成的**未登记**内部错误类（无 `code` 字段） | 对三形态分别调 `runDirectMerge` 并捕获 stderr 与退出行为 | 三者均产出四要素稳定形态：稳定前缀 `Error: merge 失败（<code>）：<message>`、**档 A** 状态声明「保持合并前字节，未写 SPEC_MERGED」、`git checkout logos/resources/` 回滚点、非零退出；③ 使用稳定兜底码并附原始 message 与错误类名。**修复前 ②③ 一律 `throw e` 逃到进程顶层裸抛——本用例即该通道的回归锁**。档位须由控制流位置派生，断言实现未从 message 文本反推 |
| UT-S09-352 | 诊断不降级：`code` 原样入错误码位，结构化归因不被吞 | 桩化抛出 `TestChangeSetBuildError`，`code='test-change-set-ambiguous-table'`、`targetPaths` 含两个目标、message 含后态行号 | 调 `runDirectMerge`，解析 stderr 文本 | 错误码位恰为 `test-change-set-ambiguous-table`（不得被统一替换为通用码）；原始 message 完整出现；`targetPaths` 逐项出现且按既有 ASCII 序稳定；行号标注为「合并后态行号」口径（消除「照磁盘文件找不到该行」的误导） |
| UT-S09-353 | 可归因优先级 + 归属不可得时不伪造 | ① 后态失败行可反查到唯一 delta 来源（delta 文件 + delta 内行号已知）；② 同一形态但归属无法确定（行不可回溯到单一 delta） | 对两形态分别调 `runDirectMerge` | ① 以「delta 文件 + delta 内行号」为主诊断、后态行号并列作佐证，两者同时在场且 delta 内行号与夹具已知值精确相等；② **不得**输出任何 delta 侧行号，降级为「仅后态行号 + 已标注口径」并显式说明未能归因——断言输出中不出现编造的 delta 路径或行号 |
| UT-S09-354 | 状态档 B / C 分档正确，提交后失败不谎报零残留（delta-r1 F2 必红臂） | 三形态：① 落盘原语返回 `{ok:false, rolled_back:true}`；② 返回 `{ok:false, rolled_back:false}`；③ **提交后清理失败**——注入使 `phase='committed'` 落盘完成后 `removePrivateArtifacts` 持续失败（其 catch 内恢复函数在无 journal 分支二次抛出），错误从原语内部逃出 | 对三形态分别调 `runDirectMerge`，同时取磁盘事实（目标字节、`SPEC_MERGED` 是否在场） | ① 档 B：声明字节同合并前并注明已整批回滚；②③ 档 C：stderr **不含**「保持合并前字节」与「未写 SPEC_MERGED」任一措辞，含「可能已提交 / 状态需核对」语义与 `git status` / `git diff logos/resources/` 指引，原始诊断原文保留，退出码非零；③ 另断言**状态声明与磁盘事实一致**——此刻目标确为新字节、`SPEC_MERGED` 确在场。**修复前（无条件档 A 文案）③ 会输出与磁盘相反的断言，本用例即该谎报的回归锁**；另设反证臂：把档位判据改为从 message 文本反推时断言必红 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-145 | 真实 `openlogos merge` 在 test-change-set 族失败下的稳定失败语义、零残留与分档准确性 | 真实 CLI 子进程，一次性隔离项目复刻 20260914 事故现场：某 `deltas/test/**` delta 的 ID 表数据行列数不一致，**绕过前移预检**直接调 `openlogos merge <slug>`。① 退出码非零；② stderr 含稳定前缀与错误码 `test-change-set-ambiguous-table`、**档 A** 状态声明与 `git checkout logos/resources/` 回滚点（该失败发生在落盘原语调用前）；③ **零残留**：`logos/resources/` 全树逐字节与合并前快照相等，`SPEC_MERGED` 未写入，无任何中间态文件；④ **对照臂（不裸抛）**：断言 stderr **不含**未捕获异常堆栈特征——无 `at <fn> (` 栈帧行、无 `Node.js v` 结尾行、无以错误类名开头的裸 `TestChangeSetBuildError:` 首行；⑤ **成功路径零漂移**：修正该行后重跑 `openlogos merge` 成功，stdout 与 `SPEC_MERGED.test_change_set` 内容同修复前实现逐字节一致；⑥ **档 C 端到端臂**：另取隔离项目，对其提案目录的私有事务目录注入持续删除失败，跑真实 `openlogos merge`——断言退出码非零、无裸堆栈、stderr **不含**「保持合并前字节 / 未写 SPEC_MERGED」，且此刻磁盘上主文档确为新字节、`SPEC_MERGED` 确在场（状态声明与事实一致）；注入恢复后清理临时目录 |

### 追溯与覆盖

- 主修·默认兜底映射 + 档 A（旧实现必红）：UT-S09-351、ST-S09-145 步骤①②④。
- 主修·**状态分档准确性，提交后失败不谎报零残留**（delta-r1 F2 必红臂）：UT-S09-354、ST-S09-145 步骤⑥。
- 主修·诊断不降级（code / message / targetPaths / 行号口径）：UT-S09-352、ST-S09-145 步骤②。
- 主修·可归因优先级与「不得伪造归属」：UT-S09-353。
- 不变式·档 A 情形下的零残留与原子性事实逐字不变：ST-S09-145 步骤③。
- 不变式·成功路径零漂移：ST-S09-145 步骤⑤。
- 功能规格：§2.84.3（含状态三档）、§2.84.4、§2.69.1、§2.69.2；场景：S09「merge 内部错误的稳定失败语义」（EX-9.23、EX-9.24）；来源变更：fix-merge-preflight-parity-and-bare-throw。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- ST-S09-145 必须以**真实子进程**运行 `openlogos merge` 并捕获 stderr 原文，不得以库内函数调用替代——裸抛与否是进程级顶层行为，库内调用观察不到。
- 步骤④ 的「不含堆栈」断言必须对 stderr **全文**做负向匹配（栈帧行 / `Node.js v` 行 / 裸错误类名首行三项），不得只断言「含稳定前缀」——两者可同时成立，只查正向会放过堆栈仍被打印的实现。
- 步骤③ 的零残留断言以合并前后**全树字节快照**比对，不得只检查被 delta 触达的目标文件；该断言只适用于**档 A / B** 情形，不得推广为对全部失败的通用断言。
- UT-S09-354 与 ST-S09-145 步骤⑥ 的注入必须限定在**一次性隔离项目**的私有事务目录，测试结束前恢复注入并清理；断言须同时读取 stderr 文案与磁盘事实两侧，仅比对文案不足以证明分档正确。

## S09 merge 原型落盘安装态路径测试

> 覆盖 `commitVerifiedPrototypes()` 从 `legacyMergeTestMode()` 门内移出到正常 `ui_impact` 合并分支，
> 并覆盖随之真正进入生产流程的两类既有风险：**提交时机**（原型不得先于规格合成提交）与
> **失败分档**（`rolledBack:false` 不得被当作零残留）。断言口径见方法论规范
> `spec/proposal-ui-ux-first.md` §12.3、§12.3.1 约束 A/B、§12.3.2 失败分档表、§12.3.3 写入阶段前置；
> 场景 S09「merge 原型落盘在安装态的可执行位置与可观测摘要」EX-9.25～EX-9.30；来源变更
> fix-merge-prototype-commit-and-phase-module-prefix。
>
> **覆盖有效性前提（硬约束）**：本节用例**一律不得**设置 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`。
> 修复前 CLI 自身回归测试恰好只跑 legacy 模式，覆盖的是那条安装态永不执行的死路径，全绿是假象——
> 本节即该假象的回归锁。**且不得仅用 hash 失配模拟全部失败**：必须含 `rolledBack:false` 的注入分支，
> 否则档 P2 形同未规定。夹具用一次性隔离项目构造（含 `ui_impact: true` 提案、`PLAN_APPROVED` 及其
> `hashes`、`deltas/prd/2-product-design/2-page-design/*.html` 与至少一份 markdown 规格 delta）。
> 测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-355 | 安装态正常分支必定求值 `commitVerifiedPrototypes()`（修复前必红） | `ui_impact:true` 隔离项目，`PLAN_APPROVED.hashes` 与 delta 原型字节一致；**不设** `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY`，`NODE_ENV` 非 `test` | 以安装态环境调用 merge 主流程，并对 `commitVerifiedPrototypes` 加调用探针 | 探针记录到**恰一次**调用；merge 后 `logos/resources/prd/2-product-design/2-page-design/<page>.html` 存在且**逐字节等于** `deltas/prd/2-product-design/2-page-design/<page>.html`。另设对照臂：把调用重新包回 `legacyMergeTestMode()` 时本用例必红（探针零调用、resources 无该文件）——即缺陷 EX-9.25 的回归锁 |
| UT-S09-356 | 档 P0：写入前拒绝 ⇒ 零残留 + 告警 + 合并照常 | 同上隔离项目，但 `PLAN_APPROVED` provenance 不完整 / 全量 hash 校验在写入任何目标字节前失配；仍为安装态环境 | 调用 merge 主流程，事后取磁盘事实与输出文本 | ① `2-page-design/` 逐字节保持 merge 前态、无 staging / backup / journal 残留；② 输出含「原型未落盘」告警、携带 `reason` 与 remediation（`openlogos check-ui-hash-match`）；③ **合并照常**：markdown 规格 delta 已落盘、`SPEC_MERGED` 在场、退出语义同正常合并 |
| UT-S09-357 | 摘要可观测：committed 逐个可见 / 零资产明说 / 失败必有告警（禁止静默） | 三形态：① 两份原型且 provenance 完整；② `ui_impact:true` 但 `2-page-design/` 下无 html；③ 落盘失败（同 UT-S09-356 前置） | 分别运行 merge，解析摘要文本 | ① 摘要与 canonical target **同级**逐个列出两份已 committed 原型的目标相对路径（数量为 2，与磁盘实际落盘文件一一对应）；② 明确说明「本次无原型资产」，不出现失败告警；③ 出现失败告警。三形态均断言**不存在静默态**——落盘成功而摘要无痕、或未落盘而无告警，任一出现即红 |
| UT-S09-358 | 分档准确：P1 已完整回滚 vs P2 回滚不完整，禁止零残留谎报（F4 必红臂） | 两形态注入唯一入口返回值：① `ok:false, rolledBack:true`（reason `commit_failed:*` 或 `post_commit_hash_mismatch`）；② `ok:false, rolledBack:false`（reason `commit_failed_rollback_incomplete` / `post_commit_hash_mismatch_rollback_incomplete`，且恢复材料被保留） | 分别调 merge 主流程，同时取磁盘事实（原型目录字节、staging/backup/journal 是否在场、`SPEC_MERGED` 是否在场）与输出文本 | ① 档 P1：可声明零残留但**必须点名**「提交中途失败后已完整回滚」，规格照常合并、`SPEC_MERGED` 在场；② 档 P2：输出**不含**「零残留 / 保持 merge 前态 / 未发生写入」任一措辞，含「可能已部分落盘、状态需核对」与 journal 指引及 `git status` / `git diff logos/resources/`；**不写 `SPEC_MERGED`**、非零退出、阻断；并断言恢复材料**仍在磁盘上**（未被清理）。**修复前（把所有失败按 partial provenance 一律「零残留 + 合并照常」处理）② 必红** |
| UT-S09-359 | 顺序与材料生命周期：合成失败不得已提交原型；规格提交失败须能回滚原型（F3 必红臂） | 两形态：① provenance 与 hashes 均正确，但某规格 delta 的 MODIFIED 章节锚不可解析 / 物质结果复验不通过；② 原型事务已 `ok:true`，随后注入 `applyBaselineClosureBatch` 落盘失败 | 分别调 merge 主流程，事后取 `2-page-design/` 字节、`SPEC_MERGED` 与输出文本 | ① **原型未被提交**：`2-page-design/` 逐字节等于 merge 前，失败输出为既有档 A 形态且与磁盘事实一致，不写 `SPEC_MERGED`；断言探针记录的调用顺序为「合成与复验完成 → 原型提交」，反序即红；② 依保留的 journal / backup **回滚原型**、规格整批回滚，`logos/resources/` 回到 merge 前一致态，输出如实说明「原型已回滚」，不写 `SPEC_MERGED`；另断言原型事务材料在 `SPEC_MERGED` 写入成功前**未被清理**。**修复前若原型提交排在合成之前，① 会出现「原型已落盘而输出称保持合并前字节」的相反声明，本用例即该谎报的回归锁** |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-146 | 真实 `openlogos merge` 子进程在安装态端到端落盘原型、可观测且失败声明与磁盘一致 | 一次性隔离项目 + **真实 CLI 子进程**，环境中**不含任何 `OPENLOGOS_INTERNAL_*`**、`NODE_ENV` 非 `test`（复刻 0.15.7/0.15.9 安装态现场）。① 提案 `ui_impact:true`、两份原型 html + 一份 markdown 规格 delta，跑 `openlogos merge <slug>`：退出码 0；`2-page-design/` 下两份文件逐字节等于对应 delta 字节；markdown 目标按既有语义正确合并；`SPEC_MERGED` 在场。② stdout 摘要逐个列出两份 committed 原型路径。③ **档 P0 臂**：另取隔离项目令 provenance 失配，跑真实 merge——原型目录全树逐字节与 merge 前快照相等、无中间态残留，输出含失败告警，规格 delta 仍落盘、`SPEC_MERGED` 仍写入。④ **档 P2 臂**：注入回滚不完整（使 `abortTransaction` 还原失败）跑真实 merge——退出码非零、无裸堆栈、输出**不含**零残留措辞、`SPEC_MERGED` **不在场**、恢复材料仍在磁盘；断言输出的状态声明与此刻磁盘事实一致。⑤ **合成失败臂**：provenance 正确但规格 delta 章节锚不可解析，跑真实 merge——`2-page-design/` 逐字节等于 merge 前（原型未提交），输出档 A 声明与磁盘一致。⑥ **修复前必红对照**：在未修复的构建上跑步骤①，断言 resources 中原型文件缺失或为旧字节且**无任何告警**（静默丢弃）。⑦ **零回归**：非 `ui_impact` 提案的 merge stdout 与 `SPEC_MERGED` 内容同修复前实现逐字节一致 |

### 追溯与覆盖

- 主修·安装态可执行（§12.3.1 约束 A，修复前必红）：UT-S09-355、ST-S09-146 步骤①⑥。
- 主修·摘要可观测、禁止静默（§12.3.1 约束 B）：UT-S09-357、ST-S09-146 步骤②。
- 主修·失败分档准确、P2 禁止零残留谎报（§12.3.2，delta-r1 F4 必红臂）：UT-S09-358、ST-S09-146 步骤③④。
- 主修·写入阶段前置与材料保留（§12.3.3，delta-r1 F3 必红臂）：UT-S09-359、ST-S09-146 步骤⑤。
- 不变式·唯一入口不变、不重复落盘（INV-P2）：UT-S09-355（恰一次调用）+ ST-S09-146 步骤①（canonical target 集不含 html）。
- 不变式·档 P0 的零残留与「合并照常」（INV-P3 的 P0 分支）：UT-S09-356、ST-S09-146 步骤③。
- 不变式·非 `ui_impact` 路径零回归：ST-S09-146 步骤⑦。
- 方法论规范：`spec/proposal-ui-ux-first.md` §12.3、§12.3.1、§12.3.2、§12.3.3；场景：S09「merge 原型落盘在安装态的可执行位置与可观测摘要」（EX-9.25～EX-9.30）；来源变更：fix-merge-prototype-commit-and-phase-module-prefix。

### 自动化与证据要求

- 全部用例须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`）。
- 「安装态」须由测试夹具**显式断言**：运行前后校验进程环境中 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY`
  未设置、`NODE_ENV !== 'test'`；夹具不得为求绿而注入该变量。
- 失败分档**必须由控制流与返回值派生**，断言实现未从输出文本反推档位；另设反证臂：
  把档位判据改为从 message 文本反推时断言必红。
- 字节一致性用 SHA-256 逐文件比对；零残留用 merge 前后全量文件清单差集证明；
  档 P2 的「材料保留」用恢复材料路径的存在性断言证明。

## S09 提案模板「最小实现论证」段测试

> 覆盖 `proposalTemplate` 新增 `## 最小实现论证` 段：zh / en 成对改动、插入位置在「变更类型」之前、**不进 canonical 必填章节**，且缺段 / 未填 / 占位残留三者均不告警（需求「S35/S09: 防过度设计的规模信号」验收条件 7–8；场景 S09-A「提案脚手架章节清单与「最小实现论证」段」；来源变更 anti-overdesign-scale-signals）。夹具用一次性隔离项目构造，不依赖本仓自身的提案内容。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-360 | zh / en 两套模板成对含该段且位置正确 | 隔离项目，locale 分别为 `zh` 与 `en` | 对两种 locale 分别执行真实 `openlogos change <slug>`，读回产出的 `proposal.md` | 两份产物均含 `## 最小实现论证`（en 为其对应英文标题），且该标题的行号**严格小于** `## 变更类型`（en 同）的行号、**严格大于** `## 变更原因`；段内三个占位提示齐备（先检索既有机制 / 为什么不能更小 / 主动砍掉了什么）。**两套须同批断言**——任一 locale 缺段即红，锁死成对改动约定 |
| UT-S09-361 | 该段占位全留仍通过 L0，且不得放宽既有检查 | 取 UT-S09-360 的 zh / en 产物各一份 | **前提步骤（不可省）**：先把既有 canonical 章节填妥——「变更原因」「变更类型」「变更范围」「变更概述」脱占位、「部署影响」六字段布尔值选定，其余 L0 条件满足；**仅保留**新增段的全部占位文本。再求 `evaluateProposalStructure` 与 `openlogos change-lint` L0 结论 | 两份产物 `evaluateProposalStructure` 返回 `issues: []`、L0 完成合同通过——新增段的占位残留**不产生任何 issue**（它不在 canonical 白名单，且其占位文本不在既有占位枚举内）。**对照臂（前提有效性证明）**：同一产物在**未执行前提步骤**时，zh / en 各返回 5 项 issue（4 条既有 canonical 章节的占位残留 + 1 条部署字段非法），且这 5 项**逐字**等于本能力上线前同夹具的输出——证明该 5 项源自既有 canonical 章节未填、与新增段无关。**严禁**为使本用例通过而修改既有占位枚举、canonical 章节集合或任一既有判据 |

### 追溯与覆盖

- 模板成对改动与插入位置：UT-S09-360。
- 「不受检、不阻断」边界 + 既有检查零放宽：UT-S09-361（含未填前提的对照臂）。
- 需求：`core-01-requirements.md`「S35/S09: 防过度设计的规模信号」验收条件 7–8；场景：S09-A「提案脚手架章节清单与「最小实现论证」段」；来源变更：anti-overdesign-scale-signals。
- 关联：刀一的观测 warning 见 UT-S35-159～UT-S35-172、ST-S35-31。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- UT-S09-360 必须以**真实 `openlogos change` 产物**断言，不得直接调用模板函数取字符串——模板到落盘之间的写入路径同属被测范围。
- UT-S09-361 的对照臂是本用例的有效性前提：只断言「填妥后零 issue」而不证明「未填时确有 5 项」，无法排除判据被整体削弱的可能。两臂必须同时在场。

## S09 proposal.md 单一来源与防复发测试

> 覆盖「`proposal.md` 形态的单一来源约定」：Step 4 不得再内嵌可整块复制的提案模板、`spec/change-management.md` 不得自列必填章节清单、§canonical scaffold 保真须覆盖**非 canonical 段**且不波及 `tasks.md`（场景 S09-A「proposal.md 形态的单一来源约定」；来源变更 single-source-proposal-scaffold）。三条用例均为**仓库文本静态断言**，读取对象一律是根权威 `skills/`、`spec/`，**不得**读 `logos/skills/`、`logos/spec/` 下的 dogfood 副本（后者由 merge 后同步机制再生成）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-362 | Step 4 不得再出现可整块复制的提案模板，且须指向既有保真条款 | 根权威 `skills/change-writer/SKILL.md` 与 `SKILL.en.md` | 各自截取 Step 4 段（`### Step 4: 生成 proposal.md` / `### Step 4: Generate proposal.md` 起，至下一个同级标题止），枚举段内全部 fenced code block；另对两份旧模板夹具施加同一判据 | **判据按代码块结构判、不按 `PLAN_SECTION_REGISTRY` 名称命中判**：段内任一 fenced code block 含 **≥3 个 `^## ` 级标题行**即判为「可整块复制的提案骨架」→ 红。两份现行 Step 4 均须判绿；且段内须含「原地逐段填写」「禁止整篇重写」语义与对 §canonical scaffold 保真（en: §Preserve the CLI scaffold）的指向。**负向样例（必须同批在场）**：以本次改动**前**的 zh / en 两份旧模板各作一个夹具，断言**两者都被检出**——现行英文旧模板的四个标题中只有 `Change Type` 精确等于 `PLAN_SECTION_REGISTRY.type.en`，其余三个（`Reason for Change` / `Change Scope` / `Change Summary`）均为旧名称，若判据绑定 registry 精确命中则英文侧只命中 1 项会漏检，把旧模板整块塞回去仍能通过。**正向样例**：新 Step 4 的「逐段填写要点」以列表承载、不置于 fenced code block，断言其不自撞该判据 |
| UT-S09-363 | `spec/change-management.md` 不得自列必填章节清单，须指向两个唯一来源 | 根权威 `spec/change-management.md` | 截取 `### proposal.md` 小节（至下一个同级标题止），施加与 UT-S09-362 同一的代码块结构判据；并检索其对来源的指向 | 小节内**不存在**含 ≥3 个 `^## ` 标题行的 fenced code block（旧内嵌模板含 5 个，改前必红）；小节须同时点名**形态唯一来源 = 脚手架 `proposalTemplate`** 与**必填判据唯一来源 = change-lint（`PLAN_SECTION_REGISTRY` + L7）**，两者缺一即红；且不得再出现「必须包含」式的自列章节清单。`## 部署影响` 的既有解析规范（人工审核依据、与 `[deploy]` 交叉校验四条）须**逐字保留**，断言其在场——防止借本次删除顺手删掉无关内容 |
| UT-S09-364 | 保真条款覆盖非 canonical 段，且不波及 `tasks.md`；全文无「整篇重写」前提的保留指令 | 根权威 `skills/change-writer/SKILL.md` 与 `SKILL.en.md` | 截取 §canonical scaffold 保真 / §Preserve the CLI scaffold 整节；另对 `SKILL.md` 全文检索以「整篇重写」为前提的保留指令 | ① 两节均须表明保护范围覆盖**不受 lint 强制的非 canonical 段**——断言其文本点名「最小实现论证」/「Minimal Implementation Rationale」或等义表述（如「不受 lint 强制的段」）；仅写 canonical 标题 / section 顺序 / 机器区块者判红（改前即此形态）。② 两节均须**显式限定不约束 `tasks.md` 的 section 增删**并指向 `spec/tasks-spec.md`；缺该限定即红——`tasks.md` 的 `[code]` 在纯规格 change 中本应删除（`spec/tasks-spec.md` §tasks 结构），保真条款原文同时约束 proposal 与 tasks，不限定会禁掉合法删除并造成流程路由错误。③ `SKILL.md` 全文不得再出现以「整篇重写」为前提的段保留指令（改前 Step 6 补充二 ① 即为此形态），但 `:322` 的 20260914 事故实证段须**逐字保留**，断言其在场 |

### 追溯与覆盖

- Step 4 去模板 + 指向保真条款（含双语负向样例）：UT-S09-362。
- spec 去清单 + 双唯一来源指向 + 部署解析规范零回归：UT-S09-363。
- 保真条款覆盖非 canonical 段、范围限定 `proposal.md`、矛盾消解：UT-S09-364。
- **脚手架产物零回归复用 UT-S09-360**（真实 `openlogos change` 子进程断言 zh / en 产物章节与位置）——本次一行代码不改，不新写回归锚。
- 场景：S09-A「proposal.md 形态的单一来源约定」；来源变更：single-source-proposal-scaffold。
- 前序关联：anti-overdesign-scale-signals 的 UT-S09-360、UT-S09-361（「最小实现论证」段本身的模板测试）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- 三条用例读取对象必须是根权威 `skills/`、`spec/` 下的文件。断言 dogfood 副本等于放过「根权威未改、副本先行」的漂移，属无效证据。
- UT-S09-362 的负向样例是本用例的有效性前提：只断言「现行 Step 4 判绿」而不证明「旧模板判红」，无法排除判据写成恒真。两份旧模板夹具须同时在场，且**英文侧不可省**——它正是按 registry 命中数判会漏检的那一侧。
- 本组用例**不得**修改 `PLAN_SECTION_REGISTRY`、占位符枚举或任一既有 lint 判据以使自身通过。

## S09 guard 资料目录与基线 staging 默认豁免测试

> 覆盖根规范 `spec/pretooluse-guard.md` §文件路径白名单（Edit/Write 工具）新增两行与 §资料目录与基线 staging 默认路径豁免；场景 S09「无活跃提案时资料目录与基线 staging 的 guard 放行时序」EX-9.31～EX-9.36；来源变更 fix-guard-reference-baseline-staging-whitelist。
>
> **夹具口径**：一律在 `mktemp -d` 一次性隔离项目内构造 launched 模块、**无** `logos/.openlogos-guard`；以 stdin JSON + cwd 调用**分发源** `plugin/bin/guard-check`（ST 另验 init / sync 部署出的托管副本），断言进程退出码与 stdout/stderr。完整 hook 用例一律在 python3 或 node 可用的环境运行（hook 读入与 lifecycle 解析依赖二者之一，既有行为）；`is_whitelisted_path` 的 bash 兜底分支仅在函数层（UT-S09-372）验证。路径以绝对路径与项目根相对路径两种形态各跑一遍。夹具不得修改本仓或用户其他仓库的真实文件。
>
> 测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S09"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-365 | reference 正向：Edit/Write 根文件与多级目录放行 | launched、无 guard | Write `logos/resources/reference/notes.md`；Edit `logos/resources/reference/a/b/c/snippet.ts`；Write `logos/resources/reference/temp/seed-manifest.json` | 三次均 exit 0，stdout 无拦截 JSON、stderr 无指引文本；未创建任何 `logos/changes/*` 目录或 guard 文件 |
| UT-S09-366 | staging 正向：单层 run_id 的 staging 及后代放行 | launched、无 guard；run_id 取 `core-20260928-001` 等合法值 | Write `logos/resources/verify/baseline-seed-runs/<run_id>/staging/system-map.md`；Write `.../staging/scenarios/core-S01.md`（嵌套） | 均 exit 0 |
| UT-S09-367 | 近似名称负向（完整段匹配） | 同上 | Write `logos/resources/reference-evil/x.md`、`logos/resources/references/x.md`、`.../baseline-seed-runs/<run_id>/staging-backup/x.md`、`.../baseline-seed-runs/<run_id>/staging.old/x.md` | 均 exit 2，stdout 含「变更管理拦截」JSON，stderr 含可读指引 |
| UT-S09-368 | 缺 run_id / 多层伪 run / 非法 run_id 负向 | 同上 | Write `.../baseline-seed-runs/staging/x.md`、`.../baseline-seed-runs/a/b/staging/x.md`、`.../baseline-seed-runs/-bad/staging/x.md`、`.../baseline-seed-runs/.hidden/staging/x.md` | 均 exit 2 |
| UT-S09-369 | 相邻受保护路径负向 + 既有判定零回归 | 同上 | 负向臂 Write：`.../<run_id>/run.json`、`.../<run_id>/commit-journal.json`、`.../<run_id>/resolved/x.md`、`.../<run_id>/backup/x.md`、`.../baseline-seed-runs/core.commit.lock`、`logos/resources/verify/test-results.jsonl`、`logos/resources/verify/baseline-events.jsonl`、`logos/resources/prd/1-product-requirements/core-01-requirements.md`、`logos/resources/test/core-S01-test-cases.md`、`src/index.ts`；零回归臂：`logos/changes/x/proposal.md`、`CLAUDE.md`、项目外路径；活跃提案臂：写入 guard 文件后对 `src/index.ts` 重跑 | 负向臂全部 exit 2；零回归臂全部 exit 0；活跃提案臂 exit 0（有提案语义不变） |
| UT-S09-370 | 点段逃逸与符号链接不放宽 | 同上；在 `logos/resources/reference/link` 建指向 `src/` 的符号链接 | Write `logos/resources/reference/../../../src/a.ts`、`logos/resources/verify/baseline-seed-runs/<run_id>/staging/../run.json`、`logos/resources/reference/link/a.ts` | 均 exit 2；对照：`logos/resources/reference/a/../b.md`（归一化后仍在 reference 内）在 python3/node 可用时 exit 0 |
| UT-S09-371 | Bash 写入复用新规则、解析能力不扩展 | 同上 | 放行臂：`mkdir -p logos/resources/reference/temp`、`touch logos/resources/reference/todo.md`、`echo x > logos/resources/reference/n.md`、`mkdir -p logos/resources/verify/baseline-seed-runs/<run_id>/staging/scenarios`、`touch .../staging/a.md`；阻断臂：`cp logos/resources/reference/a.md src/a.md`、`mv .../staging/x logos/resources/prd/x`、`touch .../<run_id>/run.json`、`sed -i 's/a/b/' logos/resources/reference/a.md`、`tee logos/resources/reference/a.md`、`touch $D/a.md`、`mkdir x && touch logos/resources/reference/a.md`；安全臂：`openlogos baseline-seed begin --module core --manifest logos/resources/reference/temp/m.json`、`echo x \| tee logos/resources/reference/a.md`（安全优先级零回归对照） | 放行臂 exit 0；阻断臂 exit 2（逐路径全允许才放行；未命中安全白名单的 `sed -i`/`tee`/变量/复合形态维持无条件阻断）；安全臂 exit 0（`^openlogos `、`^echo ` 安全白名单先判，优先级不变） |
| UT-S09-372 | `is_whitelisted_path` 函数层 python3 / node / bash 兜底三分支同判 | 隔离项目为 cwd；以不改变 hook 行为的方式加载分发源 `plugin/bin/guard-check` 中**真实的**路径判定入口（`WHITELIST_PREFIXES`、`is_whitelisted_path` 与 `guard.exempt` 读取 / 内置默认解析；按函数边界提取后 source，或实现侧提供仅定义函数的加载入口）；自 guard-versioned-content-scope 起 reference / staging 豁免由 `guard.exempt` 字段缺省时的内置默认提供，不再硬编码，git 判据与非 git 回落两种模式相同，**不得另写规则副本**；以受控 `PATH` 分别构造「python3 可用」「仅 node 可用」「两者均不可用」三种环境 | 在三种环境下对 UT-S09-365～369、UT-S09-371 涉及的全部**不含点段**路径（绝对与相对两种形态）直接调用该函数，取返回值；另调用含点段输入 `logos/resources/reference/../../../src/a.ts` 与 `logos/resources/reference/a/../b.md` | 不含点段输入三环境返回值逐条相同（`guard.exempt` 字段缺省时 reference / staging 正向返回 0，近似名、run 根状态、`verify/` 其它文件、正式规格与源码返回非 0）；在 `logos.config.json` 显式写 `guard.exempt: []` 后对 reference / staging 正向输入重跑，三环境均返回非 0（证明豁免来自配置而非硬编码）；含点段输入在 bash 兜底环境下均返回非 0（只可更保守），第一条在任一环境均不得返回 0。**本用例不调用完整 hook**：完整 hook 在无 python3 / node 时于路径判定前按既有逻辑返回，不属本案合同 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-147 | 无提案 begin → staging → commit 端到端，不创建临时提案 | S09 无活跃提案资料/staging 时序 Step 4→9；S33 begin/commit | 一次性隔离项目：模块 `core` 已注册为 adopted、`lifecycle: launched`，无 guard 文件；真实 CLI（`cli/dist/index.js`）与分发源 guard | ① 经 hook（Write）把逻辑计划 manifest 写到 `logos/resources/reference/temp/seed-manifest.json`；② 执行真实 `openlogos baseline-seed begin --module core --manifest <该路径> --format json`，取 run_id 与 staging；③ 经 hook 按返回路径 Write 满足 manifest 的 system-map 与场景候选产物（含一次经 hook 的 `mkdir -p` 建子目录）；④ 执行真实 `baseline-seed commit --module core --run-id <run_id>`；⑤ 经 hook 尝试 Write 同 run 的 `run.json`、`commit-journal.json` 与正式目标文件 | ①③ hook 全部 exit 0；② begin exit 0 且返回的 staging 与 R-STAGING 匹配；④ commit exit 0，正式基线落盘、`baseline_seed_state` 按既有协议更新；⑤ 全部 exit 2；全过程 `logos/changes/` 下无新增目录、`logos/.openlogos-guard` 始终不存在、`logos.config.json` 未被改写 |
| ST-S09-148 | init / sync 分发的托管 guard 获得同一规则 | S08 sync 托管 guard 资产补齐时序；EX-9.36 | 真实 CLI；两个一次性隔离项目：新建项目 P1；存量项目 P2，其 `.claude/openlogos/bin/guard-check` 预置为未含新规则的旧字节 | ① P1 执行真实 `openlogos init`（Claude 目标），置 launched；② P2 执行真实 `openlogos sync`；③ 对 P1、P2 的托管 `.claude/openlogos/bin/guard-check` 各跑 UT-S09-365～369、UT-S09-371 的核心矩阵（正向 + 近似名 + run 根状态 + 源码 + Bash 混合目标） | ① ② 后两份托管 guard 均与分发源 `plugin/bin/guard-check` 逐字节一致，且与 `cli/asset-manifest.json` 登记 hash 一致；③ 两项目矩阵结论与分发源逐条相同；P2 sync 前旧字节对 reference 正向输入 exit 2（修复前必红对照） |

### 追溯与覆盖

- reference 正向（R-REF）：UT-S09-365、ST-S09-147 ①。
- staging 正向（R-STAGING）：UT-S09-366、ST-S09-147 ③。
- 完整段边界（EX-9.31、EX-9.32）：UT-S09-367、UT-S09-368。
- 相邻受保护路径与零回归（EX-9.33）：UT-S09-369、ST-S09-147 ⑤。
- 点段与符号链接（EX-9.34）：UT-S09-370、UT-S09-372。
- Bash 复用与混合目标（EX-9.35）：UT-S09-371。
- 三运行时一致（函数层）：UT-S09-372。
- 分发链路（EX-9.36）：ST-S09-148；安装态见 SMOKE-core-209、SMOKE-core-210。
- 根规范：`spec/pretooluse-guard.md` §资料目录与基线 staging 默认路径豁免；场景：S09「无活跃提案时资料目录与基线 staging 的 guard 放行时序」。

### 自动化与证据要求

- 全部用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，失败不得写 pass。
- 每条 hook 调用记录输入 JSON、cwd、退出码与 stdout/stderr 摘要；负向断言同时校验 stdout JSON 与 stderr 双通道。
- UT-S09-372 的三运行时环境须由夹具**显式断言**（如 `command -v python3` / `command -v node` 在受控 PATH 下的结果），不得因宿主环境恰好具备 python3 而使兜底分支空过；被测对象必须是从分发源加载的真实函数，夹具断言加载的函数体来自 `plugin/bin/guard-check` 当前字节。
- 完整 hook 用例（UT-S09-365～371、ST-S09-147～148）须断言运行环境中 python3 或 node 至少一个可用，防止在无运行时环境下因 hook 早退而使负向断言失真。
- ST-S09-148 的字节一致性以 SHA-256 比对；不得以「文件存在」代替。

## S09 guard 跨平台可移植性与输入 fail-closed 测试

> 覆盖根规范 `spec/pretooluse-guard.md` §Claude Code guard 跨平台可移植性与输入 fail-closed（规范性）、§hook 注册形态（规范性）matcher 覆盖面；架构文档 52.1-6、52.5、52.7；来源变更 fix-windows-platform-compat。
>
> **夹具口径**：一律在 `mktemp -d` 一次性隔离项目内构造 launched 模块、**无** `logos/.openlogos-guard`（plan 阶段用例另建活跃提案）；以 stdin JSON + cwd 调用**分发源** `plugin/bin/guard-check`，断言退出码与 stdout / stderr。
>
> **Python 探测 PATH 条件（三态，测试自身构造并先断言）**：
> - **P-none**：PATH 仅含 node、bash 与 coreutils 所在目录；先断言 `python3`、`python`、`py` 均 `command -v` 失败。
> - **P-stub**：在 P-none 基础上把一个临时目录置于 PATH 最前，内含名为 `python3` 的可执行桩（执行即 `exit 9009`，不读 stdin）；先断言 `command -v python3` 成功且 `python3 -c "import sys"` 非零退出——复现 Windows 商店占位别名。
> - **P-real**：正常 PATH，先断言至少一个候选（`python3` / `python` / `py -3`）执行 `-c "import sys"` 退出 0。
>
> 故障注入**只作用于 Python 探测的 PATH**，不替换被测 hook、node、bash 或文件系统。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S09"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-373 | 三态 PATH 下 `tool_name` 均正确解析、判定一致 | 分别在 P-none、P-stub、P-real 下 | Write `src/index.ts`；Write `logos/changes/x/proposal.md`；Read `src/index.ts`；Bash `touch src/a.ts` | 三态结论逐条相同：`src/index.ts` 与 `touch src/a.ts` exit 2 且 stderr 含「变更管理拦截」；提案目录写入 exit 0；Read exit 0。**必红对照**：修复前分发源在 P-stub（及 Windows 上的 P-none）下对 Write `src/index.ts` exit 0 |
| UT-S09-374 | node 分支不读 `/dev/stdin` | 静态 + 动态：P-none 下运行；对分发源文本断言 | ① 动态：P-none 下 Write `src/index.ts`；② 静态：扫描 `plugin/bin/guard-check` 与 `plugin/bin/openlogos-phase` | ① exit 2（node 成功解析）；② 两文件不含 `/dev/stdin` 字面量，node 读 stdin 处为 `readFileSync(0` 形态 |
| UT-S09-375 | Python 可用判据是「执行成功」而非「可发现」 | P-stub | 调用 hook 的 Python 探测（按函数边界加载分发源真实实现，不另写副本） | 探测结果不为 `python3`（桩被排除）；探测在一次 hook 调用内只执行一次（以桩内计数文件断言调用次数 ≤ 候选数） |
| UT-S09-376 | 输入不可解析 fail-closed | P-real | ① stdin 为非法 JSON `{"tool_name":`；② 合法 JSON 但无 `tool_name`；③ 在「P-none 且 PATH 中移除 node」下送合法 Write 输入 | 三者均 exit 2；stdout 为 `{"reason":...}` JSON、stderr 非空且含「无法解析」与检查 node 的提示；不得出现 exit 0 |
| UT-S09-377 | MultiEdit / NotebookEdit 覆盖与字段缺失 fail-closed | P-real | MultiEdit `file_path=src/a.ts`；NotebookEdit `notebook_path=src/n.ipynb`；NotebookEdit `notebook_path=logos/changes/x/n.ipynb`；Edit 无 `file_path` | 前两者 exit 2；第三者 exit 0（白名单）；第四者 exit 2（解析不出目标路径） |
| UT-S09-378 | PowerShell 工具写入模式与 Windows shell 判定顺序 | P-real；launched、无 guard | 以 `tool_name="PowerShell"` 调用。阻断臂：`Set-Content src/a.ts x`、`Out-File -FilePath src/a.ts`、`New-Item src/b.ts`、`Remove-Item src/a.ts`、`copy src\a.ts src\b.ts`、`echo x>src/a.ts`、`echo x > src\a.ts`、`git log > src\log.txt`、`[IO.File]::WriteAllText('src/a.ts','x')`、`Set-Content $p x`、`echo x > $p`、`echo x; Remove-Item src\a.ts`；豁免臂：`echo x>logos/resources/reference/n.md`、`Set-Content logos/resources/reference/n.md x`；纯输出 / 安全臂：`echo x`、`Write-Output x`、`echo x > $null`、`git status 2>&1`、`Get-Content src/a.ts`、`openlogos status`、`git status` | 阻断臂全部 exit 2（其中 `echo …>` 与 `git log >` 三条证明安全白名单对有写入信号的 Windows shell 输入不适用）；豁免臂全部 exit 0；纯输出 / 安全臂全部 exit 0；以大小写变体（`set-content`、`ECHO x>src/a.ts`）重跑结论相同 |
| UT-S09-381 | 判定顺序例外的作用范围：Cursor win32 同判、Bash 工具零回归 | P-real；launched、无 guard | ① 以 `platform='win32'` 注入调用 `plugin-cursor/hooks/runtime.cjs` 的 `beforeShellExecution`，输入 UT-S09-378 的全部阻断臂、豁免臂与纯输出 / 安全臂；② 以 `platform='darwin'` 注入对 Cursor 重跑 `echo x>src/a.ts`、`echo x`；③ 以 `tool_name="Bash"` 调用 guard-check：`echo x > src/a.ts`、`echo x \| tee src/a.ts`、`touch src/a.ts`、`echo x` | ① 与 UT-S09-378 逐条同判（deny / allow 对应 exit 2 / 0）；② ③ 的结论与修复前实现逐条相同（以修复前实现对同一输入的实测结果为基准夹具，不在测试内复述期望）——证明例外不扩散到 `Bash` 工具与非 win32 Cursor |
| UT-S09-379 | 反斜杠与盘符路径的白名单与管辖判定 | P-real 与 P-none 各跑；以受控输入模拟 Windows 形态路径 | `is_whitelisted_path` 与 `rel_of_cwd` 函数层（加载分发源真实实现）：输入 `logos\changes\x\proposal.md`、`CLAUDE.md`、`.claude\openlogos\bin\x`、`src\a.ts`、`<项目根 win32 形态>\src\a.ts`、`<项目根小写盘符形态>\CLAUDE.md`、另一盘符 `D:\other\x.ts` | 前三者判白名单（返回 0）；`src\a.ts` 非白名单；项目根 win32 绝对形态按项目内判定、盘符大小写不影响结论；另一盘符判为项目根之外（管辖外放行语义）；python / node / bash 兜底三分支同判 |
| UT-S09-380 | plan 阶段 delta 收窄在反斜杠路径下有效 | 活跃提案处于 plan 阶段（proposal_step 仅放行原型路径） | Write `logos\changes\<slug>\deltas\prd\2-product-design\2-page-design\core-01-x.html`；Write `logos\changes\<slug>\deltas\test\core-S01-test-cases.md` | 前者 exit 0；后者 exit 2（收窄生效）。**必红对照**：修复前实现对后者 exit 0 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-149 | Windows Git Bash 真实执行 guard-check 三态 | S09 guard 拦截时序 | **Windows CI job**（windows-latest，真实 Git Bash、真实 Windows Node）；一次性隔离 launched 项目，无 guard 文件 | 在 P-none、P-stub、P-real 三态下各以 Git Bash 执行分发源 guard-check：Write `src\index.ts`（Windows 绝对路径形态 `C:\...`）、Write `CLAUDE.md`、Bash `touch src/a.ts`、PowerShell `Set-Content src\a.ts x` | 三态结论逐条相同：源码写入与 shell 写入 exit 2 且 stderr 非空；`CLAUDE.md` exit 0；每态先记录并断言 PATH 前置条件成立 |
| ST-S09-150 | init / sync 部署的 matcher 与托管副本 | S08 sync 托管 guard 资产补齐时序 | 真实 CLI；两个一次性隔离项目：新建 P1；存量 P2 的 `.claude/settings.json` 含旧 matcher `Edit\|Write\|Bash` 的 OpenLogos 条目及一条用户自有 hook | ① P1 真实 `openlogos init`（Claude 目标）；② P2 真实 `openlogos sync`；③ 读取两项目 settings.json 与托管 guard-check | ① ② 后 OpenLogos 条目 matcher 为 `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash\|PowerShell`、各恰一条（旧条目原地升级不并存）；P2 用户自有条目字节不变；托管 guard-check 与分发源逐字节一致；重复 sync 零 diff |

### 追溯与覆盖

- node 主路径与 `readFileSync(0)`：UT-S09-373、UT-S09-374、ST-S09-149。
- Python 以执行成功为判据：UT-S09-375、UT-S09-373（P-stub）。
- 输入不可解析 fail-closed：UT-S09-376。
- matcher 覆盖面与字段缺失 fail-closed：UT-S09-377、ST-S09-150。
- PowerShell / cmd 写入模式与 Windows shell 判定顺序（含对照臂）：UT-S09-378、ST-S09-149；例外作用范围（Cursor win32 同判、Bash 工具与非 win32 零回归）：UT-S09-381。
- 路径比较（`\` 归一、盘符、跨盘）：UT-S09-379、UT-S09-380。
- 来源变更 fix-windows-platform-compat；根规范 `spec/pretooluse-guard.md`。

### 自动化与证据要求

- 每个依赖 Python 探测的用例必须在断言结论之前记录并断言所处 PATH 条件成立；前置条件不成立时用例判 FAIL（而非 skip），防止 runner 镜像变化使用例静默失去覆盖。
- ST-S09-149 属 Windows 回归集，必须在 CI `windows-latest` 阻断 job 中运行；POSIX 结果不计入其覆盖。
- 函数层用例必须加载分发源中的真实实现，不得另写规则副本。
- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。

## S09 merge 对目标既有测试欠债的继承口径测试

> 覆盖功能规格 §2.86（合并后态对原样继承的目标既有欠债不再失败；变更集结论不变）、§2.84.3 / §2.84.4（失败出口稳定形态与 delta 侧归属，对本提案引入的欠债口径不变）；场景 S09「test-change-set 的捕获集变化」；来源变更 fix-inherited-test-debt-merge-block（缺陷报告 `runlogos/logos/resources/reference/BUGREPORT-merge-legacy-table-debt-blocks-unrelated-proposal.md`）。
>
> **夹具口径**：一律在 `mktemp -d` 一次性隔离 launched 项目内构造目标测试规格、活跃提案与 delta，不依赖本仓或宿主仓自身内容。「欠债行」指首格为合法测试 ID、列数与表头不一致的数据行（表头 4 列、该行 5 列）。判定口径与 S35 继承口径测试（UT-S35-202～UT-S35-214）同源，本节只覆盖 merge 侧的落盘结果与失败出口。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S09"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-382 | merge 合成期放行原样继承的欠债且 `SPEC_MERGED.test_change_set` 口径不变 | 目标 A 含欠债行 `ST-S68-05` / `ST-S68-06`；目标 B 含同文件重复 ID `UT-S37-01` 两条；提案对 A、B 各写一个合规纯 ADDED 块，新增 ID 已知 | 调用 merge 的直接合并路径（`mergeDirect`），读回 `SPEC_MERGED` | 合并成功；`test_change_set` 字段集合与 schema 与本变更前逐字一致；`changed_test_ids` 恰为两个 ADDED 块新增的 ID（ASCII 排序），不含 `ST-S68-05` / `ST-S68-06` / `UT-S37-01`；`removed_test_ids` 为空；A、B 合并后字节中欠债行与两条重复记录逐字节保留、顺序不变 |
| UT-S09-383 | 本提案引入的欠债 merge 仍以原码失败、失败出口口径不变 | 三夹具：① 目标 A 同上，delta 追加一条与 `ST-S68-05` 逐字节相同的行；② delta 新增一条与既有 ID 重复的行；③ delta 改动 `ST-S68-05` 的一个单元格 | 以跳过预检的内部路径调用合成与 `buildTestChangeSet`，再经 `runDirectMerge` 失败出口映射（模拟预检漏判时的后备出口） | ①③ 以 `test-change-set-ambiguous-table`、② 以 `test-change-set-duplicate-id` 失败；stderr 为 `Error: merge 失败（<code>）：…` 稳定形态，状态档为 A·未提交（`logos/resources/` 保持合并前字节、无 `SPEC_MERGED`）；行号带「合并后态行号」标注；delta 侧归属点名该 delta 文件与 delta 内行号（违规行在 delta 内，可归因） |
| UT-S09-384 | 修正欠债行进入捕获集 | 目标 A 同上；delta `## MODIFIED` 整节替换，把 `ST-S68-05` 修正为 4 列合规行，`ST-S68-06` 原样携带 | 调用 `mergeDirect`，读回 `SPEC_MERGED` | 合并成功；`ST-S68-05` 进 `changed_test_ids`（前态无合规记录、后态有）；`ST-S68-06` 不进任何集合 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-151 | 缺陷报告事故形态：目标既有欠债 + 纯 ADDED 真实 merge 退 0 | S09 merge 准入判定与 change-lint 同源；test-change-set 的捕获集变化 | 一次性隔离 launched 项目，复刻宿主现场：`logos/resources/test/core-S68-test-cases.md` 场景测试表表头 4 列、`ST-S68-05` / `ST-S68-06` 两行 5 列；活跃提案对该文件只有一个合规纯 ADDED 块，其余 delta 与 tasks 全部合法 | ① 运行真实 `openlogos change-lint --slug <slug> --format json`；② 运行真实 `openlogos merge <slug>`；③ 读回 `SPEC_MERGED` 与合并后目标文件；④ 合并前后各运行一次真实 `openlogos lint-specs` | ① exit 0、`data.pass=true`；② 退出码 0、无 `Error: merge 失败` 输出（**修复前此步退 1：`Error: merge 失败（test-change-set-ambiguous-table）：…core-S68-test-cases.md:82（合并后态行号）`，delta 侧归属「未能确定」**）；③ `SPEC_MERGED` 在场，`test_change_set.changed_test_ids` 恰为 ADDED 新增 ID，合并后目标中两条欠债行逐字节保留；④ 两次 `lint-specs` 对该欠债的报出结论与退出码逐字一致（可观测性不丢） |

### 追溯与覆盖

- 主修·merge 合成期放行原样继承欠债、捕获集口径不变：UT-S09-382、ST-S09-151。
- 防伪臂·本提案引入的欠债仍失败、失败出口与归因口径不变：UT-S09-383。
- 修正欠债属于变更：UT-S09-384。
- lint-specs 可观测性不丢：ST-S09-151 步骤④。
- 功能规格：§2.86.1～§2.86.4、§2.84.3、§2.84.4；场景：S09「test-change-set 的捕获集变化」；来源变更：fix-inherited-test-debt-merge-block。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- UT-S09-382 / UT-S09-384 必须读回真实落盘的 `SPEC_MERGED` 与目标字节断言，不得只断言函数返回值。
- ST-S09-151 必须跑**真实 `openlogos change-lint` / `openlogos merge` / `openlogos lint-specs`** 进程并断言退出码与输出，不得以库内函数调用替代。

## S09 guard 按版本控制内容判定测试

> 覆盖场景 S09「S09-F launched 无提案时 guard 按版本控制内容判定时序」Step 1～62 与 EX-9F.1～EX-9F.31；需求「guard 以版本控制内容为保护对象需求」AC-GUARD-VCS-01～19，「版本管理范围配置（ignore / exempt 与 init 建议忽略）需求」AC-GUARD-SCOPE-08、AC-GUARD-SCOPE-09；功能规格「guard 以版本控制内容为保护对象」；根规范 `spec/pretooluse-guard.md`、`spec/cursor-plugin.md`；来源变更 guard-versioned-content-scope（C01、C05～C07、C09～C14）。
>
> **夹具口径**：
> - **G-repo**（默认）：`mktemp -d` 一次性隔离项目，`git init` 并完成一次初始提交；模块 `core` 为 `lifecycle: launched`，**无** `logos/.openlogos-guard`；`.gitignore` 含 `node_modules/`、`dist/`、`logos/.openlogos-runtime/`；已跟踪 `src/a.js`、`src/b.js`、`package.json`（无外部依赖，含 `release:local` 脚本写 `dist/`）与预置 lockfile；`logos/resources/prd/x.md` 已跟踪。
> - **G-ignored-spec**：在 G-repo 基础上 `.gitignore` 加入 `/logos/*` 与 `!/logos/logos.config.json`（openlogos 本仓形态），`logos/resources/test/t.md` 为被忽略且未跟踪的规格文件。
> - **G-forced**：在 G-repo 基础上 `git add -f dist/app.dmg` 强制入库（runlogos 安装包形态）。
> - Claude hook 输入默认带 `permission_mode: "default"`；C14 相关用例按表中给定值覆盖。
> - **N-repo**：同 G-repo 的文件布局但**不** `git init`，夹具先断言 `git rev-parse --is-inside-work-tree` 失败；**N-nogit**：G-repo 但受控 `PATH` 中不含 `git`，夹具先断言 `command -v git` 失败。
> - ST 一律以 stdin JSON + cwd + env（`CLAUDE_PROJECT_DIR`）驱动**分发源** `plugin/bin/guard-check` 与 `plugin/bin/guard-post-check.cjs`（hook 事件名、`tool_use_id`、`session_id`、`tool_response` 按 Claude Code 真实 hook 输入构造；后台任务工具名与 tool_response 中的标识、结束状态字段以实施时采集的真实 hook 输入为夹具），并在两次 hook 之间**真实执行**被测命令；断言退出码、stdout JSON、stderr 与 `logos/.openlogos-runtime/` 下的磁盘事实。
> - UT 以函数层直接调用分发源中的真实实现（`is_protected`、切段、快照 / 摘要、执行记录状态机、受限命令的 `permission_mode` 处理），不得另写规则副本；时间以可注入时钟控制。
> - 夹具不得修改本仓或用户其他仓库的真实文件；运行前后本仓项目根字节快照相等。
>
> 测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S09"`。

### 取代说明

下列既有用例的结论被新用例取代，「适用模式」列说明取代范围：

- **仅 git 判据下取代**：旧 ID 保留，作为 EX-9F.1 非 git 回落的回归锚。测试实现须让其夹具显式处于 N-repo 口径（断言 `git rev-parse --is-inside-work-tree` 失败）后继续断言原结论；git 判据下的新结论由右列新 ID 承担。
- **两种模式均取代**：旧断言在 git 判据与非 git 回落下都不再成立，不得作为回落回归锚；已在本 delta 中以 MODIFIED 改写断言（保留原 ID）。

逐条核对结果：既有用例中没有断言「`.gitignore` 白名单放行」的条目；断言 R-REF / R-STAGING 硬编码机制的只有 UT-S09-372；UT-S09-365～371 与 ST-S09-147～148 的路径结论在两种模式下都由 `guard.exempt` 内置默认给出、保持不变，其中 UT-S09-371 的 Bash 解析不出形态结论仅在 git 判据下改变。

| 序 | 旧 ID | 旧结论 | 新结论 | 承接新 ID | 适用模式 |
|---|---|---|---|---|---|
| 取代-1 | UT-S09-16 | `sed -i 's/a/b/' src/foo.ts` 在 PreToolUse 即 exit 2 | PreToolUse exit 0（解析不出写入目标），命令执行后 PostToolUse exit 2 并列出 `src/foo.ts` | UT-S09-391、ST-S09-156 | 仅 git 判据下取代 |
| 取代-2 | UT-S09-314 | 「launched 无提案的 Bash 阻断」不区分写入目标；`git push` 因 `BASH_SAFE_PATTERNS` 放行 | Bash 是否阻断取决于事前可提取目标或事后对比；`git push` 作为独立 git 调用放行 | UT-S09-390、UT-S09-391、ST-S09-154 | 仅 git 判据下取代 |
| 取代-3 | UT-S09-318 | ③ 解析不出形态（`rm $VAR`、`rm $(cmd)`、`rm a.txt && rm b.txt`、反引号、管道复合）PreToolUse exit 2；④ `BASH_SAFE_PATTERNS` 先判放行 | ③ 事前放行，由事后检查兜底（写到受保护内容即 exit 2）；`rm a.txt && rm b.txt` 中可提取的受保护目标仍事前 exit 2；④ 安全白名单只用于跳过拍快照，不决定放行 | UT-S09-391、ST-S09-156 | 仅 git 判据下取代 |
| 取代-4 | ST-S09-122 | ③ 解析不出形态（含 `$VAR` 与 `&&` 复合）PreToolUse exit 2 | 同 UT-S09-318 ③ | ST-S09-156、ST-S09-171 | 仅 git 判据下取代 |
| 取代-5 | UT-S09-371 | `sed -i` / `tee` 写 reference、`touch $D/a.md`、`mkdir x && touch logos/resources/reference/a.md` 维持无条件阻断；`openlogos baseline-seed begin` 因 `^openlogos ` 安全白名单放行 | 目标在 `guard.exempt`（默认 reference）内时事前放行且事后不报告；`baseline-seed begin` 作为独立 openlogos 调用放行（C13） | UT-S09-388、UT-S09-391、ST-S09-153、ST-S09-174 | 仅 git 判据下取代 |
| 取代-6 | UT-S09-372 | R-REF / R-STAGING 由 `WHITELIST_PREFIXES` + `is_whitelisted_path` 硬编码提供 | 由 `guard.exempt` 字段缺省时的内置默认提供；显式 `[]` 时不再豁免 | UT-S09-372（MODIFIED）、UT-S09-388、UT-S09-409 | 两种模式均取代 |
| 取代-7 | UT-S09-378 | `Set-Content $p x`、`echo x > $p`、`echo x; Remove-Item src\a.ts` 等解析不出形态 PreToolUse exit 2 | 可提取的受保护目标（`Remove-Item src\a.ts`、重定向到 `src\a.ts`）仍事前 exit 2；目标经变量给出的形态事前放行、事后发现 | UT-S09-391、ST-S09-156 | 仅 git 判据下取代 |
| 取代-8 | UT-S09-381 | Cursor win32 `beforeShellExecution` 对解析不出形态 deny | 与 Claude 侧同口径：可提取受保护目标 deny；解析不出形态 allow 并拍快照，由 `afterShellExecution` 对比 | UT-S09-404、UT-S09-408、ST-S09-178 | 仅 git 判据下取代 |
| 取代-9 | UT-S09-297 | 固定声明「未被阻断（CLI 无 preToolUse）」 | IDE 与 CLI 均为 afterFileEdit 事后报告 | UT-S09-297（MODIFIED）、UT-S09-405 | 两种模式均取代 |

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-385 | `is_protected` 判定顺序（共享测试向量） | G-repo；向量文件 `plugin/test-vectors/guard-protected.json`（路径 + git 状态 + 配置 → 结论与命中序号），供 Claude 与 Cursor 共用 | 逐条调用：项目外绝对路径；`logos/.openlogos-runtime/guard-records/x.json`；`.gitignore`、`sub/.gitignore`、`logos/logos.config.json`（G-ignored-spec 下被忽略）；`.git/config`；`logos/changes/x/proposal.md`、`CLAUDE.md`；`logos/resources/reference/a.md`、`logos/resources/verify/baseline-seed-runs/core-20260928-001/staging/a.md`；`logos/resources/test/t.md`（G-ignored-spec）；`src/a.js`（已跟踪）；`dist/app.dmg`（G-forced）；`dist/x/a.txt`、`node_modules/p/i.js`（被忽略未跟踪）；`src/new.js`、`newdir/`（未跟踪未忽略） | 结论依次为：不保护（序 1）、保护（序 2）、保护（序 3）、保护（序 4）、不保护（序 5）、不保护（序 6）、保护（序 7）、保护（序 8）、保护（序 8）、不保护（序 9）、保护（序 10）；命中序号与向量文件一致；先命中先返回 |
| UT-S09-386 | 不可豁免项先于白名单与 exempt | G-repo 与 G-ignored-spec 各跑；`git config core.excludesFile <项目内 .config/ignore>`；另一轮 `core.excludesFile` 指向项目外文件 | ① `guard.exempt: ["docs/"]` 时 `docs/.gitignore`；② `guard.exempt: ["logos/"]` 时 `logos/logos.config.json`；③ 白名单 `.claude/` 下的 `.claude/.gitignore`；④ `a/b/.gitignore`、`.git/info/exclude`、`.config/ignore`、`.git/hooks/pre-commit`；⑤ `guard.exempt: ["logos/"]` 时 `logos/.openlogos-runtime/pending-reports.jsonl`；⑥ 读取分发源 `WHITELIST_PREFIXES`；⑦ 项目外 excludesFile | ①～⑤ 均返回保护（命中序 2～4，先于序 5 白名单与序 6 exempt）；同一配置下 `docs/a.md`、`logos/resources/prd/x.md`（exempt `logos/`）返回不保护作为对照；⑥ 不含 `.gitignore`；⑦ 返回不保护（序 1 先命中） |
| UT-S09-387 | 被忽略规格仍保护、被忽略目录下已跟踪文件仍保护 | G-ignored-spec + G-forced | `is_protected`：`logos/resources/test/t.md`、`logos/resources/prd/new.md`（被忽略未跟踪）、`logos/resources/reference/r.md`、`dist/app.dmg`、`dist/other.txt` | 前两者保护（序 6）；reference 不保护（序 3）；`dist/app.dmg` 保护（序 7）；`dist/other.txt` 不保护（序 8） |
| UT-S09-388 | `guard.exempt` 缺省 / 显式 / 空数组 / 语法拒绝 | G-repo；分别配置 `guard.exempt` 缺省、`["docs/notes/"]`、`[]`；另以 `["src/"]`、`[".gitignore"]`、`[".git/info/exclude"]`、`["a/.gitignore"]`、`["logos/logos.config.json"]`、`[".git/"]` 调用配置校验 | `is_protected`：`logos/resources/reference/a.md`、`docs/notes/a.md`、`logos/resources/verify/baseline-seed-runs/r1/staging/a.md` | 缺省：reference 与 staging 不保护，`docs/notes/a.md` 保护；显式 `["docs/notes/"]`：`docs/notes/a.md` 不保护，reference 保护；`[]`：三者均保护（不回落内置默认）；`["src/"]` 合法且使 `src/a.js` 不保护；保护范围来源、`logos/logos.config.json` 与 `.git/` 条目被校验拒绝 |
| UT-S09-389 | 前提不满足时新判据不启用 | N-repo、N-nogit、G-repo + 活跃提案、G-repo + 所有模块 initial | 调用判定入口：Write `src/a.js`、Bash `sed -i s/a/b/ src/a.js` | N-repo / N-nogit：走现行判定，结论与修改前分发源对同一输入的实测基准逐条相同（基准由修改前实现生成，不在测试内复述）；活跃提案：proposal_step 收窄逻辑不变；initial：放行 |
| UT-S09-390 | 独立 git / openlogos 调用切段识别 | 无 | 切段函数输入：`git checkout feature`、`cd /r && git pull`、`git add -A && git commit -m "a && b"`、`openlogos sync`、`cd /r && openlogos status && git status`；`cd /r`；`git status && node m.js`、`git diff > src/a.ts`、`git log \| head`、`git apply $(cat p)`、`` git show `x` ``、`(git pull)`、`git pull &`、`git apply <<EOF`、`openlogos sync && node m.js` | 前五条判为独立调用（引号内 `&&` 不切段；git 与 openlogos 混合亦可）；单独 `cd` 不是独立调用；其余各条均非独立调用，并返回首个违规记号 |
| UT-S09-391 | Bash 事前轻判 | G-repo | 判定入口：`echo x > src/a.js`、`rm src/b.js`、`cp README.md src/c.js`、`Remove-Item src\a.js`（PowerShell）、`cmd > dist/build.log`、`mkdir -p dist/x`、`sed -i s/a/b/ src/a.js`、`node -e "require('fs').writeFileSync('src/a.js','x')"`、`rm $VAR`、`touch $D/a.md`、`npm ci`、`ls -la`、`cat src/a.js`、`git status`、`echo x \| tee src/a.js` | 前四条 exit 2（可提取目标受保护）；`dist/` 两条 exit 0 且不报告；`sed -i`、`node -e`、`rm $VAR`、`touch $D/a.md`、`npm ci`、`tee` 管道 exit 0 并拍快照；`ls -la`、`cat`、`git status`（只读白名单、无重定向 / 复合）exit 0 且**不**拍快照；断言「解析不出即阻断」不再出现、安全白名单命中与否不改变 exit 码 |
| UT-S09-392 | Edit / Write / MultiEdit / NotebookEdit 事前判定 | G-repo；G-repo + 活跃提案 | Write `src/new.js`；Edit `src/a.js`；MultiEdit `logos/resources/prd/x.md`；NotebookEdit `notebook_path=dist/n.ipynb`；Write `dist/a.txt`；Edit `.gitignore`；活跃提案（delta-writing 阶段）下 Write `src/a.js` | 前三者与 Edit `.gitignore` exit 2（stdout JSON + stderr 变更管理指引）；`dist/` 两者 exit 0；活跃提案下按 proposal_step 收窄结论与修改前一致 |
| UT-S09-393 | 快照覆盖范围与原始字节留存 | G-ignored-spec；`src/a.js` 已改未提交；`src/new.js` 未跟踪；`dist/big.bin` 6 MiB 被忽略；`logos/resources/test/huge.md` 6 MiB | 调用 `snapshot` 生成记录 | `entries` 含：脏的 `src/a.js`、`src/new.js`、`logos/resources/test/t.md`、`logos/resources/test/huge.md`、`.gitignore`、`logos/logos.config.json`（每次快照都纳入）及 git 元数据条目（见 UT-S09-410）；不含 `dist/`、`node_modules/`、`logos/.openlogos-runtime/`；干净的 `src/b.js` 以 `raw-baseline.json` 中的 raw_oid 作为执行前基线被引用；留存经 `git hash-object -w --no-filters --stdin-paths`，`src/a.js`、`src/new.js`、`t.md` 的 `raw_oid` 可经 `git cat-file -e` 取到且 `recoverable: true`；`huge.md` 只记摘要、`recoverable: false`；记录含 `head`、`index_tree`、`generation` |
| UT-S09-394 | 变化判定以原始字节为准 | 同上；以可注入时钟与 stat 构造 | 对比函数输入：新增 `src/c.js`；删除 `logos/resources/test/t.md`；把 `src/b.js`（干净）换成符号链接；再次修改脏 `src/a.js`（`git status` 输出不变）；执行前已脏且本次未动的文件；stat 签名不变但 mtime 不早于缓存记录时刻的已跟踪文件 | 前四类分别判为新增、删除、类型变化、摘要变化；`src/b.js` 以 raw-baseline 中的 raw_oid 对比，不调用过滤后的 `git diff` 决定是否检查；执行前已脏未动的文件不计变化；mtime 不早于记录时刻的条目必须重算 |
| UT-S09-395 | 执行记录关闭条件状态机 | 记录 R（`closed:false`） | 依次喂入：同标识非后台 PostToolUse；同标识非后台 PostToolUseFailure；后台调用 PostToolUse 返回 `background_task_id`；该任务 BashOutput / TaskOutput 显示运行中；显示已完成 / 失败 / 被终止；KillShell / TaskStop 成功；Stop；SessionStart；补查无变化 | 仅「非后台同标识结束事件」与「后台任务结束确认（三种状态或终止工具成功）」关闭记录，且关闭前均执行一次最终对比；运行中、Stop、SessionStart、补查无变化均不关闭；关闭后记录文件被删除 |
| UT-S09-396 | 匿名记录与无标识结束事件 | 无 | PreToolUse 输入缺 `tool_use_id`；随后到达缺 `tool_use_id` 的 PostToolUse；另有一条带标识的未关闭记录 R2 | 生成 `anon-<时间戳>-<随机>` 记录且 `anonymous:true`；无标识结束事件只触发对比、不关闭任何记录（含 R2 与匿名记录）；不按「最近一次」关联 |
| UT-S09-397 | 基线规则：最早未关闭记录、新快照不吸收、rebase-only 局部更新 | R1（早）未关闭，R1 后 `src/a.js` 被改；随后建 R3 | R3 的 `check`；对 R1、R3 执行 `rebase-only`，变化路径集合为 `{src/b.js}` | `src/a.js` 的变化在 R3 的检查中仍被报告（以 R1 为「执行前」基线），不被 R3 快照吸收为既有改动；`rebase-only` 只把 `src/b.js` 在 R1、R3 中的基线更新为调用后内容，`src/a.js` 基线不动 |
| UT-S09-398 | 事件级去重 `(path, raw_digest, 事件签名)` | 去重表为空；以可注入 stat 构造 `(ino, ctime_ns)` | ① `src/a.js` 改为 X（签名 s1）→ 检查 → 再检查两次；② 恢复为基线 → 检查 → 再次改为 X（签名 s2，内容同 ①）→ 检查；③ 改为 X 后未恢复，但再次写入相同内容 X（签名 s3）→ 检查；④ 删除 `src/b.js` → 检查两次；⑤ 改 `src/c.js` 为 Y → 报告 → 独立 git 调用 rebase 该路径 → 再次写入 Y → 检查；⑥ 迟到结束事件对 ① 已报事件做最终对比 | ① 只报一次；② 观测到回到基线时清除去重条目，再次改为 X 时重新报告；③ 新事件签名使同一内容重新报告一次；④ 事件签名为 `"absent"` 加观测序号，只报一次；⑤ rebase 清除去重条目，再次写入 Y 被报告；⑥ 不重复 |
| UT-S09-399 | 反馈内容、归因与恢复命令 | 构造三类变化：本次调用、唯一归因到后台记录、无法归因；Claude 与 Cursor 宿主各一轮 | 生成反馈 | exit 2；stderr 与 stdout `{"reason":…}` 同含变化文件与类型、归因；后台归因附命令原文；无法归因含「可能来自未结束的后台调用或用户手动修改，需向用户确认，请勿自行回滚」且不含要求回滚的语句；可恢复条目（含已跟踪干净文件）的恢复命令恰为 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- <path>`（Cursor 下引擎路径为 `.cursor/hooks/openlogos-guard-post.cjs`），反馈中不出现 shell 重定向恢复写法或 `git checkout`；`recoverable:false` 条目标明不可自动恢复；复合 git / openlogos 调用的反馈含「拆成单独调用后重试」 |
| UT-S09-400 | 送达渠道 | `pending-reports.jsonl` 有 1 条未送达项 | 依次：PreToolUse 补查新增 1 条（当前调用为 Edit `dist/a.txt`）；Bash PostToolUse；Stop（`stop_hook_active:true`）；SessionStart | PreToolUse 对 `dist/a.txt` 仍 exit 0（补查不阻断当前调用），新项写入 pending；下一次 Bash PostToolUse exit 2 一并送达两项并标记已送达；随后 Stop 无新项 exit 0；SessionStart 把未送达项并入注入上下文 |
| UT-S09-401 | 提案边界函数 | R1 未关闭且有未报告变化 `src/a.js` | `boundary-start`；写 guard 后的 `check`；`boundary-end`；删 guard 后的 `check`；引擎文件不存在时调用 change / archive 的边界钩子 | `boundary-start` 把 `src/a.js` 写入 pending；有提案时 `check` 不报告新变化但照常送达 pending、照常关闭 / 去重；`boundary-end` 把 R1 全部条目基线更新为当时内容；删 guard 后的 `check` 只对比不更新基线；引擎缺失时边界钩子跳过且 change / archive 退出码不受影响 |
| UT-S09-402 | 受限命令按 `permission_mode` 处理 | G-repo | PreToolUse 输入 `openlogos exempt add src/`，`permission_mode` 依次为 `default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`auto`、`plan`、字段缺失、`weird`；另以 `default` 输入 `cd <根> && openlogos ignore add dist/`、`openlogos exempt add src/ && node x.js`、`openlogos exempt list`、`openlogos ignore remove dist/`；活跃提案在场时以 `default` 与 `bypassPermissions` 各跑一次 | `default` / `acceptEdits`：exit 0，stdout 恰为 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":…}}` 且 reason 含命令原文；其余六种：exit 2，reason 含当前模式名、`! <命令原文>` 与「不要用对话中的口头同意替代」；`cd` 前缀形态与 `ignore remove` 同为 ask；复合形态 exit 2；`list` exit 0 且无 ask；有提案时结论相同 |
| UT-S09-403 | 伪造授权文件或伪造 hook 输入不起作用 | G-repo；`permission_mode: "bypassPermissions"` | ① 在 `logos/.openlogos-runtime/` 下预置任意名称的「授权」文件（含 `scope-grants/<sha256(命令)>.json` 形态，内容声明已确认、未过期）后执行 `openlogos exempt add src/`；② 自造 `AskUserQuestion` PostToolUse 负载（回答「确认执行」）直接调用引擎，再执行同一命令；③ 以 `grant` 子命令调用引擎；④ 扫描分发源 guard-check 与引擎 | ①② 仍 exit 2；③ 引擎以未知子命令非零退出且不写任何文件；④ 不含 `scope-grants`、`grant` 子命令或读取授权文件的代码路径 |
| UT-S09-404 | Cursor 与 Claude 保护对象一致 | G-repo、G-ignored-spec、G-forced | 用 UT-S09-385 的同一向量文件分别驱动 `plugin/bin/guard-check` 的 `is_protected` 与 `plugin-cursor/hooks/runtime.cjs` 的对应判定 | 两侧对每条向量的「是否受保护」结论逐条相同；runtime 规则表中不含 `.gitignore` 白名单项 |
| UT-S09-405 | `CURSOR_HOOK_EVENTS`、模板 hooks.json 与托管文案 | 读取源文件 | 读 `cli/src/lib/cursor-adapter.ts` 导出的 `CURSOR_HOOK_EVENTS`、`plugin-cursor/hooks/hooks.json`、cursor-adapter 生成的托管文案、`spec/cursor-plugin.md`、`spec/pretooluse-guard.md`「Cursor hooks 部分强度门禁适配合同」表 | `CURSOR_HOOK_EVENTS` 含 `afterShellExecution`；模板含 `"afterShellExecution": [{ "type": "command", "command": "node .cursor/hooks/openlogos-runtime.cjs shell-after" }]`；托管文案与上述规范文本均不含「Cursor IDE 经同一 hooks.json 获得完整 preToolUse 硬拦」及同义表述，文件编辑声明为 afterFileEdit 事后报告 |
| UT-S09-406 | Cursor 受限命令返回 permission ask | G-repo | `beforeShellExecution`：`openlogos exempt add src/`、`openlogos ignore remove dist/`、`openlogos exempt list`；注入「自动运行模式不能保证弹出审批」实测结论后重跑第一条 | 前两条返回 `{"permission":"ask",…}`，消息含完整命令原文；`list` 返回 allow；实测结论为不能保证弹出时返回 deny |
| UT-S09-407 | qoder / workbuddy / zcode 行为不变 | G-repo | 以三宿主各自 hook 入口重放其既有用例输入集（UT-S09-190～201 起始的既有矩阵）及 `npm ci`、`openlogos exempt add src/` | 三宿主结论与修改前实现对同一输入的实测基准逐条相同；未接入事后检查引擎 |
| UT-S09-408 | Cursor `shell-after` 模式与快照关联 | G-repo | `beforeShellExecution` 输入含可靠调用标识后接 `afterShellExecution` 同标识；输入不含可靠标识；两次并发 before 后到达一个 after | 有标识：before 调引擎 `snapshot`、after 调 `check` 并关闭同一记录；无标识：建匿名记录，after 只对比不关闭；并发时按标识关联，不按「最近一次」猜测 |
| UT-S09-409 | 配置异常保守处理 | G-repo 与 N-repo 各跑 | `is_protected(logos/resources/reference/x.md)`，`logos.config.json` 依次为：无 `guard` 字段；`guard: {}`；`guard.exempt: []`；先写 `guard.exempt: []` 再把文件改为不可解析 JSON；`guard: "x"`；`guard.exempt: "docs/"`；`guard.exempt: ["../x", "docs/"]` | 前两种不保护（内置默认）；`[]` 保护；不可解析、`guard` 类型不符、`exempt` 类型不符三种均保护（视为 `[]`）且 stderr 含配置警告；含非法条目时跳过 `../x` 并警告，`docs/` 生效，reference 保护 |
| UT-S09-410 | git 元数据快照采集范围 | G-repo；另建 linked worktree（git 目录与 common dir 分离）；`core.hooksPath=.githooks`（项目根内未跟踪目录） | 调用 `snapshot` | `entries` 含 git 目录与位于项目根内的 common dir 下的 `config`、`info/` 全部文件、`hooks/` 全部文件，以及 `.githooks/` 下文件；不含 `objects/`、`refs/`、`logs/`、`index`、`HEAD`、`ORIG_HEAD`、`FETCH_HEAD`、`MERGE_*`、`packed-refs`、`*.lock`、`modules/` 对象库；随后执行一次 `snapshot`（会写 `objects/`）再 `check`，不报告任何变化 |
| UT-S09-411 | 原始字节摘要与过滤无关（脏文件） | G-repo；`core.autocrlf=true`；`.gitattributes` 为 `*.up filter=up`，`filter.up.clean = tr a-z A-Z`；`src/w.txt`、`src/a.up` 执行前已脏 | 对 CRLF 文件 `src/w.txt` 与 `src/a.up`：快照摘要函数；只把 `src/w.txt` 的 CRLF 改为 LF；只改 `src/a.up` 的大小写（clean 后相同） | 快照条目摘要等于 `git hash-object --no-filters` 结果；两种改动都判为摘要变化（过滤后相同也不漏）；恢复命令为 `restore` 子命令 |
| UT-S09-412 | 非 git 回落的四处保守修改 | N-repo 与 N-nogit | Edit `.gitignore`；Write `.claude/.gitignore`；Write `.git/config`（N-nogit）；Write `logos/logos.config.json`；Write `logos/.openlogos-runtime/x`；Write `logos/resources/reference/a.md`（exempt 缺省 / 显式 `[]` / 配置损坏三种）；Bash `openlogos exempt add src/`（`default` / `bypassPermissions`）；Bash `sed -i s/a/b/ src/a.js`；Bash `npm ci` | 前五条 exit 2；reference 依次 exit 0 / exit 2 / exit 2；受限命令依次 ask / exit 2；`sed -i` 与 `npm ci` 结论与修改前分发源实测基准相同（安全白名单先判、解析不出即阻断）；不生成 `guard-records/`，不调用引擎 |
| UT-S09-413 | 原始字节基线缓存 `raw-baseline.json` | G-repo；`.gitattributes` 含 `*.up filter=up`；可注入时钟 | ① 首次 `snapshot`；② 不改任何文件再次 `snapshot`；③ 只 `touch` `src/b.js`（stat 变、内容不变）后 `snapshot`；④ 构造 mtime 不早于缓存记录时刻的条目；⑤ 独立 git 调用改 `src/a.js` 后 rebase | ① 缓存覆盖全部已跟踪文件，字段为 stat 签名与 raw_oid；无内容转换的文件 raw_oid 等于索引 blob，对象库对象数不增加；② 不调用 `hash-object`；③ 只重算 `src/b.js`；④ 一律重算；⑤ 缓存与所有未关闭记录中 `src/a.js` 的基线同步更新 |
| UT-S09-414 | clean filter 下干净文件的原始字节判定（函数层） | G-repo；`.gitattributes` 为 `*.up filter=up`，`filter.up.clean = tr a-z A-Z`；已跟踪且干净的 `src/h.up` 工作区内容为 `hello` | 建快照后把 `src/h.up` 改为 `HELLO`；调用对比函数；调用 `git diff --quiet -- src/h.up` 作为对照 | 对照 diff 为空（过滤后相同）；对比函数仍判为摘要变化；报告条目的执行前基线为 `hello` 的 raw_oid；生成的恢复命令为 `restore` 子命令，不是 `git checkout` |
| UT-S09-415 | `restore` 前置校验与按目录项恢复 | G-repo；分别构造执行前 / 执行后状态 | ① 执行前普通文件、执行后被换成指向 `outside.txt` 的符号链接；② 执行前普通文件、执行后为目录；③ 执行前普通文件、执行后被删除；④ 执行前不存在、执行后为普通文件；⑤ 执行前不存在、执行后为符号链接；⑥ 执行前不存在、执行后为目录；⑦ 执行前符号链接、执行后为普通文件；⑧ 执行后状态被再次修改（摘要不符）；⑨ 文件类型不符；⑩ 执行前权限位为 0755 | ① 链接目录项被替换为原文件，`outside.txt` 字节不变；临时文件名形如 `.<name>.openlogos-restore-<pid>`，经 `rename` 替换；② 拒绝，exit 1；③ 还原原文件；④⑤ 删除目录项；⑥ 拒绝，exit 1；⑦ 以临时链接 + `rename` 重建原链接；⑧⑨ 拒绝、只报告、exit 1，文件不变；⑩ 恢复后权限位为 0755；成功恢复后该路径去重条目被清除且不产生新报告 |
| UT-S09-416 | 项目级锁 `state.lock` | 无 | ① 进程 A 持锁时进程 B 请求；② A 持锁 6 秒；③ 锁文件 `acquired_at` 早于 31 秒且 pid 不存在；④ `acquired_at` 早于 31 秒但 pid 仍存活；⑤ `acquired_at` 早于 10 秒且 pid 不存在 | 锁以 `O_CREAT\|O_EXCL` 创建，内容含 `pid`、`host`、`acquired_at`；① B 等待至 A 释放后获得；② B 等待 5 秒后放弃；③ 打破过期锁并获得；④⑤ 不打破 |
| UT-S09-417 | 原子落盘与临时文件处理 | 无 | 写执行记录、`pending-reports.jsonl`、`reported.jsonl`、`raw-baseline.json`；在 `rename` 之前注入失败；预置残留 `guard-records/x.json.tmp-123-ab` | 每个状态文件先写同目录 `*.tmp-<pid>-<rand>` 再 `rename`；注入失败后原文件内容不变且可解析；读取忽略 `*.tmp-*`；下次持锁时清理过期临时文件 |
| UT-S09-418 | 记录代际与墓碑 | 记录 R（`generation`=3） | ① 以 `generation`=2 的更新写入 R；② 关闭 R；③ 对 R 的迟到写入（基线更新、关闭、追加条目）；④ 下一会话 SessionStart | ① 丢弃；② 记录文件删除且写入 `guard-records/<id>.closed`；③ 看到墓碑即丢弃，R 不复活；④ 墓碑被清理 |
| UT-S09-419 | 拿不到锁时的降级 | 另一进程持锁且未过期 | ① PreToolUse 拍快照；② PostToolUse 有 2 条待报告项；③ Stop 有 1 条；④ 锁释放后任意检查点持锁 | ① 本次调用按非 git 回落判定，不写执行记录；②③ 各以 `O_EXCL` 写入 `pending-spill/<pid>-<时间戳>.json`；④ spill 合并进 `pending-reports.jsonl` 后删除，合并后无重复 |
| UT-S09-420 | 多文件更新中断只会多报 | 3 条未关闭记录 R1～R3 | 对三条记录做 rebase，在更新 R2 之后注入进程终止；之后检查 | R1、R2 为新基线，R3 仍为旧基线；之后检查对 R3 涉及的路径报告（需向用户确认），不出现漏报 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-152 | 构建与依赖写入放行 | S09-F Step 6→19 | G-repo | 经 PreToolUse → 真实执行 → PostToolUse 依次运行：`npm ci`；`npm run release:local`；`mkdir -p dist/x`；`node -e "process.stdout.write('log')" > dist/build.log`；Write `dist/a.txt`（Edit 工具） | 全部 PreToolUse 与 PostToolUse exit 0，stderr 无变更管理文本；`pending-reports.jsonl` 无新增；非后台记录在 PostToolUse 后被删除 |
| ST-S09-153 | exempt 与项目外路径放行 | S09-F Step 1→5、Step 9→19 | G-repo；临时 HOME 下项目外目录 | Write `logos/resources/reference/n.md`；Bash `sed -i s/a/b/ logos/resources/reference/n.md`；Bash `mkdir -p logos/resources/verify/baseline-seed-runs/r1/staging && touch logos/resources/verify/baseline-seed-runs/r1/staging/a.md`；Bash `rm -rf <项目外目录>/x`；Write `<项目外目录>/y.md` | 全部 exit 0，事后不报告 |
| ST-S09-154 | 全部 git 命令放行且不报告 | S09-F Step 25→27 | G-repo；本地 bare 远端、`feature` 分支（改 `src/a.js`）、一条 stash | 依次独立执行：`git checkout feature`、`git checkout -`、`git merge feature`、`git rebase feature`、`git stash pop`、`git pull <远端> master`、`git reset --hard HEAD~1`、`git checkout -- src/a.js`、`git restore src/b.js`、`git push <远端> HEAD:tmp`、`cd <根> && git checkout feature` | 全部 PreToolUse / PostToolUse exit 0；无未关闭记录时不生成执行记录；随后一次 Bash `ls` 与 Stop 均不报告分支切换带来的变化 |
| ST-S09-155 | Edit / Write 阻断矩阵 | S09-F Step 1→5 | G-repo | Edit `src/a.js`；Write `src/new.js`；Write `newdir/x.txt`；MultiEdit `logos/resources/prd/x.md`；Edit `.gitignore` | 全部 exit 2；stdout JSON 可解析且 reason 含变更管理指引，stderr 非空；目标文件字节不变 |
| ST-S09-156 | 任何写法改源码被发现 | S09-F Step 6→19 | G-repo | 逐条经完整 hook 链：`cd <根> && sed -i s/a/X/ src/a.js`；`node -e "require('fs').writeFileSync('src/a.js','y')"`；`python3 tools/mod.py`（夹具脚本改 `src/b.js`）；`find src -name b.js -delete`；`T=src/a.js; echo z > $T`；`echo x > src/a.js` | 前五条 PreToolUse exit 0、PostToolUse exit 2，反馈列出对应文件与变化类型（修改 / 删除）、归因「本次调用」，恢复命令为 `restore` 子命令；`echo x > src/a.js` 在 PreToolUse 即 exit 2 且文件未被写入；每条之后执行反馈中的 `restore` 子命令，下一条起点一致 |
| ST-S09-157 | 写入后失败经 PostToolUseFailure 发现 | S09-F Step 15b→19 | G-repo | Bash `node -e "require('fs').writeFileSync('src/a.js','y');process.exit(3)"`，真实执行得到退出码 3，以 PostToolUseFailure 事件送入引擎 | PostToolUseFailure exit 2，反馈列出 `src/a.js`；该记录在最终对比后关闭 |
| ST-S09-158 | 中断后未闭合快照补查 | S09-F Step 3、Step 8、Step 20→21；EX-9F.5 | G-repo | ① Bash PreToolUse 后真实执行 `node -e` 改 `src/a.js`，**不**发送结束事件；② 下一次 Edit `dist/a.txt` 的 PreToolUse；③ 下一次 Bash `ls` 的 PreToolUse → 执行 → PostToolUse；④ 另一轮重复①后直接 Stop | ② exit 0（补查不阻断当前调用）且 pending 新增 `src/a.js`；③ PostToolUse exit 2 送达该项；④ Stop exit 2 送达；再次 Stop exit 0；①的记录始终未关闭 |
| ST-S09-159 | 补查之后才写入的后台写入 | S09-F Step 22→24 | G-repo | ① 后台 Bash `node delayed-writer.js`（收到信号文件后改 `src/a.js`）：PreToolUse → PostToolUse（tool_response 含后台任务标识）；② 任意工具 PreToolUse 补查；③ 触发信号文件使其写入；④ 新的前台 Bash `ls` 完整链 | ① 后记录 `background:true` 且未关闭；② 无报告、记录仍在；④ PostToolUse exit 2 报告 `src/a.js`，归因「未结束的后台调用」并附命令；④ 新建记录不把该变化当作执行前已有改动 |
| ST-S09-160 | 迟到结束事件与无标识结束事件 | S09-F Step 40；EX-9F.4、EX-9F.6 | G-repo | ① Bash 记录 R（标识 t1）改 `src/a.js` 后不发结束事件；② 补查发现并经 Stop 送达；③ 迟到的 t1 PostToolUse；④ 另一调用 PreToolUse 缺 `tool_use_id`，执行改 `src/b.js`，再送缺标识的 PostToolUse | ③ 做最终对比后关闭 R，不重复报告 `src/a.js`（exit 0）；④ 生成 `anon-` 记录，缺标识结束事件报告 `src/b.js` 一次但不关闭任何记录，匿名记录保留在 `guard-records/` |
| ST-S09-161 | 后台运行期间 checkout / pull 不误报，后台随后改源码仍被发现 | S09-F Step 22→27 | G-repo；`feature` 分支改 `src/a.js`；本地远端领先一个提交（改 `src/b.js`） | ① 后台 `node dev-server.js`（按信号文件写入）；② 独立 `git checkout feature`；③ 独立 `git pull <远端> feature`；④ Bash `ls` 完整链与 Stop；⑤ 触发后台改 `src/a.js`；⑥ Bash `ls` 完整链 | ②③ 前后执行 `snapshot --rebase-only` / `check --rebase-only` 且 exit 0；④ 均不报告分支切换与 pull 带来的变化；未关闭记录中只有 `src/a.js`、`src/b.js` 等被改动路径的基线被更新；⑥ exit 2 报告 `src/a.js` |
| ST-S09-162 | 跨会话（含 /clear）延迟写入 | S09-F Step 28→30 | G-repo | ① 会话 s1 后台调用 R1；② 模拟 `/clear`：不发送任何结束事件，以 s2 发送 SessionStart；③ 触发后台改 `src/a.js`；④ s2 中 Bash `ls` 完整链；⑤ 另一轮：③在②之前发生 | ② 后 R1 记录文件仍在且未关闭；④ exit 2 报告 `src/a.js`，归因 R1 命令；⑤ s2 的 SessionStart 输出的注入上下文含该变化，下一次 Bash 结束事件送达 |
| ST-S09-163 | 宿主确认后台结束后关闭记录 | S09-F Step 39→40 | G-repo | ① 后台调用 R1；② BashOutput / TaskOutput PostToolUse 显示运行中；③ 显示已完成；④ 另一轮以 KillShell / TaskStop 成功结束；⑤ 关闭后在 hook 之外手动改 `src/a.js`，再执行 Bash `ls` 完整链 | ② R1 仍在；③④ 最终对比后 R1 记录文件被删除；⑤ 反馈不出现 R1 归因（无未关闭记录时手动修改按执行前已有改动处理，不报告） |
| ST-S09-164 | 提案期间改动在归档后不误报 | S09-F Step 31→37 | G-repo；真实 CLI（`cli/dist/index.js`） | ① 后台调用 R1；② 真实 `openlogos change p1`；③ 有提案时 Edit `src/a.js` 与 Bash 改 `src/b.js`；④ 真实 `openlogos archive p1`（前置 VERIFY_PASS 等按夹具预置）；⑤ Bash `ls` 完整链与 Stop | ② 写 guard 前 `boundary-start` 被调用；③ 期间检查点不报告新变化；④ 删 guard 前 R1 基线整体更新；⑤ 不报告 `src/a.js`、`src/b.js` |
| ST-S09-165 | 归档后、首次检查前的后台写入 | S09-F Step 38 | 同 ST-S09-164 ①～④ | ④ 后立即触发后台改 `src/a.js`；再执行 Bash `ls` 完整链 | exit 2 报告 `src/a.js`；该变化未被 boundary-end 吸收 |
| ST-S09-166 | 提案开始前未检查的后台写入存为待报告项 | S09-F Step 31→34 | G-repo；真实 CLI | ① 后台调用 R1；② 触发后台改 `src/b.js`，之后不经任何检查；③ 真实 `openlogos change p2`；④ 有提案时 Bash `ls` 完整链；⑤ 真实 `openlogos archive p2`；⑥ Bash `ls` 完整链 | ③ 后 `pending-reports.jsonl` 含 `src/b.js`；④ exit 2 送达该项（提案期间不丢弃）；若④未送达则⑥送达；归档不吸收、不删除该待报告项 |
| ST-S09-167 | 边界缺失时不静默吸收 | S09-F EX-9F.7 | G-repo；真实 CLI | ① 后台 R1；② 真实 `openlogos change p3`；③ 有提案时改 `src/a.js`、`src/b.js`；④ 手动 `rm logos/.openlogos-guard`（不经 CLI）；⑤ Bash `ls` 完整链；⑥ 再次 Bash `ls` 完整链 | ⑤ exit 2，`src/a.js`、`src/b.js` 各报告一次，反馈含「需向用户确认」；⑥ 不重复 |
| ST-S09-168 | 无法归因变化只报一次且不要求回滚 | S09-F EX-9F.8 | G-repo | ① 两条后台调用 R1、R2 未关闭；② 在 hook 之外手动改 `src/a.js`；③ Bash `ls` 完整链；④ Stop；⑤ 再次 Bash `ls` 完整链 | ③ exit 2，反馈含「可能来自未结束的后台调用或用户手动修改，需向用户确认，请勿自行回滚」并列出 R1、R2 的命令，不含回滚要求；④⑤ 不重复报告 |
| ST-S09-169 | 内容级对比：执行前已有不误报，二次修改等不漏报 | S09-F Step 11→16 | G-ignored-spec；执行前 `src/a.js` 已脏 | 逐条完整链：Bash `ls`；`node -e` 再次改写 `src/a.js`（`git status` 输出前后相同）；`node -e` 删除 `logos/resources/test/t.md`；`node -e` 把 `src/b.js` 换成指向 `README.md` 的符号链接 | `ls` 不报告执行前已有的 `src/a.js`；其余三条 PostToolUse exit 2，变化类型分别为修改、删除、类型变化 |
| ST-S09-170 | 脏文件、未跟踪文件与被忽略规格经 restore 逐字节还原 | S09-F Step 12、Step 18、Step 56→59；EX-9F.9、EX-9F.10 | G-ignored-spec；`src/a.js` 已脏、`src/new.js` 未跟踪、`logos/resources/test/huge.md` 6 MiB；`core.autocrlf=true` 且工作区有 CRLF 行尾的已跟踪脏文件 `src/w.txt`；`.gitattributes` 为 `*.up filter=up`、`filter.up.clean = tr a-z A-Z`，已跟踪脏文件 `src/a.up` 含小写内容 | ① 一条 Bash 同时改写 `src/a.js`、`src/new.js`、`logos/resources/test/t.md`、`huge.md`、`src/w.txt`、`src/a.up`；② 逐条执行反馈中的 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- <path>`；③ 另一轮：①后先手动再改 `src/a.js`，再执行其 `restore` | ② `src/a.js`、`src/new.js`、`t.md`、`src/w.txt`（CRLF 保留）、`src/a.up`（小写保留）与执行前逐字节一致（SHA-256 比对），恢复后检查不产生新报告；`huge.md` 被标明不可自动恢复且无恢复命令；③ `restore` exit 1、只报告，`src/a.js` 保持手动修改后的内容（本用例只覆盖执行前已脏的文件，干净文件见 ST-S09-184） |
| ST-S09-171 | git 豁免边界 | S09-F Step 9、Step 25；EX-9F.2、EX-9F.3 | G-repo；夹具 `modify-source.js` 改 `src/a.js` | `git status && node modify-source.js`；`git diff > src/a.ts`；`T=src/a.ts; git diff > $T`；`cd <根> && git checkout feature` | 第一条 PreToolUse exit 0、PostToolUse exit 2，反馈提示「拆成单独调用后重试」；第二条 PreToolUse exit 2 且 `src/a.ts` 未创建；第三条 PostToolUse exit 2 报告 `src/a.ts` 并提示拆分；第四条放行且不报告 |
| ST-S09-172 | 被忽略规格与被忽略目录下已跟踪文件仍受保护 | S09-F EX-9F.11、EX-9F.12 | G-ignored-spec + G-forced | Write `logos/resources/test/t.md`；Write `logos/resources/prd/new.md`；Bash `node -e` 写 `logos/resources/test/t.md`；Write `logos/resources/reference/r.md`；Write `dist/app.dmg`；Bash `node -e` 改 `dist/app.dmg`；Write `dist/other.txt` | 两条规格 Write 事前 exit 2；规格 Bash 事后 exit 2；reference exit 0；`dist/app.dmg` 的 Write exit 2、Bash 事后 exit 2；`dist/other.txt` exit 0 |
| ST-S09-173 | 非 git 回落 | S09-F EX-9F.1 | N-repo、N-nogit | ① 重放 ST-S09-152、ST-S09-155、ST-S09-156 的全部输入；② Edit `.gitignore`、Write `.claude/.gitignore`、Write `logos/logos.config.json`、Write `logos/.openlogos-runtime/x`；③ Bash `openlogos exempt add src/`（`default` 与 `bypassPermissions`）；④ 每条均补发 PostToolUse | ① 除四处保守修改外，每条结论与修改前分发源对同一输入的实测基准逐条相同（含 `npm ci`、`sed -i`、`rm $VAR` 的旧结论）；② 全部 exit 2；③ 依次 ask / exit 2；④ PostToolUse 全部 exit 0，不生成 `guard-records/` |
| ST-S09-174 | CLI 自身写入不误报、复合调用不豁免 | S09-F Step 51 | G-repo；真实 CLI；`guard.unversioned` 已改使托管区块与 `.gitattributes` 需重渲染 | ① 无未关闭记录时 `openlogos sync` 完整链；② 后台 R1 未关闭时 `openlogos sync` 完整链，再 Bash `ls` 完整链；③ `openlogos sync && node modify-source.js` 完整链；④ `openlogos baseline-seed begin --module core --manifest logos/resources/reference/temp/m.json` 完整链 | ① ② 不报告 `.gitignore`、`.gitattributes` 变化；② R1 中仅这两个路径的基线被更新；③ PostToolUse exit 2 报告 `src/a.js`（与 sync 写入一并列出）并提示拆分；④ exit 0，作为独立 openlogos 调用（C13）不报告 CLI 写入的 run 目录与 `run.json`（`run.json` 本身仍属受保护内容，AI 经 Edit / Write 直接写入仍事前 exit 2） |
| ST-S09-175 | 保护范围变更经宿主原生审批（Claude Code） | S09-F Step 41→48 | G-repo；真实 CLI；`permission_mode: "default"` | ① PreToolUse `openlogos exempt add src/`；② 模拟用户批准：真实执行该命令后发送 PostToolUse；③ 另一轮 ① 后模拟用户拒绝：不执行命令；④ `permission_mode: "acceptEdits"` 下 PreToolUse `cd <根> && openlogos ignore add src/` 并批准执行；⑤ PreToolUse `openlogos exempt add src/ && node x.js` | ① exit 0 且 stdout 为 `permissionDecision: ask`，reason 含命令原文；② `guard.exempt` 含 `src/`，PostToolUse 不报告 `logos/logos.config.json` 变化（C13）；③ `logos.config.json` 字节不变；④ ask，执行后托管区块含 `src/`、不报告；⑤ exit 2 |
| ST-S09-176 | 不弹审批的模式与 `--auto` 下保护范围变更被阻断 | S09-F Step 44b；EX-9F.20 | G-repo；真实 CLI；另一轮存在活跃提案 | 以 `permission_mode` 为 `bypassPermissions`、`dontAsk`、`auto`、`plan`、缺失分别执行 `openlogos ignore add src/` 的 PreToolUse；以 `openlogos next --auto` 驱动标记（`bypassPermissions`）执行 `openlogos exempt remove logos/resources/reference/`；活跃提案在场时 `bypassPermissions` 下执行同一命令 | 全部 exit 2，reason 含模式名与 `! <命令原文>` 指引；配置与 `.gitignore` 字节不变 |
| ST-S09-177 | 修改忽略规则来源与保护范围配置被发现 | S09-F EX-9F.13 | G-repo 与 G-ignored-spec 各跑；`core.excludesFile` 指向项目内 `.config/ignore` | Edit `.gitignore`；Write `logos/logos.config.json`（加入 `guard.exempt: ["src/"]`）；Bash `echo src/ \| tee -a .git/info/exclude`；Bash `node -e` 追加 `.config/ignore`；Bash `node -e` 新建 `src/.gitignore`；Bash `node -e` 改写 `logos/logos.config.json` 加入 `guard.exempt: ["src/"]` | 两条 Edit / Write 事前 exit 2 且文件字节不变；四条 Bash PreToolUse exit 0、PostToolUse exit 2，分别列出 `.git/info/exclude`、`.config/ignore`、`src/.gitignore`、`logos/logos.config.json`；G-ignored-spec 下 `logos/logos.config.json` 被 git 忽略时结论相同；之后 `src/a.js` 仍判为受保护 |
| ST-S09-178 | Cursor `afterShellExecution` 事后检查与 ask | S09-F Step 54→58 | G-repo；经 `openlogos init`（Cursor 目标）部署的 `.cursor/hooks.json`、`openlogos-runtime.cjs`、`openlogos-guard-post.cjs` | ① 断言部署的 `.cursor/hooks.json` 含 `afterShellExecution` 且 `openlogos-guard-post.cjs` 与 `plugin/bin/guard-post-check.cjs` SHA-256 相同；② `beforeShellExecution`（含调用标识）→ 真实执行 `node -e` 改 `src/a.js` → `afterShellExecution`；③ `beforeShellExecution` 执行 `npm run release:local` → `afterShellExecution`；④ `beforeShellExecution` 输入 `openlogos exempt add src/`；⑤ Edit 后 `afterFileEdit` 改 `src/a.js` | ② after 输出事后检查报告列出 `src/a.js`（反馈渠道形态以 `spec/cursor-plugin.md` 记录的实测结论为准）；③ 不报告；④ 返回 `permission: ask`；⑤ 报告文本声明未被阻断、仅事后报告 |
| ST-S09-179 | 伪造授权与伪造 hook 输入端到端无效 | S09-F Step 49→50 | G-repo；真实 CLI；`permission_mode: "bypassPermissions"` | ① Bash `node -e` 在 `logos/.openlogos-runtime/scope-grants/` 下写入伪造授权文件（完整 hook 链）；② 直接以自造 `AskUserQuestion` PostToolUse 负载调用引擎；③ PreToolUse `openlogos exempt add src/` | ① PreToolUse 对可确定的运行时目标 exit 2 或事后报告，且无论文件是否写成，③ 均 exit 2；② 引擎 exit 0 且不写任何放行状态；`guard.exempt` 始终不含 `src/` |
| ST-S09-180 | git 元数据改动被事后发现，独立 git config 只更新基线 | S09-F Step 11、Step 25→27；EX-9F.14 | G-repo | ① Bash `node -e` 向 `.git/config` 追加 `[alias] x = !rm -rf src`；② Bash `node -e` 写入 `.git/hooks/pre-commit`；③ Bash `node -e` 向 `.git/info/exclude` 追加 `src/`；④ 后台调用 R1 未关闭时独立执行 `git config user.name x`，再 Bash `ls` 完整链；⑤ 之后 Bash `node -e` 再追加 `.git/config` | ①②③ PreToolUse exit 0、PostToolUse exit 2，分别列出 `.git/config`、`.git/hooks/pre-commit`、`.git/info/exclude`，并给出恢复命令；④ 不报告，R1 中仅 `.git/config` 基线被更新；⑤ exit 2 报告 `.git/config` |
| ST-S09-181 | 不可豁免项在白名单与 exempt 目录内仍受保护 | S09-F 受保护判定序 2～4；EX-9F.13、EX-9F.15 | G-repo；分别配置 `guard.exempt: ["docs/"]` 与 `["logos/"]` | Write `docs/.gitignore`（exempt `docs/`）；Edit `logos/logos.config.json`（exempt `logos/`）；Write `.claude/.gitignore`；Write `logos/.openlogos-runtime/guard-records/x.json`；Bash `rm logos/.openlogos-runtime/pending-reports.jsonl`；Bash `node -e` 写 `docs/.gitignore`；对照：Write `docs/a.md`（exempt `docs/`） | 前五条 exit 2 且目标字节不变；`node -e` 写 `docs/.gitignore` 事后 exit 2；对照 exit 0 |
| ST-S09-182 | 显式 exempt `[]` 后配置损坏，reference 仍受保护 | S09-F Step 4；EX-9F.16 | G-repo 与 N-repo 各跑 | ① 经确认路径以外的夹具直接把 `logos.config.json` 设为 `guard.exempt: []`；② 把文件改为不可解析 JSON；③ Write `logos/resources/reference/x.md`；④ Bash `node -e` 写 `logos/resources/reference/y.md`（G-repo） | ③ exit 2，stderr 含配置警告；④ PostToolUse exit 2 报告 `y.md`；两种模式结论相同 |
| ST-S09-183 | 事件级去重：恢复后再改为同一内容重新报告，未恢复只报一次 | S09-F Step 17、Step 59 | G-repo | ① Bash `node -e` 把 `src/a.js` 改为 X → PostToolUse；② 执行 `restore`；③ Bash `ls` 完整链；④ Bash `node -e` 再把 `src/a.js` 改为 X；⑤ 另一轮：改为 X 后不恢复，连续执行三次 Bash `ls` 完整链与一次 Stop | ① exit 2 报告；③ 不报告（回到基线，去重条目被清除）；④ exit 2 再次报告；⑤ 只在第一次报告，其后均 exit 0 |
| ST-S09-184 | clean filter 下干净文件被改写可发现并还原原始字节 | S09-F Step 11、Step 16、Step 56→59 | G-repo；`.gitattributes` 为 `*.up filter=up`，`git config filter.up.clean "tr a-z A-Z"`；已跟踪且干净的 `src/h.up` 工作区原始字节为 `hello` | ① Bash `node -e` 把 `src/h.up` 改为 `HELLO`，完整 hook 链；② 断言 `git diff --quiet -- src/h.up` 退出 0；③ 执行反馈中的 `restore` 子命令 | ① PostToolUse exit 2 报告 `src/h.up`，反馈不含 `git checkout`；③ `src/h.up` 原始字节恰为 `hello`（与执行前 SHA-256 相同）；之后检查不报告 |
| ST-S09-185 | restore 恢复矩阵 | S09-F Step 56→59；EX-9F.24、EX-9F.25 | G-repo；项目外 `outside.txt` | 各经一次完整 hook 链产生报告后执行 `restore`：① `src/a.js` 被换成指向 `outside.txt` 的符号链接；② `src/b.js` 被删除后在原路径建目录；③ `src/b.js` 被删除；④ 新建 `src/new.js`；⑤ `src/a.js` 被改写后又被手动改写 | ① `src/a.js` 恢复为原普通文件，`outside.txt` 字节不变；② exit 1，只报告，目录保留；③ `src/b.js` 逐字节还原；④ `src/new.js` 被删除；⑤ exit 1，文件保持手动内容 |
| ST-S09-186 | 8 个并发 PostToolUse 全部送达 | S09-F Step 60；EX-9F.26 | G-repo | 8 条 Bash 各自真实执行改写不同文件 `src/p1.js`～`src/p8.js`，随后并发发送 8 个 PostToolUse；再发送一次 Stop | 8 个变化在 8 次反馈与 Stop 中合计各出现恰好一次；`pending-reports.jsonl`、`reported.jsonl` 可解析、无重复行；`state.lock` 最终不存在 |
| ST-S09-187 | 关闭记录后迟到的旧写入不复活 | S09-F Step 19、Step 61；EX-9F.30 | G-repo | ① 记录 R 正常关闭；② 以 R 的旧代际重放一次基线更新写入、一次追加条目写入；③ Bash `ls` 完整链 | ② 两次写入被丢弃，`guard-records/<id>.json` 不重新出现，`<id>.closed` 存在；③ 不出现 R 的归因 |
| ST-S09-188 | 写入中途被 kill 后状态可读 | S09-F Step 62；EX-9F.29 | G-repo | 对引擎注入「写完临时文件、`rename` 之前」暂停点，PostToolUse 运行到该点时 `kill -9`；之后执行 Bash `ls` 完整链 | 残留 `*.tmp-*` 被读取忽略；所有状态文件可解析；锁过期后被打破；被中断那次的变化在之后的检查中被报告（多报不漏报）；残留临时文件在下次持锁时被清理 |
| ST-S09-189 | 过期锁被打破 | S09-F Step 60；EX-9F.29 | G-repo | 预置 `state.lock`，`pid` 为已退出进程、`acquired_at` 早于 31 秒；执行 Bash `node -e` 改 `src/a.js` 完整链 | PreToolUse 正常拍快照（未回落）；PostToolUse exit 2 报告 `src/a.js`；锁文件被替换为当前进程后释放 |
| ST-S09-190 | 锁超时时报告进入 spill 并在之后合并送达 | S09-F Step 18；EX-9F.27、EX-9F.28 | G-repo | ① 夹具进程持有未过期锁；② 已拍快照的 Bash 改 `src/a.js` 后发送 PostToolUse；③ 同时发送 PreToolUse（Bash `node -e` 改 `src/b.js`）；④ 释放锁后执行 Bash `ls` 完整链 | ② 等待 5 秒后写入 `pending-spill/` 一个文件；③ 本次调用按非 git 回落判定（`node -e` 在回落下的结论与修改前基准一致），不写执行记录；④ PostToolUse exit 2 送达 `src/a.js`，spill 文件被删除，之后不重复送达 |
| ST-S09-191 | 独立调用形态的 restore 不被误报 | S09-F Step 59 | G-repo；后台记录 R1 未关闭 | ① Bash `node -e` 改写未跟踪文件 `src/new.js`（执行前已存在）→ PostToolUse 报告；② 经完整 hook 链执行 `cd <根> && node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- src/new.js`；③ Bash `ls` 完整链与 Stop；④ 以非托管路径的引擎副本执行同一 restore | ② PreToolUse 与 PostToolUse 均 exit 0、不报告；`src/new.js` 还原为执行前字节；R1 中仅 `src/new.js` 的基线改回执行前状态、其去重条目被清除，其他路径基线不变；③ 不报告；④ 不享受豁免，按普通 Bash 拍快照并对比 |
| ST-S09-192 | 复合形态的 restore 不享受豁免 | S09-F Step 59；EX-9F.31 | G-repo | ① Bash `node -e` 改写 `src/a.js` → 报告；② 经完整 hook 链执行 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- src/a.js && echo x > src/other.js` | ② PreToolUse 对可提取的受保护目标 `src/other.js` exit 2 且命令未执行；改为 `T=src/other.js; … && echo x > $T` 重跑时 PreToolUse exit 0、PostToolUse exit 2 报告 `src/other.js`（`src/a.js` 已回到基线，不报告） |

### 追溯与覆盖

- 构建与依赖放行（AC-GUARD-VCS-01）：ST-S09-152、UT-S09-391。
- exempt、项目外、git 命令放行（AC-GUARD-VCS-02）：ST-S09-153、ST-S09-154、UT-S09-385、UT-S09-388。
- Edit / Write 阻断（AC-GUARD-VCS-03）：ST-S09-155、UT-S09-392。
- 任意写法改源码被发现（AC-GUARD-VCS-04）：ST-S09-156、UT-S09-391。
- 写入后失败（AC-GUARD-VCS-05）：ST-S09-157。
- 未闭合与补查后写入（AC-GUARD-VCS-06）：ST-S09-158、ST-S09-159、UT-S09-397、UT-S09-400。
- 迟到结束事件与无标识（AC-GUARD-VCS-07）：ST-S09-160、UT-S09-395、UT-S09-396、UT-S09-398。
- 跨会话与后台结束确认（AC-GUARD-VCS-08）：ST-S09-162、ST-S09-163、UT-S09-395。
- 后台期间 git 操作（AC-GUARD-VCS-09）：ST-S09-161、UT-S09-397。
- 提案边界（AC-GUARD-VCS-10）：ST-S09-164、ST-S09-165、ST-S09-166、ST-S09-167、UT-S09-401。
- 无法归因（AC-GUARD-VCS-11）：ST-S09-168、UT-S09-399。
- git 豁免边界（AC-GUARD-VCS-12）：ST-S09-171、UT-S09-390。
- 被忽略规格与已跟踪文件（AC-GUARD-VCS-13）：ST-S09-172、UT-S09-387。
- 内容级对比（AC-GUARD-VCS-14）：ST-S09-169、UT-S09-393、UT-S09-394、UT-S09-414。
- 可恢复（AC-GUARD-VCS-15）：脏文件与未跟踪文件 ST-S09-170、UT-S09-411；clean filter 下干净文件 ST-S09-184、UT-S09-413、UT-S09-414；`restore` 子命令与按目录项恢复 ST-S09-185、UT-S09-415；恢复命令写法 UT-S09-399。
- 事件级去重：UT-S09-398、ST-S09-183。
- restore 调用自身的 C13 豁免边界：ST-S09-191、ST-S09-192。
- 共享状态并发与中断：UT-S09-416～UT-S09-420、ST-S09-186～ST-S09-190。
- 非 git 回落（AC-GUARD-VCS-16，含四处保守修改）：ST-S09-173、UT-S09-389、UT-S09-412；既有回落回归锚见「取代说明」中「仅 git 判据下取代」各行。
- CLI 自身写入（AC-GUARD-VCS-17、AC-GUARD-SCOPE-08）：ST-S09-174。
- 保护范围来源、`logos/logos.config.json`、git 元数据、guard 自有状态受保护且先于白名单与 exempt（AC-GUARD-VCS-18）：ST-S09-177、ST-S09-180、ST-S09-181、UT-S09-385、UT-S09-386、UT-S09-388、UT-S09-393、UT-S09-410。
- 配置异常保守处理：UT-S09-409、ST-S09-182、UT-S09-372（MODIFIED）。
- 多宿主分层（AC-GUARD-VCS-19）：UT-S09-404、UT-S09-405、UT-S09-406、UT-S09-407、UT-S09-408、ST-S09-178、UT-S09-297（MODIFIED）、UT-S09-302（MODIFIED）。
- 保护范围变更经宿主原生审批（AC-GUARD-SCOPE-09）：ST-S09-175、ST-S09-176、ST-S09-179、UT-S09-402、UT-S09-403、UT-S09-406。
- 分发与安装态（AC-GUARD-VCS-20）：由 `core-S08-test-cases.md` 与安装态 smoke 承担，本节不重复。

### 自动化与证据要求

- 全部用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，测试名包含对应 ID，`scenario_id="S09"`；失败不得写 pass。
- 每条 hook 调用记录输入 JSON、cwd、env、退出码与 stdout / stderr 摘要；负向断言同时校验 stdout JSON 与 stderr 双通道。
- ST 夹具在每个用例开始时断言其口径成立（G-repo：`git rev-parse --is-inside-work-tree` 成功且无 guard 文件；N-repo / N-nogit 见夹具口径），口径不成立判 FAIL 而非 skip。
- 并发与中断用例（ST-S09-186～ST-S09-190）以注入暂停点与信号文件控制时序，不依赖 sleep 竞态；锁等待时长以可注入时钟验证。
- 后台调用用夹具脚本以「信号文件」控制写入时机，不依赖 sleep 竞态；ST 中「后台任务结束」以按真实 hook 输入采集的 tool_response 夹具驱动。
- 「与修改前实测基准逐条相同」类断言（UT-S09-389、UT-S09-407、ST-S09-173）的基准由修改前分发源对同一输入集实测生成并入库为夹具，不在测试代码中手写期望。
- 运行时目录断言以磁盘事实取证（`guard-records/` 与墓碑、`pending-reports.jsonl`、`pending-spill/`、`reported.jsonl`、`raw-baseline.json`、`state.lock` 的文件与内容），不以日志文本代替。
