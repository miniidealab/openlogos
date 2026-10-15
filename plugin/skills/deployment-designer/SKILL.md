---
name: deployment-designer
description: "Design the deployment plan (topology, environments, release commands, migrations, rollback, post-deploy smoke) and the environment registry deploy configuration for openlogos deploy. Use when API/DB design is complete but logos/resources/prd/3-technical-plan/3-deployment/ is empty, or when a change affects deployment."
---

# Skill: Deployment Designer

> 在代码实现前输出完整部署方案：部署拓扑、环境配置、发布命令、数据迁移、回滚策略和部署后冒烟测试方案。该 Skill 是 Phase 3 Step 3 的执行入口。

## 触发条件

- 用户要求设计部署方案、发布方案或上线方案
- 用户提到 “Phase 3 Step 3”、“部署方案”、“deployment plan”
- API / DB 设计完成后，需要进入部署方案设计
- Initial 阶段准备进入测试设计前，`3-technical-plan/3-deployment/` 仍为空

## 前置依赖

1. `logos/resources/prd/3-technical-plan/1-architecture/` 中存在架构概要
2. `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中存在场景实现文档
3. API / DB 设计已完成，或对应模块在 `skip_phases` 中明确跳过
4. `logos/logos-project.yaml` 可读

## 核心能力

1. 从架构、API、DB 和技术栈中推导部署目标
2. 设计本地 / 测试 / 预发 / 生产环境部署拓扑
3. 明确环境变量、密钥来源、构建命令和发布命令
4. 定义数据迁移、初始化数据和回滚策略
5. 设计部署后检查清单
6. 设计 smoke 测试方案输入，供 `test-writer` 生成 `SMOKE-*` 用例
7. 更新 `logos-project.yaml` 的部署门禁信息

## 执行步骤

### Step 1: 读取上下文

必须读取：

- `logos/logos-project.yaml`
- 架构概要文档
- 场景实现文档
- API 规格（如存在）
- DB DDL（如存在）
- 现有部署方案（如存在）

重点确认：

- 项目是否需要部署
- 目标环境有哪些
- 是否存在远程服务、生产环境、密钥、域名、证书或数据迁移
- smoke 需要覆盖哪些最小链路

### Step 2: 判断部署门禁

默认规则：

- 软件项目默认需要部署方案
- 有运行环境的项目默认需要部署执行和 smoke
- 纯文档、纯规范、无需运行环境的库项目可声明 `deployment_required: false`

若用户选择无需部署，部署方案仍需写明原因和跳过条件。

### Step 3: 输出部署方案

默认文件：

`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`

**⚠️ Mermaid 部署拓扑图语法安全（强制）**：
- 部署拓扑通常使用 Mermaid `graph` / `flowchart`，节点标签默认写成 `ID["标签文本"]`。
- 含域名、URL、API 路径、端口、环境名、云服务名、中文、空格或 `<br/>` 的标签必须加双引号：`Pages["Cloudflare Pages"]`、`API["API :8787"]`、`Proxy["/voice/api 代理"]`。
- 错误：`Proxy[/voice/api 代理]`，因为 `[/` 会触发 Mermaid 平行四边形形状语法，容易导致部署图渲染失败。
- 多行标签使用 `<br/>`，整段文本仍放在同一对双引号内：`Worker["Cloudflare Worker<br/>staging"]`。
- 子图名称含空格、中文或特殊字符时必须加引号：`subgraph "Staging Environment"`。
- 只有明确要表达特定形状时才使用 Mermaid 形状语法；普通部署组件一律使用带引号的文本节点。

文档结构：

```markdown
# core-01-deployment-plan

## 一、部署目标

## 二、部署拓扑

## 三、环境变量与密钥

## 四、构建与发布命令

## 五、数据迁移策略

## 六、回滚策略

## 七、部署后检查清单

## 八、冒烟测试方案

## 九、门禁结论
```

### Step 4: 设计 smoke 输入

在部署方案的“冒烟测试方案”中列出必须覆盖的 smoke 检查项：

- 健康检查
- 核心入口
- 数据库迁移
- 静态资源
- 配置与密钥
- 关键链路
- 日志与监控

具体 `SMOKE-*` 用例由 `test-writer` 输出到 `logos/resources/test/smoke/`。

### Step 5: 更新 logos-project.yaml

如模块需要部署，建议写入：

```yaml
deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

并将部署方案加入 `resource_index`。

#### Step 5.1: 产出环境登记表 `logos/environments.yaml`（environment-registry）

部署方案涉及具体环境（测试、预发、生产等）时，按方案「一、部署目标」「三、环境变量与密钥」「四、构建与发布命令」产出或更新 `logos/environments.yaml`（格式权威：`spec/environments.md` §2、§11.2），并为可由 OpenLogos 执行部署的环境写出 `deploy` 条目与部署脚本（来源变更 environment-deploy）：

```yaml
schema_version: 1
environments:
  - id: staging
    name: 预发环境
    tier: staging
    aliases: [预发]
    health: https://staging.example.com/healthz
    version: https://staging.example.com/version
    secrets: [STAGING_DEPLOY_TOKEN]
    deploy:
      mode: script
      script: deploy/staging.sh
      args: ["{env}", "{ref}"]
      timeout_sec: 1800
  - id: prod
    name: 生产环境
    tier: prod
    aliases: [生产]
    deploy:
      mode: ci
      provider: github-actions
      workflow: deploy.yml
      inputs: { environment: "{env}" }
```

规则：

- `id` 用小写字母、数字与连字符；`tier` 取 `dev | test | staging | prod`；id 与 alias 不区分大小写全局唯一。
- `secrets` **只写环境变量名，不得写值**；方案中出现的真实密钥一律不进登记表。
- `deployment_gates.<module>.environments` 中的每一项必须能按 id 或别名解析到登记表中的环境。
- 只登记部署方案确实涉及的环境，不臆造；部署方案没有环境划分时不产出登记表（登记表是 opt-in）。
- 登记表属于 `guard.exempt` 内置默认，修改不需立案。

**选择执行方式**：

- 仓库已有可用的 GitHub Actions 部署工作流 → 优先 `mode: ci`、`provider: github-actions`；GitLab 等其他 CI → `mode: ci`、`provider: script`，编写仓库内的 `trigger_script` 与 `status_script`（JSON 协议见 `spec/environments.md` §11.3）。
- 没有流水线、部署步骤可脚本化 → `mode: script`，编写部署脚本。
- 部署步骤暂时无法脚本化（需要人工或 AI 判断的操作） → `mode: agent`，`plan_section` 写部署方案中对应章节标题；后续应尽量改为 script 或 ci。

**登记表不承载可执行命令**（决策 D13）：`deploy` 只写脚本路径、工作流名、参数、超时等配置，**不得**写 `run`、`command`、`shell` 等命令字段——登记表免立案可改，命令写在这里会让部署行为绕过 guard。改变部署行为必须改受保护的脚本或工作流。

**部署脚本编写要求**（script 方式）：

- 放在仓库内被 git 跟踪的路径（默认 `deploy/<env>.sh`），提交可执行位；CLI 以参数数组直接执行、不经 shell，参数用 `args` 的占位符 `{env}`、`{ref}`、`{ref_short}`、`{deploy_id}` 传入。
- 脚本在**目标版本的隔离工作树**中运行（`workdir: worktree` 默认）：工作树里没有 `node_modules`、构建产物等未跟踪文件，脚本必须自行安装依赖与构建，不得依赖当前工作区状态。
- 失败时以非零退出码退出；不打印密钥值（CLI 只能遮盖已声明的密钥）；幂等，可重复执行。
- 可读取 `OPENLOGOS_DEPLOY_ENV`、`OPENLOGOS_DEPLOY_REF`、`OPENLOGOS_DEPLOY_ID`、`OPENLOGOS_DEPLOY_CHANNEL`。

**CI 工作流要求**（ci 方式）：工作流部署的必须是自身检出的提交，并以固定名称上传 artifact `openlogos-deploy-result`，其中 `result.json` 为 `{"deployed_ref": "<40 位 commit>"}`，值取自部署所用 `actions/checkout` 步骤的 `commit` 输出（provider: script 由 `status_script` 在 `completed` 时输出 `deployed_ref`）。没有回报时 OpenLogos 记录部署版本为未知，该次部署不能作为回滚目标、smoke 不能得到已验证事实。

**自验证（设计阶段，不做真实部署）**：对每个配置了 `deploy` 的环境依次运行 `openlogos env check` 与 `openlogos deploy --env <id> --ref <当前提交> --dry-run`（只读，校验脚本在目标版本中存在且可执行、参数占位符合法、声明的密钥齐全、`gh` 可用且已登录），shell 脚本另做 `bash -n` 语法检查；任一失败先修正再交付。**设计阶段不得执行真实部署**。

## 输出规范

- 部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`；配置了 `deploy` 的环境须在方案中新增「部署脚本审阅摘要」一节：每个脚本或工作流的路径、做什么、动哪些外部资源（服务、数据库、存储、域名）、需要哪些密钥变量名、失败与回滚方式。该节供愿意审阅的人阅读，**不写任何确认标记、不阻断流程**（来源变更 environment-deploy，决策 C03）
- 环境登记表（部署方案涉及具体环境时）：`logos/environments.yaml`，格式见 `spec/environments.md`
- 部署脚本（script 方式）：仓库内受保护路径，默认 `deploy/<env>.sh`；CI 适配脚本（provider: script）同样放在仓库内
- 文档语言遵循项目 locale
- Mermaid 可用于部署拓扑图，且必须遵循上述节点标签与子图命名安全规则
- 不执行任何真实部署命令；只运行只读的 `openlogos env check`、`openlogos deploy --dry-run` 与脚本语法检查

## 人类确认点

本 Skill 只设计部署方案，不执行部署。部署执行必须等到：

1. 代码实现完成
2. `openlogos verify` 通过
3. 用户明确授权部署

## 推荐提示词

- `帮我设计部署方案`
- `按 Phase 3 Step 3 输出部署方案`
- `基于当前架构设计 staging 部署和 smoke 方案`

## Authority writer cutover 与 projection 重建


部署设计前读取 `spec/authority-closure.md` 和 Authority Registry，并逐个稳定 `fact_id` 引用 owner/writer/mutation entry、projection、recovery 与 cutover；不得另建 owner 表或用路径生成事实身份。只要本次改变 owner/writer/mutation entry、projection schema 或 recovery source，部署方案必须包含有限 cutover；不得把长期双写当兼容策略。

### 强制顺序

1. 冻结 authority identity、before facts、当前入口和回滚制品。
2. 停止/隔离旧 writer，并证明旧入口不能成功写入。
3. 启用唯一新 mutation entry；不可逆写入前明确 rollback boundary。
4. 从 authority 重建 projections，以 generation/version/hash/receipt 做 freshness probe。
5. 执行 stale/conflict/response-lost/restart/legacy-writer 负向 smoke。
6. 记录 exit evidence，结束迁移窗口；失败时恢复冻结版本且不留下混合 writer。

部署完成与 cutover 完成是两个事实，不能由“进程已启动”反推 writer 已唯一。新 authority 已产生不可逆写入后禁止重新开启旧 writer；只能前滚或启用兼容 reader。部署任务与 smoke 仍分别等待用户明确授权。
