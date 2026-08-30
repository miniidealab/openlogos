# Qoder 原生插件集成规范

> 版本：1.0  
> 状态：待实现  
> 适用范围：OpenLogos CLI 的 Qoder Adapter、随包 plugin、根 AGENTS 与共享 Hook runtime

## 一、目标与非目标

本规范把 Qoder CLI 定义为 OpenLogos 完整宿主：支持 init、adopt、sync、launch、`aiTool: qoder`、`all`、原生插件发现、Skills、Commands、Agents、静态记忆、SessionStart 和 PreToolUse hard guard，并由真实 tarball 与真实 Qoder CLI 验收。

非目标：

- 不实现 Qoder IDE 特有 Hook 合同、TRAE/TraeCode、WorkBuddy 或其它宿主。
- 不修改用户级 `~/.qoder/AGENTS.md`、项目 `AGENTS.local.md`、`.qoder/rules/**`、Qoder settings 或其它插件。
- 不把 AGENTS 指令当成安全门；硬阻断只能由 PreToolUse 与共享 guard 决策完成。
- 不授权公开发布、生产部署或 git push。

## 二、Adapter 与 capability

Qoder Adapter 的稳定 id 为 `qoder`，只在公共 Registry 注册。capability 至少为：

| 能力 | 值 | 交付物 |
|---|---:|---|
| instructions | true | 根 AGENTS managed block |
| skills | true | `skills/*/SKILL.md` |
| commands | true | `commands/**/*.md` |
| agents | true | `agents/*.md` |
| plugin | true | `.qoder-plugin/plugin.json` |
| sessionStart | true | `hooks/hooks.json` + runtime |
| preToolUse | true | `hooks/hooks.json` + runtime |

Registry 解析标量、数组与 `all`，返回稳定、去重集合。历史配置不含 qoder 时不得启用；`all` 必须包含 qoder；未知 id 明确报错。

## 三、随包目录与 manifest

```text
qoder-plugin-template/
├── .qoder-plugin/
│   └── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── commands/
│   └── <command>.md
├── agents/
│   └── <agent>.md
└── hooks/
    ├── hooks.json
    └── runtime.mjs
```

规范要求：

1. manifest 必须位于 `.qoder-plugin/plugin.json`，不得放在 plugin 根；至少包含 Qoder 要求的 `name`，并使用稳定 OpenLogos identity。
2. version 与 npm 包版本同源；description、author、repository 等可选元数据不得与制品事实冲突。
3. 组件默认从约定目录发现；如 manifest 显式声明 components，声明集合必须与真实文件一一对应且不得重复加载同一路径。
4. 所有 JSON、Markdown frontmatter、SKILL 目录名与路径大小写在部署前可解析；tarball 缺任一声明资产即失败。
5. plugin 安装目录不存长期方法论状态；临时/持久 plugin data 只有未来明确需求与规范后才可使用。

## 四、Skills、Commands 与 Agents

- 每个 Skill 使用 `skills/<name>/SKILL.md`，名称、描述、触发条件和语言策略与对应 OpenLogos 版本一致。
- Commands 位于 `commands/**/*.md`，不得把 merge/verify/deploy/smoke/archive/push 的人类确认点转化为隐式授权。
- Agents 位于 `agents/*.md`，只分发真实需要且能独立发现的角色；不存在的角色不得写入 AGENTS 或 manifest。
- 用户/其它插件资产保持原 identity 与命名空间，不复制进 OpenLogos plugin，不由 sync 删除。

## 五、静态记忆

Qoder CLI 默认读取根 `AGENTS.md`。OpenLogos 只维护：

```text
<!-- OPENLOGOS:BEGIN -->
<由 locale 与当前 lifecycle 生成的完整方法论片段>
<!-- OPENLOGOS:END -->
```

片段规则遵循 `spec/agents-md.md`：无 marker 追加、完整 marker 替换内部、残缺/交错/重复 marker fail loud，片段外原文不变。OpenLogos 不依赖子目录按需记忆或 Qoder rules 才能表达关键安全/流程约束。

