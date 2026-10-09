# 变更提案：sync-claude-response-language

> module: core | created: 2026-10-09

## 变更原因
OpenLogos 用两处文字约束 AI 的输出语言：CLAUDE.md / AGENTS.md 里的「语言策略（最高优先级）」段（`generatePolicyMdc` 按 `locale` 生成），以及 SessionStart hook 输出的 `Language Policy: ALL output MUST be in Chinese (中文).`。两者都是**会话上下文里的普通文字**，长会话里会被稀释甚至丢失。

runlogos 项目（`locale: "zh"`）实测：

- 同一个 Claude Code 会话跨 2026-10-01～10-09，约 69 万 token，期间发生 3 次上下文压缩（10-03 08:36、10-06 07:52、10-08 01:37，UTC）。
- 三次压缩生成的摘要都以英文为主（中文字符 380～821，英文字母 1 万以上），**都没有保留「必须用中文」这条规则**。
- 按会话记录逐小时统计助手回复语言：10-06 07:52 那次压缩之前几乎全是中文；之后英文回复占多数（例如 10-06 08 时 中文 5 条 / 英文 25 条，10-07 23 时 4 / 24）。期间 CLAUDE.md 每轮仍以系统提醒注入，没能拉回来。
- 用户为此反复截图追问，排查一度误判为「显示层把中文翻译成了英文」，最后靠读会话记录（`~/.claude/projects/<项目>/<session>.jsonl`）才确认是 AI 实际在输出英文。

Claude Code 有官方设置 `language`（「Claude 回复与语音输入的首选语言」）。设置后，每轮都会在系统提示词里加一节 `# Language`：`Always respond in chinese. Use chinese for all explanations, comments, and communications with the user. ...`。这一节属于系统提示词，不进对话历史，**不会被上下文压缩丢掉**，约束力比上下文里的文字强。runlogos 用户在用户级 `~/.claude/settings.json` 加上 `"language": "chinese"` 后，当场生效（系统提示词出现了上述 `# Language` 节）。

但 OpenLogos 目前只管理项目 `.claude/settings.json` 里的 hooks，没有写这个设置。每个中文项目的用户都得自己发现这个问题并手动配置，而大多数人只会觉得「AI 突然不听话了」。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - `generatePolicyMdc` 生成的「语言策略」段：继续保留，它约束生成的文档与代码注释；但它是上下文文字，长会话压缩后约束力不足（见上）。
  - SessionStart hook 的 `Language Policy` 一行：同为上下文文字，问题同上；保留。
  - `mergeClaudeSettings` / `mergeClaudePreToolUseGuard` / `mergeClaudePostCheckHooks`：已在 `deployClaudeCodePlugin(root, locale)` 里幂等合并项目 `.claude/settings.json`，`locale` 在这里已可用。复用这条链路，在同一处多合并一个顶层键 `language`，不新建机制。
- 为什么不能更小：只改文档提示用户「自己去配」等于没修，用户根本不知道有这个问题；只写用户级 `~/.claude/settings.json` 越过了项目边界，会影响用户的其它项目，不该由 openlogos 写。
- 本提案主动砍掉的：
  - 其它 AI 工具（Codex、OpenCode、Cursor、ZCode、Qoder 等）：没有确认它们有等价的「回复语言」设置，本提案只做 Claude Code；有需要另立。
  - 根据用户系统区域推断语言：语言以项目 `locale` 为唯一事实源，和 CLAUDE.md 语言策略同源，不另立判据。
  - 在压缩摘要里补语言规则：压缩由 Claude Code 自己完成，openlogos 管不到。

