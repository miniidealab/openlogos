## MODIFIED — 2.35 按触达目标形成规格闭包（S39，baseline-on-touch）

### 2.35 按触达目标形成规格闭包（S39，baseline-on-touch）

#### 2.35.1 能力目标

launched change 的 plan 阶段不再询问“项目是否已经建立全局基线”，而是回答“本次触达的功能/场景需要哪些规格目标，以及这些目标当前是否存在”。change-writer 必须在生成 `tasks.md` 时完成闭包规划；delta-writing 只消费已批准的计划，不额外开启 baseline 子流程。

核心不变量：**规范化合并目标路径是唯一键，一个非 SKIP 目标对应一个 task、一个 delta 文件和一次 apply 结果。** “最终态 delta”表示合并该唯一文件后，目标已经同时承载可证实的存量事实与本次变更，不依赖同一 change 内另一份先行基线 delta。

#### 2.35.2 输入与受影响场景识别

输入按可信度由高到低组合：

1. 用户在当前 proposal 中明确的变更原因、目标、验收条件；
2. 已合并的需求、功能规格、架构、场景、API、DB、测试与决策记录；
3. 当前 change 已产出的 delta（与主规格叠加形成 effective view）；
4. 可重算的代码、测试、配置、路由、DDL、消息定义等现状证据；
5. 已提交的 S33 seed/provenance（可选加速器，不是权威意图源）。

change-writer 先把变化归入已有 feature/scenario；不存在稳定身份时为本次触达能力规划新场景，并在 merge apply 时登记。代码证据只允许形成“现状事实”，不得反推原始产品动机、历史取舍或未来验收意图。

#### 2.35.3 目标模式与 delta 语义

| 判定 | task 模式 | delta 要求 | apply 结果 |
|---|---|---|---|
| 目标文件存在 | `MODIFY` | 同路径唯一 delta；已有锚用 `MODIFIED`，缺锚可同文件用 `ADDED` | 修改既有目标 |
| 目标文件缺失 | `CREATE` | 同路径唯一 delta；Markdown 用 ADDED 章节，API/DB non-Markdown 用可剥离 ADDED 首行控制行；内容达到类别最低完整度 | 创建完整新目标 |
| 场景不适用该类别 | `SKIP` | proposal 闭包矩阵记录类别、理由、证据；不创建 checkbox | 无文件 |
| 证据不足或互相冲突 | `AMBIGUOUS` | 列明缺口并保持 plan 未完成 | 不得通过既有 plan-exit |

`CREATE`/`MODIFY`/`SKIP` 是规划模式，不是新 merge 操作。Markdown delta 仍只允许 `ADDED`、`MODIFIED`、`REMOVED`、`REMOVED-ITEMS` 章节；API/DB non-Markdown delta 使用整文件 ADDED/MODIFIED 首行控制协议。同一目标既要修改旧章节又要新增章节时，所有变化必须聚合在同一 delta 中。

#### 2.35.4 闭包维度与适用性

| 维度 | 默认 | 纳入条件 | CREATE 最低完整度 |
|---|---|---|---|
| 需求/功能 | 必须 | 所有触达场景 | feature/scenario 身份、问题/目标、本次验收、范围与非目标 |
| 场景实现 | 必须 | 所有触达场景 | 参与者、前后置、合法 Mermaid `sequenceDiagram`、唯一步骤章节及至少 3 个非空有序列表项、非空异常/边界与追溯 |
| 架构 | 条件 | 组件边界、数据归属、进程/服务调用或非功能约束变化 | 边界、数据流、所有权、不变量、失败策略、实现映射 |
| API | 条件 | 时序图出现 HTTP/RPC/消息接口边界 | 可校验的完整 OpenAPI/接口定义、schema、错误与兼容策略 |
| DB | 条件 | 场景读写持久化数据 | 完整 DDL/schema、键/约束/索引、迁移与回滚语义 |
| UT/ST | 必须 | 所有触达场景 | 真实 ID、主/异常/边界用例、追溯与 reporter 要求 |
| API 编排 | 条件 | API 维度适用 | 完整请求链、断言、夹具/清理、reporter 及失败诊断 |
| 部署/smoke | 条件 | proposal 声明需要部署 | 环境、发布/回滚步骤与真实安装后最小链路 |

API 只能从已形成的有效场景时序派生；测试必须覆盖需求验收与异常分支。`skip_phases`、空目录或 seed 状态本身都不能替代场景级适用性判断。

#### 2.35.5 effective view 与目标去重

effective view = 已合并目标 + 当前 change 同目标 delta 的预期合并结果。后续目标生成器必须读取 effective view，保证 API 读取最新时序、测试读取最新需求/API/DB，而不是各自对旧主规格平行猜测。

