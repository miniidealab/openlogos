# 目录结构约定

> 版本：0.3.0
>
> 本文档定义遵循 OpenLogos 方法论的项目应采用的标准目录结构。统一的目录结构让 AI 工具和团队成员都能快速定位资源。

## 标准项目结构

```
project-root/
├── AGENTS.md                   # AI 助手指令（自动生成，根目录）
├── CLAUDE.md                   # Claude Code 指令（自动生成，根目录）
│
├── .claude/                    # Claude Code 插件目录（自动生成）
│   ├── settings.json           # 权限与 hook 配置
│   └── openlogos/
│       └── bin/
│           ├── openlogos-phase # SessionStart hook — 会话开始时注入阶段上下文
│           └── guard-check     # PreToolUse hook — 变更管理硬拦截
│
├── logos/                      # OpenLogos 方法论资产（独立收纳）
│   ├── logos.config.json       # 项目配置（OpenLogos 规范）
│   ├── logos-project.yaml      # AI 协作索引（OpenLogos 规范）
│   │
│   ├── resources/              # 研发资源文档（当前已生效的"真相"）
│   │   ├── prd/                # 产品文档
│   │   │   ├── 1-product-requirements/    # Phase 1: 需求文档
│   │   │   ├── 2-product-design/
│   │   │   │   ├── 1-feature-specs/       # Phase 2: 功能规格
│   │   │   │   └── 2-page-design/         # Phase 2: 页面设计 + HTML 原型
│   │   │   └── 3-technical-plan/
│   │   │       ├── 1-architecture/        # Phase 3: 架构与技术选型
│   │   │       ├── 2-scenario-implementation/  # Phase 3: 场景实现文档
│   │   │       └── 3-deployment/          # Phase 3: 部署方案 + 冒烟测试方案
│   │   ├── api/                           # Phase 3: OpenAPI YAML
│   │   ├── database/                      # Phase 3: SQL DDL
│   │   ├── test/                          # Phase 3: 测试用例规格（Markdown）
│   │   │   └── smoke/                     # Phase 3: 部署后冒烟测试用例（Markdown，可选）
│   │   ├── scenario/                      # Phase 3: API 编排测试（JSON）
│   │   ├── implementation/                # Phase 3: 代码实现清单（Markdown）
│   │   └── verify/                        # Phase 3: 验收、部署、冒烟结果（JSONL + 报告）
│   │
│   └── changes/                # 变更提案工作区
│       ├── {change-name}/      # 进行中的变更提案
│       │   ├── proposal.md
│       │   ├── tasks.md
│       │   └── deltas/
│       └── archive/            # 已完成变更的历史归档
│
└── src/                        # 源代码（结构由项目技术栈决定）
```

OpenLogos 的所有方法论资产收纳在 `logos/` 目录下，与项目自身代码和配置彻底分离。`AGENTS.md`（及 `CLAUDE.md`）保留在项目根目录，因为 AI 工具要求指令文件位于根目录。

## 目录职责

### logos/

OpenLogos 方法论的统一入口。包含配置文件、研发资源文档和变更管理。

### logos/resources/

存放所有研发资源文档，是项目当前已生效的"真相源"。按 OpenLogos 三层推进模型组织：

| 子目录 | 对应阶段 | 内容 |
|--------|---------|------|
| `prd/1-product-requirements/` | Phase 1: WHY | 需求文档、用户故事、竞品分析 |
| `prd/2-product-design/1-feature-specs/` | Phase 2: WHAT | 功能规格、信息架构、设计规范 |
| `prd/2-product-design/2-page-design/` | Phase 2: WHAT | 页面设计文档 + HTML 原型 |
| `prd/3-technical-plan/1-architecture/` | Phase 3: HOW | 整体架构、技术选型、部署约束 |
| `prd/3-technical-plan/2-scenario-implementation/` | Phase 3: HOW | 业务场景文档（时序图 + 步骤说明） |
| `prd/3-technical-plan/3-deployment/` | Phase 3: HOW | 部署方案、环境配置、回滚策略、冒烟测试方案 |
| `api/` | Phase 3: HOW | OpenAPI YAML 规格文件 |
| `database/` | Phase 3: HOW | SQL DDL 设计文件 |
| `test/` | Phase 3: HOW | 单元测试 + 场景测试用例规格（Markdown） |
| `test/smoke/` | Phase 3: HOW | 部署后冒烟测试用例规格（Markdown，仅需部署的项目） |
| `scenario/` | Phase 3: HOW | API 编排测试用例（JSON，仅 API 项目） |
| `implementation/` | Phase 3: HOW | 代码实现清单（Markdown），标记代码实现阶段完成 |
| `verify/` | Phase 3: HOW | 测试验收、部署执行、冒烟测试结果（JSONL + 报告） |

