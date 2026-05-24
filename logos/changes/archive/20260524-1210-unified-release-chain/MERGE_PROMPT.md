# 合并指令

## 变更提案
- 提案名称：unified-release-chain
- 提案目录：logos/changes/unified-release-chain/

## 提案内容

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


## 需要合并的 Delta 文件

### 1. deltas/prd/3-technical-plan/1-architecture/core-03-release-and-versioning.md

- Delta 文件：`logos/changes/unified-release-chain/deltas/prd/3-technical-plan/1-architecture/core-03-release-and-versioning.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/unified-release-chain/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(unified-release-chain): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive unified-release-chain`。
