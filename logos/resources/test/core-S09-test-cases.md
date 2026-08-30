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
| UT-S09-110a-neg | `done_when` 命令不存在或仍含字面占位符 → 必须失败（负向） | overlay `done_when` 后端可执行性 | 已 sync 的 GUI 项目 | ①将 `done_when: cmd:` 后端指向**不存在的子命令**求值；②或 overlay 仍保留字面 `<check-ui-prototype>`/`<...>` 占位符未被真实子命令名替换；运行/求值 `done_when` | **必须失败**（非零退出/校验失败）：命令不存在无法求值即节点不可 done；overlay 仍含字面 `<...>` 占位=未落地为真实可执行命令，判非法（保证 `cmd:` 后端确为真实子命令而非示意文本） |
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

## 十三、S39 闭包接入 change 生命周期测试

> 本节所有测试实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，记录真实 ID、S09/S39 关联、结果与时间。

### 13.1 单元测试

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S09-147 | write-tasks 接入闭包计划 | launched proposal 含行为变更 | proposal 有 on-touch-v1 声明；tasks 每个非 SKIP 目标含 MODIFY/CREATE |
| UT-S09-148 | canonical target 聚合 | 两个场景规划同一测试 target | 只产生一条 task；内容来源合并，顺序稳定 |
| UT-S09-149 | plan-exit 数量不变 | 激活 on-touch-v1 的 resolved flow | 仍只有既有 `plan-exit`；无 baseline gate/node/marker |
| UT-S09-150 | `[code]` 仍留空 | 提案需要代码且新增测试 delta | plan/spec 阶段 `[code]` 只有占位说明；不提前切片 |
| UT-S09-151 | 逐文件勾选 | 连续产出两个 delta | 第一文件落盘后对应 task 立即 `[x]`，第二项仍 `[ ]`；全部完成后才全勾 |

### 13.2 场景测试

| ID | 场景 | 步骤 | 期望 |
|---|---|---|---|
| ST-S09-57 | 首个棕地 change 无 seed | adopted + seed required，创建提案并完成 plan | 正常到达同一个 plan-exit；不要求 baseline-seed；闭包 tasks 在场 |
| ST-S09-58 | AMBIGUOUS 停在现有门前 | 构造无法判断持久化选择的提案 | plan 未完成、输出缺口；无新 gate/确认状态；补充选择后复用原 plan-exit |
| ST-S09-59 | 单目标最终态链路 | 同目标同时需要现状补齐与增量修改 | tasks 一项、deltas 一文件；合并预期同时含现状与增量，不出现 baseline delta |

### 13.3 反向回归

- 既有 GUI UI-first、纯代码 no-delta、slice-planner、半自动/全自动门语义不变。
- 不产生 `[baseline]` section、JIT advisory、`verified:true`、`baseline_warnings`、第二次 plan approval。
- `openlogos change lint` 仍表示 slug=`lint` 的既有行为；L9 继续由独立 `change-lint` 命令承载。

## 十四、Plan 阶段决策澄清协议测试用例（clarification@1）

> 覆盖 proposal 澄清区块解析、影响声明、条件性必选人类决定、完成谓词、status/next JSON、历史兼容、跨进程恢复与 `next --auto` fail-closed。所有测试实现必须使用 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，测试名包含对应稳定 ID。

### 14.1 结构解析与确定性校验

| ID | 测试名称 | 测试对象 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-152 | 提取唯一 clarification@1 YAML 区块 | proposal-lifecycle 解析器 | proposal 含合法决策澄清章节 | 解析 | 得 schema/mode/status/impacts/decisions/unresolved/defaults，字符串去外围空白但不改用户原文 |
| UT-S09-153 | 五类 impacts 完整合法 | impacts 校验器 | 五类均为 `none` 且 reason 非空 | 校验 | valid；不产生必选类别 |
| UT-S09-154 | impacts 缞字段 fail-closed | impacts 校验器 | 缺 `security_privacy` | 校验 | invalid，reason=`clarification-contract-invalid` |
| UT-S09-155 | impacts 未知状态 fail-closed | impacts 校验器 | `data.status=maybe` | 校验 | invalid，不按 none 处理 |
| UT-S09-156 | impacts 空理由 fail-closed | impacts 校验器 | `compatibility.reason` 仅空白 | 校验 | invalid，reason=`clarification-contract-invalid` |
| UT-S09-157 | category 闭合枚举 | 决策校验器 | 分别输入九个合法类别与未知类别 | 校验 | 九类均合法；未知类别 invalid |
| UT-S09-158 | CXX 格式与全局局部唯一 | 决策校验器 | 重复 C01、C00、C001、合法 C01/C10 | 校验 | 仅合法且不重复集合通过 |
| UT-S09-159 | depends_on 不存在被拒 | 依赖校验器 | C02 依赖不存在 C99 | 校验 | invalid，稳定诊断指出 C99 |
| UT-S09-160 | depends_on 循环被拒 | 依赖校验器 | C01→C02→C01 | 校验 | invalid，不产生 next_decision |
| UT-S09-161 | complete 与 unresolved 冲突 | 状态一致性 | `status=complete` 且 unresolved 非空 | 校验 | invalid，不能降级 legacy 完成逻辑 |

