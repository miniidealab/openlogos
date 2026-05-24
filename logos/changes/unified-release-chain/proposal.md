# 变更提案：统一 npm + GitHub Release 发布链路

> module: core | created: 2026-05-24

## 变更原因
当前 OpenLogos 的发布链路存在分叉：npm 版本已经发布到 `0.9.26`，但 GitHub Releases 仍停留在较早版本，导致版本入口、发行说明和可追溯标签不一致。为了避免后续每次发版都出现“npm 已发、GitHub 还缺版本”的重复问题，需要把发布入口统一为 `git tag vX.Y.Z`，由 CI 在 tag 推送后自动完成 npm publish 和 GitHub Release 创建。

## 变更类型
代码级

## 变更范围
- 影响的需求文档：无
- 影响的功能规格：`logos/resources/prd/3-technical-plan/1-architecture/core-03-release-and-versioning.md`、`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 影响的业务场景：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无

## 部署影响
- 是否需要部署：否
- 部署原因：仅修改仓库发布流程、发布说明与文档，不涉及 OpenLogos 运行环境
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## 变更概述
本次变更把 CLI 发布收口到 tag 驱动链路：发布者只需保证 `cli/package.json`、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 和 `git tag vX.Y.Z` 同步，推送 tag 后由 GitHub Actions 自动执行 npm publish，并基于同一版本的 changelog 创建 GitHub Release。

同时会更新发布规范文档，去掉“人工执行 `npm publish --otp`”的旧口径，补充 GitHub Release 的生成规则、tag 约束和发布说明来源，确保文档、workflow 和实际发布结果保持一致。
