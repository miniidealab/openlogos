# 发布流程规范

> 版本：0.1.0

本文档定义 OpenLogos 的版本发布流程，包括版本号规则、发布前检查清单和版本同步要求。

## 版本号规则

遵循语义化版本（Semantic Versioning）：

| 类型 | 格式 | 触发条件 |
|------|------|---------|
| Major | `x.0.0` | 破坏性变更，不向后兼容 |
| Minor | `x.y.0` | 新增功能，向后兼容 |
| Patch | `x.y.z` | Bug 修复，向后兼容 |

## 需要同步版本号的组件

| 组件 | 文件 | 说明 |
|------|------|------|
| CLI（npm 包） | `cli/package.json` | 主版本，用户通过 npm 安装 |
| Claude Code 插件 | `plugin/.claude-plugin/plugin.json` | 必须与 CLI 版本号保持一致 |
| CHANGELOG | `CHANGELOG.md` | 记录每个版本的变更内容 |

**版本同步规则：每次 CLI 发版时，`plugin/.claude-plugin/plugin.json` 的版本号必须同步更新为相同版本号。**

原因：Claude Code 插件通过版本号判断是否需要更新。版本号不变，用户不会拉取到新的 Skill 文档、hook 脚本等插件内容。

## 发布前检查清单

AI 辅助发布时，必须按以下顺序执行：

```
1. 确认所有变更提案已归档（logos/.openlogos-guard 不存在）
2. 更新 cli/package.json 版本号
3. 更新 plugin/.claude-plugin/plugin.json 版本号（与 CLI 保持一致）
4. 更新 CHANGELOG.md（在 [Unreleased] 下新增版本条目）
5. 运行构建：npm run build（在 cli/ 目录）
6. 运行测试：npm test（在 cli/ 目录）
7. 打包验证：npm pack（在 cli/ 目录）
8. 提交：git add cli/package.json plugin/.claude-plugin/plugin.json CHANGELOG.md
9. git commit -m "improve: 升级 CLI 版本到 x.y.z"
10. git push
11. 提示用户运行：cd cli && npm publish --otp=<验证码>
```

`npm publish` 是人类确认点，AI 不得自动执行。

## commit message 规范

| 场景 | 格式 |
|------|------|
| 版本升级 | `improve: 升级 CLI 版本到 x.y.z` |
| 规格文档合并 | `docs({slug}): merge spec deltas` |
| 代码实现 | `feat/fix({slug}): implement changes` |
| 提案归档 | `chore({slug}): archive change proposal` |