### 14.2 条件性必选人类决定

| ID | 测试名称 | 测试对象 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-162 | data required 必须匹配用户决定并输出完整问题 | 必选类别匹配 | `data=required`、无 data/user 决定、有一个依赖已满足的完整 data unresolved | status/next/auto 派生 | pending，reason=`data-clarification-required`，三者给出同一非空完整 next_decision，proposal_filled=false，auto 零 marker |
| UT-S09-163 | compatibility required 必须匹配用户决定并输出完整问题 | 必选类别匹配 | `compatibility=required` 且有完整 compatibility unresolved | 分别提供无决定、policy 决定、user 决定 | 无决定/policy 均返回专属 reason+完整 next；仅 user 决定满足并移除对应 unresolved |
| UT-S09-164 | security_privacy required 可恢复 pending | 必选类别匹配 | `security_privacy=required`、缺 user 决定、有完整同类 unresolved | status/next/auto 派生 | 专属 reason、同一完整 next_decision、auto 零 marker |
| UT-S09-165 | 部署字段派生 deployment 必选类别与完整问题 | proposal 部署解析 | “是否需要部署：是”，impacts 全 none，无 user 决定，有完整 deployment unresolved | status/next/auto 派生 | required_categories 含 deployment；专属 reason、同一完整 next、auto 零 marker |
| UT-S09-166 | public_release 映射 release 类别并输出完整问题 | 必选类别匹配 | `public_release=required`，有完整 release unresolved | 分别提供 deployment/user 与 release/user | deployment 不能满足并返回 release 专属 reason+完整 next；release/user 满足 |
| UT-S09-167 | external_commitment 可恢复 pending | 必选类别匹配 | `external_commitment=required`、缺 user 决定、有完整同类 unresolved | status/next/auto 派生 | 专属 reason、同一完整 next_decision、auto 零 marker |
| UT-S09-168 | 推荐答案或非 user source 不得冒充决定 | 必选类别匹配 | required 类别有完整同类 unresolved，另有 recommendation、repository_fact 或 policy 决定 | 派生 | required 仍未满足，使用队首类别专属 reason 并保持完整 next |
| UT-S09-168a | 必选类别缺对应 unresolved 判 invalid | 闭环校验 | `data=required`、无 data/user 决定且 unresolved 为空；另测同类 unresolved 重复 | status/next/auto 派生 | `status=invalid`、reason=`clarification-contract-invalid`、next=null、auto 零 marker；不形成不可恢复 pending |
| UT-S09-169 | none 加合法理由不产生问答 | 必选类别匹配 | 五类 none+reason、无需部署、无语义未决 | 派生 | required_categories=[]，允许 complete |
| UT-S09-170 | required_categories 去重与固定排序 | JSON 派生 | unresolved 与 impacts 重复覆盖多个类别 | 派生 | 按 product→ownership→data→compatibility→security_privacy→deployment→release→external_commitment→acceptance 去重输出 |

### 14.3 完成谓词与 CLI JSON

