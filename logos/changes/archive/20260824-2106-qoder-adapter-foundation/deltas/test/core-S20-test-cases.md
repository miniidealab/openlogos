## ADDED — S20 存量项目 Qoder 安全接入测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S20-27 | adopt 解析 qoder | 交互选择/`--ai-tool qoder` | Registry 返回规范 id 并进入总资产预检 |
| UT-S20-28 | AGENTS 安全合并 | 用户内容 + 无/完整/残缺 marker | 无/完整安全追加或替换；残缺 blocked；用户原文保留 |
| UT-S20-29 | Qoder settings/记忆保留 | 预置 settings、用户级/本地 AGENTS、rules | 全部字节不变，不纳入 OpenLogos owner |
| UT-S20-30 | 非 OpenLogos plugin 保留 | 存量插件和未知组件 | 不同 identity/未知文件 preserved，不进入删除计划 |
| UT-S20-31 | 冲突预检无部分写入 | 同名不同 owner、非法 manifest、不可写目标 | 首个提交前失败；logos/配置/Adapter 目标均不创建 |
| UT-S20-32 | 配置持久化 | adopt 成功 | aiTool=qoder，bootstrap=adopted，lifecycle=launched |
| UT-S20-33 | change 指引兼容 | adopt 报告与 status/next | 下一主动作仍为 change，无 Qoder seed/IDE 前置 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S20-17 | Qoder 完整 adopt | 未初始化存量项目选择 qoder | logos/spec/配置/索引、plugin/AGENTS/Hooks 完整原子生成，可创建 change |
| ST-S20-18 | 多类用户资产保护 | 预置 AGENTS、AGENTS.local、rules、settings、用户 plugin 后 adopt | 全部用户资产 SHA-256 不变；OpenLogos plugin 独立安装并报告 preserved |
| ST-S20-19 | 冲突/中途失败回滚 | 预置同名不同 owner 并注入事务失败 | 非零退出；无半套 logos、配置或 plugin；不输出接入完成 |

### 自动化与证据要求

- fixture 覆盖根 AGENTS 无 marker、完整 marker、残缺/重复 marker，以及自定义 Qoder 用户资产。
- ST-S20-17 在 adopt 后验证 change 工作区创建可达性，但不得把 Qoder CLI 运行作为 change 命令的前置。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，含 `status`、`timestamp`、`duration_ms`、`scenario: "S20"`，失败含 `error`。
- ST-S20-18/19 以目录快照、owner 清单和 SHA-256 证明保护/回滚；reporter 写入失败使测试失败。
