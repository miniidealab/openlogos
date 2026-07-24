# logos-project.yaml 规范

> 版本：0.3.0
>
> logos-project.yaml 是 OpenLogos 项目的 AI 协作索引文件。它为 AI 助手提供项目的全局上下文，让 AI 打开项目就知道该读哪些资料、项目用了什么技术栈、遵循什么约定。

## 文件位置

`logos/logos-project.yaml`（位于 `logos/` 目录下）

## 字段定义

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project` | object | 是 | 项目基本信息 |
| `tech_stack` | object | 是 | 技术栈描述 |
| `scenario_counter` | object | 否 | 全局场景编号计数器（多模块项目必填） |
| `modules` | array | 否 | 模块注册表（多模块项目必填） |
| `deployment_gates` | object | 否 | Initial 阶段 launch 前的部署与 smoke 门禁声明 |
| `scenarios` | array | 否 | 场景清单（单一真相来源，Phase 3-1 前写入） |
| `resource_index` | array | 是 | 资源索引列表 |
| `conventions` | array | 否 | 项目约定 |

### project

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 项目名称 |
| `description` | string | 是 | 项目一句话描述 |
| `methodology` | string | 否 | 遵循的方法论（默认 "OpenLogos"） |

### tech_stack

自由格式的键值对，描述项目使用的技术栈。推荐包含以下 key：

| Key | 说明 | 示例 |
|-----|------|------|
| `framework` | 主框架 | "Astro 5.x" |
| `language` | 主语言 | "TypeScript" |
| `hosting` | 部署平台 | "Cloudflare Pages" |
| `database` | 数据库 | "Supabase (PostgreSQL)" |
| `auth` | 认证方案 | "Supabase Auth" |
| `deployment` | 部署形态或发布方式 | "Docker Compose on VPS" |
| `smoke` | 冒烟测试命令或策略 | "npm run smoke" |

### external_dependencies

数组，声明项目依赖的外部服务及其测试策略。在架构设计阶段（S12）确定，供编排测试阶段（S06）自动消费。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 外部依赖名称（如"邮件服务"、"图形验证码"） |
| `provider` | string | 是 | 具体服务商（如"SendGrid"、"reCAPTCHA"） |
| `used_in` | array | 是 | 涉及的场景列表（如 `["S01-用户注册", "S03-忘记密码"]`） |
| `test_strategy` | string | 是 | 测试策略枚举值（见下表） |
| `test_config` | string | 是 | 测试策略的具体配置说明 |

`test_strategy` 枚举值：

| 值 | 说明 | 典型场景 |
|----|------|---------|
| `test-api` | 测试环境提供后门 API 获取验证码/回调等 | 邮件验证码、短信验证码 |
| `fixed-value` | 特定测试数据使用固定值 | 测试手机号固定验证码 |
| `env-disable` | 通过环境变量关闭该功能 | 图形验证码、滑块验证 |
| `mock-callback` | 编排中主动调用模拟回调端点 | 支付回调、Webhook |
| `mock-service` | 使用本地 mock 服务替代 | OAuth Provider、第三方 API |

### scenario_counter

对象，维护全局场景编号计数器。多模块项目必填，确保不同模块的场景编号全局唯一、不重复。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `next_id` | integer | 是 | 下一个场景的序号（整数），如 `19` 表示下一个场景从 `S19` 开始 |

**使用规则**：AI 每次生成新场景前必须读取此字段取号，生成后立即将 `next_id` 加 1 并写回，严禁不同模块从 S01 重新开始编号。

### modules

数组，模块注册表。多模块项目必填，统一在此文件维护，不另建 `modules.yaml`。`openlogos init` 时自动写入 `core` 模块初始数据。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 模块标识符，小写字母 + 连字符，如 `core`、`payment` |
| `name` | string | 是 | 模块名称（中文或英文均可） |
| `lifecycle` | string | 是 | 模块生命周期：`initial`（初始开发阶段，关注 phase 推进）或 `launched`（迭代开发阶段，关注变更提案） |
| `bootstrap` | string | 否 | 入场模式：`normal`（默认，完整走 Phase 1→3）或 `adopted`（存量项目接入，Initial 文档基线已跳过）。由 `openlogos adopt` 命令写入，不建议手动修改。历史值 `skipped` 仅用于兼容读取。 |
| `skip_phases` | array | 否 | 声明本模块不需要的阶段，phase 检测时跳过对应目录。由 `architecture-designer` Skill 在技术选型后填写。 |
| `deployment_required` | boolean | 否 | 是否需要部署执行门禁。软件项目默认 true；纯文档、纯库或明确无需部署的模块可设为 false。 |
| `baseline_seed_state` | string | 否 | brownfield-adopter（S33）：现状基线种子状态，枚举 `required｜partial｜seeded`（**唯一状态字段，非布尔**）。`openlogos adopt` 写初值 `required`；`openlogos baseline-seed commit` 写 `partial`/`seeded`（状态推进唯一入口）。读取兼容历史布尔 `baseline_seed_required: true` → 映射为 `required`。**字段缺失（legacy adopted，字段引入前接入）**：有效状态由共享 helper `effectiveBaselineSeedState` 统一派生（explicit 优先；有候选+open run→`partial`、有候选无 open run→`seeded`、无候选→`required`；无 `unknown` 第三态），三入口（next/status/baseline-seed）单一事实源；`openlogos sync` 迁移把派生值**回填为显式枚举**（仅回填缺失字段、不推进状态；已有显式值不覆盖；changes 记录写明派生依据），落盘后运行时派生仅作过渡兜底（baseline-seed-legacy-default-unify）。 |

**`bootstrap` 字段语义**：

| 值 | 含义 | 写入时机 |
|----|------|---------|
| `normal`（或缺省） | 完整走 Phase 1→3 文档基线再进入迭代 | `openlogos init` 创建的模块默认值 |
| `adopted` | 已有项目快速接入；OpenLogos 基础设施完整初始化，但 Initial 文档基线已跳过 | `openlogos adopt` 写入 |
| `skipped` | 历史兼容值，等价于 `adopted` 读取，不再新写入 | 旧版本 `openlogos adopt` 写入 |

`bootstrap: adopted` 时的行为约束：
- `status`：Phase 1、Phase 2 和 Phase 3-0 缺失不报错，显示「文档基线已跳过（存量项目接入）」
- `next`：无活跃提案时按 `baseline_seed_state` 分档引导（S33，取代旧 `add-baseline-docs`）——`required`/`partial` 引导「逆向建立现状基线」（`openlogos baseline-seed begin` + 派发 `brownfield-adopter`），`seeded` 展示现状基线覆盖率并引导正常发起 `openlogos change`
- `launch`：豁免 Initial 文档门禁检查（不依赖 `lifecycle` 值）
- `detect/status --format json`：新项目输出 `bootstrap: adopted`；历史 `bootstrap: skipped` 至少必须被识别为同一种接入模式，不得回退为普通 launched 或 initial

**`## 逆向基线来源` provenance 章节 schema（S33 权威载体）**：每份逆向产物文档内含一个具名章节 `## 逆向基线来源`，其内一段 fenced YAML 承载 `candidates[]` 注册表，是 provenance 与覆盖率的**唯一权威载体**（`logos-project.yaml` 的 `baseline_index` 仅为派生索引、携 `source_hash` 供新鲜度对账）。每个候选字段：

