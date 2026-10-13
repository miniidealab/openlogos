---
title: "openlogos change"
description: 为现有项目的迭代更新创建一份结构化的变更提案，并设置活跃提案 guard。
---

创建新的变更提案目录（含 `proposal.md`、`tasks.md` 与 `deltas/` 子目录），并在 `logos/.openlogos-guard` 中把它记为活跃提案。这是 `launched` 项目 Delta 工作流的入口。

## 命令格式

```bash
openlogos change <slug> [--module <id>]
```

必须在项目根目录下运行。

## 参数与选项

| 参数 / 选项 | 必填 | 说明 |
|-------------|------|------|
| `slug` | **是** | 变更的 kebab-case 标识（如 `fix-redirect-bug`、`add-remember-me`） |
| `--module <id>` | 否 | 指定提案归属模块。只有一个模块时自动挂靠；多个模块时默认挂靠 `core`；多模块且没有 `core` 时必须传 `--module`，命令会为每个模块各给出一条重试命令。 |

## 生成内容

```
logos/changes/<slug>/
├── proposal.md          # 变更提案模板
├── tasks.md             # 任务清单（[delta] / [code] / [deploy]）
└── deltas/
    ├── prd/             # 需求 / 设计 / 技术方案文档的 delta
    ├── api/             # API 规格的 delta
    ├── database/        # 数据库 Schema 的 delta
    └── scenario/        # 编排测试的 delta
```

同时写入 `logos/.openlogos-guard`，记录活跃提案：

```json
{
  "activeChange": "fix-redirect-bug",
  "module": "core",
  "createdAt": "2026-10-12T08:00:00.000Z"
}
```

guard 存在期间，AI 只能在本提案范围内修改代码与规格；guard 不存在时，launched 项目中会进入版本控制的代码与规格受保护（见 [PreToolUse Guard](/zh/specs/pretooluse-guard)）。

### 同一时间只能有一个活跃提案

如果 guard 已指向一个仍在 `logos/changes/` 中、尚未归档的提案，`change` 会拒绝创建新提案：

```
Error: 当前活动变更提案 'add-remember-me' 尚未完成。
请先完成该提案，并明确授权执行 `openlogos archive add-remember-me` 后再创建新提案。
```

guard 文件内容损坏同样会被拒绝，需先修复或删除；`logos/changes/` 中已存在同名 slug 也会被拒绝。

## 生成的模板

### proposal.md

模板包含以下章节（`locale: zh` 用中文标题，`en` 用英文标题）：

| 章节 | 用途 |
|------|------|
| `变更原因` | 为什么要做这个变更 |
| `最小实现论证` | 可选的自检：查过哪些既有机制、为什么不能更小、主动砍掉了什么 |
| `变更类型` | 需求级 / 设计级 / 接口级 / 代码级 |
| `变更范围` | 影响的需求、功能规格、场景、API、DB 表、编排测试 |
| `部署影响` | 是否需要部署及原因、影响环境、数据迁移、回滚预案、smoke |
| `UI/UX 变更声明` | YAML 块（`ui_impact`、`design_system_mode`、`pages`），GUI 项目才有意义 |
| `决策澄清` | `openlogos/clarification@1` YAML 块（见下文） |
| `变更概述` | 用 1～3 段话概述改什么 |

### 决策澄清（`clarification@1`）

「决策澄清」章节记录只能由人拍板的取舍——仓库、配置、规格都答不出的那部分。其 YAML 块列出五类影响，每类给出 `status` 与非空 `reason`：

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: pending
impacts:
  data:                {status: none, reason: "..."}
  compatibility:       {status: none, reason: "..."}
  security_privacy:    {status: none, reason: "..."}
  public_release:      {status: none, reason: "..."}
  external_commitment: {status: none, reason: "..."}
