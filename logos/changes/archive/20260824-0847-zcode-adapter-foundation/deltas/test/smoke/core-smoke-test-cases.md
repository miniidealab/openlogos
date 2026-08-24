## ADDED — ZCode 真实 tarball 与真实客户端 staging smoke

### 范围与统一前置条件

- 环境：隔离 staging；安装本提案真实 `npm pack` tarball，不允许 workspace link、源码直跑或已发布版本替代。
- 宿主：真实 ZCode CLI/客户端，记录版本、插件目录和新 session 标识。
- 安全：使用一次性项目与隔离用户目录；不得执行 `npm publish`、Git tag、GitHub Release、官网发布或 `git push`。
- 运行器：统一 smoke dispatcher 必须发现本节全部 ID，并把结果写入 `logos/resources/verify/smoke-results.jsonl` 或 `logos.config.json.smoke.result_path` 声明路径。

### 冒烟测试用例

| ID | 验证点 | 操作 | 预期结果与证据 |
|---|---|---|---|
| SMOKE-core-100 | 真实 tarball 与版本 | build/test 后 `npm pack`，记录哈希并隔离安装 | 实际 CLI 路径来自该 tarball；版本、大小、SHA-256 可追溯；包清单含全部 ZCode 模板/runtime |
| SMOKE-core-101 | ZCode 插件发现与启用 | 用 tarball CLI 初始化 zcode 项目，按真实 ZCode 流程安装/启用插件并开新 session | ZCode 发现唯一 OpenLogos plugin identity；manifest 来源为安装产物，不引用仓库源码 |
| SMOKE-core-102 | Skills/Commands/Agents | 在真实 ZCode 会话列出并调用最小无副作用入口 | OpenLogos Skills、Commands、必要 Agents 可发现；名称、描述、frontmatter 与 locale 正确 |
| SMOKE-core-103 | SessionStart 上下文 | 有/无 active guard 各开新 session | additionalContext 与磁盘 lifecycle/proposal_step 一致，含允许范围和下一确认点 |
| SMOKE-core-104 | PreToolUse 允许路径 | delta-writing 下由真实 ZCode 写本提案允许的 delta/任务 fixture | 工具执行成功；Hook 返回 allow；目标内容和审计日志一致 |
| SMOKE-core-105 | PreToolUse hard deny | 同一阶段请求写源码、提案外路径和 symlink 逃逸路径 | 三者均在执行前 deny，reason 清晰且为 exit 2 阻断；所有目标哈希不变 |
| SMOKE-core-106 | sync/launch 幂等与新 session | 连续 sync，两次 adopted launch，并在刷新后重开 ZCode session | 第二次资产 unchanged；用户配置/插件不变；新 session 读取 launched 资产和最新阶段 |
| SMOKE-core-107 | 既有宿主回归与回滚 | 对四个既有宿主跑最小初始化资产回归；禁用本次插件并恢复上一 tarball | Claude Code/OpenCode/Codex/Cursor 契约不变；回滚后版本、插件状态和用户资产恢复可证 |

### 判定与 reporter 契约

- 每个 runner 必须写一行合法 JSONL，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "staging"`；失败必须含 `error` 和证据路径。
- `SMOKE-core-100`～`SMOKE-core-107` 任一缺失、skip、fail、runner 未发现或 reporter 未写入，都不得产生 `SMOKE_PASS`。
- `SMOKE-core-105` 必须同时保留 ZCode Hook 原始响应、exit code 和文件哈希证据；仅看到报错文案不算通过。
- `SMOKE-core-107` 的回滚演练是本提案完成条件，不得以“已有回滚方案”替代实际 staging 证据。
- 所有日志必须脱敏；禁止把真实用户配置、凭据或生产目录复制到 smoke 证据。

### 覆盖度校验补充

- [x] 真实 tarball 来源与完整性：SMOKE-core-100
- [x] 真实 ZCode 插件发现：SMOKE-core-101
- [x] Skills/Commands/Agents：SMOKE-core-102
- [x] SessionStart：SMOKE-core-103
- [x] PreToolUse allow/hard deny：SMOKE-core-104 / SMOKE-core-105
- [x] sync/launch 幂等与快照边界：SMOKE-core-106
- [x] 既有宿主回归和 staging 回滚：SMOKE-core-107
