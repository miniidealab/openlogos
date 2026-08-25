# core WorkBuddy Adapter Foundation 实现清单

## 实现范围

- 以 `AiToolAdapterRegistry` 统一解析 WorkBuddy，`all` 在 Qoder 后稳定包含 `workbuddy`，历史单值/数组配置不自动扩展新宿主。
- 以 WorkBuddy 托管资产事务预检、暂存、原子替换和失败回滚 `.workbuddy/plugins/openlogos`，保留 settings、其它插件、未知文件与原生记忆。
- 随包提供 `.workbuddy-plugin/plugin.json`、Skills、Commands、Agents、`hooks/hooks.json` 与 Node.js Hook runtime，版本与 CLI `0.13.28` 同源。
- SessionStart 从磁盘注入 lifecycle、active change、proposal_step、允许范围和下一确认点；PreToolUse 兼容 CLI/桌面工具名与 snake_case/camelCase，并对损坏输入、未知写工具和路径逃逸 fail-closed。
- init、adopt、sync、launch 通过 Registry 部署或刷新 WorkBuddy；同步版本戳与 lifecycle 仅在 Adapter 事务成功后提交。
- 提供真实 npm tarball 与 WorkBuddy 5.3.5+ staging driver 的 `SMOKE-core-116`～`SMOKE-core-123` runner、统一 dispatcher 发现和 JSONL reporter。

## 自闭环切片与真实用例

- [x] 初始化与存量接入：UT-S01-116～123、ST-S01-21～23、UT-S20-34～40、ST-S20-20～22。
- [x] 同步与 launched 刷新：UT-S08-27～32、ST-S08-22～24、UT-S14-14～17、ST-S14-23～24。
- [x] SessionStart 与 PreToolUse 硬门禁：UT-S09-208～218、ST-S09-81～84。
- [x] staging 制品与真实宿主 smoke 执行器：`SMOKE-core-116`～`SMOKE-core-123` 的 runner、真实环境合同与 reporter 已实现；真实 PASS 只允许在获授权的 staging smoke 门写入。

## 主要产物

- `cli/src/lib/ai-tool-adapter.ts`
- `cli/src/commands/init.ts`
- `cli/src/commands/adopt.ts`
- `plugin-workbuddy/`
- `cli/scripts/build-workbuddy-template.mjs`
- `scripts/workbuddy-staging-driver.js`
- `scripts/smoke-workbuddy-staging.js`
- `cli/test/workbuddy-adapter.test.ts`
- `cli/test/workbuddy-sync-launch.test.ts`
- `cli/test/workbuddy-guard-runtime.test.ts`
- `cli/test/workbuddy-staging-runner.test.ts`
- `logos/changes/workbuddy-adapter-foundation/TEST_SLICE_MANIFEST.json`

## 当前验证

- `cd cli && npm run build`：通过。
- WorkBuddy 四个专项测试文件：54/54 通过。
- ZCode/Qoder/WorkBuddy sync、launch 与 Hook runtime 兼容回归：通过。
- `cd cli && npm test`：75 个测试文件、1937/1937 通过。
- staging driver 与 smoke runner 的 `--self-test`：通过，覆盖 `SMOKE-core-116`～`SMOKE-core-123`，没有公开发布命令。
- 尚未执行 `openlogos verify`、部署、真实 staging smoke、公开发布、Git tag、GitHub Release、官网发布或 `git push`。

## staging 执行边界

- runner 要求显式提供真实 `0.13.28` tarball、真实 WorkBuddy binary、隔离 driver/profile 与已校验的 `0.13.27` 回滚 tarball。
- driver 使用官方 `plugin validate`、`--plugin-dir`、`--print`、`agents --json` 命令面，并通过隔离 HOME/profile 避免读取真实用户配置。
- 每个 SMOKE ID 单独写 staging JSONL 证据；任一缺失、skip、fail、宿主版本不足、Hook capability 缺失或边界哈希漂移，均不得通过 smoke 门。