| 字段 | 说明 |
|------|------|
| `key` | 规范键 `<module>::<sha256(normalize(anchor))[:12]>`（hash 形式；可读 slug 只进 `anchor`/`display`） |
| `anchor` / `display` | 规范化前的语义锚点（命令名/入口符号）/ 展示名，仅供人读 |
| `state` | `active`（存活）｜`tombstone`（重扫消失未废弃）｜`retired`（已废弃） |
| `verified` | 布尔；**本变更（drop-baseline-confirmation）后冻结、恒 `false`**——人工确认机制已删除、**无 `false→true` 升级入口**；`true` 仅为历史/兼容读取值，当前无任何写入路径 |
| `aliases[]` / `superseded_by[]` | 重命名/移动追加旧 anchor（同一候选不新建）/ 合并拆分旧键指向新键 |
| `confirmed_by` / `evidence` / `confirmed_at` | **冻结字段、恒 `null`**：原为 `verified:true` 时的审计字段，当前无写入入口（仅兼容读取历史值） |
| `retired_by` / `retire_event_id` | `state:retired` 时的废弃审计字段 |

**provenance 为派生值（非独立存储）**：`verified:true` ⇒ `human-verified`（**冻结分支**：`verified` 恒 `false`、无升级路径，该派生仅兼容读取历史值）；`verified:false ∧ state∈{active,tombstone}` ⇒ `reverse-engineered`；候选/章节缺失 ⇒ `unknown`/`legacy-unclassified`（缺 `## 逆向基线来源` 章节的既有文档一律派生 `unknown`，保守迁移不虚构 candidates、不推断 `reverse-engineered`）。**覆盖率（tombstone 分母法，shape/schema 不变）**：分母 = `active ∪ tombstone`（`retired` 不计入）；分子 = `verified:true` 的 `active` 候选（冻结后恒 `0`）；零分母报 `n/a`；删除候选转 tombstone 仍留分母 ⇒ 百分比不因删除上升。

