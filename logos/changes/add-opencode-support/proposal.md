# 变更提案：将 OpenCode 作为一等 AI 工具支持

## 变更背景

当前 `AiTool` 类型只有 `cursor | claude-code | other` 三个选项。OpenCode 是一个使用面很广的终端 AI 编码工具，将其归入 `other` 不够明确，且无法针对 OpenCode 做特定优化。

## 变更目标

将 OpenCode 提升为与 Cursor、Claude Code 并列的一等 AI 工具选项。

## 变更内容

1. `AiTool` 类型：`'cursor' | 'claude-code' | 'opencode' | 'other'`
2. `chooseAiTool` 交互菜单新增 OpenCode 选项（第 3 项，Other 变为第 4 项）
3. `shouldIncludeActiveSkills`：OpenCode 读取 `AGENTS.md`，行为与 Cursor 一致（agents=true, claude=false）
4. `deploySkills`：OpenCode 部署到 `logos/skills/`（与 claude-code/other 一致）
5. CLI `--ai-tool` 参数和 help 文本更新
6. i18n 菜单文本更新

## 影响范围

| 组件 | 变更 |
|------|------|
| `cli/src/commands/init.ts` | AiTool 类型、shouldIncludeActiveSkills、CLI 参数解析 |
| `cli/src/i18n.ts` | 菜单文本（en + zh） |
| `cli/src/index.ts` | help 文本 |
| `cli/test/s01-init.test.ts` | 新增 OpenCode 相关测试 |
