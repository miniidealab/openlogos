# 实现任务

## [code] 代码实现

> 六维打分：2/12（影响范围 1：5 个相关版本/发布文件；行为复杂度 0：不改运行时逻辑；契约变化 1：npm 包版本与 CLI envelope 版本同步变化；测试规模 0：复用 3 个真实用例；风险 0：可从 0.13.20 tarball 回装；不确定性 0：版本与交付边界明确）→ 非大任务，单切片。
>
> 删后续自检：本就只有 1 片，无后续可删；该片同时落地版本元数据、发布说明、版本 golden 与打包契约回归，完成后 `openlogos --version` / package metadata 可端到端观察，并能独立通过全量 verify，(a) 与 (b) 均成立。

- [x] 单切片：完成 0.13.21 本地候选版本闭环——同步 `cli/package.json`、`cli/package-lock.json` 与 `plugin/.claude-plugin/plugin.json`，新增 `CHANGELOG.md` 0.13.21 条目及版本链接，刷新版本 golden；复用既有 OpenLogos reporter，运行版本输出与 npm prepack/pack 内容契约测试（覆盖 UT-S34-09、UT-S16-07、ST-S16-02）

## [deploy] 本机全局部署与 Windows 验收包

- [x] 按 `core-01-deployment-plan.md` §二十一保留公开发布的 `0.13.20` 回滚 tarball，并通过 `npm pack` 生成 `miniidealab-openlogos-0.13.21.tgz`
- [x] 从 `0.13.21` tarball 执行本机全局安装，确认 `openlogos --version` 与 `cli/package.json` 一致；失败时回装 `0.13.20` tarball
- [x] 核对 `0.13.21` tarball 包含 CLI `dist/`、规格、Skills 与三类插件模板，保留该文件供 Windows 真机手工验收
