## Cursor 插件集成规范

> 权威定义 OpenLogos 在 Cursor 宿主（cursor-agent CLI 与 Cursor IDE 共享项目配置）上的三件套资产布局、hooks 合并算法、托管 `.mdc` 迁移与能力子集契约。生成与部署行为由 `cli` 实现，测试锚定本规范。

### 1. 目标与非目标

- 目标：cursor 宿主获得与 claude-code / codex / opencode 等同级的 `assets: ['agents', 'plugin', 'hooks']` 集成——原生 Agent Skills、显式命令 Skills、change-reviewer subagent、sessionStart 上下文注入与部分强度写入门禁。
- 非目标：不实现 Cursor IDE 专属配置（IDE 经共享 `hooks.json` 自然生效）；不读取或迁移用户 Cursor 全局配置（`~/.cursor/**`）；不提供 marketplace 式插件打包（Cursor 无对应机制，资产直接落项目目录）。

### 2. 宿主身份与 Registry 契约

- 规范 id：`cursor`；display name：`Cursor`；不新增别名。
- capability：`assets: ['agents', 'plugin', 'hooks']`，`instructions=true`、`skills=true`、`commands=true`、`agents=true`、`sessionStart=true`、**`preToolUse=false`**。
- **capability honesty（D09）**：声明必须与宿主实测能力一致。`preToolUse=false` 表达 cursor-agent CLI hook 事件子集（2026-04 官方口径：`sessionStart` / `beforeShellExecution` / `afterShellExecution` / `afterFileEdit` / `postToolUse` / `stop`）；staging 部署必须以真实宿主实测覆盖面并记录。若未来 CLI 支持 `preToolUse`，capability 更新走独立提案。
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

npm 随包校验：源码模板存在但 tarball 缺任一声明资产时，构建 / 部署预检失败。

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
- 托管段必含 guard 强度说明行（CLI 部分强度 / IDE 完整强度），不得省略。

### 7. hooks.json 合并算法

`.cursor/hooks.json` 是用户共享文件，禁止整文件事务替换：

1. 不存在 → 创建 `{"version": 1, "hooks": {...托管条目}}`。
2. 存在 → JSON 解析；失败即 fail loud（报告精确路径，零写入）。
3. 托管条目身份 = 托管 command 路径；增改仅限托管条目，用户条目与未知字段原样保留（读回字节级校验）。
4. 同目录临时文件 + rename 原子落盘；重复执行零 diff；卸载 / 回滚仅移除托管条目。

托管条目（三条）：

| 事件 | 用途 |
|---|---|
| `sessionStart` | 阶段上下文注入（SessionContextService） |
| `beforeShellExecution` | shell 写入硬拦（GuardDecisionService） |
| `afterFileEdit` | 越界编辑事后检测报告（GuardDecisionService） |

### 8. Hook 输入、输出与错误

- 输入：Cursor stdin JSON（snake_case 字段）；适配层归一化后交共享服务，字段映射与判定契约见 `spec/pretooluse-guard.md`「Cursor hooks 部分强度门禁适配合同」。
- `sessionStart` 输出：stdout JSON 注入 module、active change、`proposal_step`、可写范围、下一确认点；CLI 不可用或项目未初始化时输出空对象。输出不构成写入授权。
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

- 真实 `npm pack` 产物必须含 cursor-plugin-template 全部资产与本规范；从解包 tarball（非 workspace）核对。
- staging 验收必须使用真实 cursor-agent CLI 新 session：Skills 发现、`/<command>` 触达、sessionStart 注入、门禁 allow/deny/检测、hook 事件覆盖面实测记录。mock 或直接调用 runtime 不计入闭环证据。

### 12. 测试与验收

- UT/ST：UT-S01-129～136、ST-S01-27～29；UT-S08-51～58、ST-S08-34～36；UT-S09-293～302、ST-S09-112～115；UT-S14-18～21、ST-S14-25～26；UT-S20-43～48、ST-S20-23～25。
- smoke：SMOKE-core-182～189（见 `logos/resources/test/smoke/core-smoke-test-cases.md`）。
- 全部测试经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl` / `smoke-results.jsonl`。

### 13. 安全与发布边界

- OpenLogos 在任何入口下只读改删自身托管资产；用户 `.cursor/**` 其余内容不读取、不写入、不迁移。
- 本集成不授权 npm publish、Git tag、GitHub Release、官网部署或 `git push`。

### 14. 规范来源

- 提案：cursor-adapter-parity；决策：core-D09（capability honesty 与部分强度边界）、core-D06（能力驱动 Adapter Registry 底座）。
- 关联规范：`spec/agents-md.md`、`spec/pretooluse-guard.md`。
