---
title: 从 0.13.x 升级
description: 把 OpenLogos 0.13.x 的安装与项目升级到 0.16.0——更新 CLI、在每个项目中执行 sync，并改用新的 merge 与切片命令。
---

OpenLogos 0.16.0 是 0.13.24 之后的首个公开版本。0.13.25～0.15.20 这些中间版本只在本地安装，从未发布到 npm，所以 0.13.x 用户直接升级到 0.16.0 即可。下面五步覆盖了其间的全部变化。

## 升级步骤

### 1. 更新全局 CLI

```bash
npm install -g @miniidealab/openlogos@latest
openlogos --version
```

`openlogos --version` 应输出 `0.16.0`。

### 2. 在每个已有项目中执行 `openlogos sync`

更新全局 CLI 不会改动你的项目。请进入每个已有项目的根目录（即 `logos/logos.config.json` 所在目录）执行：

```bash
cd <项目根目录>
openlogos sync
```

`sync` 会刷新：

- 托管的 guard 脚本与事后检查引擎；
- Claude Code hooks——在既有 `SessionStart`、`PreToolUse` 之外新增 `PostToolUse`、`PostToolUseFailure`、`Stop` 条目；
- 已部署的 Skills；
- `.gitignore` 中的 OpenLogos 托管区块（固定包含 `logos/.openlogos-runtime/`）；
- `.claude/settings.json` 的 `language`：按项目 `locale` 写入，长会话压缩后回复语言不再漂移。

不执行 `sync`，即使 CLI 已是 0.16.0，项目仍运行旧版 guard。`sync` 完成后，请在 AI 工具中新建 session，加载刷新后的 hooks 与 Skills。

### 3. Cursor 项目：托管规则改为 Skills

在 Cursor 项目中，`sync` 会把 OpenLogos 托管的 `.cursor/rules/*.mdc` 迁移为 `.cursor/skills/<name>/SKILL.md`，并在 `.cursor/hooks.json` 中写入 OpenLogos 条目（含 `afterShellExecution` 事后检查）。你自己写在 `.cursor/rules/` 下的规则不会被改动。

完整资产布局见 [Cursor 插件](/zh/specs/cursor-plugin)。

### 4. 进行中的提案：改用新的 merge 与切片命令

0.14.x 的 merge / 切片事务命令（`merge transaction *`、`merge-apply`、切片事务）已在 0.15.0 移除。对仍在进行中的提案：

- 用 `openlogos merge <slug>` 合并规格 delta。它一次调用应用全部 delta——原子落盘，要么全部写入，要么一项都不写——不再生成需要 AI 执行的 `MERGE_PROMPT.md`。
- 用 `openlogos slice plan --file <slices.json>` 规划 `[code]` 切片。它写出 `tasks.md` 的 `[code]` 段与 `TEST_SLICE_MANIFEST.json`。

如果提案已经合并、之后又修改了它的 delta，再次执行 `openlogos merge <slug>` 即可：它会按记录的合并基线增量修正已合并的规格（JSON 输出为 `result: "amended"`）。用 `openlogos next` 查看每个提案当前所处的步骤。

### 5. 读取 `--format json` 的外部工具

如果有脚本或集成解析 `--format json` 输出，请以 `data.contract.version` 和 npm 包随附的 JSON Schema（`spec/schema/*.schema.json`）为准，重点核对 verify 门禁字段，以及 0.15.0 移除的投影（见下文）。

## 0.16.0 主要变化

- **merge 一次完成**——`openlogos merge <slug>` 原子写入全部 delta；修改已合并提案后再次合并即增量修正。见 [`openlogos merge`](/zh/cli/merge)。
- **切片化实现**——merge 后由 `slice-planner` Skill 规划 `[code]` 切片，`openlogos slice plan --file` 写出切片；verify 支持切片增量 checkpoint 与最终全量验收。见 [`openlogos slice`](/zh/cli/slice)。
- **change-lint**——检查项收敛为 L0～L9，新增部署方案覆盖、后态测试 ID 重复等检查，问题在写 delta 阶段即暴露，而不是等到 merge 失败。见 [`openlogos change-lint`](/zh/cli/change-lint)。
- **verify 门禁收敛为三项**——结果账本一致、零失败、零未覆盖。Layer1 设计时覆盖度清单与 Layer3 验收条件追溯矩阵已从判定、报告与 JSON 中移除。预跑命令失败时门禁直接 FAIL（`pre_run_failed`）。见 [`openlogos verify`](/zh/cli/verify)。
- **guard 以版本控制内容为保护对象**——launched 且无活跃提案时，只保护会进入版本控制的代码与规格；被忽略的依赖、产物、日志与缓存写入不再需要立案。Bash / PowerShell 改为「事前轻判 + 执行后内容级比对」。见 [PreToolUse Guard](/zh/specs/pretooluse-guard)。
- **保护范围命令**——`openlogos ignore` 与 `openlogos exempt` 管理哪些路径不进版本控制、哪些已提交路径无需立案；修改须经宿主界面审批。见 [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt)。
- **新宿主**——ZCode、Qoder、WorkBuddy 纳入 `init` / `adopt` / `sync` / `launch`；Cursor 改用 Skills 并接入 `afterShellExecution` 事后检查。见 [ZCode](/zh/specs/zcode-plugin)、[Qoder](/zh/specs/qoder-plugin)、[WorkBuddy](/zh/specs/workbuddy-plugin)、[Cursor](/zh/specs/cursor-plugin)。
- **smoke 门禁**——本提案必要用例的 skip 默认拦截；当前平台确实无法执行的用例须以 `reason_code: "platform-unavailable"` 加说明才放行，并在报告中单独列出。见 [`openlogos smoke`](/zh/cli/smoke)。
- **流程减法（0.15.0，破坏性）**——Authority Closure 与 Baseline Closure 已移除，切片事务与 merge 事务一并移除；决策澄清与 UI 原型不再作为硬门。

本站统一使用的 Gate 编号：verify 为 **Gate 3.6**，deploy-done 为 **Gate 3.7**，smoke 为 **Gate 3.8**。

## 相关

- [`openlogos sync`](/zh/cli/sync) —— sync 刷新哪些内容
- [快速开始](/zh/getting-started/quick-start) —— 在 0.16.0 上新建项目
- [接入已有项目](/zh/getting-started/adopt-existing-project) —— 把从未用过 OpenLogos 的项目接入进来
