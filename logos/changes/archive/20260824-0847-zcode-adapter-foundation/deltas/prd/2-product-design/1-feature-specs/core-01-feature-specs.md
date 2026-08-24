## ADDED — 2.38 公共 AI Tool Adapter Registry 与 ZCode 功能规格

### 2.38.1 目标与边界

本功能把 AI 工具集成从命令内条件分支改为能力驱动注册表。注册表负责“支持哪些宿主、各宿主能做什么、资产从哪里来、如何部署”；`init`、`adopt`、`sync`、`launch` 只负责选择 Adapter、组织事务和呈现结果。

本功能只定义本地 CLI、文件资产和 Hook 子进程协议，不引入远程 API、数据库或后台服务。

### 2.38.2 Adapter 合同

每个 Adapter 至少暴露以下不可变元数据和操作：

```ts
interface AiToolAdapter {
  id: AiToolId;
  aliases: readonly string[];
  displayName: string;
  capabilities: {
    instructions: boolean;
    skills: boolean;
    commands: boolean;
    agents: boolean;
    plugin: boolean;
    sessionStart: boolean;
    preToolUse: boolean;
  };
  resolveInstructionTarget(context: DeployContext): InstructionTarget | null;
  planAssets(context: DeployContext): readonly ManagedAsset[];
  deploy(context: DeployContext): DeployResult;
}
```

- `id` 是持久化到 `logos.config.json.aiTool` 的规范值；ZCode 的规范值为 `zcode`。
- `aliases` 只用于输入归一化，不得写回配置；不同 Adapter 的规范值和别名在大小写归一化后必须全局唯一。
- `capabilities` 是调用方分支的唯一依据。新增宿主不得要求修改四个生命周期命令的宿主名称判断。
- `planAssets` 必须先给出精确目标、所有权、冲突策略与内容哈希；全部预检通过后 `deploy` 才能写入，避免半部署。
- `DeployResult` 必须逐资产报告 `created | updated | unchanged | preserved | blocked`，供中英文输出和测试断言复用。

### 2.38.3 Registry 与配置语义

1. Registry 是 Adapter 实例的唯一注册点，并提供 `parse`、`expand`、`get`、`listDeployable` 四类查询。
2. `aiTool` 继续兼容字符串或字符串数组。解析时去重并保持首次出现顺序；空数组按既有 Cursor 默认语义处理。
3. `all` 在查询时展开为 Registry 内 `deployable=true` 的 Adapter 稳定序列；`other` 不进入展开结果。
4. `all` 不得与其它值形成第二种含义；数组含 `all` 时结果等同单独 `all`，再按稳定序去重。
5. 未知值返回结构化错误和支持值列表；任何入口不得私自回退。

### 2.38.4 ZCode 插件与指令布局

OpenLogos 的 ZCode 模板为独立随包资产，推荐结构如下：

```text
zcode-plugin-template/
├── .zcode-plugin/plugin.json
├── skills/<openlogos-skill>/SKILL.md
├── commands/<openlogos-command>.md
├── agents/<openlogos-agent>.md
└── hooks/
    ├── hooks.json
    └── runtime.mjs
```

- `.zcode-plugin/plugin.json` 是首选清单；不得只依赖 `.claude-plugin/plugin.json` 兼容回退。
- `hooks/hooks.json` 使用标准自动发现位置，不在 manifest 中重复声明同一路径。
- 插件 Hook 以 `${ZCODE_PLUGIN_ROOT}` 定位 runtime，并允许 ZCode 提供的 `CLAUDE_PLUGIN_ROOT` 兼容变量；长期状态不得写入安装目录。
- 根 `AGENTS.md` 是 ZCode 工作区指令入口。OpenLogos 只维护固定 marker 内片段，片段外用户内容逐字节保留。
- OpenLogos 方法论 Skills、Commands 与 Agents 属 OpenLogos 插件；用户自建 ZCode 插件和 `~/.zcode` 全局资产不属于同步范围。

### 2.38.5 Hook runtime 合同

共享 Node.js runtime 只实现两类领域能力：

1. `SessionStart`：读取项目根、资源索引、active guard 与 proposal step，输出 `hookSpecificOutput.hookEventName="SessionStart"` 和非空 `additionalContext`。上下文必须包含 module、slug、当前阶段和精确可写范围；读取失败时输出诊断且不得虚构阶段。
2. `PreToolUse`：把 camelCase/snake_case 输入归一化为 `{ cwd, toolName, toolInput, toolUseId }`，调用同一个 guard 决策器，再映射为 ZCode `permissionDecision`。放行返回 `allow`；阻断返回 `deny`、非空 `permissionDecisionReason` 并以退出码 2 结束。

输入只从 stdin 读取一行 JSON，stdout 只允许协议 JSON，诊断写 stderr。JSON 解析失败、事件名不匹配、路径无法规范化、项目状态解析失败或决策器异常均按 deny 处理；不得让“非 0 但可恢复的 Hook 失败”成为绕过门禁的路径。

### 2.38.6 生命周期行为

| 入口 | ZCode 行为 | 事务边界 |
|---|---|---|
| `init` | 解析 `zcode`/`all`，生成配置、根指令和完整插件资产 | 预检全部目标后写入；冲突零覆盖 |
| `adopt` | 在存量项目中合并指令并部署插件 | 保留既有 `.zcode`、用户插件和 marker 外内容 |
| `sync` | 刷新 OpenLogos 托管资产与当前 lifecycle 文案 | 全部成功后才刷新 sync 版本戳 |
| `launch` | 生成 launched 指令并刷新插件内 Skills/Commands/Agents/Hooks | normal/adopted 门禁保持既有语义；重复执行幂等 |

### 2.38.7 兼容、不变量与错误体验

- 现有四个宿主的规范值、别名、目标路径、配置合并、输出 key 和 `all` 之外行为必须由回归测试锁定。
- Adapter 只拥有 OpenLogos 托管资产；用户资产永不通过“未知文件清理”删除。
- 项目级 ZCode Hook 配置当前不执行，因此团队 guard 必须随插件分发；CLI 不得生成看似成功但不会运行的工作区 Hook 配置。
- Hook 配置在 session 启动时快照，资产刷新后的成功提示必须要求用新 session 验证，不宣称旧 session 已热更新。
- ZCode 客户端不可用不影响仓库内 UT/ST，但 staging smoke 必须标记为未满足，不能用合同测试冒充真实宿主验证。

### 2.38.8 验收摘要

- S01：`zcode` 与 `all` 解析、完整资产、冲突保护、双语输出和随包模板通过。
- S08：幂等刷新、用户资产保留、版本戳成功时机和旧配置兼容通过。
- S09：SessionStart 阶段上下文、PreToolUse allow/deny、exit 2 与 fail-closed 通过。
- S14：launched 资产刷新和既有宿主零漂移通过。
- S20：存量资产保护、配置持久化和后续 change 可达性通过。
