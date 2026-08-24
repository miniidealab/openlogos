## ADDED — S14 Registry 驱动的 ZCode launch 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S14-06 | Registry 选择 ZCode | `aiTool=zcode`、`all`、不含 zcode 的旧配置 | 前两者选择一次 ZCode；旧配置不选择 |
| UT-S14-07 | launched 资产变体 | initial 模板与 launched 模板并存 | launch 计划只选择 launched Commands、Skills、Agents、AGENTS 与 Hooks |
| UT-S14-08 | adopted 幂等刷新 | adopted 模块已 launched，ZCode 资产新旧混合 | lifecycle 不改写，仅刷新托管差异，用户资产 preserved |
| UT-S14-09 | 既有宿主兼容 | 同一 fixtures 对比引入 Registry 前后 | Claude Code、OpenCode、Codex、Cursor 的计划与输出契约不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S14-19 | normal launch 刷新 ZCode | 满足 normal 门禁后 launch，再开启新 ZCode session | lifecycle=launched；插件与指令为 launched 变体；新 session 获取 launched 上下文 |
| ST-S14-20 | adopted 重复 launch | 对已 launched adopted 模块连续执行两次 launch | 两次均成功；第二次托管资产 unchanged，用户 AGENTS/配置/插件哈希不变 |

### 自动化与证据要求

- ST-S14-19 必须验证 lifecycle 的提交顺序：注入 ZCode 写入失败时 lifecycle 保持旧值。
- 既有宿主回归采用 golden 或结构化资产清单比较，不只检查命令零退出。
- 实现测试时必须内嵌 OpenLogos reporter，向 `logos/resources/verify/test-results.jsonl` 写入全部 ID，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S14"`；失败含 `error`。
- 新 session 断言须明确配置/Hook 快照边界，不要求既有 session 热更新。
