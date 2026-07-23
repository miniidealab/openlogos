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

> ⛔ **严禁在 `write-tasks` 阶段规划或填写 `[code]` 切片**（enforce-slice-stage-ordering / split-slice-planner-stage）：`write-tasks` 节点**只产** `## [delta]` / `## [deploy]`。`## [code]` 切片由独立环节 **`slice-planner`** 在 **merge / no-delta spec-complete 之后**、对**已定稿规格 + 真实测试 ID** 划分（见 `skills/slice-planner/SKILL.md`）。**即使某些切片此刻看起来"显而易见"，也绝不在此处写任何 `[code]` 条目**——提前填充会被 CLI 在 `openlogos merge` 进入 spec-complete 前**自动清理作废**：把 `[code]` 重置为占位并把旧内容备份到提案目录 `CODE_AUTORESET`（可追溯、非无痕删除，见 `spec/flow-spec.md` §12.7）。清理不阻断流程、无人值守自愈，但**你提前划的切片一律作废**——因为它是对未定稿规格 + 占位测试 ID 划的，信息不全必然切错。本步骤**只保留空 `## [code]` 标题**（切片项不在 plan 段填写，由 spec-complete 后 slice-planner 划分）；下方模板中的 `[code]` 块仅示意最终形态。
>
> ⚠️ **`## [code]` 标题行必须保留**（fix-nodelta-proposal-routing）：`write-tasks` 产出的 `tasks.md` **至少要含一个 `## [tag]` section 标题**，否则 `parseTaskSections` 返回 `null`、派生降级为「旧格式兜底」而误判为 `delta-writing`（把纯代码提案错误派到 `write-delta` 节点、无人值守下死锁）。因此：有 `[delta]` 的提案 `[code]` 标题可留空或省略（已有 `[delta]` 标题）；**无 `[delta]` 的纯代码提案必须写出空的 `## [code]` 标题行**（标题在、条目空，由 no-delta `SPEC_MERGED` 后的 slice-planner 填切片）。

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

**纯代码修复模板（无 delta；保留空 `## [code]` 标题，切片由 no-delta merge 后 slice-planner 填写）**：

```markdown
# 实现任务

## [code] 代码实现
（本段在 plan 段留空：无 `[delta]` 时不进入 `write-delta`，但仍需执行 no-delta `openlogos merge <slug>` 写入 `SPEC_MERGED`，表示 spec-complete 已完成；随后由 `slice-planner` 基于已完成 spec-complete 的规格与真实测试 ID 划分 `[code]` 切片。此处仅保留 `## [code]` 标题，勿提前填写切片项。）
```

> **为什么保留空 `## [code]` 并仍需 no-delta merge**：`## [code]` 标题用于表达 `code_required==true` 与后续切片承载区；no-delta `SPEC_MERGED` 用于表达“规格阶段已完成且本次无文档 delta”。两者缺一不可。`change-writer` 不得把无 `[delta]` 解释为可直接进入 `plan-slices`，也不得提前填写 `[code]` 切片。

**有 delta 的代码必需提案也必须保留 `[code]` 标题（fix-missing-code-section-slice-gate）**：

在 split-slice-planner-stage 下，`change-writer` 仍然严禁在 plan 段填写 `[code]` 切片条目；但“保留空 `## [code]` 标题”和“提前填写切片条目”是两件不同的事。

- 凡 proposal / 用户描述 / delta 任务表明后续需要代码实现，`tasks.md` 必须保留空 `## [code] 代码实现` 标题。
- 该规则同时适用于有 `[delta]` 的代码级提案和无 `[delta]` 的纯代码提案。
- 如果 `[delta]` 会新增或修改 `UT-*` / `ST-*` / `SMOKE-*` 测试用例，且这些用例需要业务代码、测试代码、runner、reporter 或 golden 落地，则必须保留空 `## [code]` 标题。
- `## [code]` 标题下只能写占位说明，不得写任何 `- [ ]` 切片任务；真实切片由 merge 后 `slice-planner` 统一填写。

推荐占位：

```markdown
## [code] 代码实现
（本段在 plan 段留空：本提案需要代码实现，但 `[code]` 切片由 merge 后的 `slice-planner` 基于已合并规格和真实 UT/ST ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。）
```

