## ADDED — OpenLogos 0.14.1 本地全局 patch 候选 Smoke

### 冒烟范围与前置

- 环境固定为 `local-global`，实际命令必须来自部署报告冻结的本机 npm 全局绝对入口。
- `VERIFY_PASS`、`DEPLOY_DONE.environment="local-global"` 与 `[deploy]` 全勾必须同时成立；用户需另行明确授权 `openlogos smoke --env local-global`。
- 候选与回滚输入分别为已记录 SHA-256 的 0.14.1 和 0.14.0 真实 tarball；不得使用 workspace link、仓库源码、mock、预造 receipt 或可变 registry 下载替代。
- smoke 调用图禁止 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署和 git push。

### 冒烟测试用例

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|---|
| SMOKE-core-157 | 0.14.1 全局入口与完整制品身份同源 | S19-AC-01、S19-AC-02、部署方案“本机全局安装与自检” | local-global | 已从冻结的 0.14.1 tarball 全局安装；部署报告含入口、prefix、tarball SHA 与清单 | 启动新 shell，读取 `command -v`/realpath/`--version`；读取全局 package、Claude/Codex/ZCode/Qoder/WorkBuddy manifest 与 asset manifest；重算 tarball/asset hash | 命令位于记录的 npm prefix，版本全部精确为 0.14.1，bin/文件清单/asset hash 与同一 tarball SHA 一致；不存在 link、源码入口、旧 cache 或混合版本 |
| SMOKE-core-158 | 0.14.1 安装态 merge transaction 公共消费者合同可用 | S19-AC-03、功能规格 2.44.9、S19 Step 10 | local-global | SMOKE-core-157 已通过；隔离临时 launched fixture；candidate schema/contract hash 已冻结 | 仅通过部署报告中的绝对全局入口读取 status/next transaction 投影，执行最小 CREATE/MODIFY content slot 提交、seal/apply、completed receipt 校验和 abort/action parity；校验 candidate evidence validator 与 reporter 归属 | 公共 slot/action/receipt 合同完成且 final/artifact hashes 无环覆盖 commit_paths；validator 接受同源 0.14.1 facts、拒绝 0.14.0/混合 facts；runner 不读取 OpenLogos 私有 transaction 文件，不手写正式 target/receipt/marker |
| SMOKE-core-159 | 真实 0.14.0 回滚、0.14.1 恢复与公开副作用为零 | S19-AC-04、EX-10.1、部署方案“失败与回滚” | local-global | 两个固定 tarball、SHA、安装前事实和可复制命令已记录；SMOKE-core-157～158 已通过 | 在同一全局 prefix 依次安装 0.14.0、重新安装原 0.14.1 tarball；每一步启动新 shell 核对入口/版本/package/plugin/asset identity；审计本次命令图和远程状态 | 实际序列为 `0.14.1 → 0.14.0 → 0.14.1`，每一步绑定正确 tarball SHA，最终保持 0.14.1 且消费者合同最小断言仍通过；无 publish/dist-tag/tag/release/官网部署/push，失败时恢复明确版本并阻断成功 marker |

### Runner、Reporter 与 Dispatcher 合同

1. 后续 `[code]` 切片必须实现或更新 `scripts/smoke-release-0-14-1-local.*`（或等价 canonical runner），并由 `scripts/run-smoke.js` 在活跃 slug 为 `release-0-14-1-local` 时发现并执行 SMOKE-core-157～159。
2. runner 必须调用部署报告冻结的绝对全局入口；若入口版本、realpath、prefix、candidate SHA 或部署环境不匹配，在执行 transaction fixture 前失败。
3. 每个 ID 向 `logos/resources/verify/smoke-results.jsonl` 追加唯一结果，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment="local-global"`、candidate/rollback tarball SHA、入口摘要、package/asset/schema/contract/receipt hash 与脱敏 evidence。
4. status 只允许 `pass` 或 `fail`；本组任何 skip 都视为未完成并使 Gate FAIL。缺失、重复矛盾、旧结果归属、证据不完整或 runner/reporter 未发现不得由其它历史 SMOKE ID 补位。
5. runner 只清理本次创建且 realpath containment 已验证的临时 fixture；不得递归删除 HOME、npm prefix、仓库、用户项目或未知路径。
6. code 阶段完成前必须运行 smoke 覆盖预检，确认 SMOKE-core-157～159 均有 runner/reporter/dispatcher 归属且不在 uncovered cases 中；不得预写 pass 结果冒充覆盖。

### 失败与门禁

- SMOKE-core-157 失败：停止后续用例，按部署方案恢复 0.14.0，不写 `SMOKE_PASS`。
- SMOKE-core-158 失败：保留隔离 transaction fixture 和脱敏诊断，恢复 0.14.0；不得以既有 SMOKE-core-141～156 的结果替代。
- SMOKE-core-159 在回滚或恢复任一步失败：显式报告全局环境可能不一致，阻断归档；不得继续从网络下载未知版本自愈。
- 任一用例检测到公开发布命令或远程状态变更：立即 FAIL，记录越界动作并停止。

### 覆盖度与追溯

- [x] S19-AC-01：SMOKE-core-157。
- [x] S19-AC-02：SMOKE-core-157、SMOKE-core-159。
- [x] S19-AC-03：SMOKE-core-158。
- [x] S19-AC-04：SMOKE-core-159。
- [x] EX-3.2、EX-5.1、EX-6.1：SMOKE-core-157 的前置身份门与失败恢复。
- [x] EX-10.1：SMOKE-core-158～159 的结果完整性、归属和公开副作用门。

只有三个 ID 全部由真实 runner 产生唯一 PASS、最终全局入口为同一 0.14.1 candidate，且无公开发布副作用，才能写 `SMOKE_PASS`。