**`openlogos baseline-seed` 命令契约（`baseline_seed_state` 与逆向目标文件的唯一写入入口，两阶段 staging）**：AI/driver/skill **绝不直接改 YAML、也不直接写目标 `logos/resources/`**，只把产物写入 run 私有 staging，经本命令让 CLI 校验后原子提交。

| 子命令 | 作用 | 关键校验 / 语义 |
|--------|------|------|
| `begin --module <id> --manifest <path>` | 提交**逻辑产物计划**（`{ module, expected:[{kind,target_path,candidate_keys}] }`，**无内容 hash**）→ 签发 `run_id` + 建 staging `logos/resources/verify/baseline-seed-runs/<run_id>/staging/` + 持久化 run 记录 | 必需 kind（`system-map`+`scenario-candidates`）齐、`kind` 受控枚举、`target_path` 项目根相对且位于 `logos/resources/`（拒绝绝对/`..`/符号链接/重复）；**不下调状态**（`partial` 保留至新 run 首次有效 commit）；同模块旧 open run 标 `superseded`；先在锁内恢复未终结 journal 再 supersede |
| `commit --module <id> --run-id <id>` | 对 **staged 实际字节**算 sha256 + 校验 `## 逆向基线来源`/`candidates[]` schema + 比对 `candidate_keys` 一致 → 分类 `committed`/`missing`/`invalid` | 必需 kind 齐 + 全部 expected 合法 → 经 commit journal 事务提交全部目标 + 派生索引 + `baseline_seed_state: seeded`；≥1 未全 → `partial`（**不提交不完整集合为权威**）；0 → 保持；幂等（同 run 依 staging 重算一致） |
| `status --module <id>` | 只读当前 run、staging 进度与状态 | 经恢复门（先恢复未终结 journal，否则 `baseline_commit_in_progress`） |

**错误码**（协议错误非零退出、不写状态、不提交）：`missing_required_kind` / `path_escape` / `candidate_key_mismatch` / `unknown_run` / `stale_run`（被新 begin superseded）/ `run_locked`（同模块并发）/ `baseline_commit_in_progress`。成功（含 `partial`）退出 0，JSON envelope `{ ok, run_id, module, baseline_seed_state, committed, missing, invalid }`。**多文件崩溃一致性**：`commit` 跨多目标文档 + 派生索引 + 状态 YAML，经持久化 journal `prepared→committing→committed`（状态最后写、journal 阶段/进度自身临时文件+rename 原子写）在模块级事务锁下提交；恢复按每目标 on-disk hash 与 journal old/new 逐目标重判态（prepared→回滚、committing+staging 完好→前滚+seeded、committing+staging 缺失→按 backup 回滚），`seeded` 当且仅当完整新集合在盘（详见架构 core-06-provenance-data-model §4.4）。事件日志 `logos/resources/verify/baseline-events.jsonl`（append-only）承载迁移/废弃审计。

`skip_phases` 允许值：

| 值 | 跳过的检查 | 适用场景 |
|----|-----------|---------|
| `api` | `logos/resources/api/` | 无 HTTP API 的项目（桌面应用、CLI 工具、前端库） |
| `database` | `logos/resources/database/` | 无数据库的项目（纯计算工具、无状态 CLI） |
| `scenario` | `logos/resources/scenario/` | 无 API 编排测试的项目（通常与 `api` 同时跳过） |
| `deployment` | 部署执行与 smoke 门禁 | 纯文档、无需发布运行环境的模块 |

