---
title: 工作流规格
description: 三层推进模型（WHY → WHAT → HOW）、阶段检测逻辑与质量关卡。
---

工作流规格定义了 OpenLogos 项目如何经历三个阶段——**WHY → WHAT → HOW**——并以场景作为贯穿从需求到验证全过程的统一主线。

## 核心设计：场景串联

**场景是贯穿整个开发生命周期的锚点。** 同一个场景会在三个阶段中被逐步展开：

```
Scenario S01: Email Registration

Phase 1 (WHY)  → Who needs it? What pain point? What are normal/exception expectations?
Phase 2 (WHAT) → What pages does the user see? What's the interaction flow?
Phase 3 (HOW)  → What's the system call chain? API contracts? DB schema? How to test?
```

场景 ID（`S01`、`S02`……）全局唯一，在 Phase 1 中定义并一路延续到 Phase 3 验证。无需单独的追溯矩阵——**场景本身就是追溯链**。

## 阶段总览

```
Phase 1: WHY — Why are we building this?
├── User research → Pain point extraction → Scenario identification → Prioritization
├── Output: Requirements document (scenario-driven + GIVEN/WHEN/THEN acceptance criteria)
└── Quality gate → Gate 1

Phase 2: WHAT — What are we building?
├── Information architecture → Interaction refinement → Feature specs → HTML prototypes
├── Output: Product design docs + HTML prototypes (organized by scenario)
└── Quality gate → Gate 2

Phase 3: HOW — How do we build it?
├── Step 0: Architecture overview (system architecture, tech stack, deployment)
├── Step 1: Scenario → Sequence diagram → APIs emerge
├── Step 2: API spec design → DB schema derivation
├── Step 3: Deployment plan design (deployment-designer Skill)
├── Step 4: Test design (test-first)
│   ├── 4a: Unit test + scenario test case design (all projects)
│   └── 4b: API orchestration test design (API projects only)
├── Step 5: Code generation + test code (code-implementor Skill)
├── Step 6: Test verification (openlogos verify)
├── Step 7: Deployment execution (deployment-executor Skill, human authorization)
├── Step 8: Smoke verification (openlogos smoke)
└── Quality gates → Gate 3.0 ~ Gate 3.8
```

## 场景 ID 约定

| 规则 | 格式 | 示例 |
|------|--------|---------|
| 标准 | `S{两位数字}` | `S01`、`S02` |
| 子场景 | `S{id}.{sub}` | `S01.1`、`S01.2` |
| 范围 | 在项目生命周期内全局唯一 | — |

场景不等同于功能——一个功能可能涉及多个场景，一个场景也可能跨越多个功能。

## Phase 1：WHY——需求

### 目标

明确要解决什么问题，定义核心业务场景，并为每个场景编写业务层面的验收标准。

### 活动

1. **用户调研**——了解目标用户、痛点和使用情境
2. **痛点提炼**——每个痛点都有一条因果链（起因 → 痛点 → 后果）
3. **场景识别**——将痛点转化为具体的用户场景，并分配 ID
4. **优先级排序**——按优先级对场景排序（P0 / P1 / P2）
5. **验收标准**——为每个核心场景编写 GIVEN/WHEN/THEN

### 产出

需求文档存放于 `logos/resources/prd/1-product-requirements/`：

- 产品背景与目标（定位、核心目标、用户画像）
- 用户痛点分析（因果链格式）
- 核心场景定义（场景表 + 每个场景的验收标准）
- 约束与边界（技术/资源约束 + 「不做」清单）

### 场景定义格式（Phase 1 粒度）

```markdown
### S01: Scenario Name

- **Trigger**: Who enters this scenario, under what conditions
- **User value**: What pain point it solves (trace to pain point ID)
- **Priority**: P0
- **Happy path**: [Natural language description of normal flow]

#### Acceptance Criteria

##### Normal: [Scenario name]
- **GIVEN** [Initial condition]
- **WHEN** [User action]
- **THEN** [Expected result]

##### Exception: [Exception scenario name]
- **GIVEN** [Initial condition]
- **WHEN** [Action] + [Exception trigger]
- **THEN** [Error handling behavior]
```