## 六、Hooks 配置

`hooks/hooks.json` 注册：

- `SessionStart`：matcher 可覆盖 startup/resume/clear/compact/new 等适用 source。
- `PreToolUse`：matcher 覆盖 Write/Edit/Bash 等已知写工具，并确保未知潜在写工具仍进入共享安全分类。

command 使用 `"${QODER_PLUGIN_ROOT}"/hooks/runtime.mjs` 或等价 argv-safe 形式。路径含空格或 shell 元字符时仍必须作为单一参数；不得假定 `cwd` 等于项目根或插件根。

## 七、Hook 输入输出合同

公共输入：`session_id`、`transcript_path`、`cwd`、`hook_event_name`。PreToolUse 另有 `tool_name`、`tool_input`，可含关联 id。stdin 只接受一个限长 JSON 对象。

SessionStart 成功：

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<context>"}}
```

PreToolUse allow：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}
```

PreToolUse deny：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}
```

- allow/SessionStart exit 0；deny 同时 exit 2。
- stdout 只含协议 JSON，诊断写 stderr。
- Qoder 的其它非零退出为非阻断错误；安全失败必须被捕获并转换为 deny + exit 2。
- `updatedInput`、`ask` 或 PermissionRequest 不用于本提案写入授权；OpenLogos guard 只做 allow/deny。

## 八、共享 runtime 与安全

Adapter 只做协议转换；`SessionContextService` 与 `GuardDecisionService` 每次调用重新读取配置、guard、active slug、tasks、`proposal_step` 和路径事实。不得缓存 SessionStart 权限。

非法 JSON、缺字段、未知潜在写工具、路径穿越、symlink 逃逸、项目根不可信、状态矛盾或服务异常默认 deny。所有 deny 用例必须验证协议体、reason、exit 2 与目标未变化。

## 九、生命周期与所有权

| 入口 | 资产变体 | 规则 |
|---|---|---|
| init qoder/all | initial | 全量预检后原子提交 |
| adopt qoder/all | adopted + launched | 保留存量资产，成功后可直接 change |
| sync | 当前 lifecycle | 全部 Adapter 成功后写版本戳 |
| launch | launched | 全部 Adapter 成功后提交 lifecycle |

OpenLogos owner 仅包括自身 manifest identity、声明组件和 AGENTS managed block。Qoder settings、用户级/本地记忆、rules、其它 plugin 与未知文件默认 preserved；同名不同 owner 冲突 fail loud。

## 十、CLI/IDE 边界与生效

- Qoder CLI 官方插件/Hook 协议和真实 CLI smoke 是本案权威验收。
- Qoder IDE 如存在不同事件或输出合同，由独立入口在 Adapter 边界处理；共享 runtime 不感知产品字段。
- plugin/Hook 刷新后用新 Qoder CLI session 验证。旧 session 的 PreToolUse 仍按每次磁盘重读立即收紧。

## 十一、打包、验收与回滚

- npm tarball 必须包含全部模板/runtime，记录 version、大小、SHA-256 和文件清单。
- UT/ST 覆盖 S01/S08/S09/S14/S20 的 Registry、资产、事务、协议和 reporter。
- staging smoke 使用真实 tarball 与真实 Qoder CLI，覆盖 SMOKE-core-108～SMOKE-core-115。
- 失败时禁用/卸载隔离 plugin 和本次 tarball，恢复上一版本并验证用户资产哈希；不得删除未知 owner。

## 十二、权威参考

- Qoder Plugin Reference：`https://docs.qoder.com/cli/plugins-reference`
- Qoder Hooks：`https://docs.qoder.com/cli/hooks`
- Qoder Memory：`https://docs.qoder.com/cli/memory`
- 关联：`spec/agents-md.md`、`spec/pretooluse-guard.md`、D06
