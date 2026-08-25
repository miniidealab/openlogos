## ADDED — S14 Registry 驱动的 Qoder launch 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S14-10 | Registry 选择 Qoder | qoder、all、历史不含 qoder | 前两者各选择一次 Qoder；历史配置不选择 |
| UT-S14-11 | launched 资产变体 | initial/launched 模板并存 | 只规划 launched AGENTS、Skills、Commands、Agents、Hooks/runtime |
| UT-S14-12 | adopted 幂等与提交顺序 | 已 launched 且资产新旧混合；注入 Qoder 失败 | 成功时只刷新差异；失败时 lifecycle 保持旧值并回滚 |
| UT-S14-13 | 既有宿主零漂移 | 同 fixtures 对比引入 Qoder 前后 | Claude Code、OpenCode、Codex、Cursor、ZCode 的计划/输出契约不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S14-21 | normal launch 刷新 Qoder | 满足门禁后 launch 并开新 Qoder CLI session | lifecycle=launched；插件/指令为 launched 变体；SessionStart 显示 launched |
| ST-S14-22 | adopted 重复 launch | 对已 launched adopted module 连续执行两次 | 第二次托管资产 unchanged；settings、用户 plugin、AGENTS marker 外哈希不变 |

### 自动化与证据要求

- ST-S14-21 注入 Qoder 提交/读回失败，证明 lifecycle 写入严格晚于全部 Adapter 成功。
- 既有宿主回归使用结构化资产清单或 golden，不只断言零退出。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，含 `status`、`timestamp`、`duration_ms`、`scenario: "S14"`，失败含 `error`。
- 新 session 只验证插件/静态上下文快照；PreToolUse 仍另行断言每次磁盘重读。
