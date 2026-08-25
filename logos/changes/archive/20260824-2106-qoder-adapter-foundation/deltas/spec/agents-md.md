## ADDED — Qoder CLI 静态记忆与插件资产生成规则

### Qoder 指令入口

- 当 `aiTool=qoder` 或 `all` 展开包含 Qoder 时，OpenLogos 必须维护工作区根现有大小写真实路径的 `AGENTS.md`。
- Qoder CLI 默认把项目 `AGENTS.md` 作为静态记忆；OpenLogos 托管片段必须自含项目索引、语言策略、Why→What→How、delta/guard、reporter 和人类确认点。
- OpenLogos 不修改用户级 `~/.qoder/AGENTS.md`、项目 `AGENTS.local.md`、`.qoder/rules/**/*.md` 或自定义 `context.fileName` 配置；这些均属于用户/项目 owner。
- 虽然 Qoder 可按访问路径补充加载子目录记忆，OpenLogos 关键方法论约束不得依赖先访问特定子目录才生效。

### 托管片段与用户内容保护

1. 复用既有 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 合并 helper，不新增 Qoder 专用 marker。
2. 无 marker 时保留用户原文并追加完整片段；完整 marker 只替换内部；残缺、交错或重复 marker fail loud。
3. init/adopt/sync/launch 调用同一合并与事务实现，大小写变体和回滚语义一致。
4. 用户级/本地 AGENTS、Qoder rules、settings、其它插件和 marker 外内容永不进入 OpenLogos 删除/格式化计划。
5. 托管文本语言来自 `logos.config.json.locale`；用户原文不翻译、不重排。

### Qoder Skills、Commands、Agents 分组

| 类型 | OpenLogos 位置 | AGENTS 展示规则 |
|---|---|---|
| 方法论 Skills | Qoder plugin `skills/<name>/SKILL.md` | 列为“OpenLogos 方法论 Skills”，名称/描述与真实资产一致 |
| Commands | plugin `commands/**/*.md` | 列可调用名称、用途和人类确认点，不伪装成 Skill |
| Agents | plugin `agents/*.md` | 只列真实随包 Agent，不生成不存在角色 |
| 项目/用户能力 | `.qoder/rules/**`、其它插件或仓库资产 | 独立分组并保留原 owner，不由 sync 重命名/删除 |

### 生命周期内容

- initial：强调完成 Why→What→How 与测试规格后才能实现。
- launched 无 guard：禁止源码/规格写入，下一主动作是创建 change。
- launched 有 guard：按磁盘 `proposal_step` 给出精确范围；delta-writing 仅当前提案 deltas/tasks，ready-to-merge 停止写 delta。
- adopted + launched：与 launched 一致，不因存量接入降低 guard；可直接进入 change。
- sync/launch 后提示通过新 Qoder CLI session 或受支持的 memory refresh 读取新静态记忆/插件快照；不得声称更新 AGENTS 等同 hard guard。

### 一致性与验证

- Registry 是 Qoder AGENTS/插件资产生成的唯一入口，生命周期命令不拼接 Qoder 分支。
- AGENTS 列表、plugin manifest 与 tarball 实际组件集合必须一致；缺失、额外、重复 identity 或非法 frontmatter 阻断预检。
- 自动化覆盖用户内容保留、大小写、残缺 marker、zh/en、initial/launched/adopted、qoder/all 与规则/本地记忆不被修改。
- staging 由真实 Qoder CLI 新 session 读取根 AGENTS，并证明静态记忆只提供指导，PreToolUse Hook 独立执行硬门禁。

### 权威参考

- Qoder CLI Memory：`https://docs.qoder.com/cli/memory`
- Qoder Plugin Reference：`https://docs.qoder.com/cli/plugins-reference`
