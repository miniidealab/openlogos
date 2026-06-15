---
title: CLI 概览
description: OpenLogos 命令行接口的参考文档。
---

`openlogos` CLI 管理整个项目生命周期 —— 从初始化、阶段推进、变更管理到测试验证。

## 安装

```bash
npm install -g @miniidealab/openlogos
```

验证：

```bash
openlogos --version
# 0.10.3
```

## 全局选项

| 选项 | 说明 |
|--------|-------------|
| `--help`, `-h` | 显示帮助信息 |
| `--version`, `-v` | 显示版本号 |

## 命令参考

### 项目搭建

| 命令 | 说明 |
|---------|-------------|
| [`init`](/zh/cli/init) | 初始化一个新的 OpenLogos 项目结构 |
| [`adopt`](/zh/cli/adopt) | 接入现有项目（bootstrap: adopted） |
| [`sync`](/zh/cli/sync) | 重新生成 AI 指令文件和 Skills |
| [`status`](/zh/cli/status) | 显示项目阶段并建议下一步 |
| [`next`](/zh/cli/next) | 显示最值得执行的单条下一步 |
| [`detect`](/zh/cli/detect) | 显示 CLI 版本和项目检测信息 |
| [`index`](/zh/cli/index-command) | 生成用于重建 `logos-project.yaml` 资源索引的 AI 提示词 |
| [`module`](/zh/cli/module) | 管理项目模块（list / add / rename / remove） |

### 验证与发布

| 命令 | 说明 |
|---------|-------------|
| [`verify`](/zh/cli/verify) | 针对测试用例规格验证测试结果（Gate 3.6） |
| [`smoke`](/zh/cli/smoke) | 针对 smoke 规格验证部署后健康状况（Gate 3.8） |
| [`launch`](/zh/cli/launch) | 在验证通过后激活变更管理 |

### 变更管理（Delta 工作流）

| 命令 | 说明 |
|---------|-------------|
| [`change`](/zh/cli/change) | 创建变更提案 |
| [`merge`](/zh/cli/merge) | 为 AI 生成 merge 指令 |
| [`archive`](/zh/cli/archive) | 归档已完成的变更提案 |

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
# ... AI fills proposal + creates deltas ...
openlogos merge fix-redirect-bug
# ... AI executes merge ...
openlogos archive fix-redirect-bug
```
