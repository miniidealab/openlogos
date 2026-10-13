---
title: CLI 概览
description: OpenLogos 命令行接口的参考文档。
---

`openlogos` CLI 管理整个项目生命周期 —— 从初始化、阶段推进、变更管理到测试验证。

## 安装

```bash
npm install -g @miniidealab/openlogos@latest
```

验证：

```bash
openlogos --version
# 0.16.0
```

升级 CLI 后，请在每个已有项目中运行 `openlogos sync`，刷新 guard、hooks 与 Skills。

## 全局选项

| 选项 | 说明 |
|--------|-------------|
| `--help`, `-h` | 显示帮助信息 |
| `--version`, `-v` | 显示版本号 |
| `--format json` | 结构化 JSON 输出（多数读取类与门禁类命令支持，如 `status`、`next`、`verify`、`merge`、`change-lint`、`impact`） |

除 `init`（以及在任意目录都可运行的 `detect`）外，命令都必须在项目根目录（`logos/logos.config.json` 所在目录）下运行。

## 命令参考

### 项目搭建与导航

| 命令 | 说明 |
|---------|-------------|
| [`init`](/zh/cli/init) | 初始化一个新的 OpenLogos 项目结构 |
| [`adopt`](/zh/cli/adopt) | 接入现有项目（bootstrap: adopted） |
| [`sync`](/zh/cli/sync) | 按当前配置重新生成 AI 指令文件、guard、hooks 与 Skills |
| [`status`](/zh/cli/status) | 显示项目阶段、活跃提案步骤与建议 |
| [`next`](/zh/cli/next) | 显示最值得执行的单条下一步（`--auto` 为全自动） |
| [`watch`](/zh/cli/watch) | 实时流式输出派生的 dev-flow 状态（只读） |
| [`flow show`](/zh/cli/flow-show) | 展示内置或应用 overlay 后的 dev-flow 编排 |
| [`detect`](/zh/cli/detect) | 显示 CLI 版本和项目检测信息 |
| [`index`](/zh/cli/index-command) | 生成用于重建 `logos-project.yaml` 资源索引的 AI 提示词 |
| [`module`](/zh/cli/module) | 管理项目模块（list / add / rename / remove / set-product-type） |
| [`feature list` / `feature-backfill`](/zh/cli/feature) | 列出功能分组；生成回填功能分组的提示词 |

### 验证与发布

| 命令 | 说明 |
|---------|-------------|
| [`verify`](/zh/cli/verify) | 针对测试用例规格验证测试结果（Gate 3.6） |
| [`deploy-done`](/zh/cli/deploy-done) | 受控记录部署完成（Gate 3.7） |
| [`smoke`](/zh/cli/smoke) | 针对 smoke 规格验证部署后健康状况（Gate 3.8） |
| [`launch`](/zh/cli/launch) | 在验证通过后激活变更管理 |

### 变更管理（Delta 工作流）

| 命令 | 说明 |
|---------|-------------|
| [`change`](/zh/cli/change) | 创建变更提案并设置活跃提案 guard |
| [`change-lint`](/zh/cli/change-lint) | 只读检查提案、tasks 与 delta 是否交付合格（L0～L9） |
| [`merge`](/zh/cli/merge) | 一次原子调用把规格 delta 合并进主文档；已合并提案可增量修正 |
| [`slice plan`](/zh/cli/slice) | 依据 `slices.json` 写入 `[code]` 切片与 `TEST_SLICE_MANIFEST.json` |
| [`archive`](/zh/cli/archive) | 归档已完成的变更提案并释放 guard |

### 规格检查、CI 与保护范围

| 命令 | 说明 |
|---------|-------------|
| [`lint-specs`](/zh/cli/lint-specs) | 只读检查测试规格结构（重复 ID / 表格列数 / ID 格式） |
| [`impact`](/zh/cli/impact) | 判断 git 变更区间是否只是生命周期记账（供 CI 使用） |
| [`ignore` / `exempt`](/zh/cli/ignore-exempt) | 管理不入版本控制的路径，以及无需立案的已入库路径（`add` / `remove` 须经宿主审批） |

## 项目生命周期

