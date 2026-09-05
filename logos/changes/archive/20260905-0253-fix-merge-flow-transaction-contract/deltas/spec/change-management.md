## MODIFIED — 变更工作流

> **核心原则（两档模式）**：`openlogos merge`、`openlogos verify`、部署执行、`openlogos smoke`、`openlogos archive` 和 `git push` 在**半自动 / 手动模式（无 `--auto`）**下是人类确认点——AI 可提醒、解释、准备命令；未经用户明确授权不得执行，不得在"顺手完成流程""按流程走完"等隐式场景中自动触发；用户以明确请求或 slash command 授权时可代为执行。在**全自动 / 无人值守模式（`openlogos next --auto`）**下，用户选择 `--auto` 即构成对该提案全链路的 **standing run-scoped 授权**：上述确认点中**代码已绿之后的盖章 / 发布动作**——`verify`、部署执行、`smoke`、`archive`、`git push`——以及可跳 flow 门（含 merge 的 `spec-exit`）**自动放行执行**，每次放行向 `GATE_AUTO_PASSED` 追加审计行。
>
> **无人值守模型（统一）**：launched flow 中的人类停顿点按性质分三类，`--auto` 区别对待：
>
> 1. **可跳 flow 门**（`plan` 出口 `plan-exit` 批准方案、`spec` 出口 `spec-exit` 审 delta + 授权合并、`slice` 出口 `slice-exit` 切片待批准、`deliver` 入口 `deliver-entry` 部署执行，均 `skippable:true`）：`--auto` 自动放行（既有行为不变）；放行依据是**本次 `--auto` 响应的 `gate_auto_passed=true`**（live 决策），每次放行写 `GATE_AUTO_PASSED`（append-only 审计、历史审计行不构成对后续动作的授权）。
> 2. **代码已绿后的盖章 / 发布红线步骤**（`verify`、`smoke`、`archive`、`git push`——非 skip-gate flow 门，由 CLI / 宿主 driver 驱动）：`--auto` 下由 **standing run-scoped 授权**自动执行（选择 `--auto` 即授权至 `archive`），每次执行写 `GATE_AUTO_PASSED` 审计行。其中 `git push` **无需任何 marker / guard 改动**——PreToolUse guard 的 Bash 命令安全白名单本就放行 `git push`（`^git push` 在 guard-check 的安全模式内），guard 从不拦截 `git push`；唯一约束是生成的指令文本（AGENTS.md/CLAUDE.md）：全自动下指令文本授权 AI 自动 push，半自动 / 手动下指令文本要求人工确认。
> 3. **硬红线（任何模式、含 `--auto` 都绝不自动放行）**：`gate:implement:loop-exhausted`（达迭代上限仍未过测试的未收敛 / 未绿代码）。其默认 `skippable:false`、即使 `--auto` 也照常阻塞、仅 overlay `set-loop` 的 `set.exhausted_gate.skippable:true` 可单点 opt-in 放行——这套逻辑**完整保留、一字不改**。放行未收敛代码与「全自动发布的是已验证成果」的前提直接相悖，故 `loop-exhausted` 是该前提的守门人，永不纳入全自动放行。
>
> **默认 / 手动模式（无 `--auto`）行为完全不变**：merge / verify / 部署执行 / smoke / archive / git push 全部停在对应人类确认点等明确授权（部署目标可能是测试环境而非生产，故 deliver 门纳入可跳门）。**R2 安全闸保留**：仍卡在未完成 overlay 节点时，任何放行（含可跳门）都不触发。
>
> **规格驱动代码**：代码实现必须在规格合并进主文档之后才能开始，不允许基于 delta 草稿直接写代码。

