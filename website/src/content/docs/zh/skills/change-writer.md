---
title: change-writer
description: 编写带影响分析与决策澄清的变更提案，规划 [delta] / [deploy] 任务，编写 delta，并通过 change-lint 交付门。
---

协助编写变更提案——分析变更影响范围，填写结构化的 `proposal.md` 与分阶段的 `tasks.md`，编写 delta 文件，并确保在报告完成前全部通过 `openlogos change-lint`。

## Phase 与触发条件

- **Phase**：跨阶段（Delta 工作流——`write-proposal`、`write-tasks`、`write-delta` 节点）
- **触发条件**：
  - 用户已运行 `openlogos change <slug>` 并希望协助填写提案
  - 用户描述了修改、新增或移除某个场景/功能的需求
  - 用户提到「变更提案」「迭代」「需求变更」

## 前置条件

1. 项目已初始化（`logos/logos.config.json` 存在）
2. 变更提案目录已存在（`logos/changes/<slug>/`），且 guard 指向它
3. `logos/resources/` 中的主文档可读

如前置条件未满足，用户须先运行 `openlogos change <slug>`。

## 它做了什么

1. 理解用户意图的变更（改什么、为什么、涉及哪些场景）
2. 先查事实——项目索引、规格、代码、配置——只向用户询问仓库答不出的问题
3. 扫描 `logos/resources/` 识别完整的受影响范围，确定变更类型
4. 在 CLI 模板上原地填写 `proposal.md`，含部署影响与决策澄清
5. 规划 `tasks.md`：只写 `[delta]` 与 `[deploy]`；`[code]` 保持空标题
6. GUI 项目且变更触及界面时，在计划阶段产出 UI 原型
7. 方案批准后编写 delta
8. 每个交付点运行 `openlogos change-lint`，只有 exit 0 才报告完成

## 变更类型与传播

| 变更类型 | 最少需要更新的内容 |
|-------------|------------------------|
| 需求级 | 全链路：需求 → 设计 → 架构 → API/DB → 测试 → 代码 |
| 设计级 | 原型 + 场景 + API/DB + 测试 + 代码 |
| 接口级 | API/DB + 测试 + 代码 |
| 代码级修复 | 代码 + 重新验收 |

## 影响分析范围

1. **需求文档**（`prd/1-product-requirements/`）——场景定义
2. **产品设计**（`prd/2-product-design/`）——功能规格与原型
3. **技术方案**（`prd/3-technical-plan/`）——架构、时序图、部署方案
4. **API 文档**（`api/`）——受影响的接口
5. **DB 文档**（`database/`）——受影响的表结构
6. **测试用例**（`test/`）——受影响的测试用例
7. **编排测试**（`scenario/`）——受影响的编排文件

## proposal.md

`openlogos change` 会写出完整模板。请**在模板上原地逐段填写**——整篇重写会静默丢失章节。必填章节（change-lint L0 检查）为变更原因、变更类型、变更范围、部署影响、变更概述与决策澄清；模板还带有可选的「最小实现论证」与「UI/UX 变更声明」块。

### 决策澄清（`clarification@1`）

「决策澄清」章节记录只能由人拍板的取舍。在其 `openlogos/clarification@1` 块中填写五类影响——`data`、`compatibility`、`security_privacy`、`public_release`、`external_commitment`——每类给出 `status: none | required` 与基于事实或政策的非空 `reason`。

- 只问仓库答不出的问题，一次只问一个决定，并把用户的回答记入 `decisions`。
- **部署与公开发布是两个独立决定。** 部署来自「部署影响」章节（目标环境、方式、回滚、smoke 证据）。同意部署不等于同意 npm 发布、打 tag、Release 或 `git push`，反之亦然。
- 该块是写给评审者的记录，不是硬门，也不替代 `plan-exit` 的方案批准。

### 部署影响

「无需部署」即不写 `[deploy]` 分节，任何地方都不写部署任务。「需要部署」即写 `[deploy]` 分节，并在 `[delta]` 中更新部署方案——或引用一节已合并的部署方案。change-lint L5 检查两者一致。

## tasks.md

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新 S0x 验收条件
- [ ] 产出 delta 文件到 deltas/prd/3-technical-plan/2-scenario-implementation/ — 更新 S0x 时序图
- [ ] 产出 delta 文件到 deltas/api/ — 更新 API YAML
- [ ] 产出 delta 文件到 deltas/test/ — 新增 S0x 测试用例

## [code] 代码实现

