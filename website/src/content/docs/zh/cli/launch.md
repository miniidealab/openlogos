---
title: "openlogos launch"
description: 在首个开发周期完成后激活变更管理。
---

将项目从 `initial` lifecycle 切换到 `launched` lifecycle。一旦 launched，对现有文档的所有修改都必须经过结构化的变更提案。

## 命令格式

```bash
openlogos launch [module-id]
```

必须在项目根目录下运行。如果项目恰好只有一个模块，可以省略 module id。

## 功能说明

1. 读取 `logos/logos-project.yaml` 并将所选模块标记为 `launched`
2. 同步 `logos-project.yaml` 的项目名称
3. 重新生成带变更管理规则的 `AGENTS.md` 和 `CLAUDE.md`
4. 以 launched lifecycle 上下文重新部署 Skills
5. 为 Claude Code、OpenCode 和 Codex 重新部署已配置的工具插件资源

`launch` 使用与 `sync` 相同的多工具展开逻辑：如果 `aiTool` 是数组或 `all`，则所有已配置的 Skills 和插件目标都会被刷新，而不仅仅是第一个工具。

## 输出示例

```
✓ Module "core" launched! Change management is now active.
  From now on, modifications to existing documents require a change proposal.
  Run `openlogos change <slug>` to start a new change proposal.
  ✓ AI rules updated in logos/skills/
```

## 切换前后对比

| 方面 | `initial` | `launched` |
|--------|-----------|----------|
| 阶段推进 | 自由 —— AI 按阶段推进 | 自由 —— AI 按阶段推进 |
| 修改现有文档 | 允许直接修改 | 需要变更提案 |
| `AGENTS.md` 内容 | "No change proposals needed" | "MUST create proposal before modifying" |
| AI 行为 | 直接写代码 | 先停下来要求创建提案 |
| `openlogos change` | 可用（但不强制） | 由 AI 指令强制执行 |

## 使用时机

在完成首个开发周期后运行 `launch`（所有阶段完成、`openlogos verify` 通过）。当所有阶段完成时，`status` 命令会自动建议这一步。

典型时机：

```
openlogos init → Phase 1 → 2 → 3 → openlogos verify
                                          │
                                    openlogos launch   ← here
                                          │
                              openlogos change <slug>  (iterations)
```

## 幂等性

当所选模块已经 launched 时再运行 `launch` 是一个空操作（no-op）：

```
Module "core" is already launched. No action needed.
```

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录，或先运行 `openlogos init` |

## 相关命令

- [`change`](/zh/cli/change) — 创建变更提案（launch 之后可用）
- [`status`](/zh/cli/status) — 展示 lifecycle 状态，并在就绪时建议 `launch`
- [`sync`](/zh/cli/sync) — 重新生成文件（launch 也会在内部重新生成）
