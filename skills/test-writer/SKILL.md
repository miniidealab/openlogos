# Skill: Test Writer

> 基于时序图、API 规格和 DB 约束，为每个业务场景设计单元测试用例和场景测试用例。适用于所有项目类型（API 服务、CLI 工具、前端应用、库等），是代码生成前的必要前置步骤。

## 触发条件

- 用户要求设计测试用例或测试方案
- 用户提到 "Phase 3 Step 4a"、"Step 4a"、"测试先行"、"测试设计"
- 已有场景时序图，需要在写代码前设计测试
- 用户指定某个场景编号（如 S01）需要设计测试

## 前置依赖

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图（**必需**）
- `logos/resources/prd/3-technical-plan/3-deployment/` 中包含部署方案（如项目需要部署则必需）
- `logos/resources/api/` 中包含 API 规格（有则读取，无则跳过——非 API 项目可能没有）
- `logos/resources/database/` 中包含 DB DDL（有则读取，无则跳过）
- `logos/resources/prd/1-product-requirements/` 中包含需求文档（用于追溯验收条件）

**不可跳过**：无论项目类型如何，Step 4a（本 Skill）都必须执行。若部署方案声明需要部署，本 Skill 必须一并设计部署后冒烟测试。

## 核心能力

1. 从 API 字段约束（类型、格式、长度、枚举）中提取单元测试用例
2. 从 DB 约束（UNIQUE、CHECK、NOT NULL、FK）中提取单元测试用例
3. 从业务规则和 EX 异常用例中的单点错误处理提取单元测试用例
4. 从时序图 Step 序列提取场景测试用例（主路径）
5. 从 EX 异常用例提取场景测试用例（异常路径）
6. 从部署方案提取 smoke 测试用例（仅需要部署的项目）
7. 从 Phase 1/2 验收条件反向校验测试覆盖完整性

## 执行步骤

### Step 1: 加载场景上下文

读取以下文件建立完整上下文：

- 场景时序图（`logos/resources/prd/3-technical-plan/2-scenario-implementation/`）
- 部署方案（`logos/resources/prd/3-technical-plan/3-deployment/`）—— 如果项目需要部署
- API YAML（`logos/resources/api/`）—— 如果存在
- DB DDL（`logos/resources/database/`）—— 如果存在
- Phase 1 需求文档（验收条件）
- Phase 2 产品设计文档（交互级验收条件）

确认当前场景的：
- **Step 数量**：时序图中有多少个 Step
- **EX 数量**：有多少个异常用例
- **API 端点**：涉及哪些端点及其字段约束
- **DB 表**：涉及哪些表及其约束

### Step 2: 设计单元测试用例

从三类来源提取单元测试用例：

#### 2a: API 字段约束

逐个检查 API 端点的 `requestBody` 和 `parameters`：

- `type` → 类型错误用例（传入错误类型）
- `format`（email、uuid、date-time）→ 格式校验用例
- `minLength` / `maxLength` → 边界值用例（刚好达到、超出 1 位）
- `required` → 必填缺失用例
- `enum` → 枚举值用例（合法值 + 非法值）
- `minimum` / `maximum` → 数值范围用例

#### 2b: DB 约束

逐个检查相关表的约束：

- `UNIQUE` → 重复插入用例
- `NOT NULL` → 空值插入用例
- `CHECK` → 违反检查条件的用例
- `FOREIGN KEY` → 引用不存在记录的用例
- `DEFAULT` → 不传值时默认值验证

#### 2c: 业务规则

从时序图 Step 说明和 EX 异常用例中提取单点业务逻辑：

- 权限检查（未登录、无权限）
- 状态机转换（只有特定状态才能执行操作）
- 限流 / 频控规则
- 数据计算逻辑（金额计算、折扣规则）

**每个单元测试用例格式**：

| 字段 | 说明 |
|------|------|
| ID | `UT-{场景编号}-{序号}`，如 `UT-S01-01` |
| 描述 | 测试什么行为 |
| 来源 | 约束出处（如 `auth.yaml → register → email: format:email`） |
| 前置条件 | 测试前需要的状态 |
| 输入 | 具体输入值 |
| 预期输出 | 期望的返回值或错误信息 |

### Step 3: 设计场景测试用例

