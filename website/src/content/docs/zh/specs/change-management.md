---
title: 变更管理
description: Delta 变更管理机制——变更提案、影响分析、交付门、一次调用的原子合并、增量修正、切片与归档。
---

Delta 变更管理规范定义了 OpenLogos 项目在首个开发周期之后如何处理功能迭代与 Bug 修复。每个变更都从提案开始，经过评审，再合并回主文档——确保可追溯、可审计、可回滚。

## 核心原则

1. **不直接修改主文档**——每个变更都先在 `logos/changes/` 中创建提案
2. **影响分析先行**——`proposal.md` 必须明确变更范围与部署影响
3. **按需传播**——不是每次都全链路更新，只更新受影响的环节
4. **部署可追溯**——需要部署的提案必须带部署任务与冒烟测试方案
5. **归档留痕**——变更完成后归档，保留完整历史
6. **同一时间只有一个活跃提案**——未归档的提案持有 guard 时，`openlogos change` 拒绝创建新提案

## 生命周期状态

模块通过 `openlogos launch` 从 `initial` 进入 `launched` 后启用变更管理。首个开发周期内，变更按阶段推进进行，无需提案。

| 生命周期 | 行为 |
|-----------|----------|
| `initial` | 自由遵循 Phase 1 → 2 → 3 推进，无需提案 |
| `launched` | 修改会进入版本控制的代码与规格，须先通过 `openlogos change <slug>` 创建提案 |

## 目录结构

```
logos/
├── resources/                    # 主文档（当前的「真相」）
│
└── changes/                      # 变更提案工作区
    ├── add-remember-me/          # 一个活跃提案
    │   ├── proposal.md           # 变更说明 + 影响分析
    │   ├── tasks.md              # 任务清单（[delta] / [code] / [deploy]）
    │   ├── deltas/               # Delta 文件（增量修改）
    │   │   ├── prd/
    │   │   ├── api/
    │   │   ├── database/
    │   │   └── scenario/
    │   ├── SPEC_MERGED           # openlogos merge 最后一步写入
    │   └── TEST_SLICE_MANIFEST.json  # openlogos slice plan 写入
    │
    └── archive/                  # 已完成变更的历史（仅供审计）
        └── 20261012-1430-add-remember-me/
```

## 守卫机制

`openlogos change` 写入 `logos/.openlogos-guard`，记录活跃提案；`openlogos archive` 删除它。

- **guard 存在** → AI 可以修改代码与规格，但只能在提案范围内
- **guard 不存在** → launched 项目中写入受保护内容会被拒绝；须先运行 `openlogos change <slug>`

### guard 保护什么

0.16.0 起，guard 以**会进入版本控制的内容**为保护对象，而不是一份命令词清单。在 launched 的 git 项目中、没有活跃提案时：

- **受保护**：已跟踪文件、未被 git 忽略的新文件，以及 `logos/resources/` 下的一切（即使被忽略）。忽略规则来源（各级 `.gitignore`、`.git/info/exclude`）、`logos/logos.config.json`、git 元数据与 guard 自有状态永远不可豁免。
- **不受保护**：被 git 忽略的未跟踪文件——依赖、构建产物、日志与缓存——以及 `guard.exempt` 中列出的路径。写入它们无需立案。
- **Edit / Write 类工具**在执行前判定。**Bash / PowerShell** 先做轻判（只在写入目标可确定且受保护时阻断），**执行后再按内容比对**：发现未立案的受保护内容变化时，guard 反馈变化的文件与恢复命令。
- 独立的 `git` 与 `openlogos` 调用不报告。

完整契约（含各宿主的差异）见 [PreToolUse Guard](/zh/specs/pretooluse-guard)。

### 修改保护范围

请使用保护范围命令，而不是手工编辑 `.gitignore` 或 `logos/logos.config.json`：

```bash
openlogos ignore add|remove|list <pattern>   # .gitignore 中的托管区块
openlogos exempt add|remove|list <path>      # guard.exempt：无需立案的已入库路径
```

`add` / `remove` 会改变 guard 的保护范围，因此**必须由用户在宿主的原生权限弹窗中批准**（`list` 不受限）。对话中的口头同意不算批准。若当前权限模式下宿主不会弹窗，请在终端自行执行（Claude Code 中用 `! <命令原文>`），或切换到默认权限模式后重试。`--auto` 的 standing 授权不覆盖这些命令。详见 [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt)。

## 两档授权

- **半自动（默认）**——`openlogos merge`、`openlogos verify`、部署、`openlogos smoke`、`openlogos archive` 与 `git push` 是人类确认点。AI 只在用户明确要求时执行；「按流程走完」之类说法不构成授权。
- **全自动（`openlogos next --auto`）**——选择 `--auto` 即对整个提案给出 standing 授权：可跳的 flow 门自动放行，verify、部署、smoke、archive 与 `git push` 无需逐步确认。每次自动放行都追加记录到 `GATE_AUTO_PASSED`。
- **硬红线（任何模式）**——`gate:implement:loop-exhausted`：达到迭代上限仍未通过测试的代码绝不放行，`--auto` 也不例外。

