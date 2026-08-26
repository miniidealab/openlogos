# core TRAE Adapter Foundation 实现清单

## 实现范围

- 依据 TRAE 国际版 `3.5.91` 与 CN `3.3.93` 的真实 capability probe 结论，将 TRAE 保持为 non-deployable：不注册 `trae`、TraeCode 别名、能力声明、Adapter、模板或插件 identity。
- `AiToolAdapterRegistry` 的 `all` 稳定展开既有七宿主；帮助、交互、初始化与同步计划均不包含 TRAE。
- `sync` 对持久化配置中的未知 Adapter 执行严格解析，包含 `trae` 时在迁移、索引、资产事务和版本戳写入前 fail loud，不再静默降级为 `cursor`。
- `.trae/**` 下的 Rules、Skills、Agents、Hooks、MCP、settings、账号占位、`enabled_folders` 与不透明记忆保持宿主或用户所有，不进入 OpenLogos 扫描、授权状态、资产计划、备份、回滚或清理集合。
- 不新增 TRAE SessionStart/PreToolUse normalizer，不把 Rules、prompt、MCP、人工确认、Hooks UI、配置存在或 wrapper 直调视为 hard guard capability PASS。
- 回归现有 WorkBuddy hard guard 的磁盘状态每次重读、allow/deny 协议、非空 reason、退出码与拒绝时目标 SHA-256 不变。

## 自闭环切片与真实用例

- [x] 初始化排除闭环：UT-S01-124～UT-S01-127、ST-S01-24～ST-S01-25。
- [x] 同步排除闭环：UT-S08-33～UT-S08-36、ST-S08-25～ST-S08-26。
- [x] hard guard 非适配闭环：UT-S09-219～UT-S09-223、ST-S09-85～ST-S09-87。

## 主要产物

- `cli/src/lib/ai-tool-adapter.ts`
- `cli/src/commands/sync.ts`
- `cli/test/trae-non-deployable-init.test.ts`
- `cli/test/trae-non-deployable-sync.test.ts`
- `cli/test/trae-hard-guard-exclusion.test.ts`
- `logos/changes/trae-adapter-foundation/TEST_SLICE_MANIFEST.json`

## 当前验证

- `cd cli && npm test`：78 个测试文件、1958/1958 通过。
- `cd cli && npm run build`：通过。
- `cd cli && npm run lint`：通过。
- 同步相关兼容回归：5 个测试文件、101/101 通过。
- 全局 OpenLogos reporter 覆盖本提案 20 个真实 UT/ST ID；失败执行不会写入 pass。
- 尚未执行 `openlogos verify`、部署、smoke、archive、公开发布、Git tag、GitHub Release、官网发布或 `git push`。

## 发布与重新开启边界

- 已合并决策的目标版本为 `0.13.29`，但本案不产生 TRAE npm 资产、不执行版本发布，也不创建 `[deploy]` section。
- 未来只有在独立提案中让国际版与 CN 的受支持版本共同通过真实内置工具完整 hard-guard 矩阵，才允许重新评估 TRAE deployable 注册。