缺失 `## [code]` 标题会让后续状态派生失去“需要切片”的结构锚点。在有 `[delta]` 且新增测试规格的代码级提案中，缺失标题不得被下游解释为“无需代码”；但 change-writer 必须从产物源头减少这种异常态。若不确定是否需要代码，优先保留空 `## [code]` 标题，让 merge 后的 slice-planner 基于已合并规格和真实测试 ID 作最终规划。

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

### Step 6 补充：plan 门与 delta / no-delta spec-complete 时机

change-flow-redesign 把前段流程拆为 `plan{写提案, 划分tasks}` → `spec{写delta 或 no-delta spec-complete}` → `merge/spec-complete`，并在 `plan` 出口新增「批准方案」人类门。split-slice-planner-stage 起，`[code]` 切片划分移出 plan 门，改在 spec-complete 后 `slice` 段由 `slice-planner` 产出。

- 有 `[delta]` 的提案：plan 门确认后，change-writer 只按 `[delta]` section 产出 delta 文件；全部完成后提醒用户或 driver 执行 `openlogos merge <slug>`。
- 无 `[delta]` 的纯代码提案：change-writer 不产 delta；plan 门确认后，下一步是 no-delta `openlogos merge <slug>` 写入 `SPEC_MERGED`，再由 `slice-planner` 规划 `[code]`。
- 任意代码提案：测试 ID 未稳定时不得进入 `plan-slices`，不得用占位 ID 预写切片。

## Step 6 补充二：GUI 项目提案阶段前置 UI/UX 原型（proposal-ui-ux-first）

对已 `launched` 的 **GUI 产品项目**（网站 / 桌面应用 / 移动 App），当本次变更触及界面时，change-writer 在**提案阶段**（plan 节点、`plan-exit` 门**前**）就用 `ui-ux-pro-max` 设计系统产出界面原型，使用户在批准提案时（**面板已渲染原型的前提下**）连界面一起确认，避免「批准后自动实现才发现界面不对」的高成本返工。**复用现有 `plan-exit`（批准方案）门——不新增门态、不新增确认标记、不新增 `ui/` 目录。** 非 GUI 项目（纯 CLI / API / 纯后端服务 / Skills）整个特性不启用，本节全部跳过、流程零改动。

> 本节只定义 change-writer 侧的 **producer 产出职责与可交付要求**；driver 在 plan 节点**派发** change-writer 产原型（producer dispatch）、面板渲染原型、批准时写 provenance 均归 runlogos 关联 change `ui-ux-first-panel`，本节不含其实现。

### ① 触发条件：先判 `product_type`，再判本次是否动界面（去循环依赖）

判定在 **plan 阶段由 change-writer 执行**，分两层，**依据是「提案意图 + 已规划的 `[delta]` 目标」，而非扫描尚不存在的 delta 文件内容**（plan 阶段无 delta 可扫，「先 delta 还是先原型」构成循环依赖，故不扫 delta 内容）：

1. **先判 `product_type` 是否 ∈ GUI**：从 `logos/logos-project.yaml` 的 `product_type` / `tech_stack` 读取。
   - ✅ GUI 类：Web 应用 / 移动应用 / 桌面应用（Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK 等）/ 混合型中含 GUI 交付物的部分。
   - ❌ 非 GUI 类：纯 CLI / Library / AI Skills / 纯 API 服务 / 纯后端服务（`service`：常驻 worker / 定时循环任务 / 消息消费者等，无对外接口）—— 整节跳过、`ui_impact` 恒为 `false`、不注入声明段。
2. **再判本次是否动界面**（仅当 `product_type ∈ GUI`）：
   - **依据 = 提案意图 + `tasks.md` 已规划的 `[delta]` 目标是否命中 `2-page-design/`，或命中含交互变更的 feature-specs delta**。命中即**强制判为「动了界面」**（`ui_impact:true`）。
   - **不扫描尚不存在的 delta 内容**（去循环依赖）。
   - 可选多 agent 复核默认**关**，可由 driver 派发。

判定容错优先流程平滑：作为增益功能，判错代价可控（顶多多画一次或退回重设），不追求绝对严谨。

### ② change-writer 作为 plan 节点 producer，被 driver 在 plan-exit 门前 dispatch 产原型

