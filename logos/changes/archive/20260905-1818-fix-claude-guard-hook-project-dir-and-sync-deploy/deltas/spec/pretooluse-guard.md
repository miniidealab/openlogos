## ADDED — Claude 宿主项目根定位与部署合同（fix-claude-guard-hook-project-dir-and-sync-deploy）

### hook 注册形态（规范性）

`.claude/settings.json` 中 OpenLogos 自有 hook 的 command **必须**使用 Claude Code 官方项目根环境变量：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/openlogos/bin/guard-check" }
        ]
      }
    ]
  }
}
```

SessionStart 同形态（`node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/openlogos-phase-launcher.cjs"` 等价写法）。本节取代早前配置示例中的相对路径 command 形态——相对形态在非项目根 cwd 会话下不可解析，属缺陷而非可选写法。

幂等注册判据必须同时识别新旧两种写法：旧相对路径条目升级迁移为新形态（不并存、不重复）；用户自有 hooks 条目字节保真。

### 工作目录收敛与 fail-closed（规范性）

guard-check 在一切文件判定之前收敛工作目录：

1. `CLAUDE_PROJECT_DIR` 在场：`cd` 至该目录；`cd` 失败 → exit 2 + 可读 reason。
2. 变量缺失（旧版 Claude Code 兼容窗口）：cwd 存在 `logos/logos.config.json` 才按 cwd 判定；否则 exit 2 + 可读 reason。
3. **禁止**把「无法确定项目根」落入「非 OpenLogos 项目 → exit 0」分支——该分支的前提是已确认某个项目根且其下无 `logos/logos.config.json`。
4. 收敛后既有判定合同逐项不变：lifecycle 判定、`logos/.openlogos-guard` 存在性、`BASH_SAFE_PATTERNS` 白名单、Edit/Write 绝对路径 realpath 归一化、阻断 reason 结构与 exit 2 语义。

### sync 部署合同（规范性）

guard 资产为 `openlogos sync` 托管资产面成员（不再仅 init/adopt 部署）：

- `guard-check` bin：asset-manifest 登记版本化哈希，缺失/漂移即落盘刷新（与 skills/AGENTS.md 同一机制）；
- PreToolUse hook 注册：复用上文幂等迁移语义。

存量项目（guard 功能上线前 init）升级 CLI 后一次 `openlogos sync` 必须补齐硬闸；重复 sync 幂等零变化。非 Claude 宿主项目不部署、不触碰 settings.json。
