## Cursor 插件集成规范

> 权威定义 OpenLogos 在 Cursor 宿主（cursor-agent CLI 与 Cursor IDE 共享项目配置）上的三件套资产布局、hooks 合并算法、托管 `.mdc` 迁移与能力子集契约。生成与部署行为由 `cli` 实现，测试锚定本规范。

### 1. 目标与非目标

- 目标：cursor 宿主获得与 claude-code / codex / opencode 等同级的 `assets: ['agents', 'plugin', 'hooks']` 集成——原生 Agent Skills、显式命令 Skills、change-reviewer subagent、sessionStart 上下文注入与部分强度写入门禁（shell 事前轻判 + `afterShellExecution` 事后检查，文件编辑 `afterFileEdit` 事后检测）。
- 目标：保护对象与 Claude Code 一致——对同一路径、同一 git 状态给出相同的「是否受保护」结论（判据见 `spec/pretooluse-guard.md`「版本控制内容保护与事后检查（规范性）」，共享同一组测试向量）。
- 非目标：不实现 Cursor IDE 专属配置，不接入 Cursor `preToolUse`（IDE 与 CLI 共用同一 `hooks.json`，文件编辑在两者下都只有 `afterFileEdit` 事后报告；IDE preToolUse 接线另行立案）；不读取或迁移用户 Cursor 全局配置（`~/.cursor/**`）；不提供 marketplace 式插件打包（Cursor 无对应机制，资产直接落项目目录）。

### 2. 宿主身份与 Registry 契约

- 规范 id：`cursor`；display name：`Cursor`；不新增别名。
- capability：`assets: ['agents', 'plugin', 'hooks']`，`instructions=true`、`skills=true`、`commands=true`、`agents=true`、`sessionStart=true`、**`preToolUse=false`**。
- **capability honesty（D09）**：声明必须与宿主实测能力一致。`preToolUse=false` 表达 OpenLogos 未接入 `preToolUse`：cursor-agent CLI hook 事件子集（2026-04 官方口径：`sessionStart` / `beforeShellExecution` / `afterShellExecution` / `afterFileEdit` / `postToolUse` / `stop`）不含该事件，Cursor IDE 虽可能支持，但 OpenLogos 不注册，IDE 下同样不存在 OpenLogos 的事前编辑硬拦。staging 部署必须以真实宿主实测覆盖面并记录。若未来接入 `preToolUse`，capability 更新走独立提案。
- **宿主支持 ≠ 插件已接入**：阻断能力只按 `CURSOR_HOOK_EVENTS` 中已接入、且经真实宿主实测的事件声明。本规范当前接入的事件为 `sessionStart`、`beforeShellExecution`、`afterShellExecution`、`afterFileEdit`（见 §7）。
- `all` 展开按 Registry 稳定顺序包含 `cursor`、排除 `other`；空 `aiTool` 数组的既有 cursor 默认语义不变。

### 3. 随包资产模板布局

```text
cursor-plugin-template/
├── skills/<openlogos-skill>/SKILL.md          # 13 项方法论 Skills
├── commands/<openlogos-command>/SKILL.md      # 显式命令 Skills（disable-model-invocation: true）
├── agents/change-reviewer.md                  # Cursor subagent
└── hooks/
    ├── hooks.json                             # OpenLogos 托管条目模板
    └── runtime.mjs                            # 共享 Node.js hook runtime 的 cursor 接线
```

事后检查引擎不在 cursor 模板内另存源：包内唯一源是 `plugin/bin/guard-post-check.cjs`，cursor-adapter 部署时把同一份字节复制为项目内 `.cursor/hooks/openlogos-guard-post.cjs`；资产身份以与 `plugin/bin/guard-post-check.cjs` 的哈希一致为准，缺失或漂移由 `sync` 刷新。

npm 随包校验：源码模板存在但 tarball 缺任一声明资产（含 `plugin/bin/guard-post-check.cjs`）时，构建 / 部署预检失败。

### 4. Skills

- 部署目标：`.cursor/skills/<name>/SKILL.md`。
- frontmatter：`name`（与目录名一致，小写连字符）、`description`（非空）为必填；命令形式 Skills 另带 `disable-model-invocation: true`。
- 内容语言遵循项目 `locale`；frontmatter 非法（缺字段、name 与目录不一致）时部署前失败。
- OpenLogos 只拥有自身 Skill 名单内的目录；用户自有 `.cursor/skills/` 目录一律保留，同名冲突（目标目录含非 OpenLogos 内容）在首个写入前 blocked。

### 5. 显式命令与 subagent

- OpenLogos commands（next / status / change / merge / verify / archive 等）以 `disable-model-invocation: true` Skills 表达，用户以 `/<name>` 显式触发；不部署 legacy `.cursor/commands`。
- change-reviewer 以 Cursor subagent 部署到宿主约定的项目级 agents 目录；frontmatter 校验规则同 Skills。

