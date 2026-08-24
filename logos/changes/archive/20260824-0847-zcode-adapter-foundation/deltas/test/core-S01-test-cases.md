## ADDED — S01 ZCode 初始化与 Adapter Registry 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S01-100 | ZCode 参数解析 | `--ai-tool zcode` | 解析为稳定 id `zcode` 并写入配置 |
| UT-S01-101 | `all` 展开 | Registry 注册既有宿主与 ZCode | 结果包含 ZCode、无重复且顺序稳定 |
| UT-S01-102 | Registry 唯一性 | 重复 id、未知 id、合法 Adapter | 重复/未知显式报错；合法集合可枚举 |
| UT-S01-103 | 能力清单 | 读取 ZCode capability manifest | 声明 init/sync/launch/adopt、AGENTS、plugin、hooks |
| UT-S01-104 | 模板完整性 | 遍历随包 ZCode 模板 | manifest、Skills、Commands、Agents、hooks 与 runtime 均存在可解析 |
| UT-S01-105 | AGENTS 自包含 | 生成 ZCode 根指令片段 | 不依赖子目录 AGENTS、include 或 CLAUDE.md 运行时读取 |
| UT-S01-106 | owner 冲突保护 | 目标已有不同 owner 文件 | 初始化预检失败且不覆盖用户文件 |
| UT-S01-107 | 双语结果 | locale 分别为 zh/en | 安装、保留、冲突和新 session 提示均使用配置语言 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S01-15 | ZCode 完整初始化 | 对空项目执行 init 并选择 zcode | 配置、插件、指令、AGENTS 托管片段和 Hooks 一次性生成；模板来自 npm 包 |
| ST-S01-16 | `all` 初始化回归 | 选择 all，连续执行资产规划 | ZCode 与既有四宿主均部署；各宿主目标互不覆盖，第二次计划无语义差异 |
| ST-S01-17 | 冲突时整体回滚 | 预置用户同名插件/不完整 marker 后初始化 | 非零退出；logos、配置和全部 Adapter 目标保持执行前状态；报告精确冲突路径 |

### 自动化与证据要求

- UT/ST 均须自动化，不标记 `[manual]`。
- 测试必须从构建后包目录或 `npm pack --dry-run` 等价清单读取模板，避免只验证源码树。
- 实现测试时必须内嵌 OpenLogos reporter，将每个用例的 `id`、`status`、`duration_ms`、`timestamp`、`scenario: "S01"` 追加到 `logos/resources/verify/test-results.jsonl`；失败记录必须含 `error`。
- ST-S01-17 必须比较执行前后文件快照，不能只断言退出码。
