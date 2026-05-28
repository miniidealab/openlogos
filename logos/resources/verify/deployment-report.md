# 部署报告

> 生成时间：2026-05-27 23:28:30 CST  
> 提案：`adopt-bootstrap-adopted`  
> 目标环境：npm registry
> 状态：SUCCESS

## 摘要

- CLI/npm 版本：`@miniidealab/openlogos@0.9.31`
- npm latest：`0.9.31`
- Git tag：`v0.9.31`
- GitHub Release：`https://github.com/miniidealab/openlogos/releases/tag/v0.9.31`
- GitHub Actions 发布 run：`https://github.com/miniidealab/openlogos/actions/runs/26520481571`
- npm 发布结果：`+ @miniidealab/openlogos@0.9.31`
- 部署命令：`git push origin refs/tags/v0.9.31`
- 发布前命令：`cd cli && npm test`、`cd cli && npm pack --cache /private/tmp/openlogos-npm-cache`
- 数据迁移：无

## 执行步骤

1. 更新 `cli/package.json`、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 至 `0.9.31`
2. 执行 `cd cli && npm test`
3. 执行 `cd cli && npm pack --cache /private/tmp/openlogos-npm-cache`
4. 提交发布准备变更
5. 创建并推送 `v0.9.31` tag
6. 等待 GitHub Actions 自动执行 npm publish 并创建 GitHub Release
7. 在干净存量项目验证 `openlogos adopt --locale zh --ai-tool all`
8. 在历史 `bootstrap: skipped` 项目验证 `openlogos status --format json` 与 `openlogos next`

## 结果

- CLI 构建：PASS
- CLI 测试：PASS
- CLI 打包验证：PASS
- GitHub Actions npm 发布：PASS，run `26520481571` 结论为 `success`
- npm latest：PASS，`npm view @miniidealab/openlogos version` 返回 `0.9.31`
- GitHub Release：PASS，`v0.9.31` 已发布，非 draft / prerelease
- 干净存量项目 adopt：PASS，生成完整 `logos/`、`AGENTS.md`、`CLAUDE.md`、多工具资产，且 `bootstrap: adopted`
- 历史 skipped 兼容：PASS，`status --format json` 与 `next --format json` 均按 adopted 语义工作

## 回滚点

- npm：上一稳定版本为 `0.9.30`，可通过发布补丁版本回滚客户端推荐版本。
- GitHub Release：当前发布点为 `v0.9.31`，对应提交 `fdabdf4f42964a2d79182eb6c3a76c15b01dab7c`。
- 发布回退：可通过推送后续补丁 tag 覆盖最新发布入口。

## 风险

- 本地 `npm whoami` 在当前环境返回 `401 Unauthorized`，但 GitHub Actions 发布链路已成功完成。
- 本地 `npx @miniidealab/openlogos@0.9.31` 受网络限制会回退/失败，因此采用仓库内 `cli/dist/index.js` 进行行为验证。