- 原型产出是 **plan 节点门前的普通内容生成**，授权状态与「写 `proposal.md` / `tasks.md`」**完全相同**——**不新增授权、不新增门**。唯一人类确认点仍是 `plan-exit`。
- driver 在 plan 节点判定 `ui_impact:true` 且**前置能力就绪**时，**派发 change-writer（用 ui-ux-pro-max）在 `plan-exit` 前产出原型**（producer dispatch）。这属既有 plan 节点执行范围，driver 实现归 runlogos `ui-ux-first-panel`。
- change-writer 的写入由 guard 的 **plan 阶段写入 allowlist（仅放行 `deltas/prd/2-product-design/2-page-design/*.html`）** 授权；其余 `deltas/**` 在 plan 阶段仍禁止写入，越界路径被 guard 拒。
- `--auto` 下 `plan-exit`（`skippable:true`）自动放行，但原型已在门前产出、provenance 已记录。

### ③ ui-ux-pro-max 生成步骤（调用设计系统）

复用 product-designer 的 Step 5a UI/UX 子流程（见 `skills/product-designer/SKILL.md`），在提案阶段前移使用：

1. 从提案意图 + Phase 1 需求文档提取关键词：产品类型（SaaS / e-commerce / dashboard / portfolio 等）+ 行业 + 风格倾向。
2. 调用 `ui-ux-pro-max` 获取设计系统（风格 + 调色板 + 字体配对 + 登陆页模式 + 反模式清单），并落地 `design-system.json` 令牌（此为正常路径，置 `design_system_mode: generated`）：
   ```bash
   python3 logos/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <style_keywords>" --design-system -p "<项目名>"
   ```
3. 以设计系统为视觉基础，为**结构化声明清单里的每个页面**（每条 `id` / `prototype`）产出裸 HTML 原型（关键几屏 + 各交互状态：空态 / 加载 / 正常 / 错误 / 边界态）。

### ④ 可交付要求：声明清单 == 产出文件（F1 R5，逐页 + 非空 + 令牌）

「文件存在」只是弱收敛（文件可能为空、非 ui-ux-pro-max 产物、或声明多页只产一页）。change-writer 的**可交付标准**收紧为：

- **逐页非空**：UI/UX 变更声明段声明的**每一个页面**（结构化清单中每条 `id` / `prototype` 记录），都在 `deltas/prd/2-product-design/2-page-design/` 下有 basename 精确匹配的**非空原型文件**（不是「至少一个文件」）。
- **令牌追溯（仅 `design_system_mode: generated`）**：`design_system_mode: generated` 时，提案目录 `logos/changes/<slug>/` 下留存合法非空 `design-system.json`（ui-ux-pro-max 令牌），把每个原型系到设计系统。`design_system_mode: fallback` 时**不产 / 不要求 `design-system.json`、禁伪造令牌**（详见 ⑥）。
- **完整性判据（三方对账，按 basename 集合）**：(i) `proposal.md` 声明段 `ui_impact` + 结构化声明页清单（每条的 `prototype` basename）；(ii) `2-page-design/` 下实际产出的原型文件 basename；(iii) merge 落盘 / 面板渲染对象。**声明清单 basename 集合 == 产出文件 basename 集合** 为完整性判据（排序无关；重复 / 额外 / 缺失均失败）；不一致 = 节点未收敛（advisory）。`PLAN_APPROVED.pages` / `hashes` 复用同一 basename 键。
- 该可交付要求由 overlay-add 节点 `write-ui-prototype` 的 `done_when: cmd:<check-ui-prototype>` 做**富对账**作为 `plan-exit` 前的机器收敛条件——命令 `exit 0` 节点才 done、plan 子流程才完成、plan-exit 门才可放行。checker 按 `design_system_mode` 分流：
  - `generated` → 合法非空 `design-system.json`（令牌）+ 逐页非空 + 声明清单==产出文件（basename 集合一致）→ `exit 0`；`generated` 但无令牌 → fail closed。
  - `fallback` → 必须有非空 `design_system_fallback_reason`（如「Python3 缺失」），**禁伪造令牌、不要求 `design-system.json`**，逐页非空 + 清单一致即 `exit 0`（不阻塞、plan-exit 可到达）。
  - 其它值 / 缺 `design_system_mode` 字段 → fail closed。
- **残差（如实标注）**：「HTML 是否*真出自* ui-ux-pro-max」除 `design-system.json` 令牌可追溯外**无法纯机器证明**——这是既有 acceptance 口径下的荣誉制 + 令牌追溯限制，如实记录、非遗漏。

