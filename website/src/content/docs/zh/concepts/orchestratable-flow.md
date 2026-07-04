---
title: 可编排研发流程
description: OpenLogos 自动化背后的声明式研发流程引擎——门(gate)、循环(loop)、切片(slice)与半自动/全自动两档授权。
---

OpenLogos 把**研发全流程**建模为一台声明式状态机——它不是工具去跑的脚本，而是工具去**读**的唯一事实源。引擎据此派生「我现在在哪、下一步该跑什么」。本页是这台引擎的概念说明与术语表。

## flow 引擎是什么

一份 flow 是一个 YAML 文件，用 **subflow → node → gate → loop** 的有序结构描述研发流程。它是流程形态的唯一事实源。

引擎是**被动派生**的（「A 架构」）：OpenLogos 读 flow 文件 + 扫文件系统，然后**派生**出当前前沿——哪个节点是 `done` / `active` / `skipped` / `failed` / `pending`。它**不** spawn agent、不跑脚本、不守长驻进程。`status`、`next`、`watch` 全部从模板被动派生视图，引擎**不自持任何独立状态**。真正的执行交给宿主（Claude Code / 人 / CI）。OpenLogos 是「乐谱与指挥」，不是「乐手的手」。

项目不整份拷贝模板。项目实例用 **overlay**（`extends: builtin:launched`）**只写差异**——让方法论可中心化演进，而每个项目只保留自己的增量。

| 术语 | 含义 |
|------|------|
| **subflow** | 一组有序 node，可带入口/出口 gate 与可选 loop。 |
| **node** | 单个步骤，可绑定 `skill`，带 `done_when` 完成判定谓词。 |
| **gate（门）** | subflow 边界上的确认点（`type: human` / `none`）。 |
| **loop（循环）** | 对某 subflow 的收敛循环（`until`、`max_iters`）。 |
| **overlay** | 叠加在内置基线上的 node/subflow 级差异（`skip` / `add` / `modify` / `reorder` / `set-loop`）。 |

## launched 7 段流程

项目 launch 之后，每个变更提案都流经七个 subflow：

| # | 子流程 | 做什么 | 门(gate) |
|---|--------|--------|----------|
| 1 | **plan（方案）** | 写 `proposal.md` + 把 `tasks.md` 划分为 `[delta]` / `[deploy]` | human，可跳（`plan-exit`） |
| 2 | **spec（规格）** | 编写 `[delta]` 规格变更（`when: delta_required`） | human，可跳（`spec-exit`） |
| 3 | **merge（合并）** | 生成 `MERGE_PROMPT` 并应用 delta（`when: delta_required`） | none |
| 4 | **slice（切片）** | 对已合并规格划分 `[code]` 切片（`when: code_required`） | human，可跳（`slice-exit`） |
| 5 | **implement（实现）** | `code` + `verify`，默认切片循环至全部切片绿 | none |
| 6 | **deliver（交付）** | `deploy` + `smoke`（各由自己的 `when` 把关） | human，entry，可跳（`deliver-entry`） |
| 7 | **close（收尾）** | `archive` 归档 | none |

纯代码提案（无 `[delta]`）跳过 **spec** 与 **merge**；纯文档提案（无 `[code]`）跳过 **slice**。不适用某提案的段落经其 subflow 级 `when` 整段跳过。

## 门(gate)

**门**是 subflow 入口或出口的确认点：

- `type: human`——人类确认点。`next` 在此输出「需人类确认」，不自动推进。
- `type: none`——无门，直接流转。
- `skippable: true | false`——声明该 human gate 在 auto 模式下**是否允许被自动跳过**。`skippable: false` 守住高危动作，**即使 `--auto` 也照样卡住**。

## loop 与 loop-exhausted 硬红线

**implement** 段**默认激活**切片循环：

```yaml
loop: { until: code_slices_green, max_iters: 30 }
```

