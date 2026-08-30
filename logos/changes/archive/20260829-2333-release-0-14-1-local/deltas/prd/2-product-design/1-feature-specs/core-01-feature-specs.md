## ADDED — 2.44.9 OpenLogos 0.14.1 本地全局 patch 候选交付

### 功能目标与边界

把仓库当前实现冻结为单一、可验证、可回滚的 `@miniidealab/openlogos@0.14.1` 本地候选，并让本机全局 `openlogos` 入口实际解析到该制品。本能力只推进 package/candidate identity，不改变 0.14.0 已建立的 merge transaction 公共协议、Plan Package 合同或用户项目数据格式。

当前候选身份由以下事实共同组成，任一漂移都必须判为失败：

- `cli/package.json` 与 `cli/package-lock.json` 根包版本；
- Claude、Codex、ZCode、Qoder、WorkBuddy 五类随包插件 manifest 版本；
- prepack 生成的 `cli/asset-manifest.json` 版本与文件 hash；
- 代表当前 candidate 的运行时常量、证据校验器、UT/ST golden 与 smoke runner 期望版本；
- npm tarball 文件名、解包后 package metadata、入口文件和 SHA-256；
- 新 shell 解析到的全局命令路径、realpath 与 `openlogos --version`。

描述“0.14.0 breaking cutover”的历史注释、错误文案、兼容 fixture、既有规格与归档证据不是当前 identity，不得通过全仓机械替换改写。

### 制品生成与自检

1. 在 `cli/` 先完成全量测试和 TypeScript 构建，再运行真实 `npm pack`；prepack 必须重新生成 asset manifest，并把当前根 `skills/`、`spec/` 和五类插件模板打入 tarball。
2. 打包完成后读取 npm pack JSON、tarball 解包清单和 package metadata，验证包名精确为 `@miniidealab/openlogos`、版本精确为 `0.14.1`、bin 指向 `dist/index.js`，并记录大小、文件数和 SHA-256。
3. 五类插件 manifest 与 asset manifest 的版本必须全部为 `0.14.1`；manifest 中记录的受管文件 hash 必须能从 tarball 字节重算。
4. candidate 证据读取器必须接受版本、schema/contract hash、tarball hash 和入口事实完整且同源的 0.14.1 证据；0.14.0 旧证据、旧 tarball hash、缺字段或混合版本必须 fail-closed。

### 本地全局安装与回滚

部署前必须冻结当前全局 0.14.0 的命令路径、realpath、npm prefix、package root 和固定回滚来源。优先从当前已安装 package root 生成并校验本地 0.14.0 回滚 tarball，避免把可变网络下载作为唯一恢复路径。

安装只能使用本次冻结的 0.14.1 tarball 绝对路径。安装后必须启动新 shell，重新解析 `command -v openlogos` 与 realpath，并读取全局 package/plugin/asset manifest；仓库源码入口、`npm link`、旧 shell hash/cache 或只改文件名的 tarball 均不构成成功部署。

安装、自检或 smoke 任一步失败时，立即用冻结的 0.14.0 制品恢复，并验证入口与版本回到同一旧制品。恢复失败必须保留诊断并阻断 `DEPLOY_DONE`，不得留下 package 0.14.1、插件 0.14.0 等混合资产。

### 安装态验收与 reporter

- UT-S19-22 校验所有当前 identity 源的 0.14.1 一致性，并区分应保留的 0.14.0 历史语义。
- UT-S19-23 校验旧 candidate/旧 hash/混合版本拒绝、公开发布命令隔离和 0.14.0 回滚命令构造。
- ST-S19-15 在隔离 npm prefix 中执行真实 `pack → install → self-check → rollback → restore`，使用 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 部署后的 SMOKE-core-157～159 必须由统一 dispatcher 发现真实 runner，并向 `logos/resources/verify/smoke-results.jsonl` 逐 ID 写结果；缺失、skip、fail、重复矛盾或 candidate 归属漂移均不得写 `SMOKE_PASS`。

### 公开发布隔离

本地 candidate 调用图不得包含 `npm publish`、dist-tag 修改、`git tag`、GitHub Release、官网/Cloudflare 部署或 `git push`。本节只授权生成本地 tarball 与覆盖本机 npm 全局安装；任何远程发布仍需独立提案与明确授权。
