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
- **模块报告**（module-scoped-phase-reports，仅多模块项目中 `lifecycle: initial` 的模块）：
  - 模块验收报告：`<module>-acceptance-report.md`（由 `openlogos verify` 在覆盖该模块时按其用例子集生成，整份覆盖）
  - 模块部署报告：`<module>-deployment-report.md`（只在该模块部署成功并落账后由 `openlogos deploy` / `deploy-done` 追加；CLI 不参与记录时由 deployment-executor 在部署成功后写入）
  - 模块冒烟报告：`<module>-smoke-report.md`（由 `openlogos smoke` 在目标模块确定时生成，整份覆盖）
  - 这三类路径是保留路径，只由模块报告 writer 以原子发布写入；配置的 `smoke.report_path` / `smoke.modules.<id>.report_path` 落在其上时，共用冒烟报告改写到默认路径 `smoke-report.md`
  - 它们是该模块 phase.3-6 / 3-7 / 3-8 的完成依据；共用报告照旧生成，但不计入多模块 initial 模块的阶段完成（判据见 [flow-spec.md](./flow-spec.md) §9、[test-results.md](./test-results.md)「多模块项目的模块验收报告与模块冒烟报告」、[environments.md](./environments.md) §14.9）
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

## logos/resources/knowledge/（S45，enterprise-knowledge-base）

顶层企业知识目录（与 `prd/`、`api/`、`database/`、`test/`、`decisions/` 平级），存放从企业资料提炼出的**知识条目**：业务规则、术语、外部系统约束、合规要求与业务流程。它们不是某一次需求的内容，而是设计必须遵守或参照的既有事实；场景按 `KXX` / `KXX-Rn` 引用它们。规则权威：功能规格 §2.102（条目、引用与提案通道）、§2.103（直接录入、标签表、索引与检索，来源变更 knowledge-direct-intake）。

- **文件命名**：`<module>-KXX-<slug>.md`（如 `core-K03-refund-approval.md`）。KXX 在录入（准备 apply 候选或编写 delta）时取「有效知识视图中最大 KXX（含 `deprecated` 条目）+ 1」，不设计数器；apply 与准入时校验唯一性。
- **目录内的非条目文件**（只经 `openlogos knowledge` 命令写入，不参与编号、结构校验、守恒注册与 `resource_index`）：
  - `TAGS.md`——标签表，表头「标签 | 别名 | 说明」；AI 起草与日常补充、人类负责人把关；首次 apply 时从已有条目的标签生成。
  - `.tags-enabled`——标签表启用标记，首次启用时写入，此后不删除；与 `TAGS.md`、git HEAD 一起决定标签表三态（从未启用 / 已启用 / 已启用但词表丢失）。
  - `INDEX.md`——总索引，落盘条目的派生视图，文件头注明「由 openlogos knowledge index 生成，请勿手工编辑」；过期只提示刷新。
- **文档结构**：H1 以 KXX 开头；首节「元数据」用 YAML 给出 `type`（`rule` / `term` / `external-system` / `compliance` / `process`）、`scope`（`global` / `module`）、`module`、`tags`、`status`（`active` / `deprecated`）、`source`（原文仓库相对路径与版本）；`type=rule` 的条目有「规则」表，首列为规则 ID `KXX-Rn`，另有「状态」「例外」列。
- **产出通道**：
  - **直接录入（默认，无需活跃提案）**：AI 把完整条目文件、需要变更的 `TAGS.md` 与原文（`sources/` 下）写到**项目根之外**的一次性候选目录，运行 `openlogos knowledge apply <候选目录>`；apply 在落盘前校验整批，不通过零写入，通过则把原文、条目、`TAGS.md`、`.tags-enabled` 与 `INDEX.md` 同批写入。本目录在 launched、无活跃提案时仍受 guard 保护，**不能**用文件工具直接写。
  - **提案通道（知识修订须与场景同批生效时）**：普通规格 delta——`deltas/knowledge/` 映射到 `logos/resources/knowledge/`（`DELTA_TO_RESOURCE`、合并类别白名单与目标分类器同源维护），由 `openlogos merge` 与场景、`resource_index` 登记、`SPEC_MERGED` 同批原子落盘。`deltas/knowledge/` 只放条目文件，`TAGS.md` / `INDEX.md` / `.tags-enabled` 不经 delta。`openlogos change` 的提案骨架包含 `deltas/knowledge/`。
  - initial 项目也可直接写入本目录，写后运行 `openlogos knowledge check`。