## 变更类型
设计级（`init` / `adopt` / `sync` 对 Claude Code 项目设置的托管范围新增一个键；同步场景、测试与代码）

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` — Claude Code 托管资产相关需求处补一条「按 `locale` 写入项目 `.claude/settings.json` 的 `language`」
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — Claude Code 项目设置合并相关章节，新增 `language` 键的合并规则（见「变更概述」）；第 4004 行附近的「`.claude/settings.json` 不保护」口径不变
- 影响的业务场景：S08（sync）、S01（init）— 时序中 `.claude/settings.json` 合并步骤补「合并 `language`」
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无；测试规格 `logos/resources/test/core-S08-test-cases.md` 新增章节（UT-S08-79 起、ST-S08-42 起，起草时 S08 最大为 UT-S08-78 / ST-S08-41，立案时复核），必要时 `core-S01-test-cases.md` 补 init 臂
- 影响的代码：`cli/src/commands/init.ts`（`deployClaudeCodePlugin` 调用处新增 `mergeClaudeLanguageSetting(root, locale)`，或扩展 `mergeClaudeSettings` 接收 `locale`）

## 部署影响
- 是否需要部署：是（发布新版 openlogos CLI；用户升级后运行 `openlogos sync` 即生效）
- 部署原因：CLI 行为变化，需随版本发布
- 影响环境：npm 发布 / 本机全局安装
- 是否涉及数据迁移：否（`sync` 幂等补写即可，无需迁移）
- 是否需要回滚预案：否（回滚只需删掉该键）
- 是否需要 smoke：否（单元 / 场景测试可完整覆盖 JSON 合并）

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: ready
impacts:
  data:
    status: none
    reason: 只合并项目 .claude/settings.json 的一个顶层键
  compatibility:
    status: decided
    reason: 项目级 language 会覆盖开发者个人在用户级设置的语言偏好；已有取值的处理与 en 项目是否写入已由 C01～C03 确认
  security_privacy:
    status: none
    reason: 不涉及凭据与个人数据
  public_release:
    status: decided
    reason: 随下一个 openlogos 版本发布
  external_commitment:
    status: none
    reason: 无
decisions:
  - id: C01
    impact: compatibility
    choice: "zh 写 \"chinese\"，en 写 \"english\"；两种 locale 都写（用户已确认）"
    reason: "generatePolicyMdc 对 zh / en 都要求「全部输出必须用该语言」，语言策略对称；只写 zh 会让 en 项目里用中文提问的开发者得到中文回复，与 en 项目的策略不一致"
  - id: C02
    impact: compatibility
    choice: "键不存在时写入；已存在且等于 openlogos 托管值之一（\"chinese\" / \"english\"）时按当前 locale 更新；已存在且是其它值（如 \"japanese\"）时保留不动并在 sync 输出中提示一行（用户已确认：只提示，不改）"
    reason: "locale 切换后能自动跟随；用户手工设成别的语言视为有意为之，不覆盖"
  - id: C03
    impact: compatibility
    choice: "settings.json 损坏（非法 JSON）时沿用 mergeClaudeSettings 既有语义：原样保留文件、跳过合并（用户已确认）"
    reason: "与既有 hooks 合并的容错口径一致"
unresolved: []
defaults: []
```

## 变更概述
`openlogos init` / `adopt` / `sync` 部署 Claude Code 资产时（`deployClaudeCodePlugin(root, locale)`），在合并 hooks 的同一处，按项目 `locale` 往项目 `.claude/settings.json` 写入顶层键 `language`：`zh` → `"chinese"`，`en` → `"english"`。合并规则：

1. 文件不存在：随既有骨架一起创建（与 SessionStart hook 骨架同时写入）。
2. 键不存在：写入。
3. 键已存在且是 openlogos 托管值（`"chinese"` / `"english"`）：按当前 `locale` 更新（覆盖 `logos.config.json` 改了 locale 的情况）。
4. 键已存在且是其它值：保留不动，`sync` 输出提示一行「项目 language 为自定义值，未改动」。
5. JSON 损坏：沿用既有容错，原样保留、跳过。
6. 幂等：重复运行无字节变化；不影响 hooks 等其它键。

效果：所有用 OpenLogos 管理的 Claude Code 项目，回复语言都由系统提示词的 `# Language` 节约束，长会话压缩后不再漂移。CLAUDE.md 语言策略段与 SessionStart hook 的语言提示保持不变，三者同源于 `locale`。

**已知局限（如实记录）**：`language` 设置大大加强了约束，但不能保证百分之百。runlogos 实测中加上用户级设置后，同一个超长会话（约 69 万 token）里仍出现过一次英文回复。长会话建议定期 `/clear` 或新开会话；这一点可以在 sync 的输出或文档里顺带提示，但不属本提案必做范围。

## 验收标准
- `locale: zh` 项目运行 `openlogos sync` 后，`.claude/settings.json` 含 `"language": "chinese"`，hooks 等其它键字节不变（除新增键外）。
- `locale: en` 项目得到 `"english"`。
- 已有 `"language": "japanese"` 时保持不变，`sync` 输出含一行提示。
- `logos.config.json` 的 locale 从 zh 改为 en 后再 `sync`，`"chinese"` 更新为 `"english"`。
- 损坏的 settings.json 原样保留。
- 连续两次 `sync` 第二次无变化。