从两类来源提取场景测试用例：

#### 3a: 主路径（时序图 Step 序列）

将时序图的完整 Step 1 → Step N 视为一次端到端代码调用链：

- 确定场景的入口和出口
- 标注每个 Step 之间的数据传递（前一步输出作为后一步输入）
- 验证最终状态（数据库记录、返回值）

#### 3b: 异常路径（EX 异常用例）

将每个 EX 异常用例展开为场景测试用例：

- 标注异常在哪个 Step 触发
- 验证异常触发后的处理逻辑（错误返回、补偿/回滚）
- 验证异常未影响其他数据的完整性

**每个场景测试用例格式**：

| 字段 | 说明 |
|------|------|
| ID | `ST-{场景编号}-{序号}`，如 `ST-S01-01`；无法自动化的用例加 `[manual]` 后缀，如 `ST-S01-05 [manual]` |
| 描述 | 测试什么场景流程 |
| 覆盖 Steps | 覆盖时序图的哪些 Step（如 `Step 1→6`）或哪个 EX（如 `EX-2.1`） |
| 前置条件 | 测试前需要的状态和数据 |
| 操作序列 | 按 Step 顺序的操作列表 |
| 预期结果 | 最终状态（返回值 + 数据库状态 + 副作用） |

#### 3c: `[manual]` 标记规则

以下类型的 ST 用例**必须**在 ID 后追加 `[manual]` 标记，`openlogos verify` 会将其从覆盖率计算中排除，不计入 `defined_count`，不出现在 `uncovered_cases`：

- 需要真实 TTY / PTY 渲染（如 CLI 交互式提示、颜色输出、光标控制、进度条）
- 需要跨窗口或多进程协作（如打开新终端窗口、进程间通信）
- 需要人工视觉验证（截图对比、UI 渲染效果、字体/颜色感知）
- 依赖外部硬件或不可模拟的环境（摄像头、蓝牙、特定操作系统 GUI）

**判断标准**：如果该用例在 CI 无头环境中无法稳定运行并自动断言结果，就应加 `[manual]`。

#### 3d: 部署后冒烟测试（需要部署时）

当部署方案存在且声明需要部署时，必须设计 smoke 测试用例。冒烟测试验证“部署后的环境是否可用”，不替代 UT/ST/API 编排测试。

从部署方案中提取以下用例：

- 健康检查：服务进程、HTTP health endpoint、CLI version 或桌面应用启动检查
- 核心入口：主页、登录页、主 API、主命令
- 数据库迁移：关键表/字段存在、迁移版本正确、初始化数据可读
- 静态资源：前端 bundle、图片、CSS、字体或下载资源可访问
- 配置与密钥：必要环境变量存在且没有使用测试占位值
- 关键链路：最小可用用户路径，例如登录、创建一条核心记录、读取结果
- 日志与监控：部署后没有阻断性错误

**每个 smoke 用例格式**：

| 字段 | 说明 |
|------|------|
| ID | `SMOKE-{模块}-{序号}`，如 `SMOKE-core-01` |
| 描述 | 验证什么部署后行为 |
| 来源 | 部署方案章节或检查项 |
| 目标环境 | local / staging / production |
| 前置条件 | 部署完成、迁移完成、必要配置存在 |
| 操作 | 执行的命令、请求或访问动作 |
| 预期结果 | 返回码、页面状态、日志、数据库状态 |

**同步生成 code 阶段任务要求**：

只要本轮新增或修改 `SMOKE-*` 用例，后续 `tasks.md` 的 `[code]` section 必须包含 smoke runner / reporter / dispatcher 闭环任务。测试设计阶段需要在交付说明中明确提醒 change-writer/code-implementor：

- 实现或更新 `scripts/smoke-*.sh`、`scripts/smoke-*.js` 或等效 smoke runner，且 runner 必须覆盖新增或修改的 `SMOKE-*` ID。
- smoke runner 必须写入 `logos/resources/verify/smoke-results.jsonl`，或写入 `logos.config.json.smoke.result_path` 指定路径。
- `logos.config.json.smoke.command` 必须能执行新增 runner；推荐接入统一 `scripts/run-smoke.js` smoke dispatcher 自动发现 `scripts/smoke-*`。
- code 阶段完成前必须运行 smoke 覆盖预检或等效检查，确认新增 `SMOKE-*` 不在 uncovered cases 中。

