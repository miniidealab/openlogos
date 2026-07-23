# Delta 变更管理规范

> 版本：0.3.0
>
> 本文档定义 OpenLogos 的 Delta 变更管理机制。每次功能迭代或 Bug 修复，先创建变更提案，审核通过后再合并回主文档。确保变更过程可追溯、可审核、可回滚。

## 核心原则

1. **不直接修改主文档**：每次变更先在 `logos/changes/` 中创建提案
2. **影响分析先行**：在 `proposal.md` 中明确变更范围和部署影响
3. **按需传播**：不是每次都全链路更新，只更新受影响的环节
4. **部署可追溯**：需要部署的提案必须产出部署 delta、部署任务和冒烟测试方案
5. **归档留痕**：变更完成后归档，保留完整历史
6. **guard 互斥**：同一时间只允许一个活动提案；存在活动 guard 时，必须阻止新的 `openlogos change`

## 目录结构

```
project-root/
└── logos/
    ├── resources/                    # 主文档（当前已生效的"真相"）
    │
    └── changes/                      # 变更提案工作区
        ├── add-remember-me/          # 一个变更提案
        │   ├── proposal.md           # 变更说明
        │   ├── tasks.md              # 实现任务清单
        │   └── deltas/               # 增量修改（Delta）
        │       ├── prd/
        │       ├── api/
        │       ├── database/
        │       └── scenario/
        │
        └── archive/                  # 已完成变更的历史归档
            └── add-remember-me/
```

> `logos/.openlogos-guard` 是活动提案锁文件。只要它指向 `logos/changes/` 下一个未归档提案，`openlogos change` 就必须拒绝创建新的提案，直到当前提案被 `openlogos archive` 归档后释放锁。

## 文件规范

### proposal.md

变更说明文档，必须包含：

```markdown
# 变更提案：[变更名称]

## 变更原因
[为什么要做这个变更？来源于哪个需求/反馈/Bug？]

## 变更类型
[需求级 / 设计级 / 接口级 / 代码级]

## 变更范围
- 影响的需求文档：[列表]
- 影响的功能规格：[列表]
- 影响的业务场景：[列表]
- 影响的 API：[列表]
- 影响的 DB 表：[列表]
- 影响的编排测试：[列表]

## 部署影响
- 是否需要部署：是 / 否
- 部署原因：[说明为什么需要或不需要部署]
- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]
- 是否涉及数据迁移：是 / 否
- 是否需要回滚预案：是 / 否

## 变更概述
[用 1-3 段话概述具体改什么]
```

`## 部署影响` 是人工审核依据。CLI 的部署状态判断以 `tasks.md` 的 `[deploy]` section 和提案目录标记文件为准，不解析自由文本作为唯一依据。

`## 部署影响` 同时也是提案级部署决策入口。CLI 应从该章节解析结构化决策，并与 `tasks.md` 的 `[deploy]` section 交叉校验：
- `是否需要部署：否` 时，不得创建 `[deploy]` section；verify PASS 后下一步为 archive。
- `是否需要部署：是` 时，必须创建 `[deploy]` section，并在 delta 阶段补齐部署方案影响；verify PASS 后下一步为人类确认部署。
- `是否需要 smoke：是` 只在已部署后生效；smoke 仍由 `openlogos smoke` 独立执行。
- 旧提案缺少结构化部署影响时，CLI 可回退到 `[deploy]` section 与模块级默认值，但必须标注兼容来源。

### tasks.md

实现任务清单，使用结构化 section 格式，每个 section 对应提案流程中的一个阶段。完整格式规范见 `spec/tasks-spec.md`。

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

Section 标记规则：
- `## [delta]` — delta 文档产出任务，该 section 全部勾选后可进入 `ready-to-merge`
- `## [code]` — 代码实现任务，直接修改源文件，不产出 delta
- `## [deploy]` — 部署执行任务，只能在 verify PASS 后、人类明确确认后执行
- 纯代码提案可只有 `[code]` section（无 `[delta]`），CLI 会直接跳过 delta-writing 阶段
- 不需要部署的提案不得创建 `[deploy]` section
- 旧格式（无 section 标记）向后兼容，降级为全局勾选判断

> **注意**：`openlogos verify` 和 `openlogos smoke` 是独立 CLI 操作节点，不应写入 tasks.md 作为可勾选任务。tasks.md 只追踪 delta、代码和部署执行任务。

### deltas/ 目录

增量修改文件，使用标记格式：

```markdown
## ADDED — [新增内容标题]
[新增的完整内容]

## MODIFIED — [修改内容标题]
[修改后的完整内容，替换主文档中同名章节]

## REMOVED — [删除内容标题]
[说明删除原因]
```

Delta 文件的目录结构映射主文档目录：
- `deltas/prd/` → 对应 `logos/resources/prd/` 的变更
- `deltas/api/` → 对应 `logos/resources/api/` 的变更
- `deltas/database/` → 对应 `logos/resources/database/` 的变更
- `deltas/scenario/` → 对应 `logos/resources/scenario/` 的变更
- `deltas/test/` → 对应 `logos/resources/test/` 的变更
- `deltas/spec/` → 对应项目根目录 `spec/` 的方法论规范变更
- `deltas/skills/` → 对应 `logos/skills/` 的 Skill 文档变更

部署方案 delta 使用 `deltas/prd/3-technical-plan/3-deployment/`，合并目标为 `logos/resources/prd/3-technical-plan/3-deployment/`。

