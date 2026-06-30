# Skill: Change Writer

> 辅助填写变更提案——分析变更影响范围，生成结构化的 proposal.md 和按阶段拆解的 tasks.md，确保变更可追溯、影响可控。

## 触发条件

- 用户刚运行完 `openlogos change <slug>` 并希望 AI 帮忙填写提案
- 用户描述需要修改、新增或删除某个场景/功能
- 用户提到"变更提案"、"change proposal"、"迭代"、"改需求"

## 前置依赖

1. 项目已初始化（`logos/logos.config.json` 存在）
2. 变更提案目录已由 CLI 创建（`logos/changes/<slug>/` 存在）
3. 主文档可读（`logos/resources/` 中有已生效的文档）

如果前置条件不满足，提示用户先运行 `openlogos change <slug>` 创建提案目录。

## 核心能力

1. 理解用户描述的变更意图
2. 扫描 `logos/resources/` 中的现有文档，定位受影响范围
3. 根据变更传播规则判断变更类型（需求级 / 设计级 / 接口级 / 部署级 / 代码级）
4. 判断本次变更是否需要部署、是否需要数据迁移、是否需要 smoke 验证
5. 生成符合规范的 proposal.md
6. 按变更类型自动拆解 tasks.md

## 执行步骤

### Step 1: 理解变更意图

与用户确认以下信息（信息不足则追问，最多 2 轮）：

- **变更是什么**：要新增、修改还是删除什么？
- **变更原因**：为什么要做这个变更？来自需求反馈、Bug 还是优化？
- **关联场景**：涉及哪些已有场景编号（S01, S02...）？

### Step 2: 分析影响范围

扫描 `logos/resources/` 中的文档，确定影响范围：

1. 读取需求文档（`prd/1-product-requirements/`），检查相关场景定义
2. 读取产品设计（`prd/2-product-design/`），检查相关功能规格和原型
3. 读取技术方案（`prd/3-technical-plan/`），检查相关架构、时序图、部署方案
4. 读取 API 文档（`api/`），检查相关端点
5. 读取 DB 文档（`database/`），检查相关表结构
6. 读取编排测试（`scenario/`），检查相关测试用例
7. 读取 smoke 测试用例（`test/smoke/`），检查部署后冒烟覆盖是否需要更新

### Step 3: 判断变更类型

参照变更传播规则确定变更类型及最小更新范围：

| 变更类型 | 最少需要更新 |
|---------|------------|
| 需求级变更 | 全链路（需求 → 设计 → 架构 → 部署 → API/DB → 测试 → 编排 → 代码） |
| 设计级变更 | 原型 + 场景 + API/DB + 测试/编排 + 代码 + 部署影响分析 |
| 接口级变更 | API/DB + 编排 + 代码 + 部署影响分析 |
| 部署级变更 | 部署方案 + smoke 用例 + `[deploy]` 任务 |
| 代码级修复 | 代码 + 重新验收 + 部署影响分析 |

### Step 4: 生成 proposal.md

按以下模板生成，写入 `logos/changes/<slug>/proposal.md`：

```markdown
# 变更提案：[变更名称]

## 变更原因
[为什么要做这个变更？来源于哪个需求/反馈/Bug？]

## 变更类型
[需求级 / 设计级 / 接口级 / 部署级 / 代码级]

## 变更范围
- 影响的需求文档：[列表，精确到文件名和章节]
- 影响的功能规格：[列表]
- 影响的业务场景：[场景编号列表]
- 影响的部署方案：[列表]
- 影响的 API：[端点列表]
- 影响的 DB 表：[表名列表]
- 影响的编排测试：[列表]
- 影响的 smoke 测试：[列表]

## 部署影响
- 是否需要部署：是 / 否
- 部署原因：[说明为什么需要或不需要部署]
- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]
- 是否涉及数据迁移：是 / 否
- 是否需要回滚预案：是 / 否
- 是否需要 smoke：是 / 否

## 变更概述
[用 1-3 段话概述具体改什么]
```

生成 `proposal.md` 后必须先保留部署决策结论，Step 5 生成 `tasks.md` 时必须与该结论一致。

### Step 5: 生成 tasks.md

根据变更类型和影响范围，使用结构化 section 格式生成任务清单。完整格式规范见 `spec/tasks-spec.md`。

> **禁止在 tasks.md 中写入 verify / smoke / 人工验证类条目**——这些属于独立 CLI 操作节点。tasks.md 只追踪 delta、代码和部署执行任务。