### Step 4: 覆盖度校验

反向校验测试用例是否覆盖了所有关键约束：

- [ ] Phase 1 每个正常验收条件至少对应 1 个 ST 用例
- [ ] Phase 1 每个异常验收条件至少对应 1 个 ST 或 UT 用例
- [ ] 每个 EX 异常用例至少对应 1 个 ST 用例
- [ ] API 每个 `required` 字段至少 1 个 UT 用例
- [ ] DB 每个 `UNIQUE` / `CHECK` 约束至少 1 个 UT 用例
- [ ] 如需要部署，部署方案中的每个部署后检查项至少对应 1 个 SMOKE 用例

如有未覆盖项，补充用例或向用户说明理由。

### Step 5: 验收条件追溯

将 Phase 1 需求文档中的每个 GIVEN/WHEN/THEN 验收条件提取出来，为每条分配一个追溯 ID，并关联到覆盖该条件的测试用例 ID。

#### 验收条件 ID 规则

- 格式：`{场景编号}-AC-{两位序号}`，如 `S01-AC-01`、`S01-AC-02`
- 按需求文档中出现的顺序编号，正常和异常条件统一编号
- 同一场景的 AC ID 必须连续且唯一

#### 追溯表填写规则

1. 从需求文档读取当前场景的所有验收条件（正常 + 异常）
2. 为每条验收条件分配 AC ID
3. 找到覆盖该条件的测试用例 ID（可以是 UT 或 ST），填入「覆盖用例」列
4. 每个 AC 至少关联 1 个测试用例；如果无法覆盖，在「覆盖用例」列注明原因

`openlogos verify` 会解析此追溯表，将 AC → 用例 ID → 运行结果三层联动，生成完整的验收追溯报告。

### Step 6: 输出测试用例规格文档

按场景输出 Markdown 格式的测试用例规格文档。若需要部署，同时输出 smoke 测试用例规格文档。

### Step 7: 引导后续操作

根据项目类型引导用户进入下一步：

- **涉及 API** → 「继续进入 Step 4b 设计 API 编排测试？」
- **不涉及 API** → 「测试设计已完成，建议进入代码生成：对我说『按 S01 的规格帮我实现』」

## 输出规范

- **文件格式**：Markdown
- **存放位置**：`logos/resources/test/`
- **命名规则**：`<module>-{场景编号}-test-cases.md`（如 `core-S01-test-cases.md`；从 `logos-project.yaml` 的 `modules[]` 读取当前模块，默认为 `core`）
- 每个文件包含：单元测试用例（按来源分组）+ 场景测试用例（主路径 + 异常路径）
- **Smoke 存放位置**：`logos/resources/test/smoke/`
- **Smoke 命名规则**：`<module>-smoke-test-cases.md`
- 用例 ID 全局唯一：`UT-{场景编号}-{序号}` / `ST-{场景编号}-{序号}` / `SMOKE-{module}-{序号}`

### 文档结构模板

```markdown
# {场景编号}: {场景名称} — 测试用例

## 一、单元测试用例

### 1.1 {分组名称}（来源：{约束出处}）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-01 | ... | ... | ... | ... | ... |

## 二、场景测试用例

### 2.1 主路径：{场景名称}

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | ... | Step 1→6 | ... | ... | ... |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S01-02 | ... | EX-2.1 | ... | ... | ... |

### 2.3 人工验证用例（[manual]）

> 以下用例需要真实 TTY/PTY 渲染或人工视觉验证，无法在 CI 中自动断言，标记为 [manual]。
> `openlogos verify` 不会将其计入覆盖率，也不会报告为未覆盖。

| ID | 描述 | 覆盖 Steps | 验证方式 |
|----|------|-----------|---------|
| ST-S01-05 [manual] | 交互式提示颜色和光标渲染正确 | Step 2 | 人工在真实终端观察 |

## 三、覆盖度校验

- [x] Phase 1 正常验收条件：全部覆盖
- [x] Phase 1 异常验收条件：全部覆盖
- [x] EX 异常用例：全部覆盖
- [x] API required 字段：全部覆盖
- [x] DB UNIQUE/CHECK 约束：全部覆盖

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S01-AC-01 | 正常：全新项目初始化 — 创建完整目录结构 | ST-S01-01 |
| S01-AC-02 | 正常：显式项目名与配置文件不一致时确认 | ST-S01-02 |
| S01-AC-03 | 异常：项目已初始化 — 显示错误提示 | ST-S01-03, UT-S01-05 |
```

