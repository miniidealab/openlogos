# 部署报告

> 生成时间：2026-07-04
> 提案：`verify-result-consistency-gate`
> 目标环境：staging / Cloudflare Pages preview

## 摘要

- 部署结果：PASS
- 发布版本：`v0.13.1`
- 发布提交：`9c15d073e386d2cf19f1a469a62a06c1afb98b54`
- GitHub Actions run：`28711575778`
- npm 包：`@miniidealab/openlogos@0.13.1`
- GitHub Release：`https://github.com/miniidealab/openlogos/releases/tag/v0.13.1`
- Cloudflare Pages preview：`https://34261c56.openlogos.pages.dev`
- Cloudflare Pages alias：`https://head.openlogos.pages.dev`

## 执行命令摘要

1. `cd cli && npm test`
   - 目的：执行 CLI 全量回归，覆盖 verify 结果账本一致性回归用例。
   - 结果：PASS，31 个测试文件、1052 个测试用例通过。

2. `cd cli && npm run build`
   - 目的：验证 CLI TypeScript 构建。
   - 结果：PASS。

3. `cd cli && npm pack --pack-destination /tmp/...`
   - 目的：验证发布包可打包且版本为 `0.13.1`。
   - 结果：PASS。

4. `cd website && npm run generate:releases`
   - 目的：从 npm registry 生成官网 release 数据。
   - 结果：PASS，生成 75 个版本数据。

5. `cd website && npm run build`
   - 目的：验证官网构建、release 页面和字体子集产物。
   - 结果：PASS，构建 148 个页面。

6. `git commit -m "fix(verify): enforce result ledger consistency"`
   - 目的：提交本次修复、规格、测试、smoke runner 与发布元数据。
   - 结果：PASS，提交 `9c15d073e386d2cf19f1a469a62a06c1afb98b54`。

7. `git tag v0.13.1`
   - 目的：创建 tag 驱动发布入口。
   - 结果：PASS。

8. `git push origin master && git push origin v0.13.1`
   - 目的：推送发布提交与 tag，触发 GitHub Actions 发布链路。
   - 结果：PASS。

9. `gh run watch 28711575778 --exit-status`
   - 目的：等待 tag 发布工作流完成。
   - 结果：PASS；workflow 完成 npm publish、GitHub Release、官网 release 数据生成、官网构建、Cloudflare Pages 部署。

10. `openlogos deploy-done --env staging`
    - 目的：受控写入部署完成状态，勾选当前提案 `[deploy]` 任务。
    - 结果：PASS，部署任务 `2/2`，写入 `logos/changes/verify-result-consistency-gate/DEPLOY_DONE`。

## 发布后确认

- `npm view @miniidealab/openlogos version --json` 返回 `"0.13.1"`。
- `npm view @miniidealab/openlogos@0.13.1 dist.tarball version --json` 返回 `version: "0.13.1"`。
- `gh release view v0.13.1` 返回 release URL：`https://github.com/miniidealab/openlogos/releases/tag/v0.13.1`。
- `https://34261c56.openlogos.pages.dev/releases` 返回 200，页面包含 `0.13.1` 与安装命令。
- `https://head.openlogos.pages.dev/releases` 返回 200，页面包含 `0.13.1` 与安装命令。

## 迁移结果

无业务数据库迁移。

## 服务启动结果

GitHub Actions 发布链路成功完成；Cloudflare Pages 接受部署并返回 preview / alias URL。staging preview 服务启动成功。

## 回滚点

- npm：如发现 `0.13.1` 误阻断合法 verify，可按既有策略发布新的 patch 版本回滚行为。
- GitHub Release：如 release notes 或附件异常，可修正后发布新 patch，并在必要时标记旧 release。
- 官网：如页面内容异常，可通过 Cloudflare Pages 部署历史回滚到上一成功部署。

## 未解决风险

- 主域名 `https://openlogos.ai/releases` 在本次检查时尚未显示 `0.13.1`，但 Cloudflare Pages preview 与 `head` alias 已显示新版本；后续 smoke 应继续验证最终访问入口。
- 部署后 smoke 尚未执行；本工作单元未运行 `openlogos smoke`。
