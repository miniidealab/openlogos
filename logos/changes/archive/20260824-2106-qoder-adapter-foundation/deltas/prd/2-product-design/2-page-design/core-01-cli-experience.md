## ADDED — 2.37 Qoder 宿主选择、执行反馈与错误体验

### 2.37.1 `init` / `adopt` 选择

交互列表由 Registry 枚举，在既有 ZCode 后增加 Qoder，并保留 Other 与 All：

```text
? 选择 AI 工具：
  Claude Code
  OpenCode
  Codex
  Cursor
  ZCode
  Qoder
  Other
  All supported tools
```

非交互入口接受 `--ai-tool qoder`。非法值必须回显实际输入，并从 Registry 派生支持列表：

```text
Error: unsupported AI tool "qoder-cli-x".
Supported values: claude-code, opencode, codex, cursor, zcode, qoder, other, all
```

### 2.37.2 逐资产成功反馈

```text
✓ Qoder plugin manifest: .qoder-plugin/plugin.json
✓ Qoder Skills deployed: <count>
✓ Qoder Commands deployed: <count>
✓ Qoder Agents deployed: <count>
✓ Qoder hooks deployed: SessionStart, PreToolUse
✓ AGENTS.md OpenLogos managed block updated
ℹ Qoder plugin and hook configuration applies to new CLI sessions; start a new session to verify.
```

`unchanged` 可聚合；`preserved`、`blocked` 必须逐项显示相对项目根或明确 staging 根的路径与原因，不泄露用户 home 的无关部分。

### 2.37.3 `sync` / `launch` 反馈

```text
✓ Qoder OpenLogos plugin synced
✓ Qoder managed assets: <updated> updated, <unchanged> unchanged
ℹ Preserved Qoder user asset: <relative-path>
✓ Sync version stamp updated after all adapters succeeded
```

任一 Adapter 失败时输出失败宿主、精确目标、回滚结论和未提交事实；不得打印总成功、刷新版本戳或提交 lifecycle：

```text
✗ Qoder plugin sync blocked: target is owned by a non-OpenLogos plugin
  Path: <relative-path>
  Managed changes were rolled back; the sync version stamp was not updated.
```

`launch` 成功后说明 launched 资产已刷新并要求新 session；adopted + launched 重复执行以 `unchanged` 收敛，不伪造重复安装。

### 2.37.4 `all` 展开与事务摘要

```text
AI tools: claude-code, opencode, codex, cursor, zcode, qoder
```

输出按 Adapter 分组且顺序稳定。任一宿主失败时，总结必须标记整个事务失败及回滚状态，不能让先完成的成功行掩盖后续失败。

### 2.37.5 Hook 门禁反馈

Qoder deny 的用户可见理由须包含事实和恢复动作：

```text
OpenLogos guard denied this write.
Active change: qoder-adapter-foundation
Proposal step: delta-writing
Allowed scope: logos/changes/qoder-adapter-foundation/deltas/** and tasks.md
Target: cli/src/commands/init.ts
Next action: finish the planned deltas, then explicitly authorize merge.
```

状态读取失败时显示“无法安全判断，写入已阻断”，不得伪装成无 guard 或默认 writing。SessionStart 与 PreToolUse 使用同一磁盘事实，但 SessionStart 文案不构成授权。

### 2.37.6 非目标与可访问性

- 本节是 CLI 文本体验，不生成 GUI HTML 原型。
- 中英文结构 key 一致；路径、ID、命令、协议字段与错误码不翻译。
- 不承诺 Qoder IDE 与 CLI 的产品特有输出完全一致。
- 成功文案不得暗示 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 git push 已完成。