```
1. 创建变更提案（CLI）
   └── openlogos change {slug}
   └── 生成 logos/changes/{slug}/proposal.md + tasks.md + deltas/
   └── 写入 logos/.openlogos-guard，锁定当前活动提案

2. AI 辅助填写提案（change-writer Skill）
   └── AI 分析影响范围，填写 proposal.md 和 tasks.md（plan 段只产 [delta]/[deploy]，不划分 [code] 切片）
   └── 等待用户确认提案内容后，才开始产出 delta

3. 按 tasks.md 逐项产出 Delta 文件（各阶段 Skill）
   └── 每完成一项任务，将增量变更写入 deltas/ 对应子目录
   └── AI 每完成一项任务后，立即将 tasks.md 中该项从 [ ] 更新为 [x]
   └── 对应 proposal_step: delta-writing

4. 审核变更提案
   └── 团队/自审 proposal.md 和 delta 文件
   └── delta 任务全部勾选且存在可合并 delta 后，对应 proposal_step: ready-to-merge

5. 开启合并事务（CLI）【人类确认点；--auto 下 spec-exit 门自动放行】
   └── openlogos merge {slug}
   └── 校验 deltas/（守恒 L8、模板骨架等）后创建合并事务 MERGE_TRANSACTION.json（phase: collecting）
   └── 成功后置条件二分（跨仓合同）：no-delta 提案当场写 SPEC_MERGED、前沿即进；
       有 delta 提案创建（或幂等返回既有非终态 / 终态归档让位后重建）事务——
       exit 0 + 事务在盘且 phase 合法 = 本跳成功，前沿推进 merge-generated、停在 apply 前为合法中间态
   └── 对非终态事务重跑 merge 幂等返回现状，不重复创建
   └── legacy 测试模式（NODE_ENV=test + 内部开关）仍生成 MERGE_PROMPT.md / MERGE_PROMPT_GENERATED，仅供 0.13.x 合同回归；生产路径不产生这两个文件

6. AI 执行合并（merge-executor Skill）
   └── merge-executor 按事务合同逐 slot 提交最终内容：
       openlogos merge transaction submit-content → seal → apply
   └── apply 原子落盘主文档（logos/resources/）、metadata 与 receipt，并由事务最后写入 SPEC_MERGED，
       表示“主规格已合并，可以开始切片规划/代码实现”
   └── 合并完成后，AI 自动 commit 规格文档变更（告知用户，无需确认）
   └── commit message 格式：docs({slug}): merge spec deltas

7. 切片规划（slice-planner Skill）【slice 出口 slice-exit 为人类确认点；无人值守 --auto 下可放行】
   └── 前置 auto-reset（enforce-slice-stage-ordering）：进入本步骤前，CLI 已在「进入 slice 段」的确定性动作上自动清理任何提前填充的 [code]——有 delta 提案于 openlogos merge 时、纯代码提案于 plan 门放行（写 PLAN_APPROVED）时，把 [code] 重置为占位并把旧内容备份到提案目录 CODE_AUTORESET（append-only jsonl，可追溯）；故 slice-planner 恒从空 [code] 开始划分。清理幂等、不阻断流程、无人值守自愈（见 spec/flow-spec.md §12.7）
   └── 仅当提案 code_required（tasks.md 有非空 [code] section）时进入；纯文档提案整段跳过，直接进入步骤 8/9
   └── slice-planner 以已合并的规格 + 真实 UT/ST 测试 ID 为输入，逐片过「删后续证伪门」划分 [code] 切片
   └── [code] 切片为「唯一事实源」，下游 code-implementor 忠实逐片消费、不重新分批
   └── 对应 proposal_step: ready-to-implement
   └── slice 出口「切片待批准」门：默认/手动模式须人类确认后进入实现；无人值守 --auto 模式自动放行 slice-exit（写 SLICES_APPROVED marker + 追加 GATE_AUTO_PASSED 审计行），放行后前移到 coding

8. 实现代码（code-implementor Skill）
   └── 按合并后的主文档与 slice-planner 写定的 [code] 切片，逐片实现业务代码 + 测试代码 + OpenLogos reporter
   └── 代码实现完成后，AI 自动 commit 代码变更（告知用户，无需确认）
   └── commit message 格式：feat/fix({slug}): implement changes

9. 运行验收（CLI）【人类确认点；--auto 下 standing 授权自动运行】
   └── 用户运行 openlogos verify，生成验收报告
   └── 无人值守 --auto 模式：由 standing 授权自动运行 verify，写 GATE_AUTO_PASSED 审计
   └── 验收通过（PASS）→ 继续步骤 10
   └── 验收失败（FAIL）→ 修复代码后重新运行，不需要重走 merge 流程
   └── ⛔ 若 loop 激活且达上限仍未收敛（loop-exhausted），--auto 照常阻塞、绝不放行未绿代码（硬红线）

10. 部署执行（如需要）【人类确认点；无人值守 --auto 下可经 deliver 门自动放行】
   └── 仅当 VERIFY_PASS 存在、提案级 `是否需要部署：是` 且 tasks.md 有 [deploy] section 时进入
   └── 默认/手动模式：用户必须明确授权 AI 执行部署
   └── 无人值守 --auto 模式：deliver 入口门 skippable:true，openlogos next --auto 自动放行该门，以本次响应 gate_auto_passed=true 为本次部署的放行依据（追加 GATE_AUTO_PASSED 审计行；历史审计行不构成后续授权），AI 据此执行本次部署
   └── AI 必须读取合并后的部署方案文档和 [deploy] section
   └── 部署完成后生成 logos/resources/verify/deployment-report.md
   └── 部署完成后写入 logos/changes/{slug}/DEPLOY_DONE
   └── 部署失败时不得写入 DEPLOY_DONE，应输出失败点和回滚建议

11. 运行部署后冒烟测试（CLI）【人类确认点；--auto 下 standing 授权自动运行】
   └── 仅当提案级 `是否需要 smoke：是` 且 DEPLOY_DONE 存在时运行 openlogos smoke
   └── 默认/手动模式：AI 未经明确授权不得自动运行 smoke
   └── 无人值守 --auto 模式：由 standing 授权自动运行 openlogos smoke（写 GATE_AUTO_PASSED 审计）；前置门禁（VERIFY_PASS / DEPLOY_DONE / [deploy] 全勾 / smoke_required）与 sandbox/runner 覆盖判定均不变
   └── openlogos smoke 读取 smoke 结果并生成 logos/resources/verify/smoke-report.md
   └── 冒烟通过写入 SMOKE_PASS
   └── 冒烟失败写入 SMOKE_FAIL
   └── SMOKE_PASS 后才能归档提案；无需 smoke 的提案在部署完成后可归档

12. 归档变更（CLI）【人类确认点；--auto 下 standing 授权自动归档】
   └── openlogos archive {slug}
   └── 默认/手动模式：AI 未经明确授权不得自动归档
   └── 无人值守 --auto 模式：由 standing 授权自动 archive（写 GATE_AUTO_PASSED 审计）
   └── 将 logos/changes/{slug}/ 移入 logos/changes/archive/
   └── 若当前 guard 指向该提案，则删除 logos/.openlogos-guard
   └── 归档完成后，AI 自动 commit 归档变更（告知用户，无需确认）
   └── commit message 格式：chore({slug}): archive change proposal

13. 推送到远端（Git）【人类确认点；--auto 下由 standing 授权自动 push】
    └── 默认/手动模式：AI 提示用户确认是否执行 git push，未获授权不得自动推送
    └── 无人值守 --auto 模式：archive 完成后由 standing 授权自动 push（写 GATE_AUTO_PASSED 审计）
    └── git push 无需任何 marker / guard 改动：PreToolUse guard 安全白名单本就放行 git push，唯一约束是指令文本，全自动放开即可
```

