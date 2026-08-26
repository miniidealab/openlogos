## ADDED — Plan Package 完成合同收敛需求（S05/S08/S09/S11/S35）

### 用户问题与价值

当 Agent 已写完 proposal/tasks，但模板、Skill、lint 与状态派生使用不同完成判据时，用户会同时看到“检查通过”和“仍在 writing”的矛盾结论。OpenLogos 必须提供一个可由 CLI 独立证明、可精确修复、可供宿主消费的 Plan Package 完成合同，避免用户承担内部收敛成本。

### 需求范围

- **S09** 创建 launched change 时，中文和英文 proposal/tasks scaffold 必须与完成判据同源；需要代码的 plan 只保留空 `[code]` 标题，不生成代码 checkbox。
- **S35** `change-lint` 必须把 Plan Package 完整性作为 L0 硬门，并输出结构化问题。
- **S11** `status` 必须显示与 L0 同源的 ready、tasks 三态与问题列表。
- **S05** `next` 必须只在同一 evaluator 判定 ready 时进入 `ready-to-delta`，并自描述宿主完成检查。
- **S08** `sync` 必须让项目托管 Skill、模板和插件资产携带可核验的合同版本与内容 hash。

### 正常：合法 plan 四方一致

- **GIVEN** 活跃 launched change 尚无 Delta、无 `PLAN_APPROVED`，proposal canonical 章节唯一且非空，tasks 的 `[delta]/[deploy]` 已规划且 `[code]` 为空锚点
- **WHEN** 分别运行 `change-lint --format json`、`status --format json`、`next --format json` 与 flow derive
- **THEN** `change-lint.data.pass=true`、`plan_package.ready=true`、`status.plan_state.plan_ready=true`、`next.proposal_step=ready-to-delta`，且四方完成问题均为空

### 异常：proposal 必需章节非法

- **GIVEN** proposal 缺少、重复、改名、留空或仍含占位的 canonical 章节
- **WHEN** 任一完成消费者求值
- **THEN** plan 不得 ready；问题必须指出 `code/path/section_id/message/fix_hint`，能定位时还应包含 `line/actual/expected`

### 异常：tasks 阶段语义非法

- **GIVEN** plan 阶段仍有模板 checkbox、提前写入 `[code]` 切片，或代码必需提案缺少 `[code]` 标题
- **WHEN** L0 求值
- **THEN** 返回稳定、可操作的问题；不得把空 `[code]` 误判为无需代码，也不得把 plan-ready 与 merge 后 slices-ready 混为一谈

### 正常：宿主可独立验证完成

- **GIVEN** `next_node.dispatch` 指向 proposal/tasks producer
- **WHEN** `next --format json` 输出 dispatch
- **THEN** dispatch 携带 completion command、JSON Pointer 期望和目标 `proposal_step`；宿主无需解析 Markdown 或相信 Agent 自然语言

### 正常：托管资产可核验

- **GIVEN** npm 包、插件、Codex cache 或项目 sync 资产包含 change-writer 与 proposal/tasks 模板
- **WHEN** 构建、安装或 sync 完成
- **THEN** 可通过 package version、plan contract version 与 SHA-256 manifest 证明资产一致；同一 semver 不允许静默对应不同内容

### 兼容与只读要求

- 已存在 `PLAN_APPROVED`、`SPEC_MERGED`、`MERGED` 或 `VERIFY_PASS` 的历史提案不得因新模板规则回退。
- 仍处于 writing 的旧提案按新合同诊断，但 change-lint/status/next 不自动改写内容、写 marker 或代替审批。
- 中英文项目共享语义 section ID 与 issue code，只由 locale 决定 canonical 标题。
- 旧宿主或旧 CLI 无法证明完成时必须保守提示升级/sync，不得自行维护影子 parser。

### 正常：历史重复测试 ID 可在原子合并中收敛

- **GIVEN** 某个被触及测试规格的合并前基线误含同一测试 ID 的多条结构化定义
- **AND** prepared 最终态已把这些定义收敛为全局唯一 ID，且保留定义可与任一历史候选逐字段匹配
- **WHEN** merge-apply 构造语义 before/after test change set
- **THEN** before 重复不得先于 after 校验形成不可修复死锁；匹配保留项视为未变，重编号项按新增 ID 进入 changed 集合
- **AND** before 中无法可靠归一化的历史歧义行不得阻断收敛，但不参与候选匹配，使 after 对应定义保守进入 changed
- **AND** prepared after 仍含重复、歧义表格或非法 UTF-8 时继续 fail-closed，整批零正式写入

### 非目标

- 不在 OpenLogos 实现 RunLogos WorkUnit 自动重试、UI 状态或自然语言裁决。
- 不新增 HTTP API、数据库、第三套宿主 Markdown parser 或隐式审批。
- 本需求不授权部署、smoke、公开发布或 git push。