### 6. 根 AGENTS

- `AGENTS.md` managed block 生成规则见 `spec/agents-md.md`「Cursor 原生 Skills、hooks 托管条目与部分强度门禁生成规则」。
- 托管段必含 guard 强度说明行，不得省略。该行如实声明：Cursor（IDE 与 cursor-agent CLI）下写入门禁为部分强度——shell 命令经 `beforeShellExecution` 事前轻判（保护范围变更命令需宿主审批）并经 `afterShellExecution` 事后检查，文件编辑经 `afterFileEdit` 事后检测；OpenLogos 未接入 `preToolUse`，不提供事前编辑硬拦。不得出现「Cursor IDE 经同一 hooks.json 获得完整 preToolUse 硬拦」或其它把 Cursor 表述为与 claude-code 等价的说法；`cli/src/lib/cursor-adapter.ts` 中的托管文案与 sessionStart 注入文案同口径更正。

### 7. hooks.json 合并算法

`.cursor/hooks.json` 是用户共享文件，禁止整文件事务替换：

1. 不存在 → 创建 `{"version": 1, "hooks": {...托管条目}}`。
2. 存在 → JSON 解析；失败即 fail loud（报告精确路径，零写入）。
3. 托管条目身份 = 托管 command 路径；增改仅限托管条目，用户条目与未知字段原样保留（读回字节级校验）。
4. 同目录临时文件 + rename 原子落盘；重复执行零 diff；卸载 / 回滚仅移除托管条目。

实际部署哪些事件由 `cli/src/lib/cursor-adapter.ts` 的 `CURSOR_HOOK_EVENTS` 决定（只改模板 `plugin-cursor/hooks/hooks.json` 不会部署新事件），二者必须同步：`CURSOR_HOOK_EVENTS` = `['sessionStart', 'beforeShellExecution', 'afterShellExecution', 'afterFileEdit']`。存量项目经一次 `sync` 补齐 `afterShellExecution` 托管条目，重复 `sync` 零 diff。

托管条目（四条）：

| 事件 | 托管 command | 用途 |
|---|---|---|
| `sessionStart` | `node .cursor/hooks/openlogos-runtime.cjs session` | 阶段上下文注入（SessionContextService），并接管未关闭执行记录、注入待报告项 |
| `beforeShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell` | shell 事前轻判（GuardDecisionService）：受限命令 `permission: ask`、可确定的受保护写入目标 deny，其余 allow 并调用引擎 `snapshot` |
| `afterShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell-after` | shell 事后检查：调用引擎 `check` 对比执行前后的受保护内容 |
| `afterFileEdit` | `node .cursor/hooks/openlogos-runtime.cjs edit` | 越界编辑事后检测报告（GuardDecisionService） |

### 8. Hook 输入、输出与错误

- 输入：Cursor stdin JSON（snake_case 字段）；适配层归一化后交共享服务，字段映射与判定契约见 `spec/pretooluse-guard.md`「Cursor hooks 部分强度门禁适配合同」。
- runtime 接受四种模式：`session`（`sessionStart`）、`shell`（`beforeShellExecution`）、`shell-after`（`afterShellExecution`）、`edit`（`afterFileEdit`）；模式与输入中的 `hook_event_name` 不一致时按该模式的 fail-closed 行为处理。
- `sessionStart` 输出：stdout JSON 注入 module、active change、`proposal_step`、可写范围、下一确认点与待报告项；CLI 不可用或项目未初始化时输出空对象。输出不构成写入授权。
- **快照关联**：`shell` 模式在放行前调用引擎 `snapshot` 建立执行记录，`shell-after` 模式调用引擎 `check` 做最终对比并关闭同一记录。关联键优先使用宿主输入中唯一标识单次 shell 调用的字段；宿主只提供 `generation_id` 时，以 `generation_id` + 命令文本 SHA-256 作为关联键，且仅当真实宿主实测证明同一 generation 内不会并发执行字面相同的命令时采用；拿不到可靠标识时建立匿名记录，不按「最近一次」猜测关联（匿名记录不被任何结束事件关闭，长期保留并持续对比）。执行记录生命周期、提案边界与去重与 Claude Code 共用同一合同（`spec/pretooluse-guard.md`「执行记录生命周期」「提案边界」）。
- **反馈渠道（以真实宿主实测为准）**：`afterShellExecution` 发现受保护变化时输出检测报告。宿主能否把该输出注入 agent、退出码能否阻断后续动作，由 staging 真实宿主实测确定并记录在 smoke 报告中；实测证明之前，Cursor 下 Bash 事后检查一律按事后报告（observe-only）声明，报告固定声明「本次 shell 命令已执行，以下改动未被阻断，请核查并按需回滚或先立案」。未能当场送达的变化写入待报告项，经实测可行的渠道补送：下一次 `beforeShellExecution` 的 `agent_message`（不改变 permission 结论）与下一次 `sessionStart` 注入。
- **保护范围变更受限命令**：`openlogos exempt add|remove`、`openlogos ignore add|remove` 在 `beforeShellExecution` 返回 `{"permission": "ask", "user_message": "...", "agent_message": "..."}`，由宿主对这一次 shell 调用弹出审批。宿主是否在自动运行等模式下仍弹出审批，以真实宿主实测为准：实测能保证弹出的模式返回 `ask`；不支持 `ask`、或实测不能保证弹出的模式改为 deny，并把实测结论（逐模式）记入本节与 smoke 报告。复合形态一律 deny。guard 不使用任何本地凭据文件代替宿主审批。
- 门禁输出与 fail-closed 行为以 `spec/pretooluse-guard.md` 的 Cursor 合同为唯一权威，本规范不复制。