> ⚠️ **launched 变更下 `[code]` 切片不在此处产出**（split-slice-planner-stage）：`write-tasks` 节点只产 `## [delta]` / `## [deploy]`。`## [code]` 切片由独立环节 **`slice-planner`** 在 **merge 之后**、对**已合并规格 + 真实测试 ID** 划分（见 `skills/slice-planner/SKILL.md`）。本步骤可留空 `[code]` 或完全不写 `[code]` section；下方模板中的 `[code]` 块仅示意最终形态，不在 plan 段填写。

**格式规则**：
- `## [delta] <描述>` section：只列 delta 文档产出任务，每条对应一个 delta 文件
- `## [code] <描述>` section：launched 变更下**不在 plan 段填写**，由 merge 后的 `slice-planner` 产出；只列代码实现任务，直接修改源文件，不产出 delta
- `## [deploy] <描述>` section：只列部署执行任务，只能在 verify PASS 后、人类明确确认后执行
- 不需要部署的提案不得创建 `[deploy]` section
- 需要部署的提案必须创建 `[deploy]` section
- 需要部署的提案必须在 `[delta]` section 中包含部署方案和 smoke 用例变更（如受影响）
- **严禁混用**：delta 任务不得写入 `[code]` section，代码任务不得写入 `[delta]` section

**部署决策一致性自检（强制）**：

生成 `proposal.md` 和 `tasks.md` 后，必须逐项检查：

| 检查项 | 合法状态 |
|---|---|
| `proposal.md` 声明 `是否需要部署：否` | `tasks.md` 不存在 `[deploy]` section |
| `proposal.md` 声明 `是否需要部署：是` | `tasks.md` 必须存在 `[deploy]` section |
| `proposal.md` 声明 `是否需要 smoke：是` | `proposal.md` 必须同时声明 `是否需要部署：是` |
| `proposal.md` 声明无需部署 | 不得在 `[code]` 或 `[delta]` 中写部署执行任务 |

若自检失败，必须先修正 `proposal.md` 或 `tasks.md`，不得继续产出 delta。

**需要部署的变更模板**（`[code]` 块示意，merge 后由 slice-planner 填写）：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — 更新部署方案
- [ ] 产出 delta 文件到 `deltas/test/smoke/` — 更新部署后冒烟测试用例

## [deploy] 部署任务
- [ ] 按部署方案部署到 staging
- [ ] 确认迁移、配置、服务启动和回滚预案
```

**需求级 / 设计级变更模板**（有 delta + 有代码；`[code]` 由 merge 后 slice-planner 填写）：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — 更新需求文档中 S0x 的验收条件
- [ ] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — 在场景总览表中新增/修改场景
- [ ] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — 更新功能规格中 S0x 的交互设计
- [ ] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/` — 更新原型
- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/` — 更新技术架构
- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 更新 S0x 的时序图
- [ ] 产出 delta 文件到 `deltas/api/` — 更新 API YAML
- [ ] **验证 API YAML** — `logos/resources/api/` 下所有文件必须为有效 YAML 且符合 OpenAPI 3.x 规范（所有包含 `:` 或特殊字符的 `description`/`summary` 值必须用双引号包裹）
- [ ] 产出 delta 文件到 `deltas/database/` — 更新 DB DDL
- [ ] 产出 delta 文件到 `deltas/scenario/` — 更新编排测试用例
```

**纯代码修复模板**（无 delta；`[code]` 由 merge 后 slice-planner 填写）：

```markdown
# 实现任务

（无 [delta]；merge 整段跳过，直接进入 slice 段由 slice-planner 划分 [code]）
```

### Step 5 补充：[code] 良构切片（已迁至 slice-planner）

> **split-slice-planner-stage 起，`[code]` 切片划分整体迁出 change-writer**，由独立环节 **`slice-planner`** 在 **merge 之后**决定（见 `skills/slice-planner/SKILL.md`）。原"六维打分 + 良构切片"规则连同新增的"垂直/横向判别器"和"删后续证伪门"全部归 slice-planner 维护，是 launched 变更下 `[code]` 切片的**唯一事实源**。

为什么迁出：切片在 plan 段（merge 前）产出，会对**未合并规格 + 占位测试 ID**划分，信息不全易切错（实测曾切成横向分层）。挪到 merge 后，slice-planner 对**已合并规格 + 真实 UT/ST ID**切，并以删后续证伪门强制每片自闭环。

change-writer 在 launched 下**不再产出、不再打分、不再划分 `[code]` 切片**。

### Step 6: 产出 Delta 文件

**触发时机**：tasks.md 填写完成、用户确认提案后，按 `[delta]` section 的任务清单逐项产出 delta 文件。