### Gate 1 检查清单

- [ ] 每个痛点都有因果链
- [ ] 核心场景已识别并编号（`S01`、`S02`……）
- [ ] 每个 P0/P1 场景都有 GIVEN/WHEN/THEN 标准（至少 1 个正常 + 1 个异常）
- [ ] 目标用户画像足够具体，能描绘出一个真实的人
- [ ] 场景优先级已排序
- [ ] 「不做」清单明确

## Phase 2：WHAT——产品设计

### 目标

设计具体的解决方案。以 Phase 1 的场景为骨架，为每个场景细化交互流程、页面设计和功能规格。

### 活动

1. **信息架构**——产品结构、导航层级、内容组织
2. **交互细化**——完善每个场景的页面流程和交互细节
3. **功能规格**——详细描述 + UI 层面的 GIVEN/WHEN/THEN
4. **HTML 原型**——AI 生成 HTML 页面作为产品原型
5. **设计规范**——全局 UI 约定

### 产出

存放于 `logos/resources/prd/2-product-design/`：

- `1-feature-specs/`——产品设计文档（信息架构 + 功能规格，按场景组织）
- `2-page-design/`——HTML 原型

### 场景展开（Phase 2 粒度）

Phase 2 在 Phase 1 场景的基础上增加交互细节：

- 涉及哪些页面/组件
- 页面间的跳转逻辑
- 表单字段和校验规则
- 状态展示（加载中、空状态、错误）
- 更细的 GIVEN/WHEN/THEN（细化到按钮和 UI 元素层面）

如果某个 Phase 1 场景过大，可在此阶段拆分为子场景（`S01.1`、`S01.2`）。

### Gate 2 检查清单

- [ ] 每个 P0/P1 场景都有详细的交互规格 + GIVEN/WHEN/THEN
- [ ] 所有核心页面都有 HTML 原型
- [ ] 已考虑异常状态（错误 / 空 / 加载中）
- [ ] 场景 ID 与 Phase 1 保持一致（允许拆分子场景）

## Phase 3：HOW——技术实现

### Step 0：架构总览

在进入逐场景实现之前，先建立项目的技术全局视图。这能确保后续所有时序图、API 设计和代码生成都在一致的架构约束下进行。

**活动：**

1. **系统架构图**——整体拓扑（前端、后端、数据库、第三方服务）、系统边界与交互模式
2. **技术选型决策**——语言、框架、数据库、部署——每项都附理由
3. **部署拓扑**——开发 / 测试 / 生产环境方案
4. **非功能性约束**——性能目标、安全要求、可扩展性、可观测性
5. **更新 `logos-project.yaml`**——将确定的技术栈写入 `tech_stack` 字段

**产出：** `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md`

**伸缩策略：**
- 简单项目（单体 + 单库）：一段文字 + 一张简单图即可
- 复杂项目（微服务、多数据库、消息队列）：需要详细的架构决策记录

**Gate 3.0**：架构文档完整，技术栈已确认并写入 `logos-project.yaml`。

### Step 1：场景建模（时序图）

将 Phase 1/2 的场景展开为 Mermaid 时序图。图中的跨系统调用箭头就是需要构建的 API。参与者应与 Step 0 中的系统组件保持一致。

**时序图规则：**
- 每个箭头都有 `Step N:` 前缀
- 每个箭头都包含一行行为描述
- 参与者明确标注为系统组件
- 文档标题保留场景 ID：`S01: Email Registration — Sequence Diagram`

**Gate 3.1**：所有核心场景时序图完成，API 端点清晰可见。

### Step 2：API 规格设计 → DB 推导

基于时序图中浮现的 API 端点，设计详细规格（OpenAPI 3.0 YAML）。一旦 API 请求/响应结构定义完毕，DB 表结构便自然推导出来。