去重算法：

1. 将每个候选 delta 路径映射为最终合并目标；
2. 做路径分隔符、`.` 段、大小写策略与 containment 规范化；
3. 以 canonical target path 分组；
4. 每组生成一个 task；多个来源的修改按 Why → What → How 稳定顺序聚合；
5. 任一组出现 `MODIFY`/`CREATE` 冲突时 fail-closed，不选择其中一个蒙混。

#### 2.35.6 plan/spec 两阶段结构校验

- **plan 阶段**：proposal 必须含唯一、严格可解析的 `baseline_closure` YAML（独立 `touched_scenario_ids[]` 与规范化 `targets[]`）；每个非 SKIP/AMBIGUOUS 目标在 tasks 中恰出现一次并带 `MODIFY|CREATE`，即 `P==T`；`MODIFY` 目标在主视图存在，`CREATE` 不存在；SKIP/AMBIGUOUS 的 null/证据组合不合法或任一 AMBIGUOUS 未清零时不得视为 plan 完成。
- **spec 阶段**：每个已勾选 delta task 必须有且仅有一个同路径文件，且 `P==T==D`；实际 delta 与 task 模式一致；CREATE 文档达到类别最低完整度；API/DB non-Markdown delta 的首行控制 target/mode、剥离后语法与整文件完整度均合法；所有目标仍通过既有段标记、模板骨架、路径、UI 与 S37 守恒检查。
- 语义适用性由 change-writer 决策，CLI 只校验可确定的结构事实，禁止复制第二套业务推断器。
- legacy proposal 未声明 `on-touch-v1` 时走兼容路径；新版模板声明该策略后检查 fail-closed。

#### 2.35.7 棕地与无 JIT 边界

- `baseline_seed_state`/coverage/provenance 保持读取兼容；在恢复门确认无未终结 journal 或已成功恢复后，`required`、安全 `partial`、`seeded` 均不得阻断 change 或成为默认 `next` 动作。安全 `partial` 仅指可排除的 open run/未提交 staging；未终结 `prepared|committing` journal 无法恢复时硬报 `baseline_commit_in_progress`，并在任何 resources/index/coverage 读取前停止。
- S33 committed/fresh seed 只减少证据扫描，不能让 change-writer 跳过闭包，也不能把 staged/partial 内容当权威；事务恢复失败不得降级成“忽略 seed 后继续扫描”。
- `bootstrap: adopted` 下自动写入的 `skip_phases` 只豁免 Initial 完整性；本次场景实际存在接口或持久化边界时，仍必须规划 API/DB。
- 不生成 `[baseline]` section 或“先建立基线”任务；不写 `verified:true`/`confirmed_*`，不产 JIT advisory、verify `baseline_warnings`、新 gate 或 marker。
- 真正无法判断的产品取舍只在现有 plan-exit 之前一次性报告，不按目标逐个插入确认流程。

#### 2.35.8 验收摘要

- 相同 canonical target 的多场景变更稳定收敛为一 task/一 delta。
- 缺少场景、API、DB 或测试目标时，在适用条件成立的情况下生成完整 CREATE 文档，而不是占位骨架。
- 无 API/DB 的 CLI 场景能给出证据化 SKIP，不制造空规格。
- adopted 项目不运行 baseline-seed 也能完成首个 change 的 plan/spec/merge。
- 任何 seed 状态下均无 JIT 确认、可信度升级或额外人类门。

#### 2.35.9 场景 CREATE 结构化完整性合同

生成端只写 canonical 标题 `## 步骤说明`。读取端兼容以下标题的精确、大小写不敏感形式：`步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path`；其中 `main path` 保留现有英文兼容，不构成新的输出格式。兼容集合由校验器共享常量单点维护，Skill 只引用合同，不复制另一套判词。

校验器先扫描围栏与 HTML 注释之外的 Markdown 标题、章节边界和有序列表，再做以下判定：

1. 步骤章节恰好一个；缺失或重复均返回精确 missing evidence。
2. 章节中至少有 3 个连续、非空的有序列表项；普通散文和无序列表不满足步骤合同。
3. Mermaid 证据来自合法 `mermaid` 围栏，正文首个有效声明为 `sequenceDiagram`，至少有 2 个 participant/actor 声明和 1 条消息箭头。
4. 异常/边界、追溯章节各自唯一且含非空权威正文；只有标题、注释或围栏内样例均失败。
5. change-lint 与 merge 复用同一个 evaluator；结构失败保持既有 fail-closed 和合并原子性。

兼容只扩大合法历史标题的读取范围，不 grandfather 依赖散文关键词误通过的残缺文档。RunLogos 普通 `write-delta` lint 屏障属于独立 companion change，不在本能力实现范围内。