**merge 中间态与前沿推进（fix-merge-flow-transaction-contract）**：有 delta 提案在步骤 5 成功后、步骤 6 apply 完成前，`SPEC_MERGED` 尚未落盘、前沿停在 `apply-merge` 节点——这是**合法中间态**，宿主不得判失败；`proposal_step` 于开事务后即推进 `merge-generated`（权威事实 = `MERGE_TRANSACTION.json` 在盘，见 `spec/flow-spec.md` 与架构「四十七」），`status` / `next` 在活跃事务在场时必挂 `data.merge_transaction` 只读投影供分流（契约见 `spec/cli-json-output.md`）。

### commit 粒度规则

| 变更类型 | commit 策略 |
|---------|------------|
| 需求级 / 设计级变更 | 至少 3 个 commit：规格（Step 6）+ 代码（Step 8）+ 归档（Step 12） |
| 接口级变更 | 至少 2 个 commit：规格+代码合并（Step 6 / 8）+ 归档（Step 12） |
| 代码级修复 | 至少 2 个 commit：代码（Step 8）+ 归档（Step 12） |

## MODIFIED — MERGE_PROMPT.md 文件规范

> **legacy 范围（fix-merge-flow-transaction-contract）**：自 0.14.x 起本节仅适用于 **legacy 测试模式**（`NODE_ENV=test` + 内部开关，供 0.13.x 合同回归）；生产路径的 `openlogos merge` 走合并事务（`MERGE_TRANSACTION.json` → submit-content → seal → apply），**不生成本节文件**。守恒 / 模板骨架等校验失败时生产路径同样拒绝创建事务（错误文案中「拒绝生成 MERGE_PROMPT」在事务语义下等价于「拒绝创建合并事务」）。

`openlogos merge` 命令（legacy 测试模式）自动生成的指令文件，结构如下：

```markdown
# Merge Instruction

## 变更提案
- 提案名称：{slug}
- 提案目录：logos/changes/{slug}/

## 提案内容
[从 proposal.md 中读取的完整内容]

## 需要合并的 Delta 文件

### 1. {delta-relative-path}
- Delta 文件：`logos/changes/{slug}/deltas/{category}/{relative-file}`
- 目标目录：`{target-dir}/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求
1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   `git add -A && git commit -m "docs({slug}): merge spec deltas"`
9. 写入 `logos/changes/{slug}/SPEC_MERGED`
   然后提示用户：按更新后的规格实现代码；代码完成后运行 `openlogos verify`；如有 `[deploy]` section，验收通过后由用户明确授权部署，再运行 `openlogos smoke`；最后明确授权执行 `openlogos archive {slug}`。