**Gate 3.2**：API YAML 和 DB DDL 完整且彼此一致。

### Step 3：部署方案设计

在测试设计之前，先确立部署策略。[`deployment-designer`](/zh/skills/deployment-designer) Skill 产出一份完整的部署方案，涵盖拓扑、环境配置、发布命令、回滚策略和 smoke 测试范围。

**产出**：部署方案存放于 `logos/resources/prd/3-technical-plan/3-deployment/`（如 `core-01-deployment-plan.md`）。

**Gate 3.3**：部署方案完整，已定义环境、命令、回滚策略和 smoke 范围。`deployment_gates` 已写入 `logos-project.yaml`。

### Step 4：测试设计（测试先行）

在写代码之前，先设计完整的测试体系。测试设计拆分为两个子步骤，覆盖测试金字塔：

#### Step 4a：单元测试 + 场景测试用例设计（所有项目）

**范围**：所有项目类型（API 服务、CLI 工具、前端应用、库）。不可跳过。

为每个场景设计两类测试用例：

- **单元测试用例**——单个函数/方法的输入输出正确性
  - 来源：API 字段约束（类型、格式、长度）、DB 约束（UNIQUE、CHECK、NOT NULL）、业务规则、EX 异常情况的错误处理
  - 关注点：边界值、非法输入、异常返回

- **场景测试用例**——代码层面的完整场景流程
  - 来源：时序图 Step 序列（正常路径）、EX 异常情况（异常路径）、Phase 1/2 验收标准
  - 关注点：跨模块调用链正确性、Step 之间的数据传递、失败时的补偿/回滚

**产出**：测试用例规格文档（Markdown），存放于 `logos/resources/test/`，每个场景一个文件（如 `S01-test-cases.md`）。

**Gate 3.4a**：核心场景已设计单元和场景测试用例，覆盖所有 P0 正常路径 + 核心 EX 异常路径。

#### Step 4b：API 编排测试设计（仅 API 项目）

**范围**：涉及 API 的项目。纯 CLI 工具、无 API 的前端库可跳过此步骤。

为每个场景设计 API 编排测试用例：

- **正常路径编排**：主路径 API 调用链
- **异常路径编排**：`EX-{step}.{seq}` 格式
- **边界情况**：合法但非主路径的变体

**产出**：编排测试文件（JSON），存放于 `logos/resources/scenario/`。

**Gate 3.4b**：编排覆盖所有正常路径 + 核心异常路径。

### Step 5：代码生成 + 测试代码

在拥有完整上下文（原型 + 场景 + API + DB + 测试用例 + 编排）的情况下，AI 生成的代码质量远胜于无上下文编码。由 [`code-implementor`](/zh/skills/code-implementor) Skill 驱动，逐场景生成并验证。

代码生成包括：

- **业务代码**——按时序图逐步实现
- **单元测试代码**——基于 Step 4a 单元测试用例规格
- **场景测试代码**——基于 Step 4a 场景测试用例规格
- **OpenLogos reporter**——嵌入测试代码，将结果写入 `logos/resources/verify/test-results.jsonl`（见[测试结果格式](/zh/specs/test-results)）

**Step 5 交付标准（不可妥协）：**

- 只有业务代码、没有对应测试代码 → **Step 5 未完成**
- 只有测试代码、没有对应业务代码 → **Step 5 未完成**
- 交付必须三者俱全：业务代码 + UT/ST 测试代码 + reporter

**分批执行规则（允许分批，每批闭环）：**

- 大任务可按场景或子模块拆分为多个批次
- 每批必须形成最小闭环：**本批业务代码 + 本批测试 + 本批 reporter 可用**
- 每批之前，声明本批覆盖的 UT/ST 用例 ID，确保可追溯到 `logos/resources/test/*.md`
- 不允许将所有测试推迟到最后一批

**Gate 3.5**：代码已审查，单元测试通过，测试环境已部署。

### Step 6：测试验证

运行所有测试以验证代码，使用 `openlogos verify` 进行自动化验收。

**进入 Step 6 的前提：**