### ⑤ 原型作为 page-design delta 产出 + 填写声明段

- **原型路径**：直接作为 page-design delta 写入 `logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html`（裸 HTML，可直接 iframe 渲染）。
- **不新增 `ui/` 目录、复用现有 delta 路径映射**（`deltas/prd/** → resources/prd/**`）：面板已用 `readDir(deltas/**/*)` 列出可直接渲染。但原型资产的落盘**不复用 `scanDeltas`/merge-executor 的整份拷贝路径**——所有 `ui_impact` 原型一律由 `openlogos merge` 内专用事务落盘入口 `commitVerifiedPrototypes()` 统一提交（严格模式对 staged 字节做 hash 校验 + 原子提交；advisory 模式同一入口、不做严格 hash 校验），**merge-executor 绝不触碰原型资产**、无第二条绕过路径。「复用路径映射」仅指无额外人工步骤，**非**「无新代码路径」。
- **填写声明段**：在 `proposal.md` 的「UI/UX 变更声明」段写入：
  - `ui_impact`：布尔（本次是否触及界面，权威意图源 / 单一事实源）。
  - `design_system_mode`：`generated | fallback`（是否走了设计系统的单一权威事实源）。`generated` 时同时产出 `design-system.json`；`fallback` 时须填 `design_system_fallback_reason` 且不产 / 不要求 `design-system.json`（见 ⑥）。
  - **结构化声明页清单**：本次原型应覆盖的每个页面 / 屏幕作为一条**结构化记录**填写——每页一个唯一 `id`、精确的 `prototype` basename（仅文件名，禁 `..` / 子目录，扩展名必须 `.html`，全清单唯一）、一句话 `description`：
    ```
    - id: <unique-page-id>
      prototype: core-NN-<slug>.html
      description: <一句话>
    ```
    以 `prototype` basename 集合保证「声明清单 == 产出文件」可机器判定（排序无关；重复 / 额外 / 缺失均失败）。
- `proposal.md` 保持 markdown 结构不变，避免打断 CLI / runlogos 对 proposal 的解析。声明段是下游 `flow-derive` / guard / 面板 / checker 的**唯一意图事实源**，不引入第二处判定。

### ⑥ Python3 降级：置 `design_system_mode: fallback`（通用风格兜底，不阻塞、不产令牌）

检测不到 `python3` 时跳过 ui-ux-pro-max 调用，提示用户「检测到 ui-ux-pro-max 依赖的 Python 3 不可用。原型将使用通用风格生成。如需专业级设计系统建议，请安装 Python 3 后重试。」：

- 原型**用通用风格继续产出**结构化声明清单里的每个页面，**不阻塞、不报错**。
- 在声明段置 `design_system_mode: fallback` 并填 `design_system_fallback_reason`（如「Python3 缺失」）；此情形下**不产出 / 不要求 `design-system.json` 令牌，禁伪造令牌**。
- 此时 checker `check-ui-prototype` 走 `fallback` 分支：只要 `design_system_fallback_reason` 非空、逐页非空、声明清单 == 产出文件（basename 集合一致）即 `exit 0`——**不因缺 `design-system.json` 而阻塞**，plan-exit 门可到达。这消解了「降级不产令牌，但 `done_when` 却强制要 `design-system.json` → 卡死」的矛盾。
- 正常路径（`python3` 可用、走了设计系统）则置 `design_system_mode: generated` 并产出 `design-system.json`（见 ③ / ④），checker 走 `generated` 分支要求合法非空令牌。
- 与提案「Python3 缺失时以通用风格兜底并标注，不阻塞」的口径一致。

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

**两档模式（半自动 / 全自动）的授权语义**：

- **半自动 / 手动（无 `--auto`）**：所有人类确认点行为**完全不变**——`merge`、部署执行、`smoke`、`archive`、`git push` 仍各自停在对应门，逐次等人类明确授权。
- **全自动 / 无人值守（`openlogos next --auto`）**：`--auto` 的含义被重定义为一次性的 **standing run-scoped 授权**——用户选择 `--auto` 即在本次运行域内一次性授权全链路自动到底，无需对每道门逐次再确认。

