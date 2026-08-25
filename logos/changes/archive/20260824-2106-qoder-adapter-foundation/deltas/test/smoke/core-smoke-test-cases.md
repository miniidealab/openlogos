## ADDED — Qoder 真实 tarball 与真实 CLI staging smoke

### 范围与统一前置条件

- 环境：隔离 staging；安装本提案真实 `npm pack` tarball，禁止 workspace link、源码直跑或已发布包替代。
- 宿主：真实 Qoder CLI，记录绝对路径、版本、插件数据根和新 session 标识；mock/wrapper 直调不可替代。
- 安全：一次性 init/adopt 项目与隔离用户目录；禁止 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署和 git push。
- 运行器：统一 smoke dispatcher 发现本节全部 ID，并写入 `logos/resources/verify/smoke-results.jsonl` 或配置声明路径。

### 冒烟测试用例

| ID | 验证点 | 操作 | 预期结果与证据 |
|---|---|---|---|
| SMOKE-core-108 | 真实 tarball 与 CLI 身份 | build/test/pack，记录哈希并隔离安装 | 实际 OpenLogos 路径来自本 tarball；版本/大小/SHA-256 可追溯；清单含全部 Qoder 资产/runtime |
| SMOKE-core-109 | Qoder 插件发现与启用 | 用 tarball CLI init qoder，按真实 Qoder CLI 流程 validate/install/enable 并开新 session | 唯一 OpenLogos identity 可发现；manifest/组件来自安装产物，不引用仓库源码 |
| SMOKE-core-110 | Skills/Commands/Agents/静态记忆 | 在真实 session 列出并调用最小无副作用入口，检查根 AGENTS | 声明组件与实际集合一致；locale 正确；用户 AGENTS/rules/settings 未被吸收或改写 |
| SMOKE-core-111 | SessionStart 上下文 | 无 guard/有 guard 各开新 session | hookEventName/additionalContext 合法，与磁盘 lifecycle/proposal_step/允许范围/确认点一致 |
| SMOKE-core-112 | PreToolUse allow | delta-writing 下由真实 Qoder 写允许的 delta fixture | permissionDecision=allow、exit0，工具执行；内容和审计证据一致 |
| SMOKE-core-113 | PreToolUse hard deny | 请求源码、提案外、`..` 与 symlink 逃逸写入，并注入 runtime 异常 | 全部执行前 deny、reason 非空、exit2；一般非零不计通过；所有目标哈希不变 |
| SMOKE-core-114 | sync/launch 幂等与用户资产 | 连续 sync、两次 adopted launch，每次刷新后开新 session | 第二次托管资产 unchanged；settings/用户 plugin/AGENTS marker 外哈希不变；新 session 为 launched |
| SMOKE-core-115 | 既有宿主回归与回滚 | 跑五个既有宿主最小资产回归；禁用 Qoder plugin 并恢复上一 tarball | Claude Code/OpenCode/Codex/Cursor/ZCode 契约不变；回滚后版本、插件状态和用户哈希恢复可证 |

### 判定与 reporter 契约

- 每个 runner 写一行合法 JSONL，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "staging"`；失败含 `error` 与证据路径。
- SMOKE-core-108～115 任一缺失、skip、fail、未发现或 reporter 未写入，都不得产生 `SMOKE_PASS`。
- SMOKE-core-112/113 保留脱敏 Qoder Hook 原始 stdout、stderr、exit code、tool input 摘要和文件 SHA-256；只看到 UI/文本报错不算通过。
- SMOKE-core-115 必须实际演练隔离回滚，不得用“已有方案”代替；日志不得包含凭据、真实用户配置或生产目录。

### 覆盖度校验补充

- [x] 真实 tarball 与 CLI 身份：SMOKE-core-108
- [x] 真实 Qoder plugin：SMOKE-core-109
- [x] Skills/Commands/Agents/AGENTS：SMOKE-core-110
- [x] SessionStart：SMOKE-core-111
- [x] PreToolUse allow/hard deny：SMOKE-core-112 / SMOKE-core-113
- [x] sync/launch 幂等与用户资产：SMOKE-core-114
- [x] 既有五宿主回归与 staging 回滚：SMOKE-core-115
