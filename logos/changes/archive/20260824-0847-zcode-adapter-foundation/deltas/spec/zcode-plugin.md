## ADDED — ZCode 插件、指令与 Hook 集成规范

# ZCode 插件集成规范

> 状态：提案内新增根规范
>
> 适用范围：OpenLogos CLI 的 ZCode Adapter、随包 ZCode plugin、根 AGENTS 与共享 Hook runtime

## 1. 目标与非目标

本规范把 ZCode 定义为 OpenLogos 的完整 AI 宿主：支持 init、adopt、sync、launch、`aiTool: zcode`、`all`、插件发现、Skills、Commands、Agents、根 AGENTS、SessionStart 和 PreToolUse hard guard，并通过真实 tarball 与真实 ZCode 客户端验收。

非目标：

- 不实现 Qoder、TraeCode CLI 或 WorkBuddy Adapter。
- 不新增 HTTP/RPC API、网络服务、遥测或 Secret。
- 不覆盖用户 `.zcode/config.json`、用户级 `~/.zcode/AGENTS.md`、非 OpenLogos plugin 或根 AGENTS 托管片段外内容。
- 不依赖子目录 AGENTS、CLAUDE.md 运行时读取或项目级 ZCode hooks 配置。

## 2. 宿主身份与 Registry 契约

ZCode Adapter 的稳定 id 为 `zcode`。Adapter 必须由公共 Registry 注册，禁止由 init/sync/launch/adopt 直接硬编码分支。

能力清单至少声明：

| 能力 | 要求 |
|---|---|
| lifecycle | init、adopt、sync、launch |
| instruction | 工作区根 AGENTS managed block |
| plugin | manifest、Skills、Commands、Agents、Hooks |
| guard | SessionStart 上下文、PreToolUse allow/deny |
| locale | zh、en |
| asset ownership | OpenLogos identity、marker、已知哈希与用户保留 |

Registry 解析标量、数组与 `all`，返回去重、确定顺序的 Adapter 集合。未知 id 明确报错；历史配置不含 zcode 时不得擅自启用，`all` 的新展开必须包含 zcode。

## 3. 随包插件布局

OpenLogos npm tarball 必须包含一棵自足的 ZCode plugin 模板：

```text
plugin-zcode/
├── .zcode-plugin/
│   └── plugin.json
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
├── commands/
│   └── <command-name>.md
├── agents/
│   └── <agent-name>.md
├── hooks/
│   └── hooks.json
├── runtime/
│   ├── hook-runtime.js
│   └── ...共享运行时依赖
└── .mcp.json                 # 仅确有 MCP 依赖时存在
```

- manifest 首选 `.zcode-plugin/plugin.json`；不得只依赖 `.claude-plugin/plugin.json` 兼容回退。
- `hooks/hooks.json` 使用标准自动发现位置；manifest 不重复声明同一 Hooks。
- 每个声明资产必须随 tarball 分发，禁止指向仓库外绝对路径、开发 workspace 或安装时网络下载。
- `.mcp.json` 仅在 OpenLogos 实际提供 MCP server 时生成；本提案没有 MCP 需求时不得放置空占位。

## 4. Manifest 与 identity

`plugin.json` 必须是合法 JSON，包含稳定名称、版本、描述与 ZCode 支持的必要元数据。OpenLogos plugin identity 在所有 lifecycle 中保持一致；版本与 npm 包版本来自同一构建事实，不允许手工维护漂移。

安装/同步前校验：

1. manifest 可解析且 identity 唯一；
2. 所有被声明目录和入口存在于 tarball；
3. Hook 命令能用 plugin root 环境定位 runtime；
4. Markdown frontmatter、hooks JSON 和可执行入口合法；
5. 目标存在不同 owner 时默认阻断，不覆盖或改名规避。

## 5. Skills

- 每个方法论 Skill 位于 `skills/<name>/SKILL.md`，内容与 OpenLogos 对应版本一致，名称和描述可被 ZCode 发现。
- Skill 文档必须保留 OpenLogos Why→What→How、Delta 和确认点约束；宿主适配不得弱化方法论。
- OpenLogos 只管理自身 plugin 内 Skills。用户或其它 plugin 的 Skills 保留原 owner、路径和命名空间。
- sync 只更新随包声明的 OpenLogos Skill，不扫描吸收项目自建 Skill。

## 6. Commands

- Commands 位于 `commands/<name>.md`，frontmatter 和正文符合 ZCode 当前格式。
- initial/launched 可有不同正文变体，但用户可见名称保持稳定；launched 变体必须表达 change/guard/verify/deploy/smoke/archive 人类确认点。
- Command 只提供指导或调用已存在的 OpenLogos 能力，不复制方法论状态机，也不绕过 CLI 门禁。
- 需要真实人类授权的动作不得因为从 ZCode Command 触发而自动获得授权。

## 7. Agents

- Agents 位于 `agents/<name>.md`，只打包本版本真实实现和测试覆盖的角色。
- Agent 说明必须明确输入、输出和允许范围；不得授予超出当前 `proposal_step` 的写权限。
- 无独立角色需求时允许目录为空或不生成该项，但 manifest/AGENTS 不得引用不存在的 Agent。

## 8. 根 AGENTS

ZCode 项目指令使用工作区根 `AGENTS.md`。OpenLogos 只管理以下 marker 内内容：

