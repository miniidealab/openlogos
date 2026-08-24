## ADDED — 二十八、AI Tool Adapter Registry 与 ZCode 薄适配架构

### 28.1 组件与所有权

```text
init / adopt / sync / launch
            │
            ▼
     AiToolAdapterRegistry
       │ parse / expand / get
       │
       ├────────► Claude/OpenCode/Codex/Cursor Adapters
       │
       └────────► ZCodeAdapter
                     │ planAssets
                     ▼
              ManagedAssetTransaction
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     AGENTS.md   ZCode plugin   package manifest
                         │
                         ▼
                  Hook thin wrapper
                         │ normalized event
                         ▼
                 OpenLogos Hook Runtime
                  ├─ SessionContextService
                  └─ GuardDecisionService
```

- `AiToolAdapterRegistry` 是规范值、别名、`all` 展开和能力查询的唯一事实源。
- 生命周期命令拥有流程编排与事务边界，不拥有任何宿主名称分支。
- Adapter 只拥有协议翻译、目标布局和资产清单，不复制 OpenLogos 状态派生或 guard 判据。
- `SessionContextService` 与 `GuardDecisionService` 是宿主无关领域层；Claude Code、Codex 与 ZCode 包装器只做 stdin/stdout 和字段映射。
- `ManagedAssetTransaction` 只管理 OpenLogos 标记或清单声明的资产，禁止扫描后删除未知文件。

### 28.2 Registry 数据模型

Registry 初始化时对以下不变量 fail fast：

1. 规范 `id` 与所有 `aliases` 归一化后全局唯一。
2. 每个可部署 Adapter 有非空资产规划器和稳定排序键。
3. 声明 `sessionStart` / `preToolUse` 能力时必须同时提供 Hook 映射器和共享 runtime 入口。
4. `all` 只展开 `deployable=true` 的 Adapter，输出按注册顺序稳定并去重。
5. 配置序列化只写规范 ID，不持久化别名、displayName 或运行时 capability。

Registry 返回不可变 Adapter；测试可注入 fixture Registry，但生产入口不得动态加载项目代码作为 Adapter，避免配置文件成为任意代码执行入口。

### 28.3 资产规划与原子部署

`planAssets(context)` 返回目标相对路径、资产类型、owner、内容哈希、冲突策略与文件权限。部署采用两阶段事务：

```text
plan → validate all targets → stage temp siblings → verify bytes/mode
     → atomic rename in deterministic order → report
```

- 托管文本资产按完整 marker 合并；marker 不完整立即阻断。
- 独占插件资产必须有 OpenLogos manifest identity；同路径为非 OpenLogos owner 时阻断而非覆盖。
- 事务提交失败时，恢复已替换目标的备份；若恢复失败，返回明确残留清单并使整个入口失败。
- `sync` 的 `.openlogos-sync.json` 位于所有 Adapter 事务成功之后，不能成为单个 Adapter 的副作用。

### 28.4 ZCode Adapter

ZCode Adapter 使用独立 `zcode-plugin-template/` 随 npm 包发布，模板根至少包含：

| 路径 | 所有权 | 作用 |
|---|---|---|
| `.zcode-plugin/plugin.json` | ZCode Adapter | 插件身份、版本与组件元数据 |
| `skills/*/SKILL.md` | OpenLogos | 方法论 Skills |
| `commands/*.md` | OpenLogos | `/` 命令入口 |
| `agents/*.md` | OpenLogos | 必要的专业子智能体定义 |
| `hooks/hooks.json` | ZCode Adapter | SessionStart / PreToolUse 注册 |
| `hooks/runtime.mjs` | 共享 runtime 构建产物 | stdin/stdout 协议与领域服务入口 |

`hooks/hooks.json` 采用 ZCode 标准自动发现路径，不在 manifest 重复声明。当前 ZCode 不执行项目级 Hook 配置，因此 `.zcode/config.json` 只作为用户配置事实保留，团队 guard 必须随启用的插件运行。

### 28.5 Hook 输入归一化与输出映射

输入归一化顺序：

1. 限长读取 stdin，并要求一个 JSON 对象。
2. 对公共字段同时读取 camelCase 与 snake_case；两种字段同时出现且值冲突时 fail closed。
3. 校验 `hookEventName/hook_event_name` 与当前入口相符。
4. 将 `toolName/tool_name`、`toolInput/tool_input`、`toolUseId/tool_use_id` 规范化为内部事件。
5. 把 `cwd` 解析为真实项目根内路径；不可解析、越界或符号链接逃逸时拒绝。

SessionStart 输出：

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<阶段上下文>"}}
```

PreToolUse 阻断输出：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<非空原因>"}}
```

阻断同时使用 exit 2；允许使用 exit 0 和 `permissionDecision:"allow"`。未知异常不得仅返回其它非零码，因为 ZCode 会把其它非零视为可恢复 Hook 失败而继续处理后续 Hook；安全路径必须显式 deny。

### 28.6 状态读取与缓存边界

- 每次 Hook 调用重新读取当前项目状态，不跨调用缓存 active guard 或 proposal step。
- 单次 SessionStart 可把派生结果格式化为上下文；PreToolUse 必须重新求值，不能信任会话启动时快照。
- ZCode 会在新 session 捕获 Hook 配置快照，因此同步或 launch 后的验证必须创建新 session；领域状态仍在每次进程调用读取。
- transcript 临时路径不作为 OpenLogos 状态源，不写入长期数据。

### 28.7 打包与兼容边界

1. `cli/package.json.files` 或等价随包清单必须包含 `zcode-plugin-template/` 和共享 runtime 构建产物。
2. 构建期校验模板清单、Hooks JSON、Skills frontmatter、Commands frontmatter 和路径大小写；tarball 内容检查是 staging 部署前置。
3. 现有 Adapter 迁入 Registry 时先用 golden/快照锁定解析、路径、配置合并和输出，再移除旧分支；迁移不得改变用户可观察行为。
4. Qoder、TraeCode CLI 与 WorkBuddy 只能以后续 Adapter 加入，不在本提案注册占位实现。

### 28.8 实现映射

- 新增 Registry、Adapter 类型、资产事务和共享 Hook runtime 到 `cli/src/lib/` 的独立模块。
- `cli/src/commands/init.ts` 仅保留通用流程，并让 `adopt.ts`、`sync.ts`、`launch.ts` 复用同一部署入口。
- 新增 `plugin-zcode/` 或等价模板源，并在 CLI 构建/打包配置中注册。
- 现有 Claude/Codex Hook 包装器逐步调用共享 runtime；宿主特有字段映射保留在各 Adapter。

### 28.9 架构不变量

1. 新增宿主只新增 Adapter 与模板，不修改四个生命周期命令的宿主分支。
2. guard 决策只有一份；任何宿主包装器不得自行实现 allowlist。
3. 用户资产默认保留，OpenLogos 只更新可证明由自己拥有的目标。
4. 失败时不写成功版本戳、不输出全局成功、不以可恢复 Hook 错误代替 deny。
5. 部署验证仅限已确认的 staging tarball + 真实 ZCode，不隐式扩大为公开发布。
