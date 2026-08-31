## ADDED — 2.45 Authority Closure 设计门功能规格

## 2.45 Authority Closure 设计门功能规格

### 2.45.1 产品目标与价值

把“单一事实源”从架构建议变成贯穿 plan、scenario、test、review、deploy 的可执行合同。用户在批准方案前即可看到业务事实的唯一 owner/writer、所有投影及切换风险，并由机器门阻断结构缺口。

### 2.45.2 Authority Registry

architecture-designer 在项目架构中维护唯一 Registry。每行固定包含：

| 字段 | 语义 |
|---|---|
| `fact_id` | 稳定业务事实身份，不绑定文件名或实现类名 |
| semantic scope | 该事实回答的唯一业务问题 |
| authority owner / canonical state | 有权裁决的组件与状态载体 |
| sole writer / mutation entry | 唯一写者与受控变更入口 |
| decision/read API | 消费者获得结论的同源入口 |
| projections | cache/index/marker/receipt/view 等只读派生物 |
| freshness proof | generation/version/hash/receipt 等同一性证明 |
| rebuild/recovery source | 投影如何重建、重启从哪里恢复 |
| forbidden shadow sources | 明确不能用于裁决的旧副本/启发式 |
| cutover exit | writer 迁移结束的可验证证据 |

Registry 是项目实例源。场景、部署、测试和 code review 只引用 `fact_id`，不得各自维护 owner 表。

### 2.45.3 proposal authority impact

新 scaffold 提供唯一 `authority_impact` YAML：

- `schema: openlogos/authority-impact@1`；
- `applicability: required|not_applicable`；
- required 分支包含 `trigger_reasons`、`facts[]` 和 `unresolved[]`；
- 每个 fact 引用 Registry 或本案 CREATE 的 canonical authority target，并列出 change、projections、freshness、retired shadow sources、forbidden fallbacks、cutover 和真实 test IDs；
- not_applicable 分支不得带伪造 facts，必须提供非空 evidence；
- 未知字段、重复 key、空字符串、重复 fact_id、未知 test ID、未清 unresolved 或 required 缺字段均 fail closed。

proposal 是本次变化计划，不复制根规范或项目 Registry；tasks 只是一目标一 Delta 执行投影。

### 2.45.4 AC-01～AC-08 体验

方案页面/CLI 文本按稳定顺序展示：唯一权威、受控写入口、投影血缘、新鲜度、决策同源、恢复同源、有限切换、可证伪验收。任一项未闭合时，诊断必须指出 fact、缺字段和修复入口，而非仅返回“设计不完整”。

允许一个事实有多个物理副本；只要副本可验证、可重建且不能反向裁决，即不会因“有缓存”被误判失败。反之，即便只有两个文件，只要双方都能决定业务结果，也必须报 shadow authority。

### 2.45.5 六角色流水线

1. architecture-designer 建立 Registry。
2. change-writer 声明 authority impact 并规划权威、投影、退休与测试目标。
3. scenario-architect 在 sequence diagram 中标注 authority/projection 数据流和恢复。
4. deployment-designer 关闭旧 writer、启用新入口、重建/校验投影并冻结 rollback boundary。
5. test-writer 生成 stale/conflict/concurrency/response-lost/restart/cutover 矩阵。
6. code-reviewer 对旁路写、复制判据、反向推断、heuristic recovery 与长期双写报 Critical。

### 2.45.6 共享求值与机器输出

`PlanPackageEvaluator` 是 authority impact 完成的唯一求值者。change-lint 调用它输出 `authority_closure` summary 和五类稳定 violation；status、next、flow 与 merge 前门消费同一 evaluation，不复刻 Markdown/YAML parser 或完成公式。

summary 至少包含 schema、applicability、facts_total、facts_closed、projections、retired_shadow_sources、unresolved、pass。text/JSON 共享问题集合与稳定排序；机器门只证明结构与引用闭包，语义唯一性由故障测试和 code review 继续证伪。

### 2.45.7 兼容与失败体验

- 新 proposal 与仍 writing 的历史 proposal 缺声明时给可修复诊断；已经存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 的提案不倒退。
- 项目按 fact on-touch 补齐 Registry，不强制一次性回填全部历史架构。
- 无唯一 owner、旧 writer 无法关闭、freshness 无法证明、恢复仍依赖扫描时，`unresolved` 不得清零。
- package 中根规范、Skill、evaluator 或 manifest/hash 任一漂移，安装态 smoke 失败并保留回滚证据。

### 2.45.8 验收摘要与非目标

- S04/S06/S07/S09/S12/S16/S19/S35 的 UT/ST 和 SMOKE-core-163～167 全部通过并带 OpenLogos reporter。
- required 与 not_applicable 正例、五类机器 violation、多问题稳定排序、四消费者同源、投影冲突/重启和 writer cutover 均有独立断言。
- 不建立全局 authority 服务；不禁止缓存/CQRS/多副本；不修改 API/DB；不把六个 Skill 变成六份规范源。
