## ADDED — TRAE hard guard 不成立的负向契约测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S09-219 | 无 TRAE guard normalizer | 枚举宿主 Hook normalizer/协议映射 | 不含 `trae`、TRAE 工具名或字段映射；既有宿主映射不变 |
| UT-S09-220 | 软控制不得注册 hard guard | 仅发现 Rules、Skills、Agent、MCP、Hooks UI 或配置文件 | capability 判定不能成为 deployable/PASS，不能调用共享 `GuardDecisionService` 冒充真实宿主拦截 |
| UT-S09-221 | 用户信任状态非授权输入 | 工作区 `enabled_folders` 缺失、存在或冲突 | Adapter 不读取/静默修改该状态，不从中派生 OpenLogos allow/deny |
| UT-S09-222 | TRAE 用户资产零触达 | 预置 Hooks、Rules、Skills、Agents、MCP、settings、账号占位和不透明记忆 | 不进入 OpenLogos 状态输入、资产计划、备份、回滚或清理集合 |
| UT-S09-223 | 既有 fail-closed 回归 | 执行已支持宿主的 allow/deny/异常合同 | 每次重读磁盘；deny reason 非空、协议/退出码正确、目标哈希不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-85 | 不把 TRAE wrapper 直调当作 hard guard | 即使测试脚本可直接返回 deny，也不得产生 deployable 注册、TRAE capability PASS 或真实宿主通过记录 |
| ST-S09-86 | TRAE 项目资产保持外部所有 | 变更生命周期跨 writing/delta-writing/ready-to-merge，预置 `.trae/**` 与不透明记忆的清单和 SHA-256 始终不变 |
| ST-S09-87 | 现有宿主 hard guard 回归 | 对当前已支持宿主执行允许写与源码/越界/异常拒绝；目标执行结果、reason、退出码和哈希满足原合同 |

### 真实 capability 证据边界

- 国际版 `3.5.91` 与 CN `3.3.93` 的基础 deny 已由真实客户端证明失败：内置写工具执行、Hook stdin 证据缺失、拒绝理由缺失、目标 SHA-256 改变。
- 上述真实失败是提案决策证据，不得在自动化 UT/ST 中伪造 PASS；未来只有独立提案完成双客户端完整矩阵后才能新增 TRAE 正向 guard 用例。
- Rules、prompt、MCP 拒绝、人工确认、Hooks UI、配置存在或 wrapper 直调都不能满足“工具不执行 + 非空理由 + 目标哈希不变”。

### 自动化与 reporter

- UT/ST 必须枚举真实 Registry、normalizer 注册表、生命周期状态输入和 ManagedAsset 计划，并对外部 TRAE fixture 留存前后哈希。
- 每个用例通过 OpenLogos reporter 写入 `test_id`、`scenario_id="S09"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。