`openlogos merge` 会递归扫描上述目录，保留子目录映射。例如 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 会合并到 `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`。

## 变更工作流

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

5. 生成合并指令（CLI）【人类确认点；--auto 下 spec-exit 门自动放行】
   └── openlogos merge {slug}
   └── 扫描 deltas/，生成 MERGE_PROMPT.md
   └── 写入 MERGE_PROMPT_GENERATED，表示“合并指令已生成，等待 AI 合并主规格”

6. AI 执行合并（merge-executor Skill）
   └── AI 读取 MERGE_PROMPT.md，逐个 delta 合并到主文档（logos/resources/）
   └── 合并完成后，AI 自动 commit 规格文档变更（告知用户，无需确认）
   └── commit message 格式：docs({slug}): merge spec deltas
   └── 写入 SPEC_MERGED，表示“主规格已合并，可以开始切片规划/代码实现”

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

### commit 粒度规则

| 变更类型 | commit 策略 |
|---------|------------|
| 需求级 / 设计级变更 | 至少 3 个 commit：规格（Step 6）+ 代码（Step 8）+ 归档（Step 12） |
| 接口级变更 | 至少 2 个 commit：规格+代码合并（Step 6 / 8）+ 归档（Step 12） |
| 代码级修复 | 至少 2 个 commit：代码（Step 8）+ 归档（Step 12） |

## 变更传播规则

不是每次变更都需要全链路更新。根据变更类型决定影响范围：

| 变更类型 | 最少需要更新 | 说明 |
|---------|------------|------|
| 需求级变更 | 全链路 + 部署影响分析 | 需求变了，所有下游都可能受影响 |
| 设计级变更 | 原型 + 场景 + API/DB + 编排 + 代码 + 部署影响分析 | 需求不变，实现方案调整 |
| 接口级变更 | API/DB + 编排 + 代码 + 部署影响分析 | 设计不变，接口细节调整 |
| 部署级变更 | 部署方案 + smoke 用例 + `[deploy]` 任务 | 发布平台、环境变量、迁移、回滚、健康检查变化 |
| 代码级修复 | 代码 + 重新验收 + 部署影响分析 | Bug 修复，不涉及设计变更时仍需判断是否需要重新部署 |

## 提案级部署决策优先级

部署与 smoke 的判断顺序如下：
1. 活跃提案存在时，优先读取 `proposal.md` 的 `## 部署影响`。
2. `tasks.md` 的 `[deploy]` section 是部署执行任务的结构化证据，必须与 `proposal.md` 一致。
3. `logos-project.yaml` 的模块级 `deployment_required` / `smoke_required` 是 Initial 阶段和历史提案的默认值，不得覆盖活跃提案的明确决策。
4. 文档-only 或规格-only 提案声明无需部署时，即使模块默认需要部署，verify PASS 后也直接建议 archive。
5. 部署决策缺失或冲突时，CLI 应输出警告，并采用保守策略：不自动部署，等待用户修正提案。
6. `deployment_decision_conflict=true` 时，deploy、smoke、archive 均不得作为主动作；用户必须先修正 `proposal.md` 或 `tasks.md`。

## Git 集成

- 每个变更提案对应一个 Git 分支：`change/{change-name}`
- 分支合并时，`logos/changes/{change-name}/` 同步移入 `logos/changes/archive/`
- 重大变更在文档顶部的"最后更新"时间戳中标注
- `logos/changes/archive/` 提供完整变更历史

### commit 时机与 message 规范

AI 在以下三个节点自动提交（告知用户，无需确认）：

| 节点 | commit message 格式 | 包含内容 |
|------|-------------------|---------|
| merge 完成后（Step 6） | `docs({slug}): merge spec deltas` | logos/resources/ 下的规格文档变更 |
| 代码实现完成后（Step 7） | `feat/fix({slug}): implement changes` | 业务代码 + 测试代码 |
| archive 完成后（Step 11） | `chore({slug}): archive change proposal` | logos/changes/archive/ 归档文件 |

push 是独立的人类确认点（Step 12），AI 必须等待用户明确授权后才执行。

## MERGE_PROMPT.md 文件规范

`openlogos merge` 命令自动生成的指令文件，结构如下：

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

## CLI 命令

```bash
# 创建变更提案
openlogos change add-remember-me

# 生成合并指令（由 AI 执行实际合并）
openlogos merge add-remember-me

# 归档已完成的变更
openlogos archive add-remember-me
```

## AI Skills 集成

- **change-writer**：在 `openlogos change` 后使用，辅助填写 proposal.md 和 tasks.md
- **merge-executor**：在 `openlogos merge` 后使用，读取 MERGE_PROMPT.md 执行实际合并

## no-delta spec-complete

纯代码提案（无 `[delta]` section）不进入 `write-delta`，但仍必须完成 spec-complete。spec-complete 的统一入口为：

```bash
openlogos merge <slug>
```

当提案没有 delta 文件时，`merge` 执行 no-op merge：

1. 不生成 `MERGE_PROMPT.md`；
2. 不修改主规格；
3. 写入 `logos/changes/<slug>/SPEC_MERGED`；
4. marker 内容标明 `type:"no_delta_spec_complete"`、`reason` 与 `completed_at`；
5. 已存在 `SPEC_MERGED` 时幂等返回。

### 生命周期位置

```text
plan → spec-complete(no-delta merge) → slice → implement → deliver → close
```

对于无 `[delta]` 的纯代码提案：