- 只有当 Step 5 达成完整交付（业务代码 + UT/ST 测试代码 + reporter）时，才能进入 Step 6
- 若发现「只有业务代码、没有测试」或「测试代码缺少 reporter」，先返回 Step 5
- Step 6 不编写测试代码——它的职责是对 Step 5 的交付物进行自动化判定

**验证流程：**

1. AI 在 Step 5 期间将 OpenLogos reporter 嵌入测试代码（见[测试结果格式](/zh/specs/test-results)）
2. 用户运行测试（`npm test`、`pytest` 等）→ reporter 将每个用例结果写入 `logos/resources/verify/test-results.jsonl`
3. 用户运行 `openlogos verify` → CLI 读取 JSONL + `logos/resources/test/*.md` 中的用例 ID → 计算验收结果

**三层验收判定：**

| 指标 | 定义 |
|--------|-----------|
| 覆盖率 | JSONL 中的用例 ID / test-cases.md 中定义的用例 ID 总数 |
| 通过率 | `status=pass` 的用例 / JSONL 中的用例总数 |
| 需求追溯（可选） | test-cases.md 的覆盖是否横跨 Phase 1 验收标准 |

**验收结果：**

- 全部通过 → 生成 `logos/resources/verify/acceptance-report.md`，终端输出 PASS
- 有失败或缺口 → 生成列出问题的报告，终端输出 FAIL，退出码 1

**Gate 3.6**：`openlogos verify` 输出 PASS（所有用例通过 + 100% 覆盖）。

### Step 7：部署执行

Gate 3.6 通过后，按部署方案（Step 3）执行部署。此步骤需要**明确的人类授权**——AI 不能自动部署。

[`deployment-executor`](/zh/skills/deployment-executor) Skill 负责此步骤：

1. 确认人类授权
2. 读取部署方案和提案中的 `[deploy]` 任务
3. 逐步执行部署命令
4. 生成部署报告（`logos/resources/verify/deployment-report.md`）
5. 引导用户运行 `openlogos smoke`

**Gate 3.7**：部署报告已生成，目标环境可访问。

### Step 8：Smoke 验证

部署完成后，使用 `openlogos smoke` 验证目标环境的健康状态。这是归档前的最后一道质量关卡。

1. `openlogos smoke` 从 `logos/resources/verify/smoke-results.jsonl` 读取 smoke 结果
2. 与 `logos/resources/test/smoke/*.md` 中定义的 `SMOKE-*` 用例 ID 比对
3. 生成 `logos/resources/verify/smoke-report.md`

**Gate 3.8**：`openlogos smoke` 输出 PASS（所有 smoke 用例通过 + 100% 覆盖）。

## 三级场景展开

同一个场景在三个阶段中被逐步细化：

| 阶段 | 视角 | 关注点 | 验收粒度 |
|-------|------------|-------|----------------------|
| Phase 1 | 业务 | 谁需要？为什么？要什么结果？ | 业务行为 GIVEN/WHEN/THEN |
| Phase 2 | 交互 | 用户看到什么？如何交互？ | UI 元素 GIVEN/WHEN/THEN |
| Phase 3 | 技术 | 调用链？API 响应？DB 写入？ | 三层测试（单元 + 场景 + 编排）+ `openlogos verify` |

验收标准逐层细化，到 Phase 3 测试时变得可自动执行。测试结果通过标准化 JSONL 格式输出（见[测试结果格式](/zh/specs/test-results)），由 `openlogos verify` 读取并生成验收报告。无需单独的追溯矩阵——**场景 ID 是追溯链，用例 ID 是验收锚点**。

## 迭代规则

功能迭代**必须**遵循同样的分层工作流，使用 Delta 变更管理系统（见[变更管理](/zh/specs/change-management)）。不允许跳过中间步骤直接修改代码。

迭代可能引起场景变更：新增场景、修改场景或废弃场景。所有变更都通过 `logos/changes/` 提案管理。场景 ID 一经分配，绝不重用。
