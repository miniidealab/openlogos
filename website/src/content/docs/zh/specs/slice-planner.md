---
title: 切片规划（Slice Planner）
description: merge 之后如何规划 [code] 切片——六维打分、垂直/横向判别器、删后续证伪门。
---

切片规划规范定义了变更提案的 `[code]` 实现工作在规格 merge 之后如何被拆成**良构切片**。在 launched 变更下，这是 `[code]` 切片的**唯一事实源**——切几片、每片做什么，**只在此处用六维打分 + 删后续证伪门决定一次**。下游 `code-implementor` 只逐行消费，绝不重复打分、不再自行分批。

## 触发时机（merge 后、implement 前）

切片规划被有意挪到 **merge 之后、implement 之前**运行。在 launched 流程中它是一个独立的 `slice` 子流程（单节点 `plan-slices`，`skill: slice-planner`），位于 `merge` 与 `implement` 之间（见 [Flow 规范](/zh/specs/flow-spec)）。

- `openlogos next` 落在 `ready-to-implement` 驻留态 / `plan-slices` 节点（宿主注入「规划切片」上下文）。
- 用户在变更 merge 完成后说「划分切片」「写 `[code]`」「规划实现任务」。

**前置依赖（强制，缺一不可）：**

1. 活跃提案存在且已 merge——提案目录有 `SPEC_MERGED`（或 `MERGED`）marker。
2. 规格 delta 已合并进主文档（架构 / 场景 / 功能规格已落在 `logos/resources/prd/`）。
3. **测试用例已合并、ID 已定**——相关 `logos/resources/test/*-test-cases.md` 含真实 `UT-Sxx-..` / `ST-Sxx-..`。

若任一不满足（尤其测试 ID 未定），说明尚未到切片时机——**禁止用占位 ID 切片**。对**真实规格 + 真实测试 ID**切，而非对草案猜——这正是本环节挪到 merge 后的根本原因。

## 唯一交付物

`tasks.md` 的 `## [code]` section——一组**过了删后续证伪门**的良构切片，每条末尾标注其覆盖的真实 `UT-Sxx-..` / `ST-Sxx-..`。切片规划**不**产 `proposal.md`、`[delta]`、`[deploy]`（那是 `change-writer` 的职责），**不**写业务代码（那是 `code-implementor` 的职责）。

## Step 1 — 读已合并规格 + 真实测试 ID

读提案的变更范围，再读已合并进 `logos/resources/` 的架构 / 场景 / 功能规格与 `test/*-test-cases.md`，列出要落地的代码能力清单与可用的 `UT/ST` ID 全集。

## Step 2 — 六维打分（决定是否大任务）

| 维度 | 0 分 | 1 分 | 2 分 |
|------|------|------|------|
| 影响范围 | 1 个文件 / 局部函数 | 2-5 个相关文件 | 跨模块 / 跨服务 / 跨端 |
| 行为复杂度 | 单一路径 bugfix | 2-3 个分支 | 多场景 / 状态机 / 异步流程 |
| 契约变化 | 无 | CLI/API 输出小改 | API/DB/flow/兼容契约变更 |
| 测试规模 | 1-3 个用例 | 4-8 个用例 | 9+ 个用例或多类测试矩阵 |
| 风险等级 | 易回滚 | 有兼容性风险 | 涉数据、安全、部署、迁移 |
| 不确定性 | 原因明确 | 1 个待验证假设 | 多个未知点 / 需要探索 |

- **0-7 分 = 不是大任务 → 单切片。** 即使含代码 + 测试 + reporter + golden，也只写 1 条 `[code]`。
- **8 分及以上 = 大任务 → 进入 Step 3 尝试垂直拆分。**

## Step 3 — 垂直/横向判别器（选对切片轴）

只有按**子能力垂直拆分**才算合格；**禁止按工种 / 层 / 文件横切**。给每片起名后看名字落在哪类：

- 🚩 **横向红旗（禁止，命中即推倒重切）**：片名是层 / 文件 / 工种——「地基 / 底座 / 读写 / 管道 / 接线 / helper / 工具函数 / config 接入 / schema / 类型 / 数据层（单独）/ UI 展示（单独）/ 写测试 / 补 reporter / 重拍 golden」。一组切片若读起来像「**先建底座 → 再写逻辑 → 再补工具 → 最后接 UI**」，就是把**施工顺序当成了切片**，必须重切。
- ✅ **垂直合格**：片名是**一条端到端能力线 / 一个场景 / 一个独立子模块的完整闭环**——数据→逻辑→产出→该片测试 一并落在同一片内。

