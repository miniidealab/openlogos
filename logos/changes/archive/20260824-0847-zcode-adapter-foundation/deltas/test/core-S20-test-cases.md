## ADDED — S20 存量项目 ZCode 接入测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S20-20 | adopt 解析 zcode | 交互选择或非交互 `--ai-tool zcode` | 解析为 Registry id 并进入资产预检 |
| UT-S20-21 | AGENTS 安全合并 | 已有用户内容、无 marker 或完整 marker | 用户内容保留，OpenLogos 完整托管片段插入/替换 |
| UT-S20-22 | 保留 `.zcode/config.json` | 已有模型、权限和插件配置 | 文件字节不变，不在项目配置中安装 Hooks |
| UT-S20-23 | 保留非 OpenLogos 插件 | 存量 ZCode 插件集合 | 未知 identity 和文件均 preserved，不进入删除计划 |
| UT-S20-24 | 冲突预检无部分写入 | 同名不同 owner 或不完整 marker | 在首个提交前失败；logos 与 Adapter 目标均不创建 |
| UT-S20-25 | 配置持久化 | adopt 成功 | `aiTool=zcode`，module bootstrap=adopted、lifecycle=launched |
| UT-S20-26 | change 指引兼容 | ZCode adopt 报告与 status/next | 下一主动作仍为 change，不增加 ZCode seed 前置 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S20-14 | ZCode 完整 adopt | 在未初始化存量项目选择 zcode | logos/spec、配置、索引、ZCode 插件/指令/AGENTS/Hooks 完整生成，可直接创建 change |
| ST-S20-15 | 存量资产保护 | 预置 AGENTS、`.zcode/config.json`、用户插件后 adopt | 三类用户资产哈希不变；OpenLogos 资产独立安装并报告 preserved |
| ST-S20-16 | 冲突整体回滚 | 预置同名不同 owner，注入接入事务中途失败 | 非零退出；无半套 logos、配置或插件；不输出接入完成 |

### 自动化与证据要求

- fixture 必须同时覆盖用户 AGENTS 无 marker、完整 marker 和不完整 marker 三种状态。
- ST-S20-14 在 adopt 后实际执行 change 工作区创建的可达性断言，但不得把 ZCode 作为该命令的必要前置。
- 实现测试时必须内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S20"`；失败含 `error`。
- ST-S20-16 必须以接入前后目录快照证明原子回滚。