- **录入事务**：apply / index / `apply --recover` 先取得项目级排他锁 `logos/.openlogos-runtime/knowledge-apply.lock`（复用 baseline-seed 提交锁原语，存活持有者不被抢占），再复用 baseline-on-touch 的批次提交与恢复原语，事务日志、staging 与 backup 放在 `logos/.openlogos-runtime/knowledge-apply/`（运行态目录，不入版本控制）；存在未完成事务时，下一次 apply / index / `apply --recover` 先整批回滚，回滚完成前各读取命令拒绝在半写入状态上工作。各读取命令与 change-lint 在同一把锁的读锁区间内读取知识，不会读到跨越一次提交的混合内容。
- **设计时读取**：`openlogos knowledge list` 筛选，`openlogos knowledge show <KXX>` 读取有效知识视图中的合成后全文；不要直接读提案 delta 文件当作条目全文。
- **结构有效性**：H1 以 KXX 开头、「元数据」可解析且 `type` / `scope` / `status` 合法、`tags` 非空、`source` 每项有指向 `logos/resources/reference/knowledge/` 内现存原文文件的相对 `path`（规范化与 symlink 解析后判定，目录外的仓库文件如 `README.md` 不算）与非空 `version`、`type=rule` 时规则表每一行都是本条目的 `KXX-Rn`，才是可被引用的有效条目；标签表已启用时，条目的每个标签还必须是 `TAGS.md` 中的标签或别名。结构无效或标签不在表中的条目会被 apply 与 change-lint 拒绝，不能作为引用目标。
- **退役而非删除**：已合并的条目与规则不允许删除，退役以把状态改为 `deprecated` 表达；文件名与 ID 原样保留、继续占号，永不重新分配；退役条目整体冻结（含「说明」中的定义），退役规则行的规则、状态与例外冻结。
- **resource_index 收录**：`openlogos merge` 对 CREATE 的条目自动登记；`openlogos sync` / `index` 的扫描纳入 `knowledge/`，补录 apply 录入与直接写入的条目（只收录规范命名的条目文件）。Skill 设计时用 `openlogos knowledge list` 读取有效元数据（含活跃提案的知识 delta）筛选，不依赖 `resource_index` 的描述；`INDEX.md` 供人阅读。
- **守恒保护（承 S37）**：`KXX` 与 `KXX-Rn` 纳入条目守恒 ID 注册表，作用范围限本目录；场景文档中引用表首列的 KXX 不是场景文档自身的条目 ID。

### logos/resources/reference/knowledge/（S45）

企业原始资料（制度原文、接口说明、术语表等）的存放处，是 `reference/` 的子目录，沿用 `reference/` 的 guard 默认豁免：直接写入，不经 delta（`deltas/reference/` 仍为显式忽略）；也可放进 `openlogos knowledge apply` 候选目录的 `sources/`，由 apply 校验通过后复制（显式 `guard.exempt` 不含 `reference/` 的项目只能用此方式；走提案通道时用只含 `sources/` 的候选目录写原文，条目仍经 delta 合并）。同名原文已存在且内容不同时 apply 拒绝，新版原文使用新文件名。原始资料与知识条目都进入 git 仓库；AI 写入原文时必须提示「原文将随仓库 push 扩散，push 前请确认可公开范围」。知识条目的 `source` 以仓库相对路径指向这里的文件并注明版本。`openlogos init` 创建本目录与 `logos/resources/knowledge/`；升级前已初始化的项目没有这两个目录时，首次录入由 AI 直接创建原文目录，`logos/resources/knowledge/` 由首次合并知识 delta 时创建。

## 验收历史目录（verification-history）

> 来源变更：verification-history（决策 C01～C04）。留存约定见 [test-results.md](./test-results.md)「验收历史留存（verification-history）」；功能规格 §2.104。三处目录都只由 `openlogos verify` / `openlogos smoke` 在一次运行收尾时写入，测试 runner、reporter 与 AI 不直接写入。

### logos/resources/verify/history/

- 中央轻量索引：每次进入执行的 verify / smoke 运行写一个 `<run_id>.json`（`run_id` 形如 `20261122T061530123Z-verify-a1b2c3`，全局唯一），写入后不再改写。
- 只含结构化字段，不含自由文本；覆盖所有运行（含没有活跃提案时的运行与进入执行后的早退）。
- 随项目正常提交纳入版本控制：OpenLogos 不执行 git 操作；路径被忽略规则命中时由流程提交或用户以 `git add -f` 纳入。按运行独立成文件，分支合并不冲突。

### logos/changes/<slug>/verify-runs/<run_id>/

- 提案完整记录：有活跃提案时每次运行写 `record.json`（与中央索引同字段）、`results.jsonl`（本次实际采集的结果）、`report.md`（本次最终报告快照，早退时缺省）。
- `verify.history.raw_in_proposal` 缺省 `true` 时 `results.jsonl` 为完整结果；为 `false` 时只保留结构化字段，且不写 `report.md`。
- 不属于 delta，不参与 change-lint、merge、计划 / 任务 / 规格指纹与流程派生；`openlogos archive` 整目录移动时随提案进入 `logos/changes/archive/<日期>-<slug>/verify-runs/`。归档目录仍按既有「audit-only」定位，项目清理归档时这些完整记录随之删除，中央索引不受影响。

### logos/.openlogos-runtime/verify-runs/<run_id>/

- 本机原文：只在有活跃提案且 `verify.history.raw_in_proposal: false` 时写 `report.md` 与 `results-raw.jsonl`（被剥除的自由文本字段，按用例 ID 对应）。
- 位于运行态目录，已被受管 `.gitignore` 区块排除，不进入版本控制，换机器或重新克隆后不可用。

### logos/.openlogos-runtime/result-locks/

- 结果路径运行锁文件（`<sha256(真实路径)>.lock`），运行结束即删除；持有进程不存在的锁视为过期并回收。不进入版本控制。
