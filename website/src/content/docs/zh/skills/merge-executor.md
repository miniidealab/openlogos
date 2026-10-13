---
title: merge-executor
description: 在授权合并前只读复核变更提案，合并失败时诊断并修复 delta，合并成功后点数并提交结果。
---

0.15.0 起，`openlogos merge <slug>` 一次原子调用就完成全部合并。因此 merge-executor **不再手工应用 delta**，它负责的是这条命令前后的事情：

1. **授权前**——只读复核 delta，避免合并被拒
2. **失败时**——按稳定错误码诊断并修复 **delta**，然后重跑命令
3. **成功后**——清点已合并文档中的结构化 ID、报告，并提交规格变更

## 阶段与触发

- **阶段**：跨阶段（Delta 工作流，`merge` 子流程）
- **触发条件**：
  - 用户明确授权执行 `openlogos merge <slug>`
  - 用户说「执行合并」「把 delta 合进主文档」
  - `openlogos merge` 非零退出，用户要求排查并修复

## 前置条件

1. 活跃提案 `logos/changes/<slug>/` 存在，`[delta]` 任务全部勾选，delta 文件已在盘
2. `logos/.openlogos-guard` 的 `activeChange` 与 slug 一致（否则命令直接拒绝、不写任何东西）
3. 用户已明确授权执行 `openlogos merge`——它是人类确认点（`openlogos next --auto` 下由 standing 授权覆盖）

合并指令来自提案本身——`proposal.md`、`tasks.md` 的 `[delta]` 分节与 `deltas/**`。目标集由 `deltas/` 派生，Skill 不另写目标清单。

## Step 1：合并前只读复核

本步骤不写任何东西。逐项检查：

1. **段标记**——每个 `.md` delta 都有 `ADDED` / `MODIFIED` / `REMOVED`（或 `REMOVED-ITEMS`）段标记，且无残留模板文字。
2. **章节锚**——每个段标记的标题在目标文档中恰好命中一个章节；标题重复时用 `父级 > 子级` 或序数后缀 `标题 [n]`。工具不会去猜。
3. **单写者**——同一目标章节只被一个 `MODIFIED` 块修改（跨 delta 文件亦然）。
4. **条目守恒**——`MODIFIED` 携带整节内容并原样保留未变更的结构化 ID；部分删除写成 `MODIFIED` + `REMOVED-ITEMS` 点名。
5. **目标集一致**——`[delta]` 任务与实际 `deltas/` 文件一一对应。

`openlogos change-lint --slug <slug>` 给出与 merge 准入相同的结论。任何一项不满足，先修 delta。

## Step 2：执行合并与处理失败

```bash
openlogos merge <slug>
```

命令会先收敛被中断的上次运行、重置提前填写的 `[code]`、重跑完整的 change-lint 结论，再按章节锚合成每个目标、一次性原子落盘，最后写入含结构化 `test_change_set` 的 `SPEC_MERGED`。详见 [`openlogos merge`](/zh/cli/merge)。

失败时**立即停止**，先看错误码与状态声明：

| 状态 | 处置 |
|------|------|
| 未写入（写入前被拒） | 按诊断修 delta，重跑命令 |
| 已整批回滚（落盘失败，已回滚） | 排除原因后重跑 |
| 可能已提交（状态不可确认） | 先核对 `git status`、`git diff logos/resources/` 以及 `SPEC_MERGED` 是否在场，再做任何动作 |

不得手工补写主文档、marker、计数器或 resource index，不得绕过命令单独重试某个文件，也不得删除或改名提案目录中 OpenLogos 拥有的产物来腾位。

如果提案已经合并过、delta 又有变化，同一条命令会做**增量修正**（`result:"amended"`）。若因已合并目标被手工修改而被拒（`MERGE_AMEND_DRIFT`），报告漂移文件与核对指引；修正应另立新提案承载。

## Step 3：合并后点数、报告与提交

合并成功后、提交之前，对每个被触及的文档清点结构化 ID（测试表首列的测试 ID、标题与表格首列的场景 ID、编号小节标题）：

```
合并后 ID 集合 == 合并前 ID − REMOVED 整节的 ID − REMOVED-ITEMS 点名的 ID + 新增 ID
```

- **相符** → 把点数结果写进摘要，然后提交：

  ```bash
  git add -A
  git commit -m "docs(<slug>): merge spec deltas"
  ```

- **不符** → 报告多了 / 少了哪些 ID 并停止，不提交。

`SPEC_MERGED` 由命令写入，不得再 touch 或覆盖。

随后交接下一步：切片规划——`slice-planner` 产出 `slices.json`，执行 `openlogos slice plan --file <slices.json>`，用户在 `slice-exit` 批准切片。之后是实现、`openlogos verify`、可选的部署 + `openlogos smoke`，以及 `openlogos archive`——半自动模式下每一步都是人类确认点。Skill 的职责到此结束，不会自行执行 verify、部署、smoke 或 archive。

## 边界

- GUI 原型资产（`2-page-design/*.html`）由 merge 命令自身的原型落盘步骤提交，Skill 从不编辑它们。
- `logos/changes/archive/` 下的归档仅供审计，不得读取它来还原主文档。
- 重新合并导致规格指纹变化时，切片清单会变为过期；当 `next` 提示时，用相同的 `slices.json` 重跑 `openlogos slice plan --file` 重建即可。

## 相关 Skill

- 上一步：[`change-writer`](/zh/skills/change-writer)——编写提案与 delta
- 下一步：[`slice-planner`](/zh/skills/slice-planner)——基于已合并规格规划 `[code]` 切片
