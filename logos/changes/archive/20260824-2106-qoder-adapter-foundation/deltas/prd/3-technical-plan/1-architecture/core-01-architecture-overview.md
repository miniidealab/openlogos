## ADDED — 二十九、Qoder 薄 Adapter、插件边界与 Hook 映射架构

### 29.1 组件与所有权

```text
init / adopt / sync / launch
            │
            ▼
     AiToolAdapterRegistry
            │ qoder capability
            ▼
        QoderAdapter ──planAssets──► ManagedAssetTransaction
            │                              │
            │                              ├─ AGENTS managed block
            │                              └─ qoder-plugin-template
            ▼
     Qoder Hook Wrapper
            │ normalized event
            ▼
   OpenLogos Shared Hook Runtime
      ├─ SessionContextService
      └─ GuardDecisionService
```

- Registry 拥有 `qoder` 身份、别名、capability、`all` 展开和稳定顺序。
- 生命周期命令拥有总事务、版本戳/lifecycle 提交时机与结果汇总。
- Qoder Adapter 拥有目录布局、manifest、Qoder 环境变量、事件字段与输出/退出码映射。
- 共享 runtime 独占 lifecycle、active change、`proposal_step`、路径规范化与 allow/deny 方法论事实。
- 用户拥有 Qoder settings、不同 identity 插件、未知文件和 AGENTS marker 外内容。

### 29.2 Qoder 资产模型

| 路径 | owner | 作用 |
|---|---|---|
| `.qoder-plugin/plugin.json` | Qoder Adapter | 稳定插件 identity、版本与元数据 |
| `skills/*/SKILL.md` | OpenLogos template | 方法论 Skills |
| `commands/**/*.md` | OpenLogos template | Qoder CLI Commands |
| `agents/*.md` | OpenLogos template | 必要专业 Agents |
| `hooks/hooks.json` | Qoder Adapter | SessionStart / PreToolUse 注册 |
| `hooks/runtime.mjs` | Shared runtime build | stdin/stdout 入口与领域服务桥接 |

Qoder 可从约定目录自动发现组件；若 manifest 显式声明组件，资产规划器必须保证同一路径不被重复注册。`plugin.json` 至少校验必需 `name`、合法 JSON、稳定 identity 和 CLI 同源版本。

### 29.3 Hook 启动与环境边界

- `hooks/hooks.json` 的 command 使用双引号包裹的 `${QODER_PLUGIN_ROOT}` 或 argv 形式定位 runtime，兼容含空格/元字符的安装路径。
- 不依赖 `cwd` 等于项目根或插件根；`QODER_PROJECT_DIR`/事件 `cwd` 只作为定位输入，最终项目根由共享服务按配置事实验证。
- stdin 限长读取一个 JSON 对象；stdout 仅一条协议 JSON；日志与内部错误写 stderr。
- Qoder CLI 是本案协议验收权威。IDE 差异由未来独立入口适配，不得把产品特有字段推入共享服务。

### 29.4 事件归一化与映射

Qoder 公共输入字段为 `session_id`、`transcript_path`、`cwd`、`hook_event_name`；PreToolUse 另含 `tool_name`、`tool_input`。Adapter 先校验事件名、类型与必需字段，再构造宿主无关事件。

SessionStart exit 0 输出：

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<阶段上下文>"}}
```

PreToolUse allow exit 0 输出：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}
```

PreToolUse deny 输出非空 reason，并 exit 2：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<可操作原因>"}}
```

Qoder 将其它非零退出视为非阻断错误，因此安全异常必须生成协议 deny 并采用 exit 2；不得仅抛异常或退出 1。

### 29.5 状态读取与路径安全

1. 每次 Hook 调用重新读取 guard、active slug、tasks、`proposal_step` 与必要规格，不跨调用缓存授权。
2. 文件工具目标和命令工具潜在写目标经绝对化、realpath、symlink 与工作区边界校验后再决策。
3. 未知潜在写工具、间接写盘无法可靠分类、状态矛盾或服务异常默认 deny。
4. SessionStart 可格式化当前上下文，但 PreToolUse 不信任会话快照；旧 session 也必须立即遵循最新磁盘事实。

### 29.6 资产事务与提交顺序

`planAssets` 返回目标路径、owner、内容哈希、冲突策略与权限。总流程为：

```text
plan all adapters → validate → stage → verify bytes/mode
→ atomic commit → read back → commit sync stamp/lifecycle → report
```

任一 Qoder 模板缺失、manifest/hooks/frontmatter 非法、owner 冲突、rename/读回失败都回滚本次总事务；版本戳/lifecycle 保持旧值。不得用目录镜像删除未知用户资产。

### 29.7 打包、实现与兼容边界

- npm 随包清单包含 `qoder-plugin-template/`、共享 runtime 和被声明的全部 Skills/Commands/Agents；tarball 清单是 staging 前置证据。
- 新增 Qoder Adapter 与宿主 wrapper；不修改共享 guard 判据，不在四个生命周期命令添加 Qoder 条件树。
- 现有五个宿主通过解析、资产计划、输出与 golden 回归证明零漂移。
- TRAE/TraeCode、WorkBuddy 与 Qoder IDE 特有合同不在本案实现范围。

### 29.8 架构不变量

1. Qoder Adapter 不决定阶段或权限，共享核心不解析 Qoder 专有协议。
2. 用户资产默认 preserved；只有可证明 owner 的目标可更新。
3. 所有已选 Adapter 成功后才提交 lifecycle/版本戳和全局成功。
4. hard guard 必须同时具备可观察 deny、非空原因、exit 2 与目标未变化证据。
5. 真实 tarball + 真实 Qoder CLI smoke 不得被源码合同测试替代。
