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
| UT-S09-297 | afterFileEdit 越界报告 | 报告含编辑路径、允许范围与固定「未被阻断（CLI 无 preToolUse）」声明；范围内编辑静默 |
| UT-S09-298 | 每次调用重读状态 | proposal_step 变化后下一次 hook 判定立即反映，无缓存 |
| UT-S09-299 | stdin 解析失败 fail-closed | shell 路径 deny；编辑路径产出「无法安全判断」报告 |
| UT-S09-300 | guard 缺失 fail-closed | 提案目录存在但 guard 缺失时 shell deny，提示先运行 openlogos change |
| UT-S09-301 | 决策服务异常 fail-closed | 抛异常时同 stdin 失败路径，退出码不伪装成功 |
| UT-S09-302 | cursor 协议字段转换 | 事件名/permission 字段/退出码符合 .cursor/hooks.json 契约；三接线共用同一共享决策服务实例逻辑 |

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