merge 之后、代码完成之后、归档之后，AI 都会自动提交（并告知用户）。详见 [`openlogos next`](/zh/cli/next)。

## 文件规范

### proposal.md

`openlogos change` 会写出完整模板；请在模板上原地逐段填写，不要整篇重写。必填章节由 `openlogos change-lint`（L0）检查：变更原因、变更类型、变更范围、部署影响、变更概述、决策澄清。模板还包含可选的「最小实现论证」和「UI/UX 变更声明」块（GUI 项目由 L7 检查）。

- **部署影响**是提案级部署决策。「无需部署」即不写 `[deploy]` 分节；「需要部署」即写 `[deploy]` 分节，并更新部署方案（或引用一份已合并的部署方案）。
- **决策澄清**中放 `openlogos/clarification@1` 块，覆盖五类影响——`data`、`compatibility`、`security_privacy`、`public_release`、`external_commitment`——以及用户做出的决定。部署与公开发布分别决策。该块是写给人看的记录，不是硬门。详见 [`openlogos change`](/zh/cli/change)。

### tasks.md

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新需求
- [ ] 产出 delta 文件到 deltas/api/ — 更新 API YAML

## [code] 代码实现

## [deploy] 部署执行
- [ ] 部署到预发环境
```

- `## [delta]`——每个 delta 文件一个任务。全部勾选 → `ready-to-merge`
- `## [code]`——**计划阶段保持为空**。merge 之后由 `slice-planner` 通过 `openlogos slice plan --file <slices.json>` 写入切片，同时生成 `TEST_SLICE_MANIFEST.json`
- `## [deploy]`——仅当提案需要部署时存在
- 纯代码提案没有 `[delta]`，但保留空的 `## [code]` 标题，并且仍要执行 no-delta `openlogos merge`
- 不要添加 verify / 验收任务——`openlogos verify` 是独立的 CLI 步骤

详见 [tasks.md 格式](/zh/specs/tasks-spec)。

### deltas/ 目录

Delta 文件使用带标记的章节：

```markdown
## ADDED — [新增内容标题]
[完整的新内容]

## MODIFIED — [已有章节标题]
[整节的完整内容]

## REMOVED — [删除的章节标题]
[删除原因]
```

- 标题即**章节锚**，必须恰好命中目标文档中的一个章节；标题重复时用 `父级 > 子级` 或 `标题 [2]`。
- `MODIFIED` 替换到下一个同级或更高级标题为止——改写多个章节时每节各写一个块。
- `MODIFIED` 章节中未变更的结构化 ID 必须原样带上；部分删除写成 `MODIFIED`（剩余内容）+ `REMOVED-ITEMS`（点名被删 ID）。

delta 目录镜像主文档目录，嵌套路径原样保留：

| Delta 路径 | 对应 |
|-----------|----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

## 变更工作流

```
1. 创建提案（CLI）
   └── openlogos change <slug>  → proposal.md + tasks.md + deltas/，写入 guard

2. 编写方案（change-writer）
   └── 填写 proposal.md（含决策澄清）与 tasks.md（[delta] / [deploy]，[code] 留空）
   └── GUI 项目：此时产出 UI 原型，让方案连同界面一起批准
   └── openlogos change-lint → 必须 exit 0
   └── plan-exit 门：用户批准方案

3. 编写 delta（change-writer）
   └── 每个 [delta] 任务一个 delta，逐项勾选 → ready-to-merge
   └── openlogos change-lint → 必须 exit 0
   └── spec-exit 门：审 delta、授权合并

4. 合并（CLI，人类确认点）
   └── openlogos merge <slug>
   └── 一次调用：准入（= change-lint）→ 按章节锚合成 → 原子落盘
       → 最后写含 test_change_set 的 SPEC_MERGED。全有或全无。
   └── AI 提交规格变更

5. 规划切片（slice-planner）
   └── slices.json → openlogos slice plan --file slices.json
   └── 写入 [code] + TEST_SLICE_MANIFEST.json
   └── slice-exit 门：用户批准切片划分

6. 实现（code-implementor）
   └── 逐切片：业务代码 + 测试 + OpenLogos reporter；AI 提交代码

7. 验收（CLI，人类确认点）——Gate 3.6
   └── openlogos verify → VERIFY_PASS / VERIFY_FAIL

8. 交付（仅当提案需要部署）
   └── 按部署方案执行部署（人类确认点）
   └── openlogos deploy-done（Gate 3.7）→ openlogos smoke（Gate 3.8）

9. 归档（CLI，人类确认点）
   └── openlogos archive <slug> → 移入 archive/，删除 guard；AI 提交
   └── git push（人类确认点）
```

### 修正已合并的提案