> `deployment` skip 只跳过部署执行与 smoke 门禁，不跳过部署方案设计。Initial 软件项目仍应说明为什么不需要部署。

示例：

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: initial
    skip_phases: [api, scenario]   # SQLite 桌面应用：有数据库，无 HTTP API
```

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: launched
    bootstrap: adopted
    skip_phases: [api, database, scenario]   # 存量 CLI 项目接入
```

### deployment_gates

`deployment_gates` 用于声明 Initial 阶段 launch 前的部署门禁要求。字段可由 `deployment-designer` Skill 写入，供 `status` / `launch` 判断。

```yaml
deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deployment_required` | boolean | 是 | 是否需要部署执行 |
| `smoke_required` | boolean | 是 | 是否需要部署后冒烟测试 |
| `environments` | array | 否 | 需要覆盖的部署环境 |

若未声明 `deployment_gates`，软件模块默认需要部署方案；部署执行和 smoke 门禁由模块的 `deployment_required` 与部署方案内容共同决定。

### resource_index

数组，每个元素描述一个关键资源文件：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件相对路径 |
| `desc` | string | 是 | 一句话描述——告诉 AI 什么场景下需要读这个文件 |

### scenarios

数组，声明项目的**完整场景清单**。场景是 OpenLogos 方法论中最核心的设计元素，是后续各阶段产出物的组织单位。

**写入时机**：
1. 在 `architecture-designer` Skill 完成后，由 AI 引导用户确认场景清单并预先写入；
2. 在 `scenario-architect` Skill 开始建模时，强制检查并补全。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 场景唯一编号，格式为 `S` + 两位数字，如 `S01`、`S02` |
| `name` | string | 是 | 场景名称（一句话描述） |
| `module` | string | 否 | 所属模块 id，缺省为 `core`。多模块项目必填，用于 `openlogos status` 按模块计算 phase 进度。`openlogos sync` 会自动补全缺失的 `module` 字段。 |

**命名规则约定**（各阶段产出物通过 `<module>-SXX` 前缀与场景关联，无需在 yaml 中声明路径）：

| 阶段 | 产出物路径规则 | 示例 |
|------|-------------|------|
| Phase 3-1 场景建模 | `logos/resources/prd/3-technical-plan/2-scenario-implementation/<module>-SXX-*.md` | `core-S01-user-register.md` |
| Phase 3-2 API 设计 | `logos/resources/api/SXX-*.yaml` 或 `SXX-*.yml` | `S01-user-register.yaml` |
| Phase 3-3 部署方案 | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` | `core-01-deployment-plan.md` |
| Phase 3-4a 测试用例 | `logos/resources/test/<module>-SXX-*.md` | `core-S01-test-cases.md` |
| Phase 3-4a 冒烟测试 | `logos/resources/test/smoke/<module>-smoke-test-cases.md` | `core-smoke-test-cases.md` |

**完成判断规则**：只有 `scenarios` 中每个 `id` 在对应阶段都存在匹配文件，该阶段才视为完成。若 `scenarios` 字段缺失，则降级为旧的"目录有文件即完成"逻辑（向后兼容）。

### conventions

数组，每个元素是一条项目约定（字符串格式）。

### feature_counter 与 features（add-feature-model）

在 module 与 scenario 之间引入**可选的 feature（功能）分组层**。以下三处均为**可选新增**，缺失时行为完全等同引入前（向后兼容；旧 CLI 忽略未知字段，新 CLI 读旧 yaml 视为无 feature）。

#### feature_counter

对象，维护全局 feature 编号计数器，仿 `scenario_counter`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `next_id` | integer | 否 | 下一个 feature 的序号，如 `4` 表示下一个从 `F04` 开始 |

**使用规则**：由 AI 维护（CLI 不取号）。生成新 feature 前读取取号、生成后 `next_id` 加 1 写回；feature ID 项目全局唯一，严禁不同 module 从 F01 重号。**缺失默认**：`feature_counter` 或 `next_id` 缺失时 `configured_next_id = feature_counter?.next_id ?? 1`（存量首次回填从 `F01` 起，不报错）。冲突恢复见 `spec/module-naming-convention.md`（`allocated = max(configured_next_id, max(existing)+1)`，持久化 `allocated+1`）。

#### features

数组，feature 分组注册表（可选）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | feature 标识 `F0X`，项目全局唯一 |
| `name` | string | 是 | feature 名称 |
| `module` | string | 是 | 归属模块 id，必指向 `modules[]` 已注册项（feature 不跨 module） |
| `spec` | string | 否 | feature-specs 文档序号（如 `core-01`，无 `.md`、无锚点），目标缺失视为未链接 |

#### scenarios[].feature（新增可选字段）

`scenarios[]` 元素新增可选 `feature: F0X`，声明该场景所属 feature。缺失 / 指向未知 feature / 指向跨 module 的 feature，一律降级为该场景所属 module 的"未分组"桶（不报错、不阻断）；不改动 `scenario.module` 的现状行为。

```yaml
feature_counter:
  next_id: 4