| ID | 测试名称 | 测试对象 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-171 | proposal_filled 加强谓词全真路径 | proposal-lifecycle | 原字段、UI/部署、clarification、必选决定均合法且 unresolved=[] | 计算 | proposal_filled=true，proposal_step 可进入 ready-to-delta |
| UT-S09-172 | status 输出完整 clarification | status JSON builder/schema | pending C02 | `status --format json` | plan_state.clarification 含 schema/mode/status/required/required_categories/count/id/reason/完整 next_decision，并通过 schema |
| UT-S09-173 | next 与 status clarification 同义 | next JSON builder/schema | 同一项目快照 | 分别构造 status/next data | clarification 深层语义一致，next 不自行重排/删字段 |
| UT-S09-174 | 队首依赖未满足直接判契约非法 | 队列拓扑校验 | `unresolved[0]=C02` 且其依赖不在 decisions，C03 虽可回答 | status/next 派生 | `clarification-contract-invalid`、next=null；CLI 不跳到 C03、不重排 proposal |
| UT-S09-174a | 稳定拓扑序三方选择同一队首 | 队列排序/builder | 多个依赖已满足项，类别与 CXX 不同；proposal 已按固定规则排序 | status、next、新进程重读 | 三者均选择 `unresolved[0]` 同一 CXX；required_categories 顺序一致 |
| UT-S09-175 | auto pending 不写任何批准 marker | next auto gate | pending 高影响决定 | 执行 auto 派生（marker writer 打桩） | 不写 PLAN_APPROVED/GATE_AUTO_PASSED，不进入 write-tasks/delta，返回稳定 reason |
| UT-S09-176 | 跨进程重读状态一致 | proposal 文件事实源 | 进程 A 写 decisions/unresolved 后退出 | 进程 B 重新读取 | status、required_categories、队首 CXX、proposal_filled 与 A 一致 |

### 14.4 模板与历史兼容

| ID | 测试名称 | 测试对象 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-177 | 新提案模板默认含合法区块 | i18n proposal 模板 | zh/en locale | 生成 proposal | 两种语言均含 schema、五类 impacts、空数组和合法默认值；结构字段名一致 |
| UT-S09-178 | writing legacy 缺区块仅提示补齐 | legacy 兼容 | 未越过 plan、无 clarification 区块 | status/next | 保持 writing，输出补齐提示；status/next 不自动改写 proposal |
| UT-S09-179 | 已越过 plan 历史提案不回退 | legacy 兼容 | 已有 PLAN_APPROVED 或更后步骤、无区块 | 派生 | 不回退 write-proposal，不改变既有 marker |
| UT-S09-180 | 未知 clarification schema 原样表示并保守停止 | schema 版本协商 | `openlogos/clarification@2` | status/next/schema 校验 | 原样输出 @2、status=invalid、required=true、空 categories/零计数/null next、reason=upgrade-required；两响应通过 1.2 Schema |
| UT-S09-181 | change-lint 汇总结构与类别不一致 | change-lint | 同时含空 reason、required 未匹配与部署缺决定 | lint 纯函数 | 返回确定性 violation 列表与修复提示，不修改 proposal |

### 14.4a JSON Schema 与共享 builder 跨字段负向用例

| ID | 测试名称 | 测试对象 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-182 | complete 矛盾组合被 Schema 拒绝 | status/next schema | complete + required=true + categories 非空 + count=1 | 校验 | 两份 Schema 均拒绝 |
| UT-S09-183 | pending 缺完整当前问题被 Schema 拒绝 | status/next schema | pending + next_decision_id/next_decision=null 或 count=0 | 校验 | 两份 Schema 均拒绝 |
| UT-S09-184 | invalid 归一化分支通过 Schema | status/next schema | invalid + required=true + 空 categories + count=0 + null next + 合法 invalid reason | 校验 | 两份 Schema 均通过 |
| UT-S09-185 | next_decision ID 不相等被共享 builder 拒绝 | status/next clarification builder | next_decision_id=C01、next_decision.id=C02 | 构造响应 | builder/契约校验拒绝，status/next 不得发出；记录该相等约束非标准 Schema 能力 |
| UT-S09-186 | required_categories 非规范顺序被共享 builder 拒绝 | status/next clarification builder | `[deployment,data]` | 构造响应 | builder 规范化或负向校验拒绝；最终只能输出 `[data,deployment]`，status/next 同义 |
| UT-S09-187 | unknown @2 invalid 是 1.2 Schema 正例 | status/next schema | UT-S09-180 归一化对象 | 校验 | 两份 Schema 均通过，schema 字段保持 @2 |

### 14.5 场景测试用例

