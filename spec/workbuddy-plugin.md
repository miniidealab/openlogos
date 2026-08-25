# WorkBuddy 原生插件集成规范

### 1. 目标与边界

本规范定义 OpenLogos WorkBuddy 薄 Adapter 的原生插件、组件、Hook、记忆隔离、生命周期和真实宿主验收合同。规范 id 为 `workbuddy`；Adapter 不实现 OpenLogos 状态机，只映射宿主协议与资产布局。

### 2. 插件身份与布局

`0.13.28` 随包模板必须包含：

```text
workbuddy-plugin-template/
├── .workbuddy-plugin/plugin.json
├── skills/<openlogos-skill>/SKILL.md
├── commands/<openlogos-command>.md
├── agents/<openlogos-agent>.md
└── hooks/
    ├── hooks.json
    └── runtime.mjs
```

1. `.workbuddy-plugin/plugin.json` 是原生 manifest，包含稳定 OpenLogos identity；版本与 CLI package 同源。
2. Skills、Commands、Agents 与 Hooks 使用 WorkBuddy/CodeBuddy Plugin Technical Reference 支持的目录和元数据；同一组件不得被约定目录与显式声明重复加载。
3. Hook 只在 `hooks/hooks.json` 注册，不写入 Skill/Command/Agent frontmatter。
4. Hook 命令通过 `${CODEBUDDY_PLUGIN_ROOT}` 定位同一插件内 runtime，不硬编码 staging、home 或仓库路径。
5. tarball 清单是部署资产事实；运行时不得从源码树补齐缺失文件。

### 3. capability 合同

```json
{
  "id": "workbuddy",
  "displayName": "WorkBuddy",
  "capabilities": {
    "instructions": true,
    "skills": true,
    "commands": true,
    "agents": true,
    "plugin": true,
    "sessionStart": true,
    "preToolUse": true
  }
}
```

- Registry 独占 parse、expand、stable order、alias 冲突和支持列表。
- `all` 显式包含 WorkBuddy 并排除 `other`；历史配置未选择时不自动部署。
- lifecycle 命令只消费 capability 和 `planAssets`，不得判断 `tool === "workbuddy"`。

### 4. 所有权与记忆

| 对象 | owner | OpenLogos 行为 |
|---|---|---|
| OpenLogos plugin identity 与托管组件 | OpenLogos | 清单级原子创建/更新/回滚 |
| WorkBuddy settings 与 permissions | 用户/宿主 | 不覆盖；冲突时只读诊断 |
| 其它插件、项目自有资产、未知文件 | 用户/项目 | preserved；禁止目录镜像删除 |
| WorkBuddy 原生记忆 | 用户/宿主 | 不读取正文、不写入、不清空、不迁移、不用于授权 |

记忆零写入通过不透明边界证据验证，证据不得泄露记忆内容。OpenLogos 的权威动态事实只来自项目磁盘、guard、tasks 和资源索引。

### 5. 生命周期与事务

| 入口 | 规划内容 | 提交条件 |
|---|---|---|
| `init` | initial 静态指令与完整插件 | 全量预检、暂存、读回成功 |
| `adopt` | adopted + launched 指令与插件 | 用户边界 preserved，总事务成功 |
| `sync` | 当前 lifecycle 托管资产 | 全部 Adapter 成功后写同步版本戳 |
| `launch` | launched 指令、组件和 Hook | 全部 Adapter 成功后写 lifecycle |

任一模板、owner、marker、manifest、Hook、写入或读回失败时总事务回滚；结果分类为 `created|updated|unchanged|preserved|blocked`。

### 6. SessionStart 合同

1. 从 stdin 读取一个限长 JSON 事件并校验事件名、cwd 和会话字段。
2. 调用共享 `SessionContextService`，从磁盘派生 module、lifecycle、active slug、`proposal_step`、精确可写范围和下一确认点。
3. stdout 只输出协议 JSON：`hookSpecificOutput.hookEventName="SessionStart"` 和非空 `additionalContext`；成功 exit 0，诊断写 stderr。
4. 不读取原生记忆，不把上下文缓存为授权；状态不可判定时不得虚构事实。

### 7. PreToolUse 合同

1. 归一化 `Write`/`Edit`/`Bash`、`write_to_file`/`replace_in_file`/`execute_command` 和官方字段别名。
2. 对所有候选路径执行 realpath/symlink/项目边界检查，命令工具识别直接与间接写盘。
3. 每次调用共享 `GuardDecisionService` 重读磁盘状态。
4. allow 输出 `permissionDecision="allow"`、`continue=true`、exit 0；deny 输出 `permissionDecision="deny"`、`continue=false`、非空 reason、exit 2。若官方协议要求 `continue` 与 hard deny 采用其它组合，以“工具绝不执行”为不变量并由真实宿主证明。
5. 非法输入、未知潜在写工具、路径/状态/决策异常 fail-closed；stdout 不混日志，exit 1 不算安全阻断。

### 8. 版本、安装与真实宿主兼容

- 目标 OpenLogos 版本为 `0.13.28`，只构建真实 npm tarball 并安装到隔离 staging，不公开发布。
- 真实 WorkBuddy 最低版本为 5.3.5；部署前探测版本、插件发现和扩展 Hook capability。
- 安装/启用必须引用 tarball 产物；刷新后启动新 session 验证插件、组件和 SessionStart。
- 合同 UT/ST 不能替代真实 WorkBuddy allow/deny 与 exit code smoke。

### 9. 安全与兼容不变量

1. Adapter 不自行决定方法论阶段或 allowlist；核心不解析 WorkBuddy 专有字段。
2. 静态指令、SessionStart 和原生记忆均不能授权写入。
3. 未知 owner 保留，未知潜在写操作阻断；失败不得留下半套插件或已提交版本戳/lifecycle。
4. 未选择 WorkBuddy 的历史配置和 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder 行为保持不变。
5. 日志/reporter 脱敏，不写凭据、真实用户配置或原生记忆正文。

### 10. 权威参考

- WorkBuddy Plugins：`https://www.codebuddy.cn/docs/workbuddy/Plugins`
- CodeBuddy Plugin Technical Reference：`https://www.codebuddy.cn/docs/cli/plugins-reference`
- WorkBuddy Memory：`https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory`
- CodeBuddy Hooks：`https://www.codebuddy.cn/docs/cli/hooks`
- CodeBuddy Permissions：`https://www.codebuddy.cn/docs/cli/permissions`
- WorkBuddy Changelog：`https://www.codebuddy.cn/docs/workbuddy/Changelog`