**重要**：只执行 `[delta]` section 中的任务。`[code]` section 的任务在规格合并（SPEC_MERGED）后才开始执行。

#### 目录映射

Delta 文件写入 `logos/changes/<slug>/deltas/` 下对应子目录，与 `logos/resources/` 一一对应：

| 目标主文档目录 | Delta 子目录 |
|---|---|
| `logos/resources/prd/` | `deltas/prd/` |
| `logos/resources/api/` | `deltas/api/` |
| `logos/resources/database/` | `deltas/database/` |
| `logos/resources/scenario/` | `deltas/scenario/` |
| `logos/resources/test/` | `deltas/test/` |

`prd/` 下按子目录进一步对应：

| 目标主文档子目录 | Delta 子目录 |
|---|---|
| `logos/resources/prd/1-product-requirements/` | `deltas/prd/1-product-requirements/` |
| `logos/resources/prd/2-product-design/1-feature-specs/` | `deltas/prd/2-product-design/1-feature-specs/` |
| `logos/resources/prd/2-product-design/2-page-design/` | `deltas/prd/2-product-design/2-page-design/` |
| `logos/resources/prd/3-technical-plan/1-architecture/` | `deltas/prd/3-technical-plan/1-architecture/` |
| `logos/resources/prd/3-technical-plan/2-scenario-implementation/` | `deltas/prd/3-technical-plan/2-scenario-implementation/` |
| `logos/resources/prd/3-technical-plan/3-deployment/` | `deltas/prd/3-technical-plan/3-deployment/` |
| `logos/resources/test/smoke/` | `deltas/test/smoke/` |

代码实现（`src/`、`test/`）**不产出 delta**，直接修改源文件。

部署相关行为规范：

- 需要部署时，必须产出部署方案 delta
- 需要部署且 smoke 覆盖受影响时，必须产出 smoke 测试用例 delta
- 不允许把部署执行命令写入 `[code]` section
- 不允许 AI 在 delta-writing 阶段执行部署命令

#### 文件命名

与目标主文档**同名**（含子目录层级）。例如：
- 目标：`logos/resources/api/core-api.yaml` → delta：`deltas/api/core-api.yaml`
- 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md` → delta：`deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标：`logos/resources/test/core-S01-test-cases.md` → delta：`deltas/test/core-S01-test-cases.md`

#### 文件格式

每个 delta 文件使用 `ADDED / MODIFIED / REMOVED` 标记，每个标记块对应主文档中的一个章节：

```markdown
## ADDED — [新增章节标题]
[新增的完整内容]

## MODIFIED — [修改章节标题]
[修改后的完整内容，merge 时替换主文档中同名章节]

## REMOVED — [删除章节标题]
[说明删除原因，merge 时删除主文档中同名章节]
```

#### 行为规范

- 每完成一个 delta 文件，立即将 `tasks.md` 中对应条目从 `[ ]` 更新为 `[x]`
- **禁止直接修改 `logos/resources/` 下的主文档**——所有规格变更必须通过 delta 文件，由 `openlogos merge` 统一合并
- 全部 delta 产出完成后，提醒用户明确授权运行 `openlogos merge <slug>`

### Step 6 补充：plan 门与 delta 时机（change-flow-redesign）

change-flow-redesign 把前段流程拆为 `plan{写提案, 划分tasks}` → `spec{写delta}` → `merge`，并在 `plan` 出口新增「批准方案」人类门（对应 `proposal_step: ready-to-delta`、gate_id `plan-exit`、`skippable:true`）。split-slice-planner-stage 起，**`[code]` 切片划分移出 plan 门**，改在 merge 后 `slice` 段由 `slice-planner` 产出，并在 `slice-exit` 门（`ready-to-implement`）确认。

- Step 6「产出 Delta」的触发时机 = **proposal.md + tasks.md 的 `[delta]`/`[deploy]` 均脱模板、且用户在 plan 门确认方案之后**（plan 门确认范围 = 提案 + `[delta]`/`[deploy]`，**不再含 `[code]` 切片划分**）。`[code]` 切片在 merge 后单独规划、单独确认。
- 无人值守 `openlogos next --auto` 下，plan 门可被自动放行（仅写 `GATE_AUTO_PASSED` 审计、不推进状态）；手动模式下停在 `ready-to-delta` 等人确认。

### Step 7: 引导后续操作（链式驱动）

提供一条可直接执行的提示词，让用户一句话启动全部任务的链式执行：

