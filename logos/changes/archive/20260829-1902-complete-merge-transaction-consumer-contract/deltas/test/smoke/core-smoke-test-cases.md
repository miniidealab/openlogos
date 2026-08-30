## ADDED — 修正后 OpenLogos 0.14.0 消费者合同 Smoke

### 冒烟测试用例

| 用例 ID | 场景 | 必须通过的真实断言 |
|---|---|---|
| SMOKE-core-151 | 安装态 abort/action parity | 部署后的绝对全局 CLI 暴露 abort，next/status 已知 action 与实际子命令一一对应，未知 action 保守失败 |
| SMOKE-core-152 | 声明 staging path | Agent 只在公共 slot descriptor 的 staging_path 原子写；同路径 submit 成功，任意其它路径/canonical target/symlink 负例均零正式副作用 |
| SMOKE-core-153 | completed 无环 receipt | CREATE/MODIFY/mixed 完成后 final/artifact hashes 互斥且精确覆盖 commit_paths，receipt hash 可重算，精确 Git 暂存无额外路径 |
| SMOKE-core-154 | abort 清理与幂等 | collecting/ready/sealed abort 均收敛 failed/aborted，私有制品清理、正式目标不变，重复 abort 返回同 `aborted_at` |
| SMOKE-core-155 | RunLogos 真实消费者接缝 | RunLogos 仅消费冻结的 slot/action/receipt 公共字段完成真实 E2E，不读 OpenLogos 私有 transaction 文件、不自行推导提交集 |
| SMOKE-core-156 | stacked slug 证据归属 | 旧 slug 的 SMOKE-core-150 与本 follow-up 的 SMOKE-core-151～156 分别绑定各自 guard/marker/candidate hash，不能互相顶替归档证据 |

### Runner 与边界

1. runner 必须在隔离临时项目中调用部署后的绝对全局 `openlogos`；不得调用源码入口、mock 或预造 completed receipt。
2. SMOKE-core-155 必须由 RunLogos 真实 AgentAdapter/WorkUnit/DriverCommandExecutor 驱动，并回传同一 candidate、schema 与 contract hash。
3. SMOKE-core-156 只核对各 worktree/slug 的证据归属与集成前置，不代替任一 archive，也不得删除另一 slug 的 guard/marker。
4. 调用图不得包含 npm publish、Git tag、GitHub Release、官网部署或 git push；失败时按部署方案回滚。

### Reporter 约束

每个 ID 向 `logos/resources/verify/smoke-results.jsonl` 追加唯一 OpenLogos reporter 记录，至少包含 `id/status/timestamp/duration_ms/environment="local-global"`、candidate/tarball/schema/contract hash、transaction/receipt 摘要与脱敏 evidence。任一缺失、skip、fail、重复矛盾或证据归属漂移均不得生成 `SMOKE_PASS`。