features:
  - id: F01
    name: 项目生命周期与初始化
    module: core
    spec: core-01
scenarios:
  - id: S01
    module: core
    feature: F01
```

## 完整示例

```yaml
project:
  name: "My SaaS Product"
  description: "一个基于 OpenLogos 方法论构建的 SaaS 产品"
  methodology: "OpenLogos"

tech_stack:
  framework: "Next.js 15"
  language: "TypeScript"
  hosting: "Vercel"
  database: "Supabase (PostgreSQL)"
  auth: "Supabase Auth"
  payment: "Paddle"
  deployment: "Vercel + Supabase"
  smoke: "npm run smoke"

scenario_counter:
  next_id: 6

modules:
  - id: core
    name: 核心功能
    lifecycle: launched
  - id: payment
    name: 支付模块
    lifecycle: initial

deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging

external_dependencies:
  - name: "邮件服务"
    provider: "SendGrid"
    used_in: ["S01-用户注册", "S03-忘记密码"]
    test_strategy: "test-api"
    test_config: "GET /api/test/latest-email?to={email}"
  - name: "图形验证码"
    provider: "reCAPTCHA"
    used_in: ["S01-用户注册", "S02-密码登录"]
    test_strategy: "env-disable"
    test_config: "CAPTCHA_ENABLED=false"
  - name: "支付回调"
    provider: "Paddle"
    used_in: ["S05-订阅付费"]
    test_strategy: "mock-callback"
    test_config: "POST /api/test/simulate-payment-callback"

resource_index:
  - path: logos/resources/prd/1-product-requirements/core-01-requirements.md
    desc: 产品核心需求文档。涉及产品定位、目标用户、功能需求时必读。
  - path: logos/resources/prd/2-product-design/1-feature-specs/core-00-information-architecture.md
    desc: 信息架构文档。涉及页面结构、导航设计时必读。
  - path: logos/resources/api/auth.yaml
    desc: 认证相关 API 规格。涉及登录、注册、OAuth 接口设计时必读。
  - path: logos/resources/database/schema.sql
    desc: 数据库完整 Schema。涉及表结构、字段设计、RLS 策略时必读。
  - path: logos/resources/scenario/user-auth.json
    desc: 用户认证场景的 API 编排。涉及认证流程验收时必读。
  - path: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md
    desc: 核心模块部署方案。涉及部署拓扑、发布命令、回滚策略和 smoke 验证时必读。
  - path: logos/resources/test/smoke/core-smoke-test-cases.md
    desc: 核心模块部署后冒烟测试用例。涉及 openlogos smoke 或 launch 前门禁时必读。

conventions:
  - "所有 API 路径以 /api/ 开头"
  - "数据库金额字段使用 INTEGER 存储分值"
  - "时间字段统一使用 TIMESTAMPTZ"
  - "每次变更必须先创建 logos/changes/ 变更提案"