### Smoke 文档结构模板

```markdown
# {module}: 部署后冒烟测试用例

## 一、冒烟测试范围

| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | 健康检查、核心 API、迁移检查 | launch 前必跑 |

## 二、冒烟测试用例

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-01 | 健康检查接口可访问 | 部署方案：部署后检查 | staging | 服务已部署 | GET /health | 200 OK |

## 三、覆盖度校验

- [x] 健康检查：已覆盖
- [x] 核心入口：已覆盖
- [x] 数据库迁移：已覆盖
- [x] 静态资源：已覆盖
- [x] 关键链路：已覆盖
```

## 用例 ID 合约

用例 ID（`UT-S01-01`、`ST-S01-01`）是设计文档与运行时的**绑定合约**：

- 在 test-cases.md 中定义的 ID，必须在生成的测试代码中被原样使用
- 测试代码的 reporter 会把每个用例的 ID 和运行结果写入 JSONL 文件
- `openlogos verify` 通过 ID 将运行结果映射回测试用例规格，自动判定验收
- `SMOKE-*` 由 smoke 测试脚本写入 `smoke-results.jsonl`，供 `openlogos smoke` 判定
- 修改用例 ID 时必须同步修改对应测试代码或 smoke 脚本中的 ID

详细的 JSONL 格式定义和各语言 reporter 代码模板见 `logos/spec/test-results.md`。

## 实践经验

- **测试用例是设计文档，不是代码**：本 Skill 产出的是 Markdown 格式的测试用例规格，具体的测试代码在 Step 5 代码生成阶段由 AI 基于此规格实现
- **先单元后场景**：单元测试用例覆盖单个函数的正确性，场景测试覆盖跨模块串联——先确保积木正确，再验证积木拼接
- **不要遗漏 DB 约束**：很多 Bug 来自数据库层面的约束违反，DB 约束是单元测试用例的重要来源
- **场景测试关注数据传递**：Step 间的数据传递（前一步输出 → 后一步输入）是最容易出错的地方
- **EX 异常用例必须有对应的场景测试**：时序图中标注的每个 EX 都应该在场景测试中有体现
- **边界值优先**：单元测试用例优先覆盖边界值（刚好合法、刚好非法），而不是随机值
- **与 test-orchestrator 互补**：本 Skill 设计代码层面的测试（函数调用级），test-orchestrator 设计 API 层面的测试（HTTP 请求级）。二者共同覆盖"测试金字塔"的不同层级
- **用例 ID 是跨阶段合约**：ID 贯穿 test-cases.md → 测试代码 → test-results.jsonl → acceptance-report.md，任何一处不一致都会导致 `openlogos verify` 报告不完整

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我设计测试用例`
- `帮我设计 S01 的单元测试和场景测试`
- `帮我给所有 P0 场景设计测试用例`
- `帮我检查 S01 的测试覆盖度`

## ⚠️ 收尾步骤（强制）：更新 resource_index

完成本 Skill 的所有测试用例文档产出后，**必须**将新生成的文件追加写入 `logos/logos-project.yaml` 的 `resource_index` 字段：

```yaml
resource_index:
  # ...已有条目...
  - path: logos/resources/test/core-S01-test-cases.md
    desc: S01 <场景名称>测试用例。涉及 UT-S01（单元测试）与 ST-S01（场景测试）的实现与验收时必读。
  # 每个场景的测试用例文件均需单独一条
