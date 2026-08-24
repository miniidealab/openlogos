## ADDED — ZCode 指令与 Skill 命名空间生成规则

### ZCode 指令入口

- 当 `aiTool` 为 `zcode`，或 `all` 经 Registry 展开包含 ZCode 时，OpenLogos 必须维护项目根现有大小写真实路径的 `AGENTS.md`。
- ZCode 运行时只以用户级 `~/.zcode/AGENTS.md` 与工作区根 `AGENTS.md` 的组合为前提；OpenLogos 生成内容不得依赖子目录 AGENTS 扫描、include 指令或 CLAUDE.md 持续读取。
- 根 AGENTS 中的 OpenLogos 内容必须自包含：项目索引入口、语言策略、Why→What→How、Delta/guard、测试 reporter、verify/deploy/smoke/archive/push 确认点均在完整 managed block 中表达。

### 托管片段与用户内容保护

1. ZCode 复用既有 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 合并 helper，不新增第二套 marker。
2. 无 marker 的用户 AGENTS 原文保留，并在末尾追加托管片段；完整 marker 只替换内部；不完整 marker fail loud。
3. `init`、`init --ai-tool zcode`、`adopt`、`sync`、`launch` 必须调用同一合并实现，大小写变体检测和原子回滚语义一致。
4. `.zcode/config.json`、用户级 AGENTS、托管 marker 外内容不是 OpenLogos owner，任何入口不得覆盖。
5. 生成文本语言由 `logos.config.json.locale` 决定；用户原文不翻译、不格式化。

### ZCode Skills/Commands/Agents 分组

| 类型 | OpenLogos 归属与位置 | AGENTS 展示规则 |
|---|---|---|
| 方法论 Skills | OpenLogos ZCode plugin 的 `skills/<name>/SKILL.md` | 列在“OpenLogos 方法论 Skills”，使用插件可发现名称与实际路径 |
| Commands | plugin 的 `commands/<name>.md` | 列出用户可调用名称、用途和所需确认点，不伪装成 Skill |
| Agents | plugin 的 `agents/<name>.md` | 仅列出真实随包 Agent；不得生成不存在的角色 |
| 项目专属能力 | 当前仓库或其它 ZCode plugin | 单独列为“项目专属”，保留原命名空间，不纳入 OpenLogos owner |

`openlogos` identity/命名空间只表示 OpenLogos 随包方法论资产。未知来源、用户创建或其它 plugin 中的 Skill/Command/Agent 一律视为项目/用户资产，sync 不复制、不重命名、不删除。

### 生命周期生成

- initial：说明完成 Why→What→How 设计与测试规格后才能实现，并展示初始化阶段可用的 OpenLogos 能力。
- launched 无 guard：明确禁止修改源码，下一动作是创建 change。
- launched 有 guard：按磁盘 `proposal_step` 输出精确阶段范围；delta-writing 仅允许当前提案 `deltas/**` 和对应 `tasks.md`，ready-to-merge 停止写 delta。
- adopted + launched：与 launched 指令一致，不因存量接入降低 guard；下一主路径仍可直接 change。
- launch/sync 后提示 ZCode 开启新 session 获取新指令和 Hook 配置快照；不得声称现有 session 已热更新。

### 一致性与验证

- Registry 为 ZCode AGENTS 生成的唯一入口，禁止在 init/sync/launch/adopt 各自拼接宿主分支。
- AGENTS 中列出的资产必须与 tarball 内 ZCode plugin 清单一致；缺文件、重复 identity 或非法 frontmatter 阻断部署。
- 自动化测试覆盖用户内容保留、大小写变体、不完整 marker、双语、initial/launched/adopted 与 `all`。
- staging smoke 必须由真实 ZCode 新 session 读取根 AGENTS，并确认方法论资产和项目专属资产没有混入同一 owner。