## Step 4 — 删后续证伪门（强制）

拟好 N 片后，**逐片**自问两题：

- **(a) 删后续能否独立过全量 verify**：把切片 i+1..N 全部删掉、只做切片 i，`openlogos verify`（永远全量回归）能绿吗？
- **(b) 是否端到端可观察**：切片 i 做完是否产生了一条端到端、可观察的能力，而不只是给后续片铺管道 / 接线？

任一题答「否」 → 切片 i **不自闭环** → **向前合并**进依赖它的那一片，重跑本门。

> **为什么是这道门**：切片只 scope `code` 的上下文注入、**不 scope verify**。一个「地基片」（铺好没人用，(b) 否）或「前向依赖片」（逻辑依赖还没落地的后续片，(a) 否）做完跑全量 verify 必然飘红，循环无法出环，会死锁在 `verify-failed`。删后续门就是在切片阶段**提前证伪**这种横切。

这一轮逐片自问的结论**必须写进 `[code]` section 开头**（哪几片合并、为何合并），作为切片决策的留痕。

## Step 5 — 逃生口（大任务但拆不开 → 显式单切）

评分 ≥8 但**任何垂直切法都过不了 Step 4 的删后续门**（典型：能力原子、各部分互相咬死，如「三信号互相依赖的完成判定」）→ **保留 1 条切片**，并在任务里写明「评分达大任务，但 `<原因>` 不可安全垂直拆分，故单片」。这是**合规结果，不是偷懒**。不确定两片能否各自闭环时，一律合并。

## Step 6 — 写 `[code]` section

1. **每条 = 一个自闭环切片**：业务代码 + 该片 UT/ST + OpenLogos reporter + 必要 golden baseline，**不依赖同批后续切片**。
2. **有序、无前向依赖**：从上到下串行实现（v1 不建模 DAG）；被依赖的片排前。
3. **标注真实用例 ID**：每条末尾标注覆盖的 `UT-Sxx-..` / `ST-Sxx-..`，与已合并 `test/*-test-cases.md` 对齐（**此时 ID 已定，不再用占位**）。
4. **禁止按工种拆**：实现代码 / 写测试 / 写 reporter / 更新 golden / 补文档注释，必须合并进同一自闭环切片，不得各自成片。
5. **空 `[code]`**：纯 docs/delta 提案无代码产出时 `[code]` 可为空——切片循环退化为 `tests_green`。

**Smoke 用例变更的强制闭环**：当本提案新增/修改 `logos/resources/test/smoke/*.md`，`[code]` 切片文本必须列出新增 `SMOKE-*` ID，要求实现/更新 runner、写 `smoke-results.jsonl` reporter、接入配置，并要求完成后跑 smoke 覆盖预检。

写完后**从磁盘读回 `[code]` section** 向用户展示原文确认落盘。

## 与 `tasks.md` 及 CLI 派生的关系

- `write-tasks`（plan 段、merge **之前**）**不再产 `[code]`**。其完成判定由 `tasks_filled` 收窄为 `tasks_delta_filled`——`[delta]`/`[deploy]` 脱模板即算完成；切片留待 merge 后由 `plan-slices` 产出。无 delta 的纯代码提案仍须保留空 `## [code]` 标题。
- `plan-slices` 在 `tasks_code_filled` 满足时完成（`[code]` section 写出真实切片、此时全部未勾）。这与 `implement.code` 的 `section_complete:code`（全勾=实现完成）是两个不同判定：前者判「切片已划定」，后者判「切片已实现」。
- `CODE_AUTORESET` 保护守序：若 `[code]` 被提前填充（在 `plan-slices` 合法进入前由 `write-tasks` 填），CLI 会在进入切片阶段的确定性动作上把它 auto-reset 回模板占位，并把旧原文备份（append-only JSONL）。这样即便 `[code]` 曾被越序提前填，slice-planner 仍是唯一事实源。

机器契约（`slice_state`、`next_node.slice`、`ready-to-implement`、`slice-exit`、`SLICES_APPROVED`）见 [CLI JSON 输出](/zh/specs/cli-json-output)。