```

## 与 AGENTS.md 的关系

`logos-project.yaml` 是项目资源的结构化索引，`AGENTS.md` 是面向 AI 的自然语言指令。两者互补：

- AGENTS.md 告诉 AI "先读 `logos/logos-project.yaml`"
- logos-project.yaml 告诉 AI "这个项目有哪些关键文件、什么时候该读"
- `openlogos sync` 命令会根据 logos-project.yaml 的内容更新 AGENTS.md

## product_type 模块字段（proposal-ui-ux-first）

### 字段位置与作用域

`product_type` 是 **`modules[]` 数组元素上的字段**，与 `bootstrap` / `skip_phases` /
`deployment_required` **并列**，位于 module 注册表内部。它声明**该模块**产出物的 UI 产品类型。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `product_type` | string | 否 | 模块产品类型，枚举见下。缺失一律按**非 GUI** 处理（安全默认）。 |

**作用域 = module 级**：多模块项目**各模块独立声明**自己的 `product_type`。同一项目内
可以既有 GUI 模块（如 `web`）又有非 GUI 模块（如 `api` / `cli`），互不影响。**不存在**项目
顶层的全局 `product_type` 字段——**唯一事实源就是 `modules[].product_type`**。

### 枚举值与 GUI 集合

`product_type` 允许值：

| 值 | 含义 | 是否 GUI |
|----|------|---------|
| `web` | Web 前端应用 | ✅ GUI |
| `desktop` | 桌面应用（Electron / Tauri 等） | ✅ GUI |
| `mobile` | 移动端应用（iOS / Android / 跨端） | ✅ GUI |
| `cli` | 命令行工具 | ❌ 非 GUI |
| `api` | HTTP / RPC 后端服务 | ❌ 非 GUI |
| `library` | 库 / SDK | ❌ 非 GUI |
| `skills` | 方法论 / Skill / 规格类产物 | ❌ 非 GUI |
| `service` | 纯后端服务（常驻 worker / daemon、定时循环任务、消息队列消费者等，无对外 HTTP/RPC 接口） | ❌ 非 GUI |

**GUI 集合 = {`web`, `desktop`, `mobile`}**。凡 `product_type ∈ GUI 集合` 的模块即为 **GUI 模块**；
其余值（含缺失）一律为**非 GUI 模块**。UI-first 特性（提案阶段 UI/UX 原型确认、`ui_impact`
派生、`gui-ui-first` overlay 节点参与）**仅对 GUI 模块生效**。

**`service` 与 `api` 的边界（add-product-type-service）**：模块**对外暴露 HTTP / RPC 接口** → `api`；
**无对外接口**、仅作为常驻进程 / 定时（循环）任务 / 队列消费者在后台运行 → `service`。

**枚举顺序契约（add-product-type-service）**：`service` **追加在枚举末尾**，完整固定顺序为
`web | desktop | mobile | cli | api | library | skills | service`——既有 7 值前缀顺序逐字不变，
`product_type_confirmation.next_action.enum` 的「固定顺序」契约（`spec/cli-json-output.md`）随之扩展一个尾部元素。

### 采集：init 与 adopt

- **`openlogos init`（正常创建）**：交互式**询问产品类型**，并将用户选择写入**每个 module 的
  `product_type`**（默认写入 `core` 模块，多模块场景为每个新建 module 分别询问/写入）。
- **`openlogos adopt`（存量项目接入）**：**推断** module 的 `product_type`（依据技术栈、目录结构等）；
  **无法判定时默认安全的非 GUI 值 `cli`**，并在接入报告中**标注「product_type 需人工确认」**，
  避免误将非 GUI 项目当成 GUI 而引入不必要的 UI-first 流程改动。

### 缺失语义（安全默认：非 GUI 零改动不变量）

module **无 `product_type` 字段** ⇒ **一律按非 GUI 处理**：

- UI-first 特性**不启用**；
- 变更流程**零改动**（不注入原型节点、`ui_impact` 恒为 `false`）；

由此保证「**非 GUI 项目零改动**」不变量——历史项目、未升级配置、显式非 GUI 模块的行为
与本提案落地前**完全一致**。缺失**绝不**被解释为 GUI。

### 多模块判定：module-aware `ui_impact` + 项目实例级 overlay 注入

本字段是 module 级源，但 overlay 注入发生在**项目实例级**，二者分工如下：

1. **overlay 注入（项目实例级）**：当项目 `modules[]` 中**存在 ≥1 个 GUI 模块**
   （即某 module 的 `product_type ∈ {web,desktop,mobile}`）时，`openlogos init` / `sync`
   将 `gui-ui-first` overlay 注入到 `logos/flow/launched.yaml`。注入是**项目级一次性**动作。

2. **节点是否参与（module-aware `ui_impact`）**：overlay 节点是否真正执行，由
   **module-aware 的 `ui_impact` 标志**决定。`ui_impact` 针对**活跃提案所属 module** 的
   `product_type` 求值：
   - 活跃提案所属 module 为 GUI ⇒ `ui_impact = true` ⇒ overlay 节点 `when` 满足 ⇒ 参与；
   - 活跃提案所属 module 为**非 GUI**（含缺失）⇒ `ui_impact = false` ⇒ overlay 节点 `when`
     不满足 ⇒ **skip**。

**红线**：**不得**用「任一 GUI 模块」触发**全局**注入后，让**非 GUI 模块的提案**也受影响。
overlay 虽在项目级注入，但其节点必须经 module-aware `ui_impact` 逐提案求值，从而对同一项目里
的非 GUI 模块提案自动 skip，保「非 GUI 零改动」不变量。

### 消费者：只读该模块级源

以下所有消费者在需要 UI 产品类型信息时，**只读 `modules[].product_type` 这一模块级源**，
不得另立数据源、不得从其它字段旁推：

- `openlogos init` / `sync` / `change`（注入 overlay、判定活跃提案所属 module 的产品类型）；
- `flow-derive`（派生 module-aware 的 `ui_impact` when-flag）；
- `change-writer`（先判 `product_type` 再判改动，决定是否产出 UI 原型）。

### YAML 示例

多模块项目：`web` 模块为 GUI（UI-first 生效），`api` 模块与缺省的 `tooling` 模块为非 GUI（零改动）：

```yaml
modules:
  - id: web
    name: Web 控制台
    lifecycle: launched
    product_type: web          # ∈ GUI 集合 ⇒ 该模块提案启用 UI-first
    deployment_required: true

  - id: api
    name: 后端服务
    lifecycle: launched
    product_type: api          # 非 GUI ⇒ ui_impact 恒 false、overlay 节点 skip
    skip_phases: [database]
    deployment_required: true

  - id: tooling
    name: 内部脚本
    lifecycle: initial
    # 无 product_type 字段 ⇒ 缺失=非 GUI 安全默认 ⇒ 流程零改动
    skip_phases: [api, database, scenario]
    deployment_required: false
