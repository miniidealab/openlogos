# 变更提案：变更 Guard 机制 — 防止 AI 绕过变更管理流程

## 变更背景

在 `lifecycle: "active"` 的项目中，AI 有时会跳过变更管理流程直接修改代码，尤其在"紧急修 bug"场景下。当前 AGENTS.md 中的规则措辞不足以约束 AI 行为。

## 变更目标

建立"提醒 → 约束"两道防线：

1. **Guard 锁文件**（P0）：`openlogos change` 创建 `.openlogos-guard`，`openlogos archive` 删除。为上下文检测提供基础数据。
2. **SessionStart 增强**（P0）：Claude Code 每次启动时检测 guard 状态，明确告知 AI 是否有活跃提案。
3. **声明机制**（P1）：在 AGENTS.md/CLAUDE.md 中升级变更管理规则，要求 AI 在修改代码前必须先输出结构化声明并等待用户确认。

## Guard 文件格式

文件路径：`logos/.openlogos-guard`

```json
{
  "activeChange": "fix-xxx",
  "createdAt": "2026-04-07T12:00:00Z"
}
```

- `openlogos change <slug>` → 写入 guard 文件
- `openlogos archive <slug>` → 删除 guard 文件
- 同一时间只能有一个活跃变更（创建新变更时覆盖旧 guard）

## SessionStart 增强

`openlogos-phase` 脚本在 `lifecycle: "active"` 时检测 `.openlogos-guard`：

- **有 guard** → `"🔓 Active change: <slug>. Modify files within the scope of this proposal."`
- **无 guard** → `"⛔ NO active change proposal. You MUST run openlogos change <slug> before modifying any code."`

## 声明机制

在 active lifecycle 的 AGENTS.md/CLAUDE.md 变更管理段落中增加：

1. 发现 bug/问题时：只输出分析和方案，**禁止直接修改代码**
2. 修改代码前：必须输出结构化变更声明并等待用户确认
3. 无 `.openlogos-guard` 时：先运行 `openlogos change <slug>`

## 影响范围

| 组件 | 变更 |
|------|------|
| `cli/src/commands/change.ts` | 写入 `.openlogos-guard` |
| `cli/src/commands/archive.ts` | 删除 `.openlogos-guard` |
| `plugin/bin/openlogos-phase` | 检测 guard 状态 |
| `cli/src/commands/init.ts` | AGENTS.md/CLAUDE.md 变更管理段落升级 |
| `plugin/hooks/` | 无需变更（复用 SessionStart） |
