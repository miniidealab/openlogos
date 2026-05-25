# core-01-feature-specs

## 一、核心能力列表
1. 初始化 OpenLogos 项目（全新项目）。
2. 已有项目接入 OpenLogos（`adopt`，直接进入 launched 模式）。
3. 同步 AI 工具资产与资源索引。
4. 查看阶段进度与下一步建议。
5. 创建、合并、归档变更提案。
6. 执行 verify 与 smoke。
7. 切换 launched 生命周期。
8. 管理模块注册表。
9. 解析 SQL 注释与输出 JSON。

## 二、规格边界
### 2.1 CLI 交互
- 所有命令必须支持明确的成功与失败输出。
- `--format json` 结果必须稳定可解析。

### 2.2 AI 资产
- `AGENTS.md`、`CLAUDE.md`、Skills 和插件模板必须由 `sync`/`init`/`launch` 维护。

### 2.3 变更管理
- 活跃 guard 存在时，新变更必须被阻止。
- merge 前必须先有 proposal 和 tasks。

### 2.4 资源索引
- 新文档与关键文档必须通过 `resource_index` 可发现。

### 2.5 提案级部署决策
- `proposal.md` 的 `## 部署影响` 是每个提案的部署决策入口，必须明确是否需要部署、是否需要 smoke、部署原因、影响环境、数据迁移与回滚要求。
- `tasks.md` 的 `[deploy]` section 是部署执行任务入口，只能在提案声明需要部署时存在。
- `openlogos status`、`openlogos next` 和 RunLogos 面板必须优先使用提案级部署决策；模块级 `deployment_required` / `smoke_required` 只作为缺少提案级决策时的兼容默认值。
- `openlogos status --format json` 必须额外输出 `deployment_progress` 与 `deployment_document`，其中 `deployment_progress` 仅统计当前提案 `tasks.md` 的 `[deploy]` section，`deployment_document` 必须指向当前提案 `tasks.md`。
- `deployment_progress` 建议结构为 `{ checked, total, percent, status, label }`，其中 `status` 取值为 `pending` / `done` / `empty` / `unavailable`。
- `deployment_document` 建议结构为 `{ path, name, exists }`，并保留 `path` 便于降级诊断。
- 文档-only、规格-only、索引修正类提案若声明无需部署，verify PASS 后必须直接建议 archive，不展示部署执行按钮或 smoke 按钮。
- 代码运行时、打包产物、发布脚本、插件模板或官网构建受影响的提案若声明需要部署，verify PASS 后必须进入部署授权流程。
- 当 `proposal.md` 与 `tasks.md` 冲突时，CLI 必须在 status / next 中给出警告，并阻止“无需人工确认的自动部署”。
- 冲突状态必须通过 `deployment_decision_conflict=true` 显式暴露，作为 CLI 和 RunLogos 的阻断信号；冲突未修正前不得展示 deploy、smoke 或 archive 作为主动作。

### 2.6 bootstrap: skipped 行为约束

- `adopt` 命令生成的 `logos-project.yaml` 中，模块 `bootstrap` 字段值为 `skipped`，`lifecycle` 直接为 `launched`。
- `bootstrap: skipped` 模块不要求 Phase 1~3 文档存在；`status` 将其显示为「文档基线已跳过（快速接入）」，而非未完成。
- `next` 在 `bootstrap: skipped` 且无活跃提案时，固定输出补文档引导，建议执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代。
- `launch` 对 `bootstrap: skipped` 且 `lifecycle: launched` 的模块豁免 Phase 1~3 门禁检查。
- 补文档提案（如 `add-baseline-docs`）归档后，`next` 恢复正常阶段建议逻辑。

## 三、功能验收摘要
### S01
初始化后必须生成完整目录、配置和 AI 指令文件。

### S05
next 必须输出最可执行建议，而不是多条并列建议；存在活跃提案时，next 必须优先读取提案级部署决策。无需部署的提案在 verify PASS 后建议 archive；需要部署的提案在 verify PASS 后建议由用户明确授权部署；部署决策冲突时建议修正 proposal / tasks，不建议部署、smoke 或归档。

### S08
sync 必须同时处理 AI 资产和资源索引。

### S09
change/merge/archive 必须构成闭环；提案填写阶段必须同步形成部署影响判断。`proposal.md` 声明无需部署时，`tasks.md` 不得出现 `[deploy]` section；声明需要部署时，必须有 `[deploy]` section，并在 delta 阶段补齐部署方案与 smoke 影响。AI 生成 proposal/tasks 后必须先做一致性自检，自检失败不得进入 delta-writing。

### S11
status 必须显示阶段进度、活跃变更、提案级部署决策、部署进度摘要和下一步建议。JSON 输出必须暴露部署决策字段、部署进度摘要和任务文档入口，供 RunLogos 面板判断是否展示部署按钮、smoke 按钮和归档按钮。`deployment_decision_conflict=true` 时必须展示为阻塞态。

### S13
verify 必须关联测试用例与运行结果。

### S14
launch 必须检查验收、部署和 smoke 门禁。

### S15
SQL 注释解析必须保留表与字段元数据。

### S16
JSON 输出必须与文本输出共享同一事实源。

### S17
模块增删改必须同步 YAML 与引用。

### S18
resource_index 必须能反向索引当前真相源。

### S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。

### S20
adopt 后必须生成完整 `logos/` 目录、`bootstrap: skipped` 标记和 AI 指令文件；`status` 必须将 Phase 1~3 显示为「已跳过」；`next` 必须输出补文档引导；`launch` 必须豁免 Phase 1~3 门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。