```

> 本示例中项目**存在 GUI 模块（`web`）**，故 `init`/`sync` 会在项目级注入 `gui-ui-first`
> overlay；但只有以 `web` 模块为归属的活跃提案才会 `ui_impact=true` 使原型节点参与，`api` /
> `tooling` 模块的提案 `ui_impact=false`、overlay 节点自动 skip。

## 既有项目 product_type 迁移与回填（proposal-ui-ux-first）

> **背景（F1 critical，insisted）**：本特性的目标受众是**已 `launched` 的 GUI 项目**。但这些
> 存量项目早已跑完 `init` / `adopt`，升级到本版本后**不会重跑**采集流程；其 `logos-project.yaml`
> 的 `modules[]` 里**普遍缺 `product_type` 字段**。按上一节「缺失=非 GUI」的安全默认：`sync`
> **不注入** `gui-ui-first` overlay、`ui_impact` **恒为 `false`** ⇒ **UI-first 对目标存量 GUI
> 用户完全不可达**，且此前**没有受支持的回填入口**。本节补齐幂等的迁移路径，使存量 GUI 项目
> 能显式、可发现、可机器读取地开启 UI-first，同时**不破坏「非 GUI 项目零改动」不变量**。

### 1. 幂等回填命令 `openlogos module set-product-type`

**命令**：`openlogos module set-product-type <module-id> <enum>`

- **作用**：显式、带校验地**写入 / 更新** `logos-project.yaml` 中 `modules[<module-id>].product_type`。
  已存在的 module（含存量 launched 模块）一律可经本命令更新其 `product_type`。
- **幂等**：把某 module 的 `product_type` 设为**与当前相同的值** ⇒ **no-op 成功**（不报错、不产生多余写入），
  可安全重复执行。
- **错误语义**（显式、可诊断）：

  | 情形 | 行为 |
  |------|------|
  | `<enum>` 非合法枚举 | **报错并列出全部合法枚举**（`web` / `desktop` / `mobile` / `cli` / `api` / `library` / `skills` / `service`），非零退出 |
  | `<module-id>` 未知（不在 `modules[]`） | **报错**指明该 module id 不存在，非零退出 |
  | 缺参（缺 `<module-id>` 或 `<enum>`） | **用法错误**（usage error），打印用法、非零退出 |

- 设为 **GUI 枚举**（`web`/`desktop`/`mobile`）后，下一次 `sync` 依「项目是否含 ≥1 GUI 模块」
  幂等注入 overlay（见 §4）；设为**非 GUI 枚举**则维持零改动。

### 2. `module add` 采集 `product_type`

- **`openlogos module add`** 在新增 module 时**同步采集 `product_type`**：
  - 交互式 **prompt** 询问产品类型；或
  - 通过 **`--product-type <enum>`** 参数非交互指定。
- **省略时的默认**：不提供 product_type ⇒ 落**安全的非 GUI 默认 `cli`**，并**标注「product_type
  需人工确认」**（与 `adopt` 的推断口径一致，避免误把新模块当成 GUI）。
- 任何已有 module 之后都可经 §1 的 `set-product-type` 更新，包括把 `add` 时的默认 `cli` 改为 GUI 值。

### 3. 缺字段诊断信号 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`