| ID | 测试名称 | 场景 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| ST-S09-60 | 简单变更零额外问答直通 | write-proposal 主路径 | facts 充分、五类 none+reason、无需部署 | change-writer 写 complete proposal 后新进程读取 status | proposal_filled=true，可达 write-tasks；无 clarification_required |
| ST-S09-61 | 部署方案未确认以完整问题阻塞 plan | EX-9.7 | proposal 声明部署是，无 deployment/user 决定，有一个完整 deployment unresolved | status/next/next-auto | 三者均保持 write-proposal并输出同一完整 next；auto 不写 marker；reason=`deployment-clarification-required` |
| ST-S09-62 | 依赖决策逐个持久化并恢复 | 主路径 | ownership C01 后才可回答 data C02 | 提交 C01，退出并重启，再读取 | C01 在 decisions；仅 C02 成为 next_decision；不会一次输出两问 |
| ST-S09-63 | 数据迁移 required 经过用户决定后完成 | data 条件触发 | data=required，C01 pending | 用户回答并由 Agent 持久化 source=user | required 匹配、队列清零、其它条件满足时 proposal_filled=true |
| ST-S09-64 | 部署与公开发布双必选互不替代 | EX-9.8 | 部署是且 public_release=required | 先只确认 deployment，再确认 release | 第一步仍阻塞 release；第二步两类均满足；决定和授权边界可审计 |
| ST-S09-65 | `next --auto` 不回答 recommendation | auto fail-closed | compatibility required、next_decision 有推荐 | 连续两次 next --auto | 两次均同一 CXX、proposal 字节与批准 marker 不变，无自动选项漂移 |
| ST-S09-66 | 非法区块跨 status/next 一致失败 | EX-9.10 | 缺 impact 字段且 complete+unresolved | status 与 next JSON | 均返回 clarification-contract-invalid，前沿一致保持 write-proposal |
| ST-S09-67 | writing legacy 补齐后启用严格校验 | 历史兼容 | legacy writing proposal | 先读取提示，再由 change-writer 写区块，再读取 | 第一次不改文件；第二次按 @1 严格判定；无隐式迁移 |
| ST-S09-68 | RunLogos 消费所需字段由 CLI 一次给全 | OpenLogos 宿主契约 | pending C02 | next --format json | 完整问题、影响、推荐、理由、options、required_categories 在同一响应；宿主不需读 proposal |
| ST-S09-69 | 新进程恢复不会重新询问已确认决定 | 跨会话恢复 | C01 已确认、C02 未决 | 关闭并重启 CLI/测试进程 | 不再展示 C01；C02 ID 与内容稳定；decisions 不丢失 |
| ST-S09-70 | 手动与 auto 执行授权均不替代方案决定 | 授权分层 | 同一 pending 提案分别走手动 next 与 next --auto | 派生前沿 | 两种模式均要求用户回答；仅 clarification complete 后才按各自 gate 语义继续 |
| ST-S09-71 | required 缺 unresolved 端到端 fail-closed | F1 非法闭环 | data=required、无决定、unresolved=[] | status/next/next-auto | 三者输出 invalid/contract-invalid/null next，前沿 write-proposal，auto 零 marker；宿主不收到不可回答 pending |
| ST-S09-72 | unknown @2 端到端可表示且零副作用 | EX-9.12 | proposal schema=`openlogos/clarification@2` | status/next/next-auto + 随包 Schema 校验 | 原样 @2 invalid 响应均通过 Schema；reason=upgrade-required，前沿 write-proposal，proposal/marker 字节不变 |

### 14.6 覆盖度校验

- [ ] YAML/impacts/category/CXX/依赖结构：UT-S09-152～UT-S09-161
- [ ] 六类条件性必选决定、闭环与排序：UT-S09-162～UT-S09-170、UT-S09-168a
- [ ] 完成谓词、JSON、auto、拓扑队首、跨进程：UT-S09-171～UT-S09-176、UT-S09-174a
- [ ] 模板、legacy、未知版本、lint：UT-S09-177～UT-S09-181
- [ ] Schema oneOf 与共享 builder 跨字段约束：UT-S09-182～UT-S09-187
- [ ] 简单直通与逐问依赖：ST-S09-60、ST-S09-62、ST-S09-63
- [ ] 部署/发布分离与 auto fail-closed：ST-S09-61、ST-S09-64、ST-S09-65、ST-S09-70
- [ ] 非法契约、legacy、宿主消费和恢复：ST-S09-66～ST-S09-69、ST-S09-71、ST-S09-72

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