`code_slices_green` 的收敛条件 = `tasks.md` 的 `[code]` 切片**全部勾选** 且 末轮 verify 测试绿。收敛信号押的是**客观数字**（测试绿 / 切片全勾 ∧ 测试绿），绝不以 review_agent 的主观判定作裁判。循环未收敛时，流程**一律不得推进**到任何后续 subflow（deliver / close）。

当迭代达 `max_iters` 仍未收敛，循环升级到专门的退出门 `gate:implement:loop-exhausted`，**默认 `skippable: false`**。

这就是**硬红线**。它是「全自动发布的是已验证成果」这一前提的守门人：**任何模式——含 `--auto`——都绝不自动放行未通过测试的代码。** 全自动的 standing 授权明确**不覆盖** `loop-exhausted`；未收敛代码在任何模式都被阻塞。（唯一的 opt-in 松绑是显式 overlay `set-loop` 的 `exhausted_gate.skippable: true`，默认关闭。）

## 切片(slice)

**切片**是位于 **merge 之后、implement 之前**的独立子流程。它的单个节点运行 [`slice-planner`](/skills/slice-planner) skill，用**六维打分** + **删后续证伪门**（逐片自问：删掉后续所有切片、只做本片，能独立过全量 `verify` 吗？本片是否端到端可观察？）把*已合并*规格 + *真实*测试 ID 拆成良构的 `[code]` 切片。

切片环节是 launched 变更下 `[code]` 的**唯一事实源**——切几片、每片做什么，**只在此处决定一次**。下游 `code-implementor` 只逐行消费，不再重复打分、不再自行分批。对已合并规格 + 真实测试 ID 切（而非对草案猜），正是本环节挪到 merge 之后的根本原因。

## 驻留态(residency states)

段与段之间，派生前沿在等待某个门时会稳定在**驻留态**：

- `ready-to-delta`——plan 完成，停在 plan-exit 门。
- `ready-to-merge`——delta 写完，停在 spec-exit 门。
- `ready-to-implement`——切片划完，停在 slice-exit 门。
- `ready-to-deploy`——deploy 之前停在 deliver-entry 门。

（另有 `ready-to-verify`、`ready-to-smoke` 等。）这些正是人类——或在全自动下由 standing 授权——决定是否放行该门的稳定平台。

## 两档授权：半自动 vs 全自动

同一份 flow 支持两档授权，由宿主在运行时选择。

**半自动（默认，无 `--auto`）。** `merge`、`verify`、部署、`smoke`、`archive`、`git push` 都是**人类确认点**。AI 未经明确授权不得自行执行。每个人类确认点行为完全按声明。

**全自动 / 无人值守（`openlogos next --auto`）。** 选 `--auto` 即一次性、**standing、run-scoped 的授权**——授权该提案全链路自动跑到底。除自动放行 `skippable: true` 的 flow 门外，standing 授权还让 AI **自动执行「代码已绿之后」由 CLI 驱动的盖章/发布步骤**——`verify`、`smoke`、`archive`、`git push`。（`git push` 无需 marker：PreToolUse guard 的安全白名单本就放行它。）每次自动放行都向提案目录的 `GATE_AUTO_PASSED` **追加一行 append-only 审计记录**——是审计轨迹，不是状态源。

**硬红线（两档都不放行）：** `loop-exhausted`——达迭代上限仍未过测试的未收敛代码——**在任何模式（含 `--auto`）都阻塞。** 全自动发布的是已验证成果，绝不发布未测代码。

---

## 相关

- [`openlogos flow show`](/cli/flow-show)——查看 raw 或 `--resolved`（overlay 合并后）流程。
- [`openlogos watch`](/cli/watch)——实时流式输出派生前沿。
- [flow-spec](/specs/flow-spec)——本页背后的字段级数据模型契约。
- [变更管理](/specs/change-management)——launched 流程驱动的 delta 工作流。