- `delta_required=false` 表示跳过 `write-delta`；
- `SPEC_MERGED` 表示 spec-complete 已完成；
- 缺 `SPEC_MERGED` 时，`next/status` 返回 `spec-complete-required`；
- spec-complete 后若缺真实测试 ID，`next/status` 返回 `test-id-required`；
- 只有两者满足后，才允许进入 `plan-slices`。

### 责任边界

- OpenLogos CLI 负责写入 no-delta `SPEC_MERGED`、派生前沿与诊断。
- `slice-planner` 负责保持严格前置，不绕过 marker 与真实测试 ID。
- RunLogos 等宿主只按 `next/status` 派发，不自行越级调用 `slice-planner`。

## 机器契约版本握手与消费方保守模式（contract-self-description）

`openlogos status` / `openlogos next` 的机器 JSON 输出是 runlogos 等 AI driver 判定推进 / 阻塞 / 终态的**判死依赖契约**。为消灭「driver 本地缓存的世界模型过期 → 弱信号误杀健康 run」整类问题，变更管理规范在此确立契约版本握手与消费方保守模式约定。

### 两个语境的显式区分（不推翻既有结论）

本规范「GUI 项目提案阶段前置 UI/UX 原型确认（proposal-ui-ux-first）」章节曾判定：runlogos 面板对 delta 路径下 `.html` 原型的 iframe 渲染「接口仅为『delta 路径下的 `.html` 文件』，无需版本握手」。**该结论在其原语境下继续成立、本章节不推翻它**。两个语境按消费方式区分：

- **文件路径接口（无需握手）**：面板渲染原型消费的是「约定目录下存在哪些 `.html` 文件」这一文件系统事实，接口面 = 路径约定本身，无结构化字段语义可漂移；误读的最坏后果是渲染缺失，不产生不可逆终态——无需版本握手。
- **status/next 机器契约（需要握手）**：driver 判死逻辑消费的是结构化 JSON 字段的**语义**（`proposal_step`、`step_meta`、`facts`、`loop_state`、`next_node.dispatch` 等），字段增删或挂出判据变更会使旧消费方的本地假设静默失效，误判后果是不可逆终态（误杀健康 run）——必须版本握手。

两者并存、互不覆盖。判断某接口是否需要握手，以「消费方是否依赖字段语义做不可逆决策」为准，而非一刀切。

### contract 版本握手（D1）

