# 变更提案：release-0-13-21

> module: core | created: 2026-08-02

## 变更原因

`v0.13.20` 之后已经合入两项需要交付给使用方的修复：sandbox 写入审计对依赖目录的受控豁免，以及 Windows `archive` 与 watcher 的有界握手协议。后者的协议逻辑已通过 `fs` / `platform` / `env` 注入在 macOS 完成自动化验证，但 Windows 专属分支仍需将真实 npm 包带到 Windows 机器做最终验收。

本次生成 `0.13.21` 本地候选版本，在当前 Mac 全局安装验证，并产出可复制到 Windows 的 npm `.tgz`。用户明确限定：不创建或推送 tag、不发布 npm、不创建 GitHub Release、不部署官网、不执行 `git push`。

## 变更类型

代码级修复（版本元数据与发布说明；无规格行为变更）

## 变更范围

- 影响的需求文档：无
- 影响的功能规格：无
- 影响的业务场景：无（复用已合并的 S09 / S13 / S19 规格）
- 影响的部署方案：无文档变更；复用 `core-01-deployment-plan.md` §二十一的本地 build / pack / 全局安装 / 回滚流程
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的 smoke 测试：无用例规格变更；复用 `SMOKE-core-01`、`SMOKE-core-04`
- 影响的源码（`[code]` 阶段）：`cli/package.json`、`cli/package-lock.json`、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md`、`cli/test/__snapshots__/s34-feature.test.ts.snap`

## 部署影响

- 是否需要部署：是
- 部署原因：需要将生成的 `0.13.21` tarball 安装到本机全局 npm 环境，验证真实安装入口，并把同一 tarball 交付 Windows 真机验收
- 影响环境：本机全局 npm 安装；Windows 验收机由用户后续手工安装，本提案不远程操作
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（保留公开发布的 `0.13.20` tarball；失败时全局回装并复核版本）
- 是否需要 smoke：是（本机安装后验证 CLI 版本与包内模板；Windows 专属端到端验收在目标机器执行）

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 复用测试 ID

- UT-S34-09 — 版本号进入 `status` / `next` envelope 的逐字节 golden，随版本 bump 同步验证
- UT-S16-07 — npm prepack 包内容与随包 schema 完整性验证
- ST-S16-02 — 真实 pack 面内 schema 与 CLI 输出契约端到端验证
- UT-S09-125 — Windows watcher 协议路径确定性、固定兼容向量与越界拒绝
- ST-S09-44 — Windows 单 watcher 在 released ACK 后才允许 archive rename
- ST-S09-45 — Windows 多 watcher ACK 未收齐时超时且不得 archive rename
- ST-S09-EX-10.4 — 非 Windows 平台不访问 watcher 协议文件
- SMOKE-core-01 — 本地 tarball 可全局安装并输出目标版本
- SMOKE-core-04 — npm tarball 包含插件模板

## 变更概述

把 CLI、npm lockfile 与 Claude 插件元数据统一提升到 `0.13.21`，刷新依赖包版本的 UT-S34-09 golden，并在 `CHANGELOG.md` 记录 `v0.13.20` 以来的 sandbox 审计修复和 Windows archive watcher 握手能力。代码行为不再新增或改写，完整回归沿用已合并规格与测试。

验证通过后，按既有部署方案生成 `miniidealab-openlogos-0.13.21.tgz`，先保留 `0.13.20` 回滚 tarball，再从新 tarball执行本机全局安装和版本校验。交付物只保留本地文件，不触发任何远程发布或推送。

## 非目标

- 不执行 `npm publish`
- 不创建或推送 `v0.13.21` tag
- 不创建 GitHub Release，不部署官网
- 不执行 `git push`
- 不在当前 Mac 伪造 Windows 原生端到端结果