OpenLogos 项目有两种 lifecycle 状态：

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  openlogos     Phase 1 → 2 → 3    openlogos     openlogos    │
│  init          (AI + Skills)       verify        launch       │
│  ────────► ┌──────────────────┐ ──────────► ──────────►       │
│            │   "initial"      │  Gate 3.6                     │
│            │ (No change       │   PASS                        │
│            │  proposals       │                               │
│            │  required)       │                               │
│            └──────────────────┘                               │
│                                                               │
│            ┌──────────────────┐                               │
│            │   "launched"     │  ◄── openlogos change <slug>  │
│            │ (Change          │  ──► openlogos merge <slug>   │
│            │  proposals       │  ──► openlogos archive <slug> │
│            │  required)       │                               │
│            └──────────────────┘                               │
└───────────────────────────────────────────────────────────────┘
```

- **`initial`** —— 首个开发周期。AI 自由地遵循阶段推进（Phase 1 → 2 → 3），无需变更提案。以 `openlogos verify` 结束（Gate 3.6 必须 PASS）。
- **`launched`** —— 在 `openlogos launch` 之后。对现有文档的所有修改都必须经过变更提案（`change` → `merge` → `archive`）。

## 阶段推进

开发生命周期通过 **13 个阶段**推进。`status` 命令通过扫描 `logos/resources/` 目录跟踪其中 11 个阶段；Phase 3-5 在项目源码树中产出代码，并通过 Phase 3-6 验证间接校验。

| 阶段 | 目录 | 建议的 AI 提示词 |
|-------|-----------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` | "Help me write requirements" |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` | "Do product design based on requirements" |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` | "Help me design the technical architecture" |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` | "Help me draw S01 sequence diagram" |
| Phase 3-2 · API Design | `logos/resources/api/` | "Help me design the API" |
| Phase 3-2 · DB Design | `logos/resources/database/` | "Help me design the database" |
| Phase 3-3 · Deployment Plan | `logos/resources/prd/3-technical-plan/3-deployment/` | "Help me design the deployment plan" |
| Phase 3-4a · Test Cases | `logos/resources/test/` | "Help me design test cases" |
| Phase 3-4b · Orchestration | `logos/resources/scenario/` | "Help me design orchestration tests" |
| Phase 3-5 · Code Implementation | *(project source tree)* | "Implement S01 based on the specs" |
| Phase 3-6 · Verification | `logos/resources/verify/` | Run tests, then `openlogos verify` |
| Phase 3-7 · Deployment Execution | *(deployment report)* | Execute deployment with human authorization |
| Phase 3-8 · Smoke Test | `logos/resources/verify/smoke-report.md` | `openlogos smoke` after deployment |

Phase 3-5 是核心实现步骤，AI 在此基于完整的规格链（时序图、API YAML、DB DDL、测试用例规格）生成**业务代码 + 测试代码**。每一批生成的代码都必须包含一个 OpenLogos reporter，将结果写入 `logos/resources/verify/test-results.jsonl`。该阶段没有专属的 `logos/resources/` 目录，因为代码输出直接进入项目源码树。

## 典型工作流

```bash
# 1. Initialize
openlogos init my-project
cd my-project

# 2. Work through phases with AI
#    Phase 1 → 2 → 3-0 → 3-1 → 3-2 → 3-3 (AI loads Skills automatically)
openlogos status          # check progress at any time
openlogos next            # ask for the single next action

# 3. Implement code + test code (Phase 3-5)
#    AI generates business code and test code from full specification chain
#    Test reporter writes results to logos/resources/verify/test-results.jsonl

# 4. After all phases complete, verify test coverage
openlogos verify          # Gate 3.6 must PASS

# 5. Activate change management for future iterations
openlogos launch

# 6. For future changes, use the Delta workflow
openlogos change fix-redirect-bug
# ... AI 填写提案与 tasks，再编写 delta ...
openlogos change-lint                      # 交付前必须 exit 0
openlogos merge fix-redirect-bug           # 一次原子调用，写入 SPEC_MERGED
openlogos slice plan --file slices.json    # slice-planner 写入 [code] 切片
# ... AI 实现代码与测试 ...
openlogos verify                           # Gate 3.6
openlogos archive fix-redirect-bug
```

半自动模式下，`merge`、`verify`、部署、`smoke`、`archive` 与 `git push` 只在你明确授权后执行；`openlogos next --auto` 对整条链路给出 standing 授权（见 [`next`](/zh/cli/next)）。