**全自动 `--auto` 下的自动放行范围（依据 `spec/change-management.md` §143「无人值守 skip-gate 例外」）**：
- `spec` 出口门（`spec-exit`，审 delta + 授权合并）与 `deliver` 入口门（`deliver-entry`，部署执行）这两道 `skippable:true` 门可被**编排器（driver）**自动放行。据此 `openlogos merge` 由编排器凭本次 `next --auto` 响应的 `gate_auto_passed=true` 执行，无需逐次人类授权。
- **「代码已绿后的盖章 / 发布」4 样红线在全自动下由 standing 授权自动放行**：`openlogos verify`、`openlogos smoke`、`openlogos archive`、`git push`。它们均属"代码已收敛/已绿之后"的盖章或发布动作，`--auto` 下凭用户选择 `--auto` 这一次性授权放行，半自动 / 手动下仍逐次须人类明确授权。
- 可跳门每次放行向 `GATE_AUTO_PASSED` 追加一行审计（append-only，历史审计行不构成对后续动作的授权）；`git push` **无需任何 marker / guard 改动**——`plugin/bin/guard-check` 的安全白名单本就含 `^git push`、PreToolUse guard 从不拦截 `git push`，全自动下它是否执行纯由生成进 AGENTS.md / CLAUDE.md 的指令文本授权。
- **被派发的 change-writer agent 自身仍不直接执行 `openlogos merge`**：产出全部 delta 后停手、把控制权交回编排器，由编排器走自动合并。这与默认/手动模式下"提醒用户授权"并不矛盾——`--auto` 只是把"授权"前置到了用户选择 `--auto` 这一步。
- **硬红线（任何模式都绝不自动放行，含 `--auto`）**：`gate:implement:loop-exhausted`（未收敛 / 未绿代码，默认 `skippable:false`）。这是唯一在 `--auto` 下也始终须人类明确授权的门，现有逻辑一字不改——自动放行只发生在"代码已绿"之后，绝不跨越"代码未绿"这条线。

merge 后的后续提示应按半 / 全自动两档区分：

- **半自动 / 手动**：
  - 不需要部署：实现代码 → 用户授权 `openlogos verify` → 用户授权 `openlogos archive` →（如需）用户确认 `git push`
  - 需要部署：实现代码 → 用户授权 `openlogos verify` → 用户明确授权部署 → 用户授权 `openlogos smoke` → 用户授权 `openlogos archive` →（如需）用户确认 `git push`
- **全自动 `--auto`**：代码绿后 `verify` / 部署执行 / `smoke` / `archive` / `git push` 均由 standing 授权经编排器自动放行（可跳门逐次写 `GATE_AUTO_PASSED` 审计；`git push` 由 guard 本就放行 + 指令文本授权，不涉及任何 marker），无需逐次人类授权；唯独 `loop-exhausted`（代码未绿）仍停门等人类。

AI 只负责驱动内容修改。半自动 / 手动下不得在未获明确授权的情况下推进提案状态；全自动 `--auto` 无人值守下，对 `spec-exit` / `deliver-entry` 两道可跳门，以及代码绿后的 `verify` / `smoke` / `archive` / `git push` 的放行均属 §143 standing 授权范围内的自动推进，放行依据为本次 `next --auto` 响应的 `gate_auto_passed=true`（`git push` 由 guard 本就放行、全自动下纯由指令文本授权，无需 marker / guard 改动），但 `loop-exhausted` 永不在自动放行之列。

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

## Step 6 补充三：存量逆向基线的 JIT 深化 advisory（brownfield-adopter S33，不设硬门）

> 适用范围：`bootstrap: adopted` 模块下，本次 change 的**目标区域只有 `verified: false` 的逆向 spec**（种子基线，见 S33）时启用。其余情形 change-writer 行为零改动。

**判定（只读已合并主文档）**：对本次 `[delta]` 触碰的每个目标主文档，读其 `## 逆向基线来源` 章节——若该章节存在候选、且其 active/tombstone 候选**全部** `verified: false`（无 human-verified），则该区域为「未验证逆向区域」。判定只读 `logos/resources/` 已合并主文档，**不看未合并 delta**（advisory 不因未合并 delta 前移/消失）。CLI 侧支撑 helper：`cli/src/lib/baseline-jit.ts` 的 `detectBaselineJitAdvisory(root, slug)`。