## S09 合并事务单一权威测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S09-233 | canonical plan 稳定性 | target 排序、mode、source/before、producer/validator 相同则 plan_hash 相同 |
| UT-S09-234 | plan 漂移 | 任一 canonical identity 改变产生新 plan_hash，旧 transaction 不接受 |
| UT-S09-235 | opaque identity | target_ref/slot_id 不泄漏可写正式路径且由冻结算法稳定派生 |
| UT-S09-236 | slot allowlist | 仅声明 write_path 可写；额外、重复、逃逸、symlink 全部拒绝 |
| UT-S09-237 | 原子替换 | 半写与遗留临时文件不能被 seal；合法 rename 后可读取完整字节 |
| UT-S09-238 | slot 边界 | 缺失、空、超限、非法编码分别返回稳定 waiting/retryable code |
| UT-S09-239 | validator 重试 | 内容语义失败保持 collecting，同 transaction 可替换后重试 |
| UT-S09-240 | seal 冻结 | seal 后 slot hash 和字节不可改变，漂移触发 fatal |
| UT-S09-241 | apply 全批成功 | resources、metadata、dogfood、test change set、receipt、marker 全部提交 |
| UT-S09-242 | apply 回滚 | 每个故障注入点均恢复 MODIFY、删除 CREATE/marker并恢复 counter/index |
| UT-S09-243 | journal 前滚 | marker 前 response lost 后恢复到唯一 completed receipt |
| UT-S09-244 | 幂等调用 | 重复 seal/apply/status 不重复写入且返回相同 identity/receipt |
| UT-S09-245 | no-delta | 零 slot transaction 仍生成 completed receipt 和绑定 marker |
| UT-S09-246 | UI prototype | 原型 target/receipt 必须绑定同一 plan_hash，漂移时 apply 拒绝 |
| UT-S09-247 | OpenLogos producer | decision/counter/index/dogfood/test change set 不分配 Agent slot |
| UT-S09-248 | commit_paths | receipt 只含正式产物，排除 slot/journal/staging/backup |
| UT-S09-249 | 旧命令断代 | `merge-apply --manifest` 固定非零且零正式副作用 |
| UT-S09-250 | 命名空间隔离 | Plan completion receipt/journal/dispatch 不改变 merge phase |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-91 | 纯 CREATE transaction | Agent 写 slot→seal→apply→completed，目标与 marker 同批出现 |
| ST-S09-92 | 纯 MODIFY transaction | before/final hash 校验并原子替换，receipt 可重读 |
| ST-S09-93 | CREATE/MODIFY/metadata 混合 | 20+ 多根目标、counter/index 与 dogfood 全批一致 |
| ST-S09-94 | validator 修复闭环 | 第一次 seal retryable，替换 slot 后同 transaction 完成 |
| ST-S09-95 | no-delta/UI 分支 | 两者均产生同形 transaction receipt，无旁路 marker |
| ST-S09-96 | apply 崩溃与恢复 | 故障点重启后只得到全旧或全新，不存在半新成功 |
| ST-S09-97 | response lost | apply 已完成但响应丢失，重试返回同 receipt且不重复 commit |
| ST-S09-98 | RunLogos 权限边界 | Agent/Driver 对正式 target、metadata、marker 零写入，只消费公共动作 |

### Runner 与 Reporter

- UT 使用 Vitest 覆盖状态机、plan/hash、slot、validator、journal、receipt 和旧命令拒绝。
- ST 必须通过真实 CLI 子进程和隔离临时项目执行；不得 mock transaction 输出、手工 target/marker 或预造 completed receipt。
- 每个 ID 必须通过 OpenLogos reporter 追加到 `logos/resources/verify/test-results.jsonl`；故障注入证据包含 transaction_id、phase、stable code 与目标树 hash，但不得泄露绝对临时路径或敏感内容。

## S09 公共 staging、abort 与 completed receipt 测试用例


### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S09-251 | 公共 slot descriptor | 每个 slot 稳定返回 `slot_id/target_ref/staging_path/required/content_encoding/max_bytes/write_protocol/submitted_sha256`，不泄漏 canonical target 写权 |
| UT-S09-252 | submit 路径等值 | `submit-content --file` 仅接受声明 `staging_path`；其它路径、逃逸、symlink 与 canonical target 均在首写前失败 |
| UT-S09-253 | staging 写协议 | 仅同目录临时文件原子 rename、UTF-8 raw、字节上限及提交后 SHA-256 全部满足时接收 |
| UT-S09-254 | abort phase allowlist | 只在 collecting/ready/sealed 接受 abort；applying/recovering/completed/failed 均拒绝新 abort |
| UT-S09-255 | abort 终态与清理 | 成功后固定为 failed/aborted，动作清空、receipt=null，并清理本事务 staging/临时/备份私有制品 |
| UT-S09-256 | abort 幂等 | 同一已 aborted transaction 重复 abort 返回同 identity 与 `aborted_at`，不新增写入或清理外部路径 |
| UT-S09-257 | receipt 无环身份 | `receipt_sha256` 只对排除自身字段的 canonical receipt payload 计算；receipt 不包含自身或 marker 的 file hash |
| UT-S09-258 | completed 提交闭包 | `final_hashes.paths` 与 `artifact_hashes.paths` 互斥，二者并集精确等于 `commit_paths` |
| UT-S09-259 | response-lost 重建 | completed 响应丢失后新进程返回同 receipt、`receipt_sha256`、artifact hashes 与完成时间 |
| UT-S09-260 | 私有制品排除 | slot/journal/staging/temp/backup 不进入 final/artifact hashes 或 commit_paths，完成或 abort 后按合同清理 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-99 | staging→submit→seal→apply | Agent 原子写声明 staging path，Driver 以同路径 submit，最终得到合法 completed receipt 与精确提交闭包 |
| ST-S09-100 | abort 清理闭环 | collecting、ready、sealed 三夹具可 abort；重复 abort 幂等，正式 target/metadata/marker 均不变 |
| ST-S09-101 | response-lost 精确回放 | apply 已完成但响应丢失，新进程只读恢复同一 receipt/hash/commit paths，不重做 apply 或生成第二 receipt |

### Runner、Reporter 与追溯

- UT 使用临时项目、路径逃逸/symlink 负例、canonical JSON 与故障注入；ST 必须走真实 CLI 子进程，禁止预造 receipt。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；evidence 记录脱敏 transaction/receipt/hash、前后树 hash 与清理结果。
- staging：UT-S09-251～253、ST-S09-99；abort：UT-S09-254～256、ST-S09-100；receipt：UT-S09-257～260、ST-S09-101。

## S09 Seal Preflight、Legacy Reopen 与崩溃边界测试


### 单元测试

| 用例ID | 验证目标 | Fixture/故障注入 | 关键断言 |
|---|---|---|---|
| UT-S09-261 | 新事务seal前preflight拒绝 | ready事务的after测试表列数歧义 | seal不产生；phase=collecting；问题slot missing；正式树、journal、apply staging/backup、receipt/marker零变化 |
| UT-S09-262 | 0.14.1 legacy sealed局部reopen | 无preflight record、15个sealed Agent slots，其中一个内容错误 | 同transaction/plan/target-set；只错误slot submitted hash清空；其余14个保留；外层seal与全部sealed hash清空 |
| UT-S09-263 | 结构化多target归因 | 两个可修复Agent target错误、mixed/OpenLogos/unknown对照组 | 全Agent且唯一映射时共同missing；任一不可归因时一个slot也不清；不解析message文本 |
| UT-S09-264 | reopen崩溃一致性 | transaction atomic rename前/后及私有cleanup中fault injection | rename前完整sealed；rename后完整collecting；残留私有字节非权威；未受影响slot不删除 |
| UT-S09-265 | 首写后不可逆边界 | applying、journal prepared/committing、receipt/marker和正式新字节参数化fixture | 全部分支禁止reopen，只暴露recover/稳定fatal；transaction不倒退collecting |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S09-102 | 新/旧事务真实CLI生命周期 | subprocess创建新事务验证seal reject；加载legacy sealed fixture触发reopen、修正、submit、reseal、apply | 新事务错误不sealed；legacy同transaction最终completed；receipt/marker/final hashes有效 |
| ST-S09-103 | response-lost与重复修复 | reopen响应丢失、status恢复、第一次修复仍失败、第二次修复通过 | 每轮只退回真实rejected slots；其它hash守恒；重复seal/apply幂等；不abort/新建事务 |

### 追溯

UT-S09-239继续锚定一般validator重试；UT-S09-240/242/243继续锚定seal、apply rollback和journal恢复。本节用例专门覆盖跨target preflight、legacy兼容和状态先落盘顺序。

### Runner 与 OpenLogos Reporter

Vitest/subprocess runner必须逐个执行UT-S09-261～265、ST-S09-102～103。每个ID独立写`test-results.jsonl`；测试名、fixture和reporter ID一一对应，禁止一个happy-path函数无条件为全部ID报PASS。
