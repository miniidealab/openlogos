## ADDED — TRAE non-deployable 初始化负向测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S01-124 | Registry 排除 TRAE | 枚举全部 Adapter 规范值、别名和 capability | 不含 `trae`/TraeCode 占位；现有七宿主规范值与稳定顺序不变 |
| UT-S01-125 | `all` 稳定展开 | 解析 `--ai-tool all` | 只含 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy；排除 `other` 与 TRAE，无重复 |
| UT-S01-126 | 支持列表一致性 | 生成帮助、交互选项与结构化支持列表 | 三者均由 Registry 派生且不展示 TRAE；既有七宿主顺序一致 |
| UT-S01-127 | 显式 TRAE fail loud | 解析 `trae` 及大小写/猜测别名 | 返回未知/不支持错误与原始输入；不映射成 `other`，不产生资产计划 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S01-24 | `init --ai-tool trae` 被拒绝 | 首个目标写入前失败；配置、工作区与既有 `.trae/**` 哈希不变；错误列出真实支持值且说明 non-deployable |
| ST-S01-25 | `init --ai-tool all` 七宿主回归 | 只部署现有七宿主，目标顺序与历史 golden 一致；不创建 `.trae/**`、TRAE Agent/Rules/Skills/Hooks/MCP 或记忆资产 |

### 自动化与证据要求

- 测试必须枚举真实 `AiToolAdapterRegistry` 和真实 init 资产计划，不用手写支持数组代替断言。
- ST 使用隔离临时 HOME/workspace，并对配置、全部目标及预置 `.trae/owned-by-user.txt` 记录前后 SHA-256。
- 每个用例通过 OpenLogos reporter 向 `logos/resources/verify/test-results.jsonl` 追加 `test_id`、`scenario_id="S01"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。