### 9. 托管 .mdc 迁移

- 迁移清单 = OpenLogos Skill 名单派生的 `<skill>.mdc` + `openlogos-policy.mdc`，逐文件精确匹配，禁止通配删除。
- 顺序不变量：Skills 事务成功 → hooks 合并 → `.mdc` 清理；任何失败路径不提前删除。
- 清单项已被用户删除 / 改名时跳过并如实报告；用户自有 `.cursor/rules/` 文件永不触碰。
- CLI 反馈逐项报告清理与保留结果。

### 10. 生命周期资产矩阵

| 入口 | Skills/subagent | hooks 托管条目 | .mdc 迁移 | 版本戳/lifecycle |
|---|---|---|---|---|
| `init` | 部署 | 合并写入 | 清理（如有历史） | 全部成功后写配置 |
| `adopt` | 部署（冲突预检） | 合并写入 | 清理 | 全部成功后持久化 aiTool |
| `sync` | 幂等刷新 | 幂等合并 | 清理（迁移完成点） | 全部 Adapter 成功后刷新 |
| `launch` | launched 版刷新 | 幂等合并 | 清理（如未迁移） | 全部成功后提交 lifecycle |

任一步失败：目录事务回滚、hooks 回退或零写入、`.mdc` 保留——不留半套资产。

### 11. 打包与安装证明

- 真实 `npm pack` 产物必须含 cursor-plugin-template 全部资产、`plugin/bin/guard-post-check.cjs` 与本规范；从解包 tarball（非 workspace）核对。
- staging 验收必须使用真实 cursor-agent CLI 新 session：Skills 发现、`/<command>` 触达、sessionStart 注入、门禁 allow/deny/ask/检测、hook 事件覆盖面实测记录。mock 或直接调用 runtime 不计入闭环证据。
- `afterShellExecution` 必须在真实宿主上实测并记录：事件是否触发、输入中可用于关联的调用标识字段、输出能否注入 agent、退出码能否阻断后续动作、`permission: ask` 是否弹出审批。实测结论记入 smoke 报告；任一项测不出时按本规范 §8 的降级声明执行，不得在任何面向用户的表述中扩大承诺。
- 部署后的 `.cursor/hooks.json` 必须含 `afterShellExecution` 托管条目，`.cursor/hooks/openlogos-guard-post.cjs` 与 `plugin/bin/guard-post-check.cjs` 哈希一致。

### 12. 测试与验收

- UT/ST：UT-S01-129～136、ST-S01-27～29；UT-S08-51～58、ST-S08-34～36；UT-S09-293～302、ST-S09-112～115；UT-S14-18～21、ST-S14-25～26；UT-S20-43～48、ST-S20-23～25。
- smoke：SMOKE-core-182～189（见 `logos/resources/test/smoke/core-smoke-test-cases.md`）。
- 全部测试经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl` / `smoke-results.jsonl`。

### 13. 安全与发布边界

- OpenLogos 在任何入口下只读改删自身托管资产；用户 `.cursor/**` 其余内容不读取、不写入、不迁移。
- 本集成不授权 npm publish、Git tag、GitHub Release、官网部署或 `git push`。

### 14. 规范来源

- 提案：cursor-adapter-parity；决策：core-D09（capability honesty 与部分强度边界）、core-D06（能力驱动 Adapter Registry 底座）。
- 提案：guard-versioned-content-scope；决策：C11（Cursor 分层能力：保护对象一致、阻断能力按已接入事件声明、`afterShellExecution` 接线、更正 IDE preToolUse 强度声明）、C14（保护范围变更经宿主审批）。
- 关联规范：`spec/agents-md.md`、`spec/pretooluse-guard.md`。
