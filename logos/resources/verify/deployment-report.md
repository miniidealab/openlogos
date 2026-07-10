# 部署报告：support-nodelta-spec-complete

## 部署时间
- 2026-07-10T11:23:29Z

## 目标环境
- 本机全局 npm 环境（`/opt/homebrew`）。
- 本次仅重新部署本地全局 CLI；未发布 npm、未推送 Git、未部署 Cloudflare Pages。

## 执行命令摘要
- `openlogos verify`
- `cd cli && npm run build`
- `cd cli && npm pack --pack-destination /tmp/openlogos-local-redeploy-20260710`
- `npm install -g /tmp/openlogos-local-redeploy-20260710/miniidealab-openlogos-0.13.6.tgz`
- `npm list -g --depth=0 @miniidealab/openlogos`
- `openlogos --version`
- `openlogos detect --format json`
- `openlogos status --format json`

## 验收结果
- `openlogos verify` 通过：31 个测试文件、1078 个测试全部通过。
- OpenLogos 测试账本定义 769 个用例，执行 769 个，通过 769 个，覆盖率与通过率均为 100%。
- Gate 3.6：PASS。

## 部署结果
- CLI 构建与 npm 打包成功。
- 本地 tarball：`/tmp/openlogos-local-redeploy-20260710/miniidealab-openlogos-0.13.6.tgz`。
- tarball SHA-256：`1fcc2663c57bd49d0b7895183e7fc40ae05bfb6f6c5ffa9af5b1ed6f60132068`。
- 全局包：`@miniidealab/openlogos@0.13.6`。
- CLI 入口：`/opt/homebrew/bin/openlogos`。
- `openlogos --version` 输出 `0.13.6`。
- 当前项目 `openlogos detect --format json` 与 `openlogos status --format json` 执行成功，项目识别为 `launched`，活跃提案为 `support-nodelta-spec-complete`。

## 迁移与服务
- 无数据库迁移。
- 无远程服务配置迁移。
- 部署对象为本机全局 CLI，无常驻服务。

## 回滚点
- 如本地 CLI 异常，可执行 `npm install -g @miniidealab/openlogos@0.13.5` 回滚到上一版本。
- 也可重新安装已留存的旧版本地 tarball。

## 未解决风险
- smoke dispatcher 的嵌套 runner 结果路径问题已修复；`openlogos smoke` 已执行 37/37 个用例并全部通过，Gate 3.8 PASS。
- smoke 沙箱在 `auto` 模式下仍报告构建产物非白名单写入警告；写入发生在隔离副本中，未污染真实工作区，也未阻塞本次门禁。