```

**不执行此步骤将导致 code-implementor 无法感知测试用例规格，AI 在生成测试代码时无法与用例 ID 对齐，最终 `openlogos verify` 将报告覆盖度不足。**

## S39 delta 模式：触达场景的完整 UT/ST 与唯一测试 delta

### 强制适用

所有 on-touch-v1 触达场景都必须有 UT/ST 规格；测试类别不能 SKIP。API 编排由 test-orchestrator 另行补充，但不能替代本 Skill 的单元/场景测试。

### 输入事实源

读取 effective requirement、feature、scenario、architecture、API、DB 与当前 change 已产 deltas。测试不得基于旧主文档平行猜测。现有测试代码可证明存量覆盖，但不能替代本次新增验收规格。

### MODIFY

- 测试目标存在时，在同一个 canonical target delta 中加入/修改所有相关 UT/ST；
- MODIFIED 测试表必须携既有 ID 全量结构，遵守 S37；新增章节可同文件 ADDED；
- 多场景共享测试文件时合并一 task/一 delta；
- 不把“补历史测试”与“新增测试”拆成两份 delta。

### CREATE

目标缺失时返回完整测试规格，至少包含：

1. 场景/需求来源与测试边界；
2. 真实且全局不冲突的 `UT-<scenario>-<id>` 与 `ST-<scenario>-<id>`；
3. 主路径、异常、边界、权限/并发/幂等中适用项；
4. 输入/fixture、操作、精确期望；
5. requirement/scenario/API/DB 追溯；
6. OpenLogos reporter 要求：实现结果写 `logos/resources/verify/test-results.jsonl`；
7. 覆盖度与不可由其它层替代的说明。

禁止占位 ID、通配族名、TODO、只有标题无表格。真实 ID 必须在 delta 阶段定稿，供 merge 后 slice-planner 使用。

### baseline-on-touch 必测矩阵

- canonical target 去重与 mode；
- effective view；
- CREATE 类别完整度；
- API/DB 适用与 SKIP；
- seed required/安全 partial/seeded 均不阻断；未终结 journal 无法恢复时必须以 `baseline_commit_in_progress` 在任何资源读取前硬阻断；
- adopted skip 冲突；
- AMBIGUOUS 停在现有 plan-exit；
- 无 JIT/verified/baseline warning 回归；
- task 每文件立即勾选与 plan/spec/merge 共享判据。

### 输出所有权

本 Skill 返回测试表、真实 ID 清单与 reporter/runner 影响给 change-writer；change-writer 写目标唯一 delta。若新增/修改 smoke 测试，还必须提示部署方案与 runner/reporter/dispatcher 实现影响，不能只补规格。

### 完成检查

- 全部验收/异常分支至少有一个真实 ID；
- ID 与现有主规格、当前 change 其它 deltas 无冲突；
- CREATE 文档自足；MODIFY 守恒；
- 不使用 seed coverage/verified 作为测试通过条件。

## Authority Closure 故障矩阵与追溯


### 输入

读取 `spec/authority-closure.md`、项目 Authority Registry 和有效时序图。按 required `fact_id` 生成测试，不复制 owner/writer 表。

### 每 fact 必测

- authority 正常路径；
- stale projection 与 conflicting old copy；
- legacy/concurrent writer；
- response lost + 新进程 restart；
- projection rebuild 与 freshness；
- cutover rollback；
- forbidden reverse inference。

不可发生项必须引用架构不变量形成证据化 SKIP。断言要证明 decision/恢复来自 authority identity/action；投影夹具必须与权威值冲突，restart 必须启动新进程并保留残留。

所有 UT/ST/smoke 使用真实 ID、建立 AC 追溯并接入 OpenLogos reporter。漏任一 required 维度时不得报告覆盖闭合。

## 加载相关企业知识（S45）

> 来源变更：enterprise-knowledge-base（S45）；knowledge-direct-intake（直接录入、标签表、索引与检索）。规则权威：功能规格 §2.102、§2.103；目录约定：`spec/directory-convention.md`「logos/resources/knowledge/」。跳过条件只有一种：项目没有任何知识条目、本提案没有 `deltas/knowledge/`，**并且本轮用户没有提供企业资料**——此时跳过本节，其余步骤不变。

### 录入入口（先于加载，不受跳过条件影响）

本轮用户提供了待沉淀的企业资料（制度原文、接口说明、术语表等）时，先录入再加载，即使项目还没有 `logos/resources/knowledge/`、`logos/resources/reference/knowledge/` 与 `deltas/knowledge/`（例如升级前就已 launched 的存量项目第一次录入）：

1. **选择通道**：只提供资料、没有需求变更（或新知识可以先于需求生效）→ **直接录入，不立案**（第 2～5 步）。知识修订必须与场景修改同批生效（如退役旧规则的同时改写引用它的场景）→ 走提案通道（第 7 步）。
2. **取号与标签**：运行 `openlogos knowledge list --format json`，读取有效知识视图中的条目与 `tag_state`。新条目编号取最大 KXX（含 `deprecated`）+ 1，视图为空时为 K01；修订既有条目时新规则取该条目最大 Rn（含 `deprecated`）+ 1。标签优先使用 `logos/resources/knowledge/TAGS.md` 中已有的标签或别名。
3. **准备候选目录**：在**项目根之外**新建一次性目录（如 `mktemp -d` 的结果），写入：
   - 完整条目文件 `<module>-KXX-<slug>.md`：新建；或修订时整文件替换——必须保留原有全部规则行，退役只改状态，已退役的内容逐字不动；
   - 需要新增标签时，写完整的 `TAGS.md`：复制现有全部行再追加，表头为「标签 | 别名 | 说明」；
   - 原文放在 `sources/<文件名>`；同名原文已存在且内容不同时改用新文件名（如 `-v4`）。条目 `source.path` 写 `logos/resources/reference/knowledge/<文件名>`。

   不要用文件工具直接写 `logos/resources/knowledge/`——该目录受 guard 保护，会被拦截。候选目录放在项目根之外，因此不受项目 `guard.exempt` 配置影响。
4. **录入**：在项目根**单独**运行 `openlogos knowledge apply <候选目录> --format json`，不要与其他命令用 `&&` 组合。
5. **按结果处理**：
   - 退出码 1：整批被拒，项目里没有写入任何文件。按 `errors[]` 逐条修正候选后重跑第 4 步。
   - 退出码 0：读回 `written[]` 中的条目，并提示用户：「原文将随仓库 push 扩散，push 前请确认可公开范围」。`warnings[]` 中的 `knowledge_tag_synonym`（疑似同义标签）转告用户，由人类负责人决定是否合并，不要自行合并。
   - 项目第一次 apply 时会自动从已有条目生成 `TAGS.md`，不会让既有条目失效。
   - 退出码 2 且 `rolled_back=false`，或任何命令报 `knowledge_apply_incomplete`：上一次录入被中断或回滚失败。先运行 `openlogos knowledge apply --recover`，成功后再继续；仍失败时把输出交给用户处理。
   - 报 `knowledge_apply_busy`：另一个录入正在进行，稍后重跑第 4 步；不要删除 `logos/.openlogos-runtime/` 下的锁或事务文件。
   - 报 `knowledge_apply_conflict`：候选与活跃提案的知识 delta 同名或同编号，改用其他编号，或改在提案内修改。
6. **条目必须结构有效**：H1 以 KXX 开头；「元数据」YAML 含合法的 `type`、`scope`、`status`（`scope: module` 时含 `module`）、非空 `tags`，以及非空 `source`——每项写原文的仓库相对 `path`（必须指向 `logos/resources/reference/knowledge/` 内存在的文件，或本批 `sources/` 中的文件；指向该目录之外的仓库文件如 `README.md` 视为无效）与非空 `version`；`type: rule` 时有「规则」表，表中每一行首列都是本条目的 `KXX-Rn`、「状态」为 `active` 或 `deprecated`；标签表已启用时，每个标签都必须是 `TAGS.md` 中的标签或别名（或在同批 `TAGS.md` 中加入）。不满足时 apply 以 `knowledge_entry_invalid` / `knowledge_tag_unknown` 整批拒绝，提案通道中 change-lint 同样拒绝。
7. **提案通道**：由 change-writer 在 `tasks.md` 的 `[delta]` 中规划 `deltas/knowledge/<module>-KXX-<slug>.md` 并预定 KXX（取号同第 2 步），产出知识 delta，合并时落盘。原文：项目 `guard.exempt` 仍含 `logos/resources/reference/` 时直接写入 `reference/knowledge/`；不含时（如显式 `guard.exempt: []`），在项目根之外建一个**只含 `sources/`** 的候选目录，运行 `openlogos knowledge apply <候选目录>` 写入原文（不写条目），条目仍经 delta 与场景同批合并。`deltas/knowledge/` 只放条目文件；需要的新标签先按第 3～5 步经 apply 加入 `TAGS.md`。initial 项目也默认使用直接录入。
8. 录入完成后，按下文在有效知识视图上加载；刚录入或同一提案新录入的条目立即可被引用。

### 有效知识视图

加载对象是**有效知识视图**：当前提案视角下知识条目的候选后态。提案尚未合并时，是磁盘上的 `logos/resources/knowledge/` 条目叠加本提案 `deltas/knowledge/` 后的结果；提案已合并且没有待应用的修正时，直接读磁盘上的条目（delta 已应用，不再叠加）；有待应用的修正时，以合并基线叠加修正后的 delta。没有活跃提案时就是磁盘上的条目。只看当前提案，不读其他提案或 archive。`openlogos knowledge list` 输出的就是这一视图的元数据。

标签表状态（`knowledge list` 的 `tag_state`）：

- `never`：从未启用标签表，条目有效性沿用原判据；
- `enabled`：条目的每个标签都必须在 `TAGS.md` 中（含别名），标签不在表中的条目不能作为依据或引用目标；
- `missing`：已启用但 `TAGS.md` 丢失——停止录入与引用，请用户从 git 恢复 `TAGS.md`，或运行 `openlogos knowledge apply --init-tags` 重新初始化。

### 加载步骤

1. 运行 `openlogos knowledge list --module <当前模块> --format json`（需要时加 `--tag <标签>`，按标签表的行匹配别名），得到有效元数据（含本提案知识 delta）。不要以 `INDEX.md` 作为筛选依据——它只是已落盘条目的总索引，不含本提案的知识 delta。
2. 在结果中按 `scope`（`global` 一律命中）与 `tags` 收窄到与当前需求 / 场景相关的条目。不依赖 `resource_index` 的描述，不做语义检索。
3. 对每个命中条目运行 `openlogos knowledge show <KXX> --format json`，读取它在同一有效知识视图中的**合成后全文**（`content`）与规则（`rules`）。不要沿 `list` 返回的 `path` 直接读 delta 文件——只修改了「元数据」的 delta 不含原有规则。`type: rule` 的条目以「规则」表中状态为 `active` 的 `KXX-Rn` 为约束；`deprecated` 的条目或规则只作背景，不作为新设计的依据。
4. 同一 KXX 出现在两个文件、或同一条目内重复 Rn 时，不得解析该 ID，先提示用户修复重号（会被报 `knowledge_id_duplicate`）。
5. `valid=false` 的条目（`problems` 说明原因：结构无效或标签不在表中）不作为依据，先提示用户经录入入口修正（引用它会被 change-lint 报 `knowledge_reference_unknown`）。
6. 需要知道某个条目或规则被哪些场景使用时（退役、修订、评估影响面），运行 `openlogos knowledge refs <KXX|KXX-Rn>`。

### 写明依据与冲突处理

- 产出中凡受企业知识约束的内容，写明依据的 `KXX` 或 `KXX-Rn`。
- 发现需求或设计与某条 `active` 规则冲突时，**不硬阻断、不静默取舍**：列出冲突（规则 ID、冲突点、可选处理：遵守 / 本次例外 / 规则需更新）并停下询问用户，一次只问一个决定。用户裁决「本次例外」时，在场景「适用业务约束」的「例外」列记录理由；裁决「规则需更新」时，按录入入口修订规则（只改知识时直接录入；须与场景同批生效时交由 change-writer 规划知识 delta）。

### 本 Skill 的加载时机与产出

- **时机**：设计 UT / ST 用例之前，读取场景「适用业务约束」章节引用的 `KXX-Rn` / `KXX`，用 `openlogos knowledge list` 在有效知识视图中定位对应条目（含本提案的知识 delta），再用 `openlogos knowledge show <KXX>` 读取合成后全文。
- **从 `KXX-Rn` 派生用例**：每条被引用的 `active` 规则至少有一个正向用例（满足规则的路径）与一个反向用例（触发规则约束的路径，如金额大于 5000 元必须进入二审）；规则的「例外」列各有对应用例。被引用为 `KXX` 的术语 / 外部系统条目，在用到其定义的用例中按定义构造数据。
- **标注知识来源**：在用例「描述」中注明依据（如「依据 K03-R1」）；场景「例外」列记录了本次例外的规则，按例外后的行为设计用例并注明例外。