## [deploy] 部署执行
- [ ] 按部署方案部署到预发环境
```

- `## [delta]`——每个 delta 文件一个任务。全部勾选 → `ready-to-merge`
- `## [code]`——**计划阶段只保留空标题**，不写任何 `- [ ]` 切片行。merge 之后由 [`slice-planner`](/zh/skills/slice-planner) 通过 `openlogos slice plan --file <slices.json>` 写入切片。提前填写的切片会被 `openlogos merge` 重置并备份到 `CODE_AUTORESET`。
- 纯代码修复保留空的 `## [code]` 标题、没有 `[delta]`。它们在切片前仍要执行 no-delta `openlogos merge <slug>`（写入 `type:"no_delta_spec_complete"` 的 `SPEC_MERGED`）。
- 代码变更需要新增或复用测试时，必须给出真实的 `UT-*` / `ST-*` / `SMOKE-*` ID——通过测试 delta，或在 proposal 中用 `## 复用测试 ID` 小节列出已合并规格中存在的 ID。`UT-Sxx-xx` 之类占位会被拒绝；没有真实 ID 时 `next` / `status` 停在 `test-id-required`。
- 严格区分 delta 任务与代码任务。

## GUI 项目：提案阶段的 UI 原型

对已 launched 的 GUI 产品（网站、桌面应用、移动 App），当变更触及界面时，Skill 在 UI/UX 变更声明中设 `ui_impact: true`，并在 `plan-exit` **之前**产出原型——让用户批准方案时连界面一起确认，而不是实现后才发现界面不对。

- 原型是裸 HTML，作为页面设计 delta 写入 `deltas/prd/2-product-design/2-page-design/<module>-NN-<slug>.html`，`pages` 中声明的每个页面各一份。
- `design_system_mode: generated` 时，[`ui-ux-pro-max`](/zh/skills/ui-ux-pro-max) 的设计令牌保存在提案目录的 `design-system.json`；`fallback`（如 Python 3 不可用）需填写 `design_system_fallback_reason`，且不产令牌文件。
- 内部检查器 `openlogos check-ui-prototype` 对账声明与产出（声明页面 == 产出文件，逐页非空）。
- 即使是非 GUI 项目也不要删掉 UI/UX 声明段，保留 `ui_impact: false` 即可。非 GUI 项目整步跳过。

## 交付门：`openlogos change-lint`

每个交付点——`proposal.md` + `tasks.md` 完成后、全部 delta 完成后——在项目根目录运行：

```bash
openlogos change-lint
```

- **exit 0**——Skill 唯一可以报告「完成」并交回控制权的状态
- **exit 2**——按每条违规的「缺什么 / 在哪补 / 补成什么样」逐条修复，重跑直到 exit 0
- **exit 1**——操作错误（无活跃提案、slug 非法），修复环境后重跑

change-lint 只读，运行无需授权。通过它**不等于**授权合并——delta 完成后，Skill 只报告「可以合并」，等待用户明确授权 `openlogos merge`。详见 [`openlogos change-lint`](/zh/cli/change-lint)。

## 编写 delta

- 每个 `.md` delta 使用 `ADDED` / `MODIFIED` / `REMOVED` 段标记，不得残留模板占位。
- `MODIFIED` 块替换到下一个同级或更高级标题为止——改写多个同级章节时每节各写一个块。
- `MODIFIED` 中原样保留未变更的结构化 ID；删除条目用 `REMOVED-ITEMS` 显式点名。
- 标题重复时使用标题路径锚（`父级 > 子级`）或序数锚（`标题 [2]`）。
- 写完后从磁盘读回每个文件，再勾选对应的 `[delta]` 任务。

## 产出

| 文件 | 位置 |
|------|----------|
| `proposal.md` | `logos/changes/<slug>/proposal.md` |
| `tasks.md` | `logos/changes/<slug>/tasks.md` |
| Delta 文件 | `logos/changes/<slug>/deltas/**` |
| UI 原型（仅 GUI） | `logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/*.html` |

## 最佳实践

- **高估影响范围**——漏掉一环比反复核对更危险
- **先查事实再提问**——仓库能回答的绝不反问用户
- **即使小变更也走流程**——「只是一行 API」也可能影响测试与代码
- **绝不自行合并**——Skill 停在「可以合并」

## 相关 Skill

- delta 完成后：[`merge-executor`](/zh/skills/merge-executor)——复核、执行并跟进 `openlogos merge`
- 合并后：[`slice-planner`](/zh/skills/slice-planner)——规划 `[code]` 切片
