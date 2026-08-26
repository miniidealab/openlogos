# core TRAE 本地负向 Smoke 实现清单

## 实现范围

- 将 CLI、lockfile 与 Claude/Codex/ZCode/Qoder/WorkBuddy 随包插件 manifest 统一升级为 `0.13.29`；没有 npm publish、tag、Release、官网部署或 push 动作。
- 新增 `scripts/smoke-trae-local-negative.js`，仅验证 OpenLogos 候选 tarball 的 TRAE non-deployable 合同，不创建或注册 TRAE Adapter、插件、Hook normalizer、wrapper 或 `.trae/**` 托管资产。
- runner 通过一次性 HOME、npm prefix/cache、workspace 和 evidence 根安装真实候选制品，强制 CLI realpath 位于隔离根，并对候选 `0.13.29` 与回滚 `0.13.28` tarball 的包名、版本、大小和 SHA-256 进行校验。
- 安装态执行显式 `trae` 首写前拒绝、`all`/sync 七宿主回归与含 `trae` 配置的事务前严格失败；只使用合成 TRAE fixture 比较清单和 SHA-256，不启动客户端或读取真实记忆正文。
- 在同一隔离 prefix 实际执行 `0.13.29 → 0.13.28 → 0.13.29`，恢复后重新验证显式 TRAE 拒绝；任一阶段失败均写 fail reporter 且不得产生 smoke PASS。
- `scripts/run-smoke.js` 为该 runner 独立路由 `OPENLOGOS_TRAE_LOCAL_TARBALL` 与 `OPENLOGOS_TRAE_ROLLBACK_TARBALL`，并继续使用统一 `smoke-results.jsonl`。

## 自闭环切片与真实用例

- [x] 单切片完成候选身份、隔离、初始化/同步排除、所有权、reporter 与回滚恢复闭环。
- [x] S01：UT-S01-128、ST-S01-26。
- [x] S08：UT-S08-37、ST-S08-27。
- [x] S19：UT-S19-10、UT-S19-11、ST-S19-09。
- [x] Smoke runner：SMOKE-core-124～SMOKE-core-129；真实 PASS 只允许在完成部署并获得独立 smoke 授权后写入。

## 主要产物

- `scripts/smoke-trae-local-negative.js`
- `scripts/run-smoke.js`
- `cli/test/trae-local-negative-smoke.test.ts`
- `cli/package.json`
- `cli/package-lock.json`
- `plugin/.claude-plugin/plugin.json`
- `plugin-codex/plugin.json`
- `plugin-zcode/.zcode-plugin/plugin.json`
- `plugin-qoder/.qoder-plugin/plugin.json`
- `plugin-workbuddy/.workbuddy-plugin/plugin.json`

## 当前验证

- 新增专项测试：8/8 通过；7 个真实 UT/ST ID 已由 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- `cd cli && npm test`：79 个测试文件、1966/1966 通过。
- `cd cli && npm pack --dry-run --json`：通过；候选包 identity 为 `@miniidealab/openlogos@0.13.29`，清单包含 CLI 与全部随包插件模板。
- runner `--self-test`：声明 SMOKE-core-124～SMOKE-core-129、`environment=local-isolated`、TRAE capability `BLOCKED`、不启动 TRAE且公开发布命令为空。
- 尚未执行 `openlogos verify`、本地部署、真实双 tarball smoke、archive 或任何公开发布动作。

## 部署与 Smoke 边界

- 部署执行须显式提供真实 `0.13.29` 候选 tarball 和已固定 SHA-256 的 `0.13.28` 回滚 tarball；源码测试与 dry-run 不能替代真实制品安装。
- 部署和 smoke 仍是独立人类确认点；实现完成不写 `DEPLOY_DONE`、`SMOKE_PASS` 或部署报告。
- 全部 smoke 通过只证明 OpenLogos 安装产物保持 TRAE non-deployable 与隔离可回滚，不改变 D06 hard guard **BLOCKED**。
