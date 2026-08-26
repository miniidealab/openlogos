## ADDED — 2.42 TRAE 本地候选制品负向验证功能规格

### 2.42.1 产品状态与术语

`local-isolated deployment` 表示将 OpenLogos CLI `0.13.29` 候选 tarball 安装到一次性本地环境；它不表示部署 TRAE Adapter。无论部署和负向 smoke 是否通过，TRAE 的产品状态都保持 `non-deployable / hard guard BLOCKED`，Registry、`all`、帮助和交互选择均不得出现 `trae`。

### 2.42.2 输入与输出合同

| 项目 | 合同 |
|---|---|
| 候选制品 | `OPENLOGOS_TRAE_LOCAL_TARBALL`；真实 npm tarball，包名正确，版本精确 `0.13.29`，SHA-256 可追溯 |
| 回滚制品 | `OPENLOGOS_TRAE_ROLLBACK_TARBALL`；真实 npm tarball，版本精确 `0.13.28`，SHA-256 可追溯且可离线安装 |
| 环境 | `local-isolated`；一次性 prefix、HOME、npm cache、workspace 和 evidence root |
| 被测入口 | 仅允许解析到候选/回滚 tarball 安装 prefix 的 `openlogos`；禁止全局 CLI、workspace link 和源码直跑 |
| 结果 | deployment report、smoke JSONL、脱敏命令证据、文件清单与 SHA-256；不得包含凭据或记忆正文 |

### 2.42.3 用户流程

1. 用户明确授权本地部署后，执行者完成 build/test/pack，并核验候选 tarball 身份。
2. 执行者创建一次性环境，安装 `0.13.29`，核验 CLI 入口、版本、清单和隔离边界。
3. 执行 S01/S08 最小安装态检查，确认显式 TRAE 首写前拒绝、`all` 七宿主和 `.trae/**` 零新增/零改动。
4. 在同一 prefix 安装 `0.13.28` 核验回滚，再恢复 `0.13.29` 并重跑最小检查。
5. 部署证据完整后才允许标记 `DEPLOY_DONE --env local-isolated`；获得独立 smoke 授权后执行 SMOKE-core-124～SMOKE-core-129。

### 2.42.4 所有权与隔离体验

- 一次性环境内的 prefix、HOME、cache、workspace、日志和哈希证据由本次部署拥有，可按保留策略清理。
- 真实用户 HOME、全局 npm、仓库工作区外项目、TRAE settings/账号/信任状态/Rules/Skills/Agents/Hooks/MCP/记忆均是外部资产，禁止读取性探测或修改。
- runner 只在合成 fixture 中预置 `.trae/**` 边界样本并比较不透明哈希；不得复制真实用户内容。
- TRAE 应用版本只能作为既有只读背景事实记录，runner 不启动客户端、不触发内置写工具，也不修改 `enabled_folders`。

### 2.42.5 失败语义

下列任一情况必须 fail loud，且不得写成功 marker：环境不是 `local-isolated`；tarball 缺失或版本/SHA 不符；入口逃逸到 prefix 外；发现 workspace link/源码入口；显式 `trae` 产生任何写入；`all` 不等于既有七宿主；`.trae/**` 或用户边界哈希变化；smoke ID 缺失/skip；回滚或候选恢复失败；试图公开发布。

错误输出须指出失败阶段、预期/实际版本、脱敏路径类别与证据位置。它不得建议用户安装付费 TRAE 能力、启用信任开关，或把软控制升级为 hard guard。

### 2.42.6 兼容与验收

- 既有七个 deployable Adapter 的规范值、顺序、资产计划、哈希与结果分类保持不变。
- 版本元数据统一提升到 `0.13.29`，但不新增 `trae` 代码分支、模板或插件 identity。
- SMOKE-core-124～SMOKE-core-129 全部 pass 只证明候选制品的负向排除合同与本地可回滚性；不改变 D06 重新开启门槛。
- 不授权 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。