**自足性声明（S37，merge-conservation-archive-audit）**：`logos/resources/` 必须**自足**——所有「当前有效」的规格内容必须存在于此处（方法论规范在根 `spec/`、Skill 在 `skills/`），任何流程、Skill、CLI 均不得依赖读取 `logos/changes/archive/` 内容来还原当前真相。条目退出 resources 只能显式发生——**整节删除经 `REMOVED`，部分条目删除经同锚 `MODIFIED`（携带剩余全量）+ `REMOVED-ITEMS`（逐行点名）的成对协议**——由条目守恒门（change-lint L8 + merge 拒绝）机器保障，详见 [change-management.md](./change-management.md)。


### logos/resources/decisions/（S38，decision-record-capability）

顶层决策记录目录（与 `prd/`、`api/`、`database/`、`test/` 平级），存放标准 ADR 变体的**决策记录**——把「为什么这样设计」的拍板理由沉淀为当前有效规格的活文档。

- **文件命名**：`<module>-DXX-<slug>.md`（如 `core-D01-decision-record-capability.md`）；`DXX` 全局唯一，由 `logos-project.yaml` 的 `decision_counter.next_id` 维护（对齐 `scenario_counter`，跨模块单调递增）。
- **文档结构（标准 ADR 变体）**：状态（`proposed` / `accepted` / `superseded by DYY`）、背景、决策、理由、备选方案、影响面、来源（提案 slug + issue 链接）。
- **产出通道**：决策记录是普通规格 delta——delta 子目录 `deltas/decisions/` 映射到 `logos/resources/decisions/`（`DELTA_TO_RESOURCE` 同源维护，**该类别由 decision-record-capability 的代码注册；注册前 `deltas/decisions/` 会被判 `delta_path_invalid`**，delta-r1 F1）；`openlogos merge` 只校验 + 生成 `MERGE_PROMPT`，**实际落盘由 merge-executor 在 apply 时完成**（delta-r1 F2，见 `change-management.md`）；**不新增 `openlogos decision` CLI 命令**。
- **resource_index 收录（delta-r1 F3）**：`decisions/` 文件的内容化 desc 需 `cli/src/lib/sync-resource-index.ts` 的 `scanCandidateFiles()` 纳入 `decisions/`、`inferResourceDesc()` 增 `DXX` 规则后，才由 `openlogos index` / `sync` 发现并入 `resource_index`（非既有机制自动收录）。
- **与自足性声明联动（承 S37）**：决策理由入 resources 后，`logos/resources/` 的「自足性」从「只覆盖规格结论（是什么）」扩展到「覆盖决策理由（为什么）」——archive 彻底卸下「决策理由唯一载体」负担，删除 archive 不再损失任何需复盘信息。
- **守恒保护（承 S37）**：`DXX` 纳入条目守恒门 ID 模式注册表，决策记录条目删除必须显式（`REMOVED` / `REMOVED-ITEMS` 点名）；推翻旧决策改状态为 `superseded by DYY`（不删除），决策历史留在活文档内、可检索、不依赖 archive。

### logos/changes/

变更提案工作区。每次功能迭代或 Bug 修复，先在这里创建变更提案，审核通过后再合并回主文档。详见 [change-management.md](./change-management.md)。

**archive 定位（audit-only，S37）**：`logos/changes/archive/` 是已完成变更的历史归档，**仅供审计**——它不是任何规格内容的事实源；归档内容过期后可整体或部分删除（含 `MERGE_PROMPT.md` 等纯派生物），删除不得损失任何当前有效信息（当前真相自足于 `logos/resources/` 与根 `spec/`、`skills/`）。清理由项目按需自行执行，OpenLogos 不强制保留期。

### logos.config.json 与 logos-project.yaml

- `logos/logos.config.json`：项目配置文件，定义文档模块的路径和匹配模式
- `logos/logos-project.yaml`：AI 协作索引，为 AI 助手提供项目全局上下文

两个文件都放在 `logos/` 目录下。

