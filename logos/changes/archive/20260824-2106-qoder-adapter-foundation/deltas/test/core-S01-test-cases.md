## ADDED — S01 Qoder 初始化、Registry 与随包资产测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S01-108 | qoder 参数解析 | `--ai-tool qoder` | 解析为规范 id 并持久化，不写 alias |
| UT-S01-109 | all 新展开 | Registry 含既有宿主和 Qoder | 结果稳定包含 qoder、排除 other、无重复 |
| UT-S01-110 | capability 合同 | 读取 Qoder Adapter | instructions/skills/commands/agents/plugin/sessionStart/preToolUse 全为 true |
| UT-S01-111 | 原生 manifest | 解析 `.qoder-plugin/plugin.json` | 路径正确、name 稳定、版本同源、JSON 合法 |
| UT-S01-112 | 约定组件完整性 | 遍历构建后 Qoder 模板 | Skills/Commands/Agents/Hooks/runtime 均存在且可解析，无重复声明 |
| UT-S01-113 | QODER_PLUGIN_ROOT 安全 | 模板路径含空格/元字符 | Hook command 仍将 runtime 作为单一路径解析 |
| UT-S01-114 | 用户 owner 冲突 | 同名不同 identity/未知文件/残缺 marker | 全量预检 blocked，任何目标不被覆盖 |
| UT-S01-115 | 双语逐资产反馈 | locale=zh/en，结果含各状态 | key/路径/ID 稳定，文案按 locale，新 session 提示存在 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S01-18 | Qoder 完整初始化 | 对空项目以 tarball CLI 执行 init qoder | 配置、AGENTS、manifest、Skills、Commands、Agents、Hooks/runtime 原子生成并读回一致 |
| ST-S01-19 | all 加法回归 | 选择 all 并连续执行两次资产规划 | Qoder 与既有五宿主均在稳定顺序；第二次计划无语义漂移 |
| ST-S01-20 | 冲突整体回滚 | 预置不同 identity plugin/残缺 marker 后初始化 | 非零退出；配置、logos、所有 Adapter 目标与用户哈希保持执行前状态 |

### 自动化与证据要求

- 全部 UT/ST 自动化，不允许 `[manual]`；模板断言必须读取构建后包或 `npm pack --dry-run` 等价清单。
- ST-S01-20 比较执行前后完整目录快照和用户文件 SHA-256，不能只断言退出码。
- 测试内嵌 OpenLogos reporter，将本节每个 ID 的 `id`、`status`、`duration_ms`、`timestamp`、`scenario: "S01"` 追加到 `logos/resources/verify/test-results.jsonl`；失败含 `error`。
- reporter 写入失败必须使对应测试失败，不能吞掉或延后补写。