decisions: []
unresolved: []
defaults: []
```

- `none` 表示本次无需用户选择（没有影响，或事实 / 政策已唯一确定）；`required` 表示存在必须由用户做出的高影响选择，并记入 `decisions`。
- **部署与公开发布分别决策。** 部署由「部署影响」章节决定；`public_release` 覆盖 npm 发布、打 tag、Release、官网开放等。同意本地或生产部署不等于同意公开发布，反之亦然。
- 该章节必须存在（change-lint L0 检查它在场且已填写），但其内容是写给人看的记录——不是硬门，也不替代方案批准。

### tasks.md

launched 模块的模板为：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 更新需求文档的场景和验收条件
- [ ] 更新产品设计文档的功能规格

## [code] 代码实现
```

计划阶段 `[code]` 标题保持**为空**——真实的 `[code]` 切片在 merge 之后由 [`slice-planner`](/zh/skills/slice-planner) 通过 [`openlogos slice plan`](/zh/cli/slice) 写入。需要部署的提案再加 `[deploy]` 分节。详见 [tasks.md 格式](/zh/specs/tasks-spec)。

## 交付门：change-lint

填完 `proposal.md` + `tasks.md` 后、写完全部 delta 后，各运行一次：

```bash
openlogos change-lint
```

只有 exit 0 才表示提案产物可以交付。`openlogos merge` 的准入判定与它同源，违规应在这里修掉，而不是等到合并时。详见 [`openlogos change-lint`](/zh/cli/change-lint)。

## 输出示例

```
创建变更提案：fix-redirect-bug
归属模块：core（自动挂靠，当前只有一个模块）

  ✓ logos/changes/fix-redirect-bug/proposal.md
  ✓ logos/changes/fix-redirect-bug/tasks.md
  ✓ logos/changes/fix-redirect-bug/deltas/
  ✓ logos/.openlogos-guard

变更提案已创建。下一步：
  1. 对 AI 说：「帮我填写变更提案 fix-redirect-bug」
  2. AI 将分析影响范围并填写 proposal.md + tasks.md
  3. 然后按 tasks.md 逐项产出 delta 文件到 deltas/
  4. 完成后明确授权执行 `openlogos merge fix-redirect-bug` …
```

## Delta 工作流

```
openlogos change <slug>
       │
       ▼
  AI 填写 proposal.md + tasks.md         →  openlogos change-lint（exit 0）
       │                                     plan-exit：批准方案
       ▼
  AI 在 deltas/ 中编写 delta             →  openlogos change-lint（exit 0）
       │                                     spec-exit：审 delta、授权合并
       ▼
openlogos merge <slug>                   →  一次调用、原子落盘，写入 SPEC_MERGED
       │
       ▼
  slice-planner → openlogos slice plan   →  slice-exit：批准切片
       │
       ▼
  实现代码 + 测试 → openlogos verify（→ 部署 → openlogos smoke）
       │
       ▼
openlogos archive <slug>                 →  移入 archive/，删除 guard
```

除非使用 `openlogos next --auto`，`merge`、`verify`、部署、`smoke`、`archive` 与 `git push` 都是人类确认点。

## 错误

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `Missing change proposal name` | 未提供 slug | `openlogos change add-remember-me` |
| `Change proposal 'X' already exists` | `logos/changes/` 中已有同名 slug | 换一个 slug |
| `当前活动变更提案 'X' 尚未完成` | 另一个未归档的提案持有 guard | 先完成并归档该提案 |
| `logos/.openlogos-guard 内容无效` | guard 文件不是合法 JSON | 修复或删除 guard 文件 |
| `模块 'X' 在 logos-project.yaml 中不存在` | `--module` 的值未注册 | `openlogos module list` |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |

## 相关命令

- [`change-lint`](/zh/cli/change-lint) — 提案与 delta 的交付门
- [`merge`](/zh/cli/merge) — 获得授权后合并 delta
- [`slice`](/zh/cli/slice) — merge 后规划 `[code]` 切片
- [`archive`](/zh/cli/archive) — 归档已完成的提案
- [`launch`](/zh/cli/launch) — 为模块激活变更管理