第 4 步之后如需修改 delta，直接修改后再次运行 `openlogos merge <slug>`。命令按记录的合并基线增量修正（`result:"amended"`），清除 `VERIFY_*` / `DEPLOY_DONE` / `SMOKE_*`，使修正后的规格重新验收，`[code]` 与切片批准保持不变。`openlogos status --format json` 以 `spec_amend` 展示待应用状态。若有已合并目标被手工修改，修正会被拒绝并给出核对指引——这类修正请另立新提案。详见 [`openlogos merge`](/zh/cli/merge)。

## launched 流程

在 launched 流程下（见 [Flow 规格](/zh/specs/flow-spec)），生命周期是七个子流程组成的流水线：

```
plan → spec → merge → slice → implement → deliver → close
```

| 子流程 | 节点 | 出口门 | 说明 |
|---------|-------|-----------|--------------|
| **plan** | `write-proposal`、`write-tasks` | `plan-exit`（human，可跳） | `write-tasks` 只产 `[delta]` / `[deploy]`——**不产 `[code]`** |
| **spec** | `write-delta` | `spec-exit`（human，可跳） | `when: delta_required`；审 delta + 授权合并 |
| **merge** | `generate-merge-prompt`、`apply-merge` | — | 一次 `openlogos merge` 调用写入 `SPEC_MERGED` 即完成本子流程（第一个节点 id 为历史沿用）。纯代码提案执行 no-delta merge |
| **slice** | `plan-slices`（slice-planner） | `slice-exit`（human，可跳） | `when: code_required`；基于**已合并**规格 + 真实测试 ID 切片 |
| **implement** | `code`、`verify` | — | 默认激活切片循环（`until: code_slices_green`，`max_iters: 30`） |
| **deliver** | `deploy`、`smoke` | `deliver-entry`（human，可跳） | 部署在**提案级**决策 |
| **close** | `archive` | — | — |

- **`[code]` 切片发生在 merge 之后。** 它基于真实的已合并规格与固定的测试 ID 划分，而不是对草稿猜测。提前填写的切片会被 `openlogos merge` 重置（备份到 `CODE_AUTORESET`）。
- **无 delta 也要完成 spec-complete。** 纯代码提案执行 `openlogos merge <slug>`，写入 `type:"no_delta_spec_complete"` 的 `SPEC_MERGED`。在此之前 `next` / `status` 报告 `spec-complete-required`；之后若缺真实测试 ID 则报告 `test-id-required`。
- **部署是提案级决策。** `deployment_required` / `smoke_required` 来自提案的部署影响加 `[deploy]` 分节，从不取模块默认值。

驻留态 `ready-to-delta`（`plan-exit` 处）、`ready-to-merge`（`spec-exit` 处）与 `ready-to-implement`（`slice-exit` 处）表达流程在哪里等待；见 [`openlogos status`](/zh/cli/status)。

## 变更传播规则

| 变更类型 | 最小更新范围 | 说明 |
|------------|---------------------|-------------|
| 需求级 | 全链路 | 需求变了——所有下游都可能受影响 |
| 设计级 | 原型 + 场景 + API/DB + 编排 + 代码 | 需求不变，实现方式调整 |
| 接口级 | API/DB + 编排 + 代码 | 设计不变，接口细节调整 |
| 代码级修复 | 代码 + 重新验收 | Bug 修复，不涉及设计变化 |

## Git 集成

- 每个变更提案对应一个 Git 分支：`change/{change-name}`
- merge 后的规格提交、实现后的代码提交以及归档提交由 AI 自动完成；`git push` 是人类确认点
- `logos/changes/archive/` 提供变更历史，仅供审计，从不用于还原主文档
- CI 可用 [`openlogos impact`](/zh/cli/impact) 把只含归档的提交识别为生命周期记账

## CLI 命令

```bash
openlogos change add-remember-me            # 创建变更提案 + guard
openlogos change-lint                       # 交付检查（须 exit 0）
openlogos merge add-remember-me             # 一次调用原子合并 / 增量修正
openlogos slice plan --file slices.json     # 写入 [code] 切片 + TEST_SLICE_MANIFEST.json
openlogos verify                            # Gate 3.6
openlogos archive add-remember-me           # 归档已完成的变更
```

## 相关 Skill

| Skill | 作用 |
|-------|------|
| [`change-writer`](/zh/skills/change-writer) | 填写 `proposal.md` 与 `tasks.md`、编写 delta，报告完成前必须通过 `openlogos change-lint` |
| [`merge-executor`](/zh/skills/merge-executor) | 授权合并前只读复核、失败诊断与 delta 修复、合并后事后点数与提交交接 |
| [`slice-planner`](/zh/skills/slice-planner) | merge 后规划 `[code]` 切片，并通过 `openlogos slice plan` 写入 |
| [`code-implementor`](/zh/skills/code-implementor) | 按已批准切片实现代码，附测试与 OpenLogos reporter |