```

## MODIFIED — AI Skills 集成

- **change-writer**：在 `openlogos change` 后使用，辅助填写 proposal.md 和 tasks.md
- **merge-executor**：在 `openlogos merge` 后使用——生产路径按合并事务合同逐 slot 提交最终内容（submit-content → seal → apply，`SPEC_MERGED` 由事务写入）；legacy 测试模式读取 MERGE_PROMPT.md 执行实际合并


## MODIFIED — 决策记录沉淀（S38，decision-record-capability）

**目的**：把设计决策的**理由**从「只活在 archive 的 proposal 变更原因里」沉淀为 `logos/resources/decisions/` 下可检索的活文档。archive 归档后仅供审计、可删除（S37），若决策理由只活在 proposal 里则归档即失联；决策记录使「为什么这样设计」成为当前有效规格的一部分。

**「变更原因」与「决策记录」分工（升格判据）**：
- **变更原因**：`proposal.md` 每案必填的叙述性动机，留在 proposal / archive，**不机械复制进 resources**。
- **决策记录**：`logos/resources/decisions/` 下**少数**值得长期复盘的拍板。满足任一即升格——① 立了未来变更必须遵守的不变量 / 约束；② 在真实备选间取舍且被否项可能被重提；③ 跨多个规格 / 组件。一句话测试：「读合并后的规格本身能否还原这个 why？」能→不升格；会丢 why 与被否方案→才升格。bug 修复 / 机械重构 / 发版 bump / trivial 不升格。

**两阶段 bootstrap（delta-r1 F1）**：`deltas/decisions/` 是尚未注册的 delta 类别，现行 `delta-classify.ts` 会判 `delta_path_invalid`、`openlogos merge` 拒绝创建合并事务（legacy 测试模式下为拒绝生成 `MERGE_PROMPT`）；注册该类别属代码、只能 merge 后实现。故引入本能力的变更**先合并能力规格 + 在代码注册 `decisions` 类别与索引扫描**，**首条真实决策记录由后续变更**在注册上线后产出。

**流程接入（不强制、零负担、走既有 delta 通道；落盘所有者 = merge-executor）**：
1. change-writer 在 `proposal.md` 新增**可选**「已确定的设计决策」章节（每条含**拟定** `DXX`、决策一句话、理由摘要——拟定号不硬编，最终号由 merge-executor 按公式定）。
2. 含该章节的提案，`tasks.md` `[delta]` 必须规划 `deltas/decisions/<module>-DXX-<slug>.md` 决策记录 delta。
3. **`openlogos merge` 只校验 delta（含 `decisions` 类别合法性、S37 守恒 L8）+ 创建合并事务（legacy 测试模式为生成 `MERGE_PROMPT` / `MERGE_PROMPT_GENERATED`）——不写资源、不改计数器**。
4. **merge-executor 在 apply 时**（同一提交内）：按分配公式定号——`base = max(configured_next_id ?? 1, max(【已落盘】DXX，空集=0)+1)`（**基准只含已落盘、不纳入本批待落盘 DXX**，delta-r2 F5），候选按稳定序第 `i` 条 `expected_i = base + i`，校验「文件名==标题==`expected_i`」、拒重复 → 落盘决策记录到 `logos/resources/decisions/` → 持久化 `decision_counter.next_id = base + 候选数`（对齐 `scenario_counter` / `feature_counter` 的 AI 维护语义）→ 更新 `resource_index`（内容化 desc 由 `sync-resource-index.ts` 扩展扫描器生成）→ 事后 ID 点数自检通过后写 `SPEC_MERGED`。失败回滚（不提前消耗编号）、重试幂等。详见 `skills/merge-executor/SKILL.md`。
5. **不含该章节的提案，全流程行为与现状完全一致（零回归、零负担）**；**不新增 `openlogos decision` CLI 命令**。

**change-lint 提示（warning 级，不阻断门）**：proposal 含「已确定的设计决策」章节但 `[delta]` 无 `deltas/decisions/` 任务时，`openlogos change-lint` 产 warning（`decision_record_section_without_delta`），走独立 `warnings[]` 通道、**不改 exit code、不进 `ChangeLintViolationCode` 闭合枚举**；契约见 `spec/cli-json-output.md` §3.15（`warnings` 仅非空时出现、否则省略）。「是否值得记决策」是判断题、非机器可判定事实，故取 warning 而非 violation。

**守恒与 superseded 生命周期（承 S37 守恒门）**：`DXX` 纳入条目守恒门 ID 模式注册表，决策记录条目删除必须显式（`REMOVED` 删整条 / 同锚 `MODIFIED` + `REMOVED-ITEMS` 点名）。推翻旧决策**不删除**，用 `MODIFIED` 携整条剩余全量、仅把「状态」改为 `superseded by DYY` 并由新记录引用旧 `DXX`——决策历史留在 `logos/resources/decisions/` 活文档内、可检索、不依赖 archive。

**非目标**：不追溯为存量已归档提案补写决策记录；不强制所有提案产出决策记录；不实现 archive 保留策略 / `archive --prune`（issue #12 请求 2，团队已暂缓）。