这是存量项目**可发现、可达的迁移入口**：

- **`openlogos sync` / `status` / `next`** 在检测到**任一 `launched` 模块缺 `product_type` 字段**时，
  输出**机器可读信号 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`**：
  - 作为 **warning**（不阻断既有流程），并携带 **`next_action`** 指向 `openlogos module set-product-type`；
  - **列出所有缺 `product_type` 的 module ids**，供人类 / driver 精确回填。
- **安全默认维持不变**：在用户**显式设置**（经 §1 / §2）之前，缺字段的模块**仍按非 GUI 处理**——
  不注入 overlay、`ui_impact` 恒 `false`。诊断信号只是**暴露待确认项**，绝不隐式升级为 GUI。

### 4. 半自动 vs `--auto`：绝不凭启发式升级 GUI

- **无人值守（`openlogos next --auto`）绝不**凭启发式把**未设置 `product_type`** 的模块升级为 GUI：
  - 保持**安全非 GUI 默认**；
  - 把 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为**机器可读 next action 暴露**给 driver；
  - **仅在显式配置 GUI 枚举后**（经 §1 / §2）才注入 overlay。
- 即：`--auto` **决不**为未设置的模块自动启用 UI-first。这与 §3 的安全默认一致，保证全自动模式下
  存量项目行为可预测、不被误改。

### 5. 幂等 `sync` 注入 / 移除 `gui-ui-first` ops

`sync` 以「**项目是否含 ≥1 GUI 模块**」（即存在某 `modules[].product_type ∈ {web,desktop,mobile}`）
为**唯一键**，对 `logos/flow/launched.yaml` 做幂等收敛：

- **注入**：当项目含 ≥1 GUI 模块（含刚经 §1 / §2 设置的存量模块）时，`sync` **幂等注入**
  `gui-ui-first` overlay 的 ops（节点 `write-ui-prototype` / `verify-ui-provenance`）——
  **重复 `sync` 不重复注入**。
- **移除**：当某模块由 GUI 改为非 GUI（经 §1）、或**最后一个 GUI 模块被移除**、导致项目**不再含任何
  GUI 模块**时，`sync` 安全**移除已注入的 `gui-ui-first` ops**。
- **识别边界（红线）**：移除**仅按 `gui-ui-first` overlay 已知的 node id（`write-ui-prototype` /
  `verify-ui-provenance`）及 overlay 源标记**识别注入产物；**绝不删除用户自定义的 overlay ops**。
- **不变量**：注入 / 移除均以「项目是否含 ≥1 GUI 模块」为键，重复 `sync` 收敛到同一状态（幂等）；
  在项目不含 GUI 模块时 `launched.yaml` 回到**无 `gui-ui-first` ops** 的态，保「**非 GUI 项目零改动**」不变量。
