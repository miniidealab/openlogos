# 变更提案：repo-integration-official

## 变更原因

- **轻记账（money-log）** 已按 OpenLogos 方法论在 **OpenCode** 下完成一轮研发，并包含 `.opencode/plugins/`、`.opencode/commands/` 等集成资产，适合作为官方 **OpenCode 集成演示** 纳入 OpenLogos monorepo 的 `examples/`。
- 主仓 `examples/README.md` 与根 `README.md` 目前仅突出 FlowTask，未区分「Claude Code 演示」与「OpenCode 演示」，读者难以按工具选型找到对应示例。
- 需在入库前完成卫生与文档：`.gitignore`、剔除 `__pycache__`、移除不应提交的活跃 guard、补充示例 README 与上级文档交叉引用。

## 变更类型

文档级 + 仓库示例资产整理（不涉及 money-log 业务需求语义或对外 API 变更）。

## 变更范围

- 影响的需求文档：无
- 影响的功能规格：无
- 影响的业务场景：无（示例内历史归档 `logos/changes/archive/` 仅作方法论参考，本次不删改其内容）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的仓库与文档：
  - `examples/money-log/`（新增/整理 `.gitignore`、`README.md`，修正 `AGENTS.md` 中 CLI 路径描述，移除 `__pycache__` 与 `logos/.openlogos-guard`）
  - `examples/README.md`（并列说明 FlowTask = Claude Code 演示、Money Log = OpenCode 演示）
  - 根目录 `README.md`（方式三与仓库结构说明）
  - `examples/flowtask/README.md`（明确官方定位为 Claude Code 集成演示）
  - `docs/opencode.md`（增加可运行示例入口链接）

## 变更概述

将 **money-log** 作为与 **flowtask** 对位的官方桌面小示例：**flowtask** 侧重 Tauri + **Claude Code** 工作流；**money-log** 侧重 Electron + **OpenCode**（插件、斜杠命令、可选 `.opencode/skills`）。在 monorepo 内统一索引与定位说明，并完成入库卫生条件，避免将 Python 缓存、活跃变更 guard 等误提交。

本提案完成后，维护者可在主仓 `CHANGELOG` 中单列「新增 examples/money-log」条目（若需发版时再写）。