- **需求级 / 设计级变更**（多任务）：建议用户说「按 tasks.md 帮我逐步更新 S0x 的所有受影响文档」
- **代码级修复**（少任务）：建议用户说「帮我修复 S0x 的 [问题描述] 并重新验收」

链式执行的行为规范：
1. AI 读取 `tasks.md`，按顺序逐项执行
2. **每完成一项任务，立即将 `tasks.md` 中该项从 `[ ]` 更新为 `[x]`**（AI 主动执行，无需用户提醒）
3. 每完成一项任务，汇报修改摘要，并自动提示「继续下一项？」
4. 用户说「继续」或给出调整意见后，执行下一项
5. 全部任务完成后，提醒用户明确授权运行 `openlogos merge <slug>`

**关键原则**：不要让用户手动跟踪任务清单——AI 应主动驱动流程。

**`openlogos merge` 和 `openlogos archive` 是人类确认点**：
- AI 未经用户明确授权不得自行执行这两个命令
- 用户明确要求执行（包括使用 `/openlogos:merge`、`/openlogos:archive` slash command）时，AI 可以代为执行
- 不得在"顺手完成流程"、"按流程走完"、"继续"等隐式场景中自动触发

**无人值守 `--auto` 例外（与 plan 门对称，依据 `spec/change-management.md` §143「无人值守 skip-gate 例外」）**：
- 无人值守 `openlogos next --auto` 下，**仅** `spec` 出口门（`spec-exit`，审 delta + 授权合并）与 `deliver` 入口门（`deliver-entry`，部署执行）这两道 `skippable:true` 门可被**编排器（driver）**自动放行——**用户选择 `--auto` 即构成对这两道可跳门的授权**；每次放行向 `GATE_AUTO_PASSED` 追加一行审计（append-only，历史审计行不构成对后续动作的授权）。据此，`--auto` 下 `openlogos merge` 由编排器凭本次 `next --auto` 响应的 `gate_auto_passed=true` 执行，无需逐次人类授权。
- **被派发的 change-writer agent 自身仍不直接执行 `openlogos merge`**：产出全部 delta 后停手、把控制权交回编排器，由编排器走自动合并。这与默认/手动模式下"提醒用户授权"并不矛盾——`--auto` 只是把"授权"前置到了用户选择 `--auto` 这一步。
- **红线（`--auto` 绝不自动放行，始终须人类明确授权）**：`openlogos archive`、`openlogos smoke`、`git push`、以及 `gate:implement:loop-exhausted`（默认 `skippable:false`）。它们要么不是可跳 flow 门、要么属高危动作，不在 `--auto` 自动放行范围。
- **默认 / 手动模式（无 `--auto`）行为完全不变**：merge、部署执行仍停在对应门等人类明确授权。

merge 后的后续提示应按是否需要部署区分：

- **不需要部署**：实现代码 → `openlogos verify` → `openlogos archive`
- **需要部署**：实现代码 → `openlogos verify` → 用户明确授权部署 → `openlogos smoke` → `openlogos archive`

**部署执行、`openlogos smoke` 也是人类确认点**。AI 未经用户明确授权不得自动部署或自动运行 smoke（例外：`--auto` 下部署执行可经 `deliver-entry` 门由编排器自动放行；`openlogos smoke` 不在自动放行范围，始终须人类确认）。

AI 只负责驱动内容修改，不得在未获明确授权的情况下推进提案状态（`--auto` 无人值守下，对 `spec-exit` / `deliver-entry` 两道可跳门的放行属 §143 授权范围内的自动推进，放行依据为本次 `next --auto` 响应的 `gate_auto_passed=true`）。

## 输出规范

- 文件格式：Markdown
- 存放位置：`logos/changes/<slug>/`
- 文件名：`proposal.md` 和 `tasks.md`（覆盖 CLI 生成的模板）

## 实践经验

- **宁可高估影响范围**：漏掉一个环节的更新比多检查一遍更危险
- **变更类型决定工作量**：帮助用户在动手前理解改一个需求可能需要全链路更新
- **tasks.md 是执行清单**：每完成一项打一个 `[x]`，方便追踪进度
- **小变更也走流程**：看似"只改一行 API"的变更，可能影响编排测试和代码

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

**填写提案**：
- `帮我填写变更提案 <slug>`
- `我要给 S02 登录场景加一个记住密码功能，帮我分析影响范围`
- `这个 Bug 修复只涉及代码层，帮我快速写个提案`

**执行任务（提案填写完成后）**：
- `按 tasks.md 帮我逐步更新 S02 的所有受影响文档`
- `帮我修复 S02 登录接口的 500 错误并重新验收`