**`logos.config.json` 的 `flow.cmd_timeout_seconds`（cmd 超时项目级默认）**：可选 `flow` 块（与 `verify` / `smoke` 块同级）

- **`flow.cmd_timeout_seconds`**（integer ≥ 1，默认 60）：flow 节点 `cmd:` 谓词的**项目级默认超时秒数**。
- **优先级**：节点级 `cmd_timeout_seconds`（flow 文件 node 字段）> 项目级 `flow.cmd_timeout_seconds` > 内置 60s。
- 二者均须整数 ≥ 1；为 0 / 负数 / 非整数时报 `FLOW_SCHEMA_INVALID`。

## 文件命名约定

### 文档文件

- 使用 `<module>-{序号}-{英文名}.md` 格式：`core-01-requirements.md`
- `<module>` 为模块标识符（小写字母 + 连字符），初始项目默认使用 `core-` 前缀
- 序号用于控制显示顺序
- HTML 原型使用 `{序号}-{英文名}-prototype.html` 格式
- 设计文档与原型成对出现：`03-homepage-design.md` + `03-homepage-prototype.html`

### API 文件

- 按领域分文件：`auth.yaml`、`payment.yaml`、`license.yaml`
- 使用 OpenAPI 3.0 YAML 格式

### 数据库文件

- 完整 Schema：`{project-name}.sql`
- 或按领域分文件：`auth.sql`、`payment.sql`

### 测试用例规格文件

- 按场景分文件：`core-S01-test-cases.md`、`core-S02-test-cases.md`
- 命名格式：`<module>-{场景编号}-test-cases.md`
- 使用 Markdown 格式，包含单元测试和场景测试的用例设计
- 每个文件对应一个场景编号，覆盖该场景的所有测试层级

### 部署方案文件

- 部署方案默认文件名：`core-01-deployment-plan.md`
- 命名格式：`<module>-{序号}-deployment-plan.md`
- 存放位置：`logos/resources/prd/3-technical-plan/3-deployment/`
- 内容至少包含：目标环境、部署拓扑、环境变量、构建命令、发布命令、数据迁移、回滚策略、部署后检查、冒烟测试方案

### 冒烟测试用例文件

- 冒烟测试用例默认文件名：`core-smoke-test-cases.md`
- 命名格式：`<module>-smoke-test-cases.md`
- 存放位置：`logos/resources/test/smoke/`
- 用例 ID 建议使用 `SMOKE-{module}-{序号}`，例如 `SMOKE-core-01`
- 冒烟测试只验证部署后的环境可用性，不替代 `UT-*` / `ST-*` 用例

### 场景文件

- 按场景分文件：`user-auth.json`、`payment-flow.json`
- 使用 JSON 格式定义 API 编排

### 验收文件

- 测试结果：`test-results.jsonl`（JSONL 格式，每行一个用例结果）
- 验收报告：`acceptance-report.md`（由 `openlogos verify` 自动生成）
- 部署报告：`deployment-report.md`（部署执行完成后生成）
- 冒烟结果：`smoke-results.jsonl`（JSONL 格式，每行一个冒烟用例结果）
- 冒烟报告：`smoke-report.md`（由 `openlogos smoke` 自动生成）
- 详细格式定义见 [test-results.md](./test-results.md)

### .claude/openlogos/bin/guard-check

PreToolUse guard hook 脚本。在 Claude Code 调用 Edit/Write/Bash 工具前执行，检查 `logos/.openlogos-guard` 是否存在。

判定逻辑：
1. 读取 `logos/logos-project.yaml`，若所有模块均为 `initial` lifecycle → 放行（不受限）
2. 存在 `launched` 模块时，检查 `logos/.openlogos-guard` → 存在则放行
3. guard 不存在且目标文件/命令不在白名单内 → exit 2 硬性阻断

- 部署方式：由 `openlogos init` / `openlogos sync` 自动部署到 `.claude/openlogos/bin/guard-check`
- 适用工具：仅 Claude Code（其他工具通过各自机制实现）
- 详细规格：见 `spec/pretooluse-guard.md`

## 可选目录

根据项目需要，可以添加以下目录：

| 目录 | 用途 |
|------|------|
| `logos/resources/image/` | 产品图片资源（截图、图标等） |
| `logos/resources/context/` | 额外的 AI 上下文文件 |
| `docs/` | 面向用户的文档（部署文档、使用手册等） |
| `scripts/` | 开发脚本 |
