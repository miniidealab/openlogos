---
title: "openlogos change-lint"
description: 只读检查变更提案的计划产物（proposal.md、tasks.md、deltas）是否交付合格——L0～L9 十项检查，与 merge 准入判定同源。
---

检查活跃变更提案的计划产物——`proposal.md`、`tasks.md` 以及 `deltas/` 下的全部内容——是否可以交付。它是 [`change-writer`](/zh/skills/change-writer) 的**交付门**：写完提案后、写完全部 delta 后，产出方都必须运行它，只有 exit 0 才能报告「完成」。

`openlogos merge` 的准入判定就是同一套检查，所以问题会在写 delta 阶段就暴露，而不是等到 merge 被拒。

本命令**只读**：不写任何文件、marker、guard 或哈希，也不改变派生出的 `proposal_step`。它不是人类确认点，任何时候都可以运行；通过检查也不等于授权合并。

## 命令格式

```bash
openlogos change-lint [--slug <slug>] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|------|------|
| `--slug <slug>` | 检查指定提案。省略时使用 `logos/.openlogos-guard` 中的 `activeChange`。值为空或非法时直接报错，不会回退到 guard。 |
| `--format json` | 输出 JSON envelope：`data.slug`、`data.pass`、`data.plan_package`、`data.violations[]`（`code` / `path` / `message` / `fix_hint`），以及仅在非空时出现的 `data.warnings[]`。 |

## 十项检查（L0～L9）

| 检查 | 内容 |
|------|------|
| **L0** 计划包完成 | `proposal.md` 含全部必填章节（变更原因、变更类型、变更范围、部署影响、变更概述、决策澄清），每节唯一、非空、无模板占位；`tasks.md` 已填写且与提案一致 |
| **L1** tasks 结构 | `tasks.md` 能解析出 `## [delta]` / `## [code]` / `## [deploy]` 分节 |
| **L2** `[code]` 标题 | 需要代码的提案保留空的 `## [code]` 标题（切片在 merge 之后填写） |
| **L3** 测试证据 | 代码变更在当前阶段引用了真实测试 ID：规划中的 `deltas/test/` 任务、实际的测试 delta，或 proposal 中标题精确为 `## 复用测试 ID` 的小节（每行 `- <ID> — <用途>`，ID 必须存在于已合并规格）。`UT-Sxx-xx`、`TBD` 之类占位不算 |
| **L4** delta 段标记 | 每个 `.md` delta 都有 `ADDED` / `MODIFIED` / `REMOVED`（或 `REMOVED-ITEMS`）段标记、无残留模板文字，合成后态没有重复测试 ID 或列数错乱的测试表 |
| **L5** 部署决策 | `proposal.md` 的部署影响与 `[deploy]` 分节一致；需要部署的提案要更新部署方案，或引用一份已合并的部署方案 |
| **L6** delta 路径 | `deltas/` 下每个文件都能映射到合法的 canonical target |
| **L7** UI 声明 | 仅 GUI 项目：UI/UX 变更声明块结构合法，且与原型对得上 |
| **L8** 条目守恒 | 章节锚恰好命中一个标题；结构化 ID 没有被静默丢掉 |
| **L9** 下游阻塞 | 提前给出 `next` / `status` 会报告的阻塞理由（如缺真实测试 ID、缺 no-delta spec-complete 标记） |

检查随阶段伸缩：计划阶段还没有 delta 时，delta 相关检查以空集通过。

**警告**（决策记录提醒、变更类型与 delta 层级不符、SQL 方言预检被跳过、部分条目守恒观察）会打印出来，但不改变结论，也不影响退出码。

## 退出码

| 退出码 | 含义 | 处置 |
|--------|------|------|
| `0` | 全部通过 | 产物可以交付 |
| `2` | 检查完成，存在违规 | 按每条违规的「缺什么 / 在哪补 / 补成什么样」逐条修复，重跑直到 exit 0 |
| `1` | 操作错误，检查无法进行 | 先修环境：`not_initialized`、`no_active_proposal`、`slug_not_found`、`slug_invalid`、`module_unresolved`、`artifact_unreadable`、`baseline_commit_in_progress` |

## 示例

```bash
openlogos change-lint --slug add-remember-me
```

```
change-lint: add-remember-me
  ✓ L0 Plan Package 完成合同
  ✓ L1 tasks.md 结构可解析
  ✓ L2 [code] 标题在场（空段占位合法）
  ✗ L3 [code_change_requires_real_test_ids]
      缺什么：…
      在哪补：logos/changes/add-remember-me/proposal.md
      补成什么样：…
  ✓ L4 delta 段标记与脱模板（2 个 .md delta）
  …
FAIL（9/10，1 项违规）
```

## 相关命令

- [`change`](/zh/cli/change) — 创建被检查的提案
- [`merge`](/zh/cli/merge) — 准入判定与本命令同源
- [`lint-specs`](/zh/cli/lint-specs) — 已合并测试规格的结构检查
- [change-writer](/zh/skills/change-writer) — 报告完成前必须通过本门的 Skill