**advisory（建议、不阻断）**：检测到未验证逆向区域时，change-writer 给出建议——**在当前 change 的单份最终态 delta 内**，把对应 `## 逆向基线来源` 候选置 `verified: true` 并记 `confirmed_by` / `evidence` / `confirmed_at`，与本次前向改动**一并落盘**（同一个 `MODIFIED` 章节替换即可原子承载「确认现状 + 前向改动」）。

**硬约束（务必遵守）**：
1. **单份最终态 delta**：每个被触碰目标文档只产出一份 delta（现行 `deltas/** → 主文档` 1:1 映射、`MODIFIED` 替换同名章节）；**不生成第二份「现状确认 delta」**、不引入双有序 delta / 多操作 delta 协议。
2. **不直接改 `resources/**`、不嵌套第二个 change**（guard 互斥）；现状确认作为审计事实记在该章节 + `tasks.md` `[delta]` 勾稽对应候选 ID。
3. **`human-verified` 仅 merge 后生效**：merge 前主文档仍 `verified: false`，覆盖率只读已合并主文档、不因未合并 delta 前移。
4. **不设硬门**：用户可跳过建议、直接写前向 delta；该区域 `verified` 保持 `false`、覆盖率不前移。change-writer 不得阻断。

## 硬性交付门：openlogos change-lint（Step 5 / Step 6 完成后强制）

> change-lint-shift-left 起，本 Skill 的自检从「逐项人工核对」升格为**机器硬门**。适用于 Step 5（`proposal.md` + `tasks.md` 生成完毕、含部署决策一致性自检表核对之后）与 Step 6（全部 delta 文件产出完毕之后）两个交付点。

**规则（强制）**：

1. 每个交付点完成后，必须运行：
   ```bash
   cd <项目根目录> && openlogos change-lint
   ```
   （检查活跃提案；需要时可 `--slug <slug>` 显式指定，`--format json` 供程序化消费。）
2. **exit 0 才可交付**——才允许报告"本步骤完成"、把控制权交回用户或 driver。
3. **exit 2（检查红）**：按输出中每条 violation 的「缺什么 / 在哪补 / 补成什么样（fix_hint）」逐条修复后**重跑**，直至 exit 0；禁止带红交付。
4. **exit 1（操作错误）**：按 stderr message 排障（如无活跃提案、slug 非法），修复环境后重跑。
5. 该命令只读、非人类确认点，运行不需要额外授权，也**不**替代 `openlogos merge` 等人类确认点。

**plan 段的 L3 证据指引**（避免死锁与假通过）：plan 阶段测试 ID 通常尚未定稿，L3 只认两种证据——(a) `tasks.md` `[delta]` 中规划了测试规格 delta（目标含 `deltas/test/`）；(b) `proposal.md` 中标题**精确**为 `## 复用测试 ID` 的小节，每行 `- <ID> — <一句话用途>`，ID 必须**精确存在于已合并** `logos/resources/test/` 规格（固定语法与逐项判定规则见功能规格 §2.30）。**禁止**用占位 ID（`UT-Sxx-xx`、`TBD`、`TODO`）或通配族名（`UT-Sxx-*`）蒙混——lint 与 flow-derive 一律拒绝采信。注意证据等级随阶段自动升级：`[delta]` 任务**全部勾选**后，任务文字里的 `deltas/test/` 规划字样不再充当证据，必须有实际产出的测试 delta 文件或合法复用清单。**producer 规则**：`[delta]` section 只含一文件一任务的 delta 产出 checkbox；非 delta / merge-time 工作（如「merge 时同步更新元数据」）**不得以 checkbox 形式写入 `[delta]`**（用说明文字或独立小节承载）——否则延后条目会把已完成的 delta 证据等级错误压回 plan 级（阶段分类的勾选度计数基仅含 delta 产出条目，见功能规格 §2.30）。

**delta 产出的 L4 提醒**：每个 `.md` delta 必须含 ADDED/MODIFIED/REMOVED 段标记**且**已把模板占位字面量（如 `[新增章节标题]`、`[新增的完整内容]`）替换为真实内容——只要正文中残留任一**独占一行**的占位字面量（含「真实内容 + 未替换占位行」的混合形态）即命中模板骨架，会被 lint 与 merge 同时拒绝；行内代码/代码围栏中的引用不受影响。
