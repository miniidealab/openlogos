## ADDED — 2.36 ZCode 宿主选择、资产反馈与错误体验

### 2.36.1 `init` / `adopt` 选择体验

交互模式的 AI 工具列表在既有选项后增加 ZCode，并继续提供 `all`：

```text
? 选择 AI 工具：
  1. Claude Code
  2. OpenCode
  3. Codex
  4. Cursor
  5. ZCode
  6. Other
  7. All supported tools
```

非交互模式支持：

```text
openlogos init demo --locale zh --ai-tool zcode
openlogos adopt demo --locale zh --ai-tool zcode
```

非法值必须输出实际输入和由 Registry 派生的支持值列表；不得保留手写的过期枚举：

```text
Error: unsupported AI tool "z-codee".
Supported values: claude-code, opencode, codex, cursor, zcode, other, all
```

### 2.36.2 成功反馈

ZCode 部署结果逐资产显示，用户可以判断插件是否完整，而不是只看到笼统“同步成功”：

```text
✓ ZCode plugin manifest: zcode-plugin-template/.zcode-plugin/plugin.json
✓ ZCode Skills deployed: 18
✓ ZCode Commands deployed: 9
✓ ZCode Agents deployed: 2
✓ ZCode hooks deployed: SessionStart, PreToolUse
✓ AGENTS.md OpenLogos managed block updated
ℹ ZCode hooks apply to new sessions; start a new session to verify them.
```

路径展示使用相对项目根或明确的 staging 安装根，禁止输出含用户 home 的模糊截断路径。`unchanged` 资产可聚合显示，但 `preserved` 和 `blocked` 必须逐项列出原因。

### 2.36.3 `sync` 与 `launch` 反馈

`sync` 必须区分刷新、保留和失败：

```text
✓ ZCode OpenLogos plugin synced
✓ ZCode managed assets: 29 updated, 14 unchanged
ℹ Preserved user asset: <relative-path>
✓ logos/.openlogos-sync.json updated after all adapters succeeded
```

任一 Adapter 失败时不得输出总成功或刷新版本戳：

```text
✗ ZCode plugin sync blocked: target is owned by a non-OpenLogos plugin
  Path: <relative-path>
  No managed asset was overwritten; sync version stamp was not updated.
```

`launch` 对 ZCode 输出 launched 变体刷新结果，并提醒新 session 生效；已 launched 的 adopted 模块重复执行时输出 `unchanged` 汇总，不制造重复安装成功提示。

### 2.36.4 `all` 展开与兼容反馈

`--ai-tool all` 的结果按 Registry 稳定顺序展示，并明确包含 ZCode：

```text
AI tools: claude-code, opencode, codex, cursor, zcode
```

各宿主反馈按独立 Adapter 分组。一个宿主失败时，总结必须标记本次事务失败并指出是否已回滚；不得让先完成宿主的成功行掩盖后续失败。

### 2.36.5 Hook 门禁反馈

ZCode PreToolUse 拒绝消息必须包含决定、原因和可恢复动作：

```text
OpenLogos guard denied this write.
Active change: zcode-adapter-foundation
Proposal step: delta-writing
Allowed scope: logos/changes/zcode-adapter-foundation/deltas/** and tasks.md
Target: cli/src/commands/init.ts
Next action: finish and merge the planned deltas before editing source code.
```

SessionStart 上下文必须使用同一状态派生结果。若状态读取失败，反馈说明“无法安全判断，写入已阻断”，不能显示为无活跃提案或默认 writing。

### 2.36.6 非目标与可访问性

- 本节是 CLI 文本体验，不生成 GUI HTML 原型。
- 中英文输出 key 一一对应；路径、ID、命令和错误码不翻译。
- 不在成功文案中暗示 npm publish、Git tag、GitHub Release、官网发布或 git push 已完成。
