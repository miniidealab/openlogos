## ADDED — 公共 AI Tool Adapter 与 ZCode 完整宿主集成需求

### 用户价值

OpenLogos 使用者应能像选择 Claude Code、OpenCode、Codex 或 Cursor 一样，在 `init`、`adopt`、`sync` 与 `launch` 中选择 ZCode，并获得同等级的 OpenLogos 指令、Skills、Commands、插件 Hook、阶段上下文和写入门禁。新增宿主不得要求用户理解 OpenLogos 内部的条件分支，也不得改变既有宿主的可观察行为。

### 公共能力要求

1. AI 工具标识必须新增规范值 `zcode`；标量、数组和 `all` 三种配置形态均须支持，`all` 必须稳定展开为所有可部署宿主且不包含 `other`。
2. 工具解析、别名归一化、能力声明、资产来源、部署目标、指令生成和生命周期刷新必须由单一 Adapter Registry 驱动；`init`、`adopt`、`sync`、`launch` 不得继续各自维护宿主枚举分支。
3. 每个 Adapter 必须显式声明是否支持 instructions、skills、commands、agents、plugin、SessionStart 与 PreToolUse；调用方只消费能力，不根据宿主名称推断能力。
4. 现有 `claude-code`、`opencode`、`codex`、`cursor`、`other` 以及历史单值配置必须保持兼容；未知工具仍 fail loud，不得静默回退到 Cursor。

### ZCode 资产与协议要求

1. ZCode 插件必须使用 `.zcode-plugin/plugin.json` 作为首选清单，并提供 `skills/<name>/SKILL.md`、`commands/*.md`、必要的 `agents/*.md` 与自动发现的 `hooks/hooks.json`；不得把项目级 `.zcode/config.json` 当作团队 Hook 分发入口。
2. 根 `AGENTS.md` 继续通过 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 托管片段维护。ZCode 仅保证读取工作区根 `AGENTS.md`，因此所有关键方法论约束必须在该托管片段内自足，不依赖子目录 AGENTS、`@include` 或 `CLAUDE.md`。
3. SessionStart 与 PreToolUse 必须由插件 Hook 调用宿主无关 Node.js runtime。输入同时接受 ZCode camelCase 与 Claude Code snake_case 别名；输出使用 ZCode `hookSpecificOutput` 协议。
4. PreToolUse 拒绝必须同时返回 `permissionDecision: "deny"` 与非空原因，并以退出码 2 形成阻断捷径；输入非法、项目状态不可判定或 guard 求值异常时必须 fail closed，不能以 Hook 可恢复失败绕过写入门禁。
5. 插件安装目录与用户配置、项目自有 Skills/Commands/Agents 必须分属不同所有权边界；同步只能更新 OpenLogos 托管资产，不得删除、覆盖或吸收用户资产。

### 场景验收条件

#### S01 初始化

- `--ai-tool zcode` 能生成 `logos.config.json`、根 `AGENTS.md` 托管片段、ZCode 插件清单、Skills、Commands、Agents 与 Hooks；输出逐项报告目标路径。
- `--ai-tool all` 包含 ZCode 且重复执行幂等；既有四个宿主的路径、文案和资产字节语义保持兼容。
- 任一托管 marker 不完整或 ZCode 目标路径与用户资产冲突时，初始化在覆盖前失败，并列出冲突路径。

#### S08 同步

- `sync` 依据 Adapter Registry 刷新 ZCode OpenLogos 资产与 launched/initial 指令变体，保留插件目录内非 OpenLogos 文件及根 `AGENTS.md` 托管片段外内容。
- 同步成功后才刷新 `.openlogos-sync.json`；ZCode 资产复制、Hook 配置或原子替换任一步失败时，版本戳保持原值。

#### S09 变更生命周期

- 新 ZCode session 的 SessionStart 能注入当前 module、active change、proposal step 和该阶段可写范围；已有会话不要求热刷新，资产更新后以新 session 验证。
- PreToolUse 对 Write/Edit/Bash 等写入工具执行与现有 guard 相同的 proposal-step allowlist；无 guard、越界目标、路径解析失败和状态解析失败均不得放行。

#### S14 launched 刷新

- `launch` 通过注册表选择 ZCode Adapter，刷新 launched 指令、Skills、Commands、Agents 和插件 Hook；normal/adopted 既有门禁语义不变。
- 已 launched 的 adopted 模块重复执行时幂等收敛，不复制 Hook、不重复注册插件、不改变用户资产。

#### S20 存量接入

- `adopt --ai-tool zcode` 在保留既有根 `AGENTS.md`、`.zcode` 配置与用户插件资产的前提下部署 OpenLogos ZCode 插件，并继续直接引导首个 change。
- 大小写变体、残缺托管 marker、同名非 OpenLogos 插件和不可写目标必须在写入前诊断；失败不得留下半部署插件或伪造接入完成信息。

### 部署与非目标

- 本能力必须经 staging 真实 npm tarball 安装和真实 ZCode 客户端新 session 验证；smoke 覆盖插件发现、Skills/Commands、SessionStart、PreToolUse deny、幂等同步和既有宿主回归。
- 不涉及数据库迁移，不新增 HTTP/RPC/消息 API。
- 本提案不实现 Qoder、TraeCode CLI 或 WorkBuddy，也不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。
