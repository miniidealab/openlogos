## MODIFIED — 一、版本策略
- CLI 版本与 npm 包版本保持一致。
- CLI 版本号、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 对应版本章节、Git tag `vX.Y.Z` 必须同步。
- 发布入口统一为 `git tag vX.Y.Z`，tag 推送后由 GitHub Actions 自动执行 npm publish，并创建同版本 GitHub Release。
- `CHANGELOG.md` 的对应版本章节作为 GitHub Release 说明来源。

## MODIFIED — 二、发布策略
- CLI：通过 `git tag vX.Y.Z` 触发 GitHub Actions，自动完成 npm publish，并同步创建 GitHub Release。
- 网站：通过站点托管发布。
- 插件模板：随 CLI 版本同步发布。
- 发布归档：GitHub Release 的标题、正文与资产必须与 `CHANGELOG.md` 的对应版本保持一致。

## MODIFIED — 三、变更日志
每次发布应在仓库的变更记录中保留可追溯说明。发布时应确保 `CHANGELOG.md` 的对应版本条目已填写，且其内容既作为 GitHub Release 说明来源，也作为发布归档依据。