```markdown
<!-- OPENLOGOS:BEGIN -->
[由 locale、lifecycle、proposal_step 与 Registry 生成的自包含指令]
<!-- OPENLOGOS:END -->
```

合并、大小写变体、语言、用户内容保护和 Skill 分组遵循 `spec/agents-md.md`。生成内容不能要求 ZCode 扫描子目录 AGENTS 或持续读取 CLAUDE.md；用户级 `~/.zcode/AGENTS.md` 不由项目 CLI 修改。

## 9. Hooks 配置

`hooks/hooks.json` 至少注册：

- `SessionStart`：调用共享 runtime 的 session 入口，输出当前 lifecycle、active change、`proposal_step`、允许范围和下一确认点。
- `PreToolUse`：匹配所有可能写盘的工具入口，调用共享 runtime 的 guard 入口。

Hook 命令必须以 Node.js 可移植方式执行，并使用 `ZCODE_PLUGIN_ROOT` 或 ZCode 提供的等价 plugin root 变量解析文件。不得假定 shell 当前目录等于项目根或插件根。

项目 `.zcode/config.json` 不是本 plugin 的 Hook 分发位置：OpenLogos 不写入该文件，也不把其中 hooks 当作团队门禁已安装的证据。

## 10. Hook 输入、输出与错误

### 输入

stdin 为单行 JSON。Adapter 接受 ZCode camelCase 与 Claude 兼容 snake_case alias，按 `spec/pretooluse-guard.md` 归一化。冲突别名、损坏 JSON、未知潜在写工具或不可信路径 fail-closed。

### SessionStart 输出

使用 `hookSpecificOutput.additionalContext` 或 ZCode 当前官方等价结构。stdout 只包含协议 JSON；诊断写 stderr。

### PreToolUse 输出

- allow：`permissionDecision: "allow"`，exit 0。
- deny：`permissionDecision: "deny"` 加可操作 reason，exit 2。
- runtime/解析/状态异常：按 deny 输出并 exit 2；不得只用一般非零退出，因为它可能被宿主视为可恢复 Hook 故障。

SessionStart 上下文不是授权缓存。每次 PreToolUse 都从磁盘重新解析 guard 与 `proposal_step`，路径经规范化和 symlink 解析后交给共享 Guard Decision Service。

## 11. 生命周期资产矩阵

| 入口 | 资产变体 | 必须保持的事务语义 |
|---|---|---|
| init zcode | initial | 配置、logos、AGENTS、plugin 全量预检后提交 |
| init --ai-tool zcode | 当前模块 lifecycle | 只补齐 ZCode，保留已部署宿主和用户资产 |
| adopt zcode | adopted + launched | 直接选择 launched 变体；接入后可直接 change |
| sync | 当前 lifecycle | 幂等刷新 managed 资产；全部成功后才写版本戳 |
| launch | launched | 所有 Adapter 资产成功后才提交 lifecycle |

每次结果区分 installed/updated/unchanged/preserved/blocked。未知文件绝不通过目录镜像删除。任一预检或写入失败回滚本次编排单元，不输出完成文案。

Hook/插件配置按 ZCode 新 session 快照生效；部署、sync、launch 后必须提示重开 session。旧 session 的 PreToolUse 仍按最新磁盘事实决策，不能依赖启动时缓存放宽权限。

## 12. 打包与安装证明

- `npm pack` 文件清单必须包含本规范第 3 节的全部实际资产、共享 runtime 及所需双语模板。
- 模板完整性测试从打包目录或 tarball 清单读取，禁止只验证源码树。
- staging 必须从真实 tarball 安装 CLI，再由其部署 plugin；禁止 npm workspace link 代替。
- 记录 tarball 版本、大小、SHA-256、真实 CLI 路径、ZCode 版本、plugin identity 和资产清单。

## 13. 测试与验收

- UT/ST：S01、S08、S09、S14、S20 对应测试规范中的新增 ID，全部写 OpenLogos reporter。
- 协议测试：字段 alias、冲突、stdout/stderr、allow、deny、exit 2、runtime failure、路径与 symlink 逃逸。
- 资产测试：manifest/frontmatter/hooks JSON、owner、用户保留、幂等、rollback、tarball completeness。
- staging smoke：SMOKE-core-100～SMOKE-core-107，真实 ZCode 客户端和新 session 必需。
- 兼容性：Claude Code、OpenCode、Codex、Cursor 的选择、资产与结果契约必须回归通过。

## 14. 安全与发布边界

- Hook runtime 只读取项目内 OpenLogos 状态并执行既有 guard 决策，不新增网络访问、遥测、Secret 或生产权限。
- 日志脱敏，不输出事件内容中的潜在凭据；错误报告精确到规则和路径，但不泄露工作区外内容。
- 本提案只允许未来经授权的 staging tarball 与真实 ZCode 验证，不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。

## 15. 规范来源

- ZCode Plugin 文档：`https://zcode.z.ai/en/docs/plugin`
- ZCode Hooks 文档：`https://zcode.z.ai/en/docs/hooks`
- ZCode Agents/AGENTS 文档：`https://zcode.z.ai/en/docs/agents`
- OpenLogos 关联规范：`spec/agents-md.md`、`spec/pretooluse-guard.md`、`logos/spec/test-results.md`
