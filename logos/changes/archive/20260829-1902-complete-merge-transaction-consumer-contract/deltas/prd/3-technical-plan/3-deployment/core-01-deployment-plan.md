## ADDED — 0.14.0 消费者合同修正 candidate 部署计划

### 部署目标与前置条件

目标为本机全局 npm prefix，不含公开发布。前置条件：本 follow-up canonical verify PASS、部署任务获得独立授权、旧全局 candidate 已冻结为可回滚 tarball，并记录入口、realpath、版本和 SHA-256。

### 执行步骤

1. 从 follow-up worktree 构建并测试，执行真实 npm pack。
2. 记录新 tarball 绝对路径、大小、SHA-256；明确旧 tarball/schema/contract hash 失效。
3. 在隔离 prefix 安装并执行 version/help、abort、slot descriptor、无环 receipt、status/recover golden 自检。
4. 使用显式 tarball 安装到本机全局；复核 `command -v`、realpath、0.14.0、随包 schema/Skill 与新双 hash。
5. 写部署报告并通过 `openlogos deploy-done` 标记 follow-up 部署完成。
6. 暂停 follow-up 正式 smoke，先把新合同交给 RunLogos 实现真实 E2E。
7. RunLogos 回传后按旧 slug smoke/archive → follow-up smoke/archive → branch 合入 master 的顺序交接。

### 回滚与失败

pack、安装、自检或全局身份任一失败，立即用冻结的旧 candidate tarball 恢复，复核版本/入口/hash 并记录失败。不得使用 registry 不确定版本或源码 link 代替回滚。

### Smoke 策略

SMOKE-core-151+ 覆盖新合同；旧 SMOKE-core-150 仍由原提案运行。两个 slug 的报告和 marker 独立，均 PASS 前不得完成最终集成。
