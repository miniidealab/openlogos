## ADDED — S19 0.14.1 本地全局 patch 候选验收要求

### 背景与用户价值

当前仓库已包含 0.14.0 之后完成的 merge transaction 消费者合同修正，但本机全局入口与随包版本身份仍为 0.14.0。用户需要把当前仓库的完整代码和受管资产冻结为真实 `@miniidealab/openlogos@0.14.1` npm tarball，并用该 tarball 替换本机全局安装，以便后续命令实际消费当前实现，而不是继续运行旧候选或仓库源码入口。

本次交付只产生本地 patch candidate，不构成公开发布。成功状态必须由真实 tarball、全局命令解析、版本/资产一致性与可恢复回滚共同证明，不能用改写文件名、`npm link`、`node cli/dist/index.js` 或历史 smoke 结果替代。

### 验收条件

| AC ID | GIVEN | WHEN | THEN |
|---|---|---|---|
| S19-AC-01 | 当前全局 `openlogos` 精确为 0.14.0，仓库 candidate 已完成 0.14.1 版本同步并通过测试与构建 | 从 `cli/` 执行真实 `npm pack` | tarball 的包名、版本、入口、文件清单、SHA-256、五类插件 manifest 与 `asset-manifest.json` 均可追溯到同一 0.14.1 candidate |
| S19-AC-02 | 0.14.1 tarball 身份已经冻结，且部署前 0.14.0 的命令路径、package root、安装来源与可复制回滚制品已经记录 | 从固定 tarball 安装到本机 npm 全局 prefix，并在新 shell 中重新解析命令 | `command -v openlogos` 与 realpath 指向目标全局安装，`openlogos --version`、package/plugin/asset manifest 和 candidate 证据均精确为 0.14.1，不允许 workspace link、源码入口或旧 shell cache |
| S19-AC-03 | 0.14.1 已从真实 tarball 安装到全局环境 | 运行安装态最小 smoke | 版本与制品身份、merge transaction 公共消费者合同和 reporter 结果全部通过；任一 ID 缺失、skip、fail、证据漂移或结果归属错误时不得产生 `SMOKE_PASS` |
| S19-AC-04 | 已保留固定的 0.14.0 回滚来源与 0.14.1 candidate tarball | 安装、自检、smoke 或回滚演练任一步失败，或执行 `0.14.1 → 0.14.0 → 0.14.1` 恢复演练 | 全局入口最终回到明确版本且路径/版本/制品 SHA 一致；失败时停在可诊断状态，不留下混合资产，不执行 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push |

### 范围与非目标

- patch candidate 只更新当前 package identity、候选证据与安装态覆盖，不改变 `openlogos/merge-transaction@1`、status/next contract 或用户项目文件格式。
- 0.14.0 中描述 breaking cutover 的历史语义、兼容 fixture 和归档证据保持原样；只有代表“当前 candidate”的版本常量、断言和 runner 更新为 0.14.1。
- 本次不访问 npm registry 进行发布，不创建或推送 tag，不创建 GitHub Release，不部署官网，也不推送 Git 远端。

### 追溯

- 场景：S19 0.14.1 本地全局 patch 候选分支。
- 单元/场景测试：UT-S19-22、UT-S19-23、ST-S19-15。
- 部署后 smoke：SMOKE-core-157、SMOKE-core-158、SMOKE-core-159。