- status/next 的 `data` 顶层输出 `"contract": {"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本演进；与 envelope 既有 `version`＝CLI 版本串、flow 文件整数 schema `version` 是三个不同事物）。此前无 `contract` 字段的历史输出视为「0.x 前契约时代」。
- SemVer 规则：**major** = 必填字段删除/改义、闭合枚举语义变化（含移除值）、既有字段挂出判据变更；**minor** = 向后兼容扩展（新增可选字段、闭合枚举新增值）；**patch** = 不改形态与语义的澄清。
- 版本-schema 一一映射：`spec/schema/status.schema.json`、`spec/schema/next.schema.json` 内嵌契约版本号，随 npm prepack 打包；响应 `contract.version` 必须与打包 schema 版本一致，CI 校验。

### 消费方（driver）保守模式约定（规范性引用，验收归 runlogos R5）

- driver 声明自己支持的 contract major 区间。
- 遇**未知 major** / **缺 `contract` 字段** → 进**保守模式**：仅按 next 驱动普通推进 + 看门狗，一切启发式判定（本地步骤枚举、错误串、正则、屏幕启发式）降级为**仅观察**，不得据此产生不可逆终态。
- 契约内任何枚举字段（如 `step_meta.phase` / `step_meta.kind`）遇**未知值** → 按**保守分支**处理；CLI 按 minor 规则新增枚举值不再构成对旧 driver 的破坏。
- 拍板原则（宁慢勿错杀）：多等 5 分钟看门狗远好于误杀健康 run；真死可以重新点一下，假死会让用户弃用全自动能力。一切措辞与设计冲突以此裁决。

### 验收边界（D9）

openlogos 仓（生产者侧）验收范围 = **生产者契约**：`contract` 字段在场、注册表/step_meta/schema 三方同步、`pre-implement 步骤不输出 loop_state` 的反面锚（漂移注入 x-future-step 生产者一致性测试）、响应 `contract.version` 与打包 schema 一致。**消费方保守模式 / 零误杀 / suspect 可逆态的行为验收归 runlogos 仓 R5 提案**（以本仓发布的新生产者夹具喂旧/现役消费者做韧性测试）；「双向契约测试全绿」是跨仓总方案的完成定义，不是本仓单仓完成判据。

## GUI 项目提案阶段前置 UI/UX 原型确认（proposal-ui-ux-first）

对已 `launched` 的 **GUI 产品项目**（网站 / 桌面应用 / 移动 App），变更管理在**提案阶段（plan 阶段）就前置产出界面原型**，使用户在「批准提案」这一现有动作上（面板已渲染原型的前提下）连界面一起确认，把 UI/UX 纠偏从"全自动实现期"提前到"提案批准门"。

本特性**不新增门态、不新增确认标记文件、不新增 `ui/` 目录**：原型**复用现有 delta 路径映射**（`deltas/prd/**→resources/prd/**`）与现有批准门；但原型资产的实际落盘**不经 merge-executor 的整份合并路径**，而由 `openlogos merge` 内新增的专用事务落盘实现 `commitVerifiedPrototypes()` 统一执行——它是所有 `ui_impact` 原型资产的**唯一落盘入口**（无第二条绕过它的原型落盘路径）。但这**不等于 driver 不变**——面板对原型的 producer dispatch / 渲染 / provenance 写入是本特性核心价值的必要实现，归 runlogos 协同 change（见「跨仓交付闭环与发布顺序」）。非 GUI 项目（纯 CLI / API / Skills）整个特性不启用，变更流程零改动。

### 原型作为 page-design delta（不新增目录 / 门态 / 标记）

GUI 项目在提案阶段判定「本次动了界面」时，**原型直接作为 page-design delta** 写入：

```text
deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html
```

- 原型为裸 HTML（关键几屏 + 各状态），由 `ui-ux-pro-max` 设计系统产出；`design-system.json` 作为审计令牌留在提案目录。
- **复用现有 delta 路径映射**：`deltas/prd/2-product-design/2-page-design/*.html` 沿现有 `deltas/prd/**→resources/prd/**` 映射落入原型图文件夹 `logos/resources/prd/2-product-design/2-page-design/`，**不新增 `ui/` 目录**。但原型资产**不经 merge-executor 的整份 create/replace 路径落盘**，而由专用事务落盘入口 `commitVerifiedPrototypes()`（`openlogos merge` 内）统一执行——merge-executor 只应用 markdown 规格 delta，绝不触碰原型资产。这是所有 `ui_impact` 原型资产（含严格与 advisory 两模式）的**唯一落盘入口**。
- `proposal.md` 保持既有 markdown 结构不变，仅注入机器可读的「UI/UX 变更声明」段（见下）；不打断 CLI / runlogos 对 proposal 的解析。
- runlogos 面板已用 `readDir(deltas/**/*)` 列出原型、可直接 iframe 渲染；接口仅为「delta 路径下的 `.html` 文件」，无需版本握手。

### plan 阶段写入 allowlist（F1）

plan-exit 门前，写入范围**显式且仅放行** `deltas/prd/2-product-design/2-page-design/*.html` 这一原型路径；其余 `deltas/**` 在 plan 阶段仍禁止写入。此 allowlist 与 `spec/pretooluse-guard.md`、`spec/flow-spec.md` 的 ordering 例外三者口径一致：SessionStart 上下文 `writing` / `ready-to-delta` 分支的"暂不产出 delta"指令，对 GUI + `ui_impact` 情形加此例外。

### producer 授权链（门前普通生成、无新授权，F2 R2）

原型产出的授权链上无悬空授权、无「谁批准 producer 写」的缺口：

1. **producer（change-writer，driver 派发）**：原型产出是 plan 节点**门前的普通内容生成**，授权状态与「写 `proposal.md` / `tasks.md`」**完全相同**，不新增授权、不新增门；其写入由 guard 的 **plan 阶段 allowlist（仅放行 `2-page-design/*.html`）** 授权，越界路径被 guard 拒。
2. **provenance 写入方（runlogos 面板 / driver）**：批准时写 `PLAN_APPROVED` body，**由用户的批准动作本身授权**（同一次点击），无独立授权。
3. **`--auto`**：`plan-exit`（`skippable:true`）自动放行，producer 仍在门前产原型、provenance 仍记录，无新授权。
4. **hash 比对消费者（下游 merge / implement）**：只读 provenance，无写授权需求。

唯一人类确认点仍是 `plan-exit`。

### ground truth：`ui_impact` 单一事实源 + 三方对账（F1 R4/R5）

- **单一事实源**：`proposal.md`「UI/UX 变更声明」段的 `ui_impact` 是「本次动没动界面」的**权威意图源**；`flow-derive` / guard / 面板**只读这一组事实源**，不引入第二处判定。
- **完整性判据（三方对账）**：权威三元组必须一致——(i) `proposal.md` 声明段的 `ui_impact` + **声明页清单**；(ii) `2-page-design/` 下实际产出的原型文件；(iii) merge 落盘 / 面板渲染的对象。**声明清单 == 产出文件 == merge 目标** 为完整性判据，不一致 = 节点未收敛。
- **可交付 done_when（逐页非空 + 令牌）**：声明段声明的**每一个页面**在 `2-page-design/` 下都有对应的**非空**原型文件，且提案目录存在 `design-system.json`（ui-ux-pro-max 令牌，供追溯）。不再是「至少一个文件」的弱收敛。
- **不可约残差（如实标注）**：「HTML 是否*真出自* ui-ux-pro-max」除 `design-system.json` 令牌可追溯外**无法纯机器证明**，属既有 acceptance 口径下的荣誉制 + 令牌追溯限制，**如实记录、非遗漏**；Python3 缺失时以通用风格兜底并在提案标注「未走设计系统」，不阻塞、不报错。

### 「批准即确认」的前提与 provenance 契约（F3 / F4）

「批准 == UI 已确认」这一等价**仅当面板实际渲染了原型时成立**；在不渲染的旧面板上，批准只是普通方案批准、**不构成 UI 视觉确认**。为把该保证做实而不新增门 / 标记文件，在既有 `plan-exit` 批准记录上叠加 provenance 属性：

**载体与向后兼容（F3）**：provenance 落在 **`PLAN_APPROVED` marker 的可选 JSON body**。`PLAN_APPROVED` 是「存在性 marker + 可选 provenance body」的**向后兼容超集**：

- **存在性语义完全不变**：`PLAN_APPROVED` 存在即门已过，**空 marker 仍合法**，现有空写路径与「仅存在性」读取者不受影响。
- **缺失 / 空 body = 安全默认「不宣称 UI 已确认」**。
- 仅 runlogos 渲染批准路径写 JSON body；仅 UI 确认消费者解析，缺失容忍。
- driver 批准 progress 事件**可镜像但不权威**，判定一律以 `PLAN_APPROVED` 为准。

**body 内容**：批准时刻确认的原型清单与逐文件内容 hash——

```json
{ "ui_prototype_rendered": true, "pages": ["..."], "hashes": { "<file>": "<sha256>" } }
```

**绑定内容 hash、防批准后漂移（F4）**：下游（merge / implement）**重算 hash 比对**——

- `ui_prototype_rendered:true` 且 **hash 全匹配** = UI 已确认、放行。
- **hash 失配**（原型在批准后漂移）= 该 UI 确认**作废**，且对 `ui_impact:true` 变更**阻断其交付前进**（非仅 advisory 放行）。阻断**复用现有 `plan-exit` 门的「批准内容变更即批准失效 → 必须重新批准」完整性语义**，**不新增门**。由此杜绝「确认 vX、实现 vY」。
- 缺失 / false（旧面板 / 未渲染，非漂移）= 不宣称 UI 已确认、记 advisory、不阻断（保留 F3 向后兼容语义：无 provenance ≠ 漂移）。
- 仅 `ui_impact:true` 提案要求这些字段有意义。

### 「动没动界面」判定（主体、时机、去循环依赖，F2）

判定在 **plan 阶段由 change-writer 执行**，依据是**提案意图 + 项目 `product_type` + `tasks.md` 已规划的 `[delta]` 目标**，**而非扫描尚不存在的 delta 文件内容**（后者在 plan 阶段无 delta 可扫、构成「先 delta 还是先原型」循环依赖，已废除）。三层：① 依 `product_type` 与提案意图声明；② 自检 `tasks.md` `[delta]` 目标是否命中 `2-page-design/` 或含交互变更的 feature-specs，命中即强制判为「动了界面」；③ 可选多 agent 复核（默认关，可由 driver 派发）。据此判定后再产出原型，无循环。

### driver 非「不变」（F2）

看界面挂在既有「批准提案」动作上、复用 `plan-exit` 门，故 openlogos 侧**不新增门态 / 标记 / 目录**。但本特性核心价值（plan 门前产原型 + 面板渲染 + 写 provenance + hash 比对）**必然需要 runlogos driver 改动**：producer dispatch、原型渲染、provenance 写入均为 runlogos 的**必要改动**，归 runlogos 协同 change，**不排除、不宣称 driver 不变**。openlogos 侧只定契约、不含这些 driver 实现。

### 跨仓交付闭环与发布顺序

**交付闭环（两仓都必须落地）**：本特性核心价值 = openlogos 契约（本 change：flow 节点 + `ui_impact` flag + 声明段 + provenance 契约 + guard allowlist）**且** runlogos 实现（producer dispatch + 原型渲染 + provenance 写入 + hash 比对）。**二者缺一，核心视觉确认价值即不成立**。

- **具名依赖**：runlogos 关联件登记为具名 change **`ui-ux-first-panel`**（runlogos 仓，待创建），本提案以此 slug 引用、跟踪对齐，**非「默认其存在」**。顺序：openlogos 契约先 merge / 发布 → runlogos 依此实现；runlogos change 是**必须交付的关联件（非可选）**。
- **前置能力门（capability gate，F2 R4）**：runlogos 在批准前声明 `capabilities.ui_prototype_render`；openlogos 侧在 plan-exit **之前**据此选模式——**就绪 → 渲染确认模式**（要求 provenance + hash）；**缺失（旧面板 / CLI-only）→ 降级模式**（不 claim UI 确认、advisory 不阻断）。能力信号经 SessionStart 上下文（源模板 `plugin/bin/openlogos-phase` + `plugin-codex/session-start.sh`）与 `openlogos status` / `next` JSON 的 `capabilities` 字段表面传递；输入通道 = runlogos 会话建立时写 `logos/.session-capabilities.json`（`{"ui_prototype_render": true}`），文件缺失 = 能力缺失（降级）。该文件为 runlogos 私有会话态、`logos/` 下（gitignore）。**provenance 存在性仅作事后一致性校验**。
- **三层指令资产纳入交付（F2 R4）**：运行时行为由三层指令资产驱动，均为交付物，缺一则运行时指令链断——**(L1) skills**：`change-writer` / `product-designer` / `merge-executor` SKILL + checker 命令说明；**(L2) 生成的 AI 指令文件**：`openlogos sync` 重新生成的 `AGENTS.md` / `CLAUDE.md`（承载 UI-first 工作流指令，随发布分发）；**(L3) flow overlay 资产**：方法论 GUI overlay 模板（含 `write-ui-prototype` / `verify-ui-provenance` overlay-add 节点），经 project-init / sync 注入。
- **完整运行时指令链（端到端有序）**：① driver 在 plan 节点判 `ui_impact` 且前置能力就绪 → ② dispatch change-writer（ui-ux-pro-max）产逐页原型 + `design-system.json`（写 `2-page-design/`，guard allowlist 放行）→ ③ overlay-add `write-ui-prototype` 的 `done_when: cmd:openlogos check-ui-prototype`（真实可执行子命令，`<...>` 仅文档示意）富对账通过 → ④ 面板渲染原型、用户批准 → ⑤ 面板 / driver 写 `PLAN_APPROVED` body（`ui_prototype_rendered` + `pages` + `hashes`）→ ⑥ merge 前 `verify-ui-provenance` 的 `done_when: cmd:openlogos check-ui-hash-match` 按三分支重算 hash（见漂移检测点）→ 含 provenance 完好匹配 / legacy advisory 则 done 前进、失配或部分 provenance 则卡未 done。

### 双阶段发布状态（F2 R7）

发布状态与对外宣称边界由验收结果**机器判定**，非人工声称：

- **contract-ready（capability-disabled）**：OpenLogos npm 新版本 + 文档站发布即达此态。**只交付契约**（flow overlay / `ui_impact` flag / 声明段 / provenance 契约 / guard allowlist / 会话入口例外文案 / merge 严格校验代码），**默认降级、不得对外 claim「UI/UX 确认已前移」已启用**。对外宣称边界 = contract-ready。
- **feature-enabled**：**当且仅当** 具名关联 change `ui-ux-first-panel`（runlogos 仓）已部署，且**跨仓端到端 smoke 通过**后达此态，方可 claim UI-first 正式启用。

**跨仓端到端 smoke 完成标准（逐条可判）**：① `ui-ux-first-panel` 已部署且在会话建立时写入 `logos/.session-capabilities.json`（`ui_prototype_render:true`）；② 两个 SessionStart 入口（`plugin/bin/openlogos-phase` + `plugin-codex/session-start.sh`）读取并**一致 surface** 该 capability；③ 面板实际渲染原型并在批准时写入绑定 `pages` / `hashes` 的 `PLAN_APPROVED` provenance；④ merge 严格 hash 校验对批准后漂移的原型**确实拒绝**；⑤ smoke 能**区分** contract-ready 与 feature-enabled 两态。owner = runlogos（`ui-ux-first-panel` 交付方）联合 openlogos 发布；成功标记 = 跨仓 smoke 全绿 → 置 feature-enabled；任一步失败 → 保持 contract-ready 并如实声明「契约就绪、功能未启用（降级）」，**不得 claim feature-enabled**。契约侧 smoke 覆盖补入 `logos/resources/test/smoke/core-smoke-test-cases.md`；跨仓端到端 smoke 由 `ui-ux-first-panel` change 承载并登记为其交付。

**openlogos 可独立发布至 contract-ready**：原型即普通 delta，merge 照常落盘，旧面板仍不崩不阻断；但**核心视觉确认价值须 runlogos 到位并跨仓 smoke 通过才 feature-enabled**。

### 漂移失效检测点（前移到 merge 前，F4 R4）

- **检测点前移**：漂移检测由 **overlay-add 节点 `verify-ui-provenance`** 承载，置于 **merge 之前**（`before: generate-merge-prompt`、`when: ui_impact`），在原型落盘 resources **之前**拦截漂移（放在 merge 之后太迟）。
- **单 `done_when: cmd:` + `check-ui-hash-match` 三分支（F6）**：`verify-ui-provenance` 用**单个 `done_when: cmd:openlogos check-ui-hash-match`**（无 `fail_when`；三分支逻辑全在命令内部）。该命令是**真实可执行 CLI 子命令**（项目根 cwd、自解析活跃提案、`exit 0`=放行 / 非 0=阻断；文档中 `<...>` 仅示意，运行时须为可执行命令）。命令读**持久化 `PLAN_APPROVED` provenance**（非会话 capability）分三支：**(1) 含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`）→ 重算 `2-page-design/` 现值 hash 比对 `PLAN_APPROVED.hashes`：完好且全匹配 `exit 0`（节点 done、放行）；缺失 / 损坏 / 失配 **fail closed 非 0**（节点未 done、前向阻断）。**(2) legacy/degraded 或旧空 marker 且无任何「曾渲染确认」证据** → **记 advisory 后 `exit 0`**（节点 done、merge 可达）——**新增第三成功分支**，令 GUI `ui_impact:true` 但批准记录为旧空 `PLAN_APPROVED` 的提案不再永久卡在 `verify-ui-provenance`；此类提案的 advisory 放行现**经本节点 `exit 0` 达成，而非绕过节点**。**(3) 部分 / 损坏 provenance**（`ui_prototype_rendered:true` 但 `hashes` 缺 / 空）→ 不得误判 legacy → **fail closed 非 0**。单 cmd: 合法（overlay-add，非双 cmd:）；只有第 1 支全匹配与第 2 支 advisory 两种成功路径。
- **状态转换（诚实边界）**：flow 引擎**前向线性、无跨 subflow 自动 rewind**。「退回 plan-exit」**非引擎自动倒转**，而是——失配即卡在未 done，remediation = **driver / 人工显式重入 plan**（重跑 producer 产原型 + plan-exit 重批，刷新 `PLAN_APPROVED.hashes`）→ 再到该节点时 hash 匹配 `exit 0` → done → 放行。

### F4 R7 红线：严格性以持久化 `PLAN_APPROVED` 为键，绝不因会话 capability 缺失降级

**模式选择**与**强制语义**分离，堵跨会话降级绕过：

- **模式选择（plan-exit 之前）** 才读会话 capability（`.session-capabilities.json`）：就绪 → 渲染确认模式；缺失 → 降级模式。这是该文件的**唯一**合法用途，**绝不**作为批准后的完整性门降级开关。
- **强制语义（plan-exit 之后：merge / 落盘 / 落盘后复核）以持久化 `PLAN_APPROVED` provenance 为键，不再读 session capability**：
  - **批准记录含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`，即曾走渲染确认路径）⇒ **所有 merge / 落盘 / 落盘后复核入口永久 fail closed**：`hashes` 必须存在且完好、逐文件重算匹配；缺失 / 损坏 / 失配一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）。**当前会话 capability 文件缺失 / 过期 / 被清理一律不得降级**——「曾渲染确认」证据已固化在批准记录里，易失会话态无权推翻它。
  - **仅** 批准记录为 legacy/degraded、或旧空 marker 且无任何「曾渲染确认」证据时 ⇒ 才允许 F3 向后兼容 advisory 放行（不要求 `hashes`、不阻断）。此 advisory 放行**经 `check-ui-hash-match` 第三成功分支 `exit 0` 达成**（`verify-ui-provenance` 节点正常 done、merge 可达），**非绕过节点**——故「旧空 marker advisory 不阻断」现是节点内的合法成功路径，不是流程被跳过（见「漂移失效检测点」三分支）。
  - **部分 / 损坏 provenance**（`ui_prototype_rendered:true` 但 `hashes` 缺 / 空）**不得**误判为 legacy 走上一支 ⇒ **fail closed**（拒绝 / 阻断），与含完好 provenance 的失配同等对待。
- 判据由 `ui_impact` **与 `PLAN_APPROVED` 内容**共同决定；merge.ts / `check-ui-hash-match` / freshness 三处（提示前 / 落盘时 / 落盘后）**一致按此三分支**分支，杜绝三处复用同一「capability 缺失即降级」错误分支而一致放行、形不成纵深防御。

### freshness 权威校验点在落盘时刻 + 事务门（F1 新循环 / R2 / R3）

`openlogos merge` 是 AI 驱动——`merge.ts` 生成 `MERGE_PROMPT` 后停手，实际落盘由后续 `apply-merge` / merge-executor 完成，「提示生成 → 实际落盘」之间原型仍可漂移。故权威校验点下沉到**落盘时刻**，并升级为事务语义：

- **具名执行入口（单一 owner）**：原型资产落盘由 `openlogos merge` 内的**唯一命名函数** `commitVerifiedPrototypes()`（`cli/src/commands/merge.ts`）执行，是原型落盘的**唯一代码入口**；**merge-executor 绝不触碰原型资产**（只应用 markdown 规格 delta）。
- **进入事务门的判据（按 F4 R7 持久化批准记录分支，非消费时 capability）**：所有 `ui_impact` 原型资产（含严格与 advisory 两模式）**一律经同一入口 `commitVerifiedPrototypes()` 落盘**，无第二条绕过它的原型落盘路径；该入口内部按持久化 `PLAN_APPROVED` provenance 选严 / 宽——`PLAN_APPROVED` 含 UI provenance 时**永久进入严格事务门并 fail closed**（全量校验 staged 字节 hash 匹配才提交，失配即在写入任何文件前 abort），**当前会话 capability 缺失 / 过期 / 被清理一律不得跳过本事务门、不得降级**；**仅** 批准记录为 legacy/degraded、或旧空 marker 且无「曾渲染确认」证据时，才走 F3 advisory 分支——**仍由 `commitVerifiedPrototypes()` 同一入口落盘，只是不做严格 hash 校验**（不进严格事务门、不阻断），**并非由 merge-executor 整份落盘**。**不以消费时 `.session-capabilities.json` 决定严 / 宽或是否进门**。
- **三段事务（verify-all → stage → atomic commit）**：① **全量校验**——落盘任何文件前，对本次全部 ui_impact 原型资产重算 hash 比对 `PLAN_APPROVED.hashes`，任一不符即在写入任何文件前 abort；② **staging**——校验通过的资产先写临时区，**对 staged 副本算 hash**（消除 verify-to-stage 竞态，提交的正是已校验的 staged 字节，无 TOCTOU 窗口）；③ **原子提交**——以原子 rename 逐文件提交，失败即回滚。
- **崩溃恢复（intent journal）**：提交前写 commit journal（`{target, staged, backup}` 清单，落 `logos/changes/<slug>/`）；中途崩溃时下次 `openlogos merge` / 启动检测到残留 journal → 前滚或回滚到一致的全有或全无态，恢复后清 journal。
- **落盘后复核（双保险）**：`apply-merge` 完成后复核 resources 中已落盘原型的 hash == `PLAN_APPROVED.hashes`，不符则阻断流程前进（不进 slice / code）。
- **失败语义（无残留）**：任一阶段失败 ⇒ resources 回到 merge 前状态（无部分落盘、无未获批内容）、`SPEC_MERGED` 不写、流程标记失败并阻断；remediation = 显式重入 plan 刷新 hashes 后重跑。即**全有或全无、失败零残留**。
- **堵直接调用绕过**：hash 校验同时下沉进 `merge()` 命令本身——对 `ui_impact:true` 提案，`merge()` 在扫 delta / 生成 `MERGE_PROMPT` **之前**读 `PLAN_APPROVED.hashes` 并重算原型现值 hash，失配即拒绝 merge（非零退出 + 明确错误，不生成 `MERGE_PROMPT`）。由此无论经 driver 流还是直接 CLI 调用都不可绕过。
- 三处校验点（提示前 = 早失败优化 / 落盘时 = 权威门 / 落盘后 = 双保险）**全部按 F4 R7「持久化 provenance 为键」分支**，不以消费时会话 capability 做严 / 宽开关。

### 整份落盘规则收窄——防静默覆盖（F3）

merge-executor 的「整份 create / replace」**仅**适用于 `2-page-design/` 等资产目录下**非 `ui_impact` 绑定**的原型 / 资产文件类型（`.html` / `.png` / `.svg` 等）；`.md` 规格 / skill delta 缺 `ADDED` / `MODIFIED` / `REMOVED` 段标记时**一律判为非法 delta 并报错停下**，绝不静默整份覆盖主文档。**注意**：本特性引入的 `ui_impact` 原型资产**不走 merge-executor 的整份 create / replace 路径**，一律由 `commitVerifiedPrototypes()` 统一落盘（严格模式做 hash 校验、advisory 模式不做，二者同一入口）；merge-executor 绝不触碰原型资产。

## 存量逆向基线的 JIT 深化（brownfield-adopter S33，advisory + 单份最终态 delta）

`bootstrap: adopted` 模块下，当活跃 change 的目标区域**只有 `verified: false` 的逆向 spec**（种子基线）时，change-writer 给出 **JIT advisory（不设硬门）**：建议在**当前 change 的单份最终态 delta**内一并确认该区域现状。本节定义该路径在现行 delta 协议下的**唯一合法落盘结构**。

### 单份最终态 delta 承载「确认现状 + 前向改动」（不引入多操作 delta）

现行 delta 协议规定 `deltas/**` 相对路径 **1:1 映射唯一目标主文档**，`MODIFIED` 语义是「用完整内容替换主文档同名章节」。同一目标文档无法并存两份独立 delta，也无「同一 delta 内两个同名 `MODIFIED` 有序阶段」的表示。故：

1. **单份最终态 delta**：每个被触碰目标文档只产出**一份**最终态 delta，承载「人工确认后的现状 + 本次前向改动」的最终内容，按现行 `MODIFIED`（每章节一份完整替换）落盘，走既有 `deltas/** → resources/**` 映射——**merge CLI / merge-executor / delta schema 一律不改**。
2. **provenance 随 delta 原子升级**：该 delta 的一个 `MODIFIED` 同时把文档内具名章节 `## 逆向基线来源` 的 `verified: false → true`（并写 `confirmed_by` / `evidence` / `confirmed_at`）与正文改动一并替换。
3. **现状确认是审计事实、非第二份 delta**：确认了哪些逆向候选、证据、确认人记在该章节 + `tasks.md` `[delta]` 勾稽对应候选 ID，**不新增第二个落盘目标**、**不引入双有序 delta / 多操作 delta manifest**（现行协议无法表达）。
4. **`human-verified` 仅 merge 后生效**：merge 前主文档仍 `verified: false`，覆盖率**只读已合并主文档**，advisory 不因未合并 delta 提前消失或声称前移。
5. **guard 合规**：全程在当前单一 change 的 `deltas/**` 内写作，**不直接改 `resources/**`、不嵌套第二个 change**。
6. **不设硬门**：用户可跳过建议、直接写前向 delta；该区域 `verified` 保持 `false`、覆盖率不前移；change-writer 不得阻断。

判定与校验的 CLI 侧支撑：`cli/src/lib/baseline-jit.ts`（`detectBaselineJitAdvisory` 只读已合并主文档判未验证逆向区域；`deltaConfirmsCurrentState` 校验单份 delta 是否承载 verified:true 现状确认）。

## change-lint 产出点自检（change-lint-shift-left）

### 定位

`openlogos change-lint [--slug <slug>] [--format json]` 是提案计划产物（proposal.md / tasks.md / deltas/**）的**产出点主动硬检查**：把 pre-implement 判据（测试 ID 在场、`[code]` 标题、delta 段标记与脱模板、部署决策一致性、delta 路径合法、GUI 声明结构）从消费点（merge / flow-derive）左移到产出点，在 agent 上下文还热时暴露缺口。

### 授权语义

- **只读、非人类确认点**：任何角色、任何阶段可跑；不写任何文件 / marker / 哈希清单；不改变任何 step/gate 派生；不属于 merge/verify/smoke/archive 等人类确认点序列。
- **产出方硬性交付门（技能侧约定）**：change-writer 在 write-proposal/write-tasks 完成后与 delta 产出完成后、slice-planner 在切片产出完成后，必须运行 change-lint 且 **exit 0 才可交付**；exit 2（检查红）按 violations 逐条修复后重跑；exit 1（操作错误）按 message 排障。该门是产出方的自检纪律，**不是**新增 flow gate。

### 与消费点判据的关系（纵深防御）

- lint 与 merge / flow-derive **共享同一批判据函数**（单一事实源，严禁第二份判据）；lint 只提前暴露，消费点判据全部保留。
- 随本变更生效的两项判据语义收紧（两端同步）：①test-id 采信收紧——占位尾段（`xx`/`TBD`/`TODO` 等）与通配族名（`UT-Sxx-*` 等）不再计入真实测试 ID；②`.md` delta 收紧——除段标记外，模板骨架（占位字面量未替换）也被 merge 拒绝。
- delta 路径检查为正交双结论：merge 消费行为零改动（历史存量兼容通道）；lint 对 `invalid` 路径报违规（新产出交付门）。

### 检查项与退出码（摘要）

L1 tasks 结构可解析 / L2 `[code]` 标题在场 / L3 分阶段测试证据 / L4 delta 段标记+脱模板 / L5 部署决策一致 / L6 delta 路径合法 / L7 GUI 声明结构（`product_type ∈ GUI` 时激活）。exit 0 = 全过；exit 2 = 检查完成有违规（stdout success envelope）；exit 1 = 操作错误（stderr error envelope）。plan 段无 delta 时 L4/L6 空集通过（阶段感知，「产出多少查多少」）。JSON 契约详见 `spec/cli-json-output.md` §3.15。
