# 发版流程规范

> 版本：1.0.0
>
> 本文档定义 OpenLogos CLI 的标准发版流程。每次发版必须严格按照此流程执行，确保 GitHub Releases、npm 版本号、官网文档三者保持一致。

## 版本号规则

遵循 [Semantic Versioning](https://semver.org/)：

- `PATCH`（0.9.x）：Bug 修复、文档更新、小改动
- `MINOR`（0.x.0）：新功能、向后兼容的 API 变更
- `MAJOR`（x.0.0）：破坏性变更

需要同步更新版本号的文件：

| 文件 | 字段 |
|------|------|
| `cli/package.json` | `"version"` |
| `plugin/.claude-plugin/plugin.json` | `"version"` |

## 标准发版流程

### Step 1：代码准备

确保所有功能代码、测试、文档已合并到 `master`，且测试全部通过：

```bash
cd cli && npm test
```

### Step 2：更新版本号和 CHANGELOG

更新 `cli/package.json` 和 `plugin/.claude-plugin/plugin.json` 的版本号。

在 `CHANGELOG.md` 的 `## [Unreleased]` 下方插入新版本条目：

```markdown
## [0.9.x] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...
```

### Step 3：提交并推送

```bash
git add CHANGELOG.md cli/package.json plugin/.claude-plugin/plugin.json
git commit -m "improve: 升级 CLI 版本到 0.9.x"
git push origin master
```

### Step 4：打 tag 并推送

tag 推送会自动触发 `.github/workflows/publish.yml`，完成 npm 发布。

```bash
git tag v0.9.x <commit-hash>
git push origin v0.9.x
```

`<commit-hash>` 取 Step 3 提交的 hash（`git log --oneline -1`）。

> ⚠️ tag 推送后 CI 会自动运行 `npm publish`。如果该版本已手动发布过，CI 会报错（npm 不允许覆盖已发布版本），属于正常现象，不影响结果。

### Step 5：创建 GitHub Release

```bash
gh release create v0.9.x \
  --title "v0.9.x" \
  --latest \
  --notes "## Added
- ...

## Fixed
- ..."
```

`--notes` 内容直接从 `CHANGELOG.md` 对应条目复制。

### Step 6：更新并部署官网文档

如有 CLI 行为变更或新功能，更新 `website/src/content/docs/` 下对应文档，然后部署：

```bash
cd website && npm run deploy
```

`npm run deploy` 会自动执行 `astro build && npx wrangler pages deploy dist --project-name openlogos`。

## 快速检查清单

发版前确认：

- [ ] `cli/package.json` 版本号已更新
- [ ] `plugin/.claude-plugin/plugin.json` 版本号已更新
- [ ] `CHANGELOG.md` 已添加对应版本条目
- [ ] `npm test` 全部通过（277+ 个测试）
- [ ] 代码已推送到 `master`

发版后确认：

- [ ] `git tag v0.9.x` 已推送，CI npm publish 成功
- [ ] `gh release create` 已创建 GitHub Release，显示为 Latest
- [ ] `npm info @miniidealab/openlogos version` 返回新版本号
- [ ] 官网文档已更新并部署（如有文档变更）

## 工具安装

```bash
# GitHub CLI（创建 Release）
brew install gh
gh auth login --hostname github.com --git-protocol https --web

# Wrangler（部署官网，已内置在 website/package.json devDependencies 中）
# 直接用 npm run deploy 即可，无需全局安装
```

## 常见问题

**CI npm publish 失败（403 版本已存在）**

手动发布后补打 tag 会触发 CI 重新 publish，npm 会拒绝。这不影响已发布的版本，忽略即可。后续改用 tag 驱动流程（先打 tag，CI 自动 publish，不再手动 `npm publish`）。

**GitHub Release 版本号与 npm 不一致**

补打历史 tag 并创建 Release：

```bash
# 找到对应 commit
git log --oneline | grep "升级 CLI 版本到 0.9.x"

# 补打 tag
git tag v0.9.x <commit-hash>
git push origin v0.9.x

# 创建 Release
gh release create v0.9.x --title "v0.9.x" --latest --notes "..."
```
