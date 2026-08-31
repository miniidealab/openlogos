## ADDED — S04/S06/S07/S09/S12/S16/S19/S35 Authority Closure 方法论门需求

## S04/S06/S07/S09/S12/S16/S19/S35 Authority Closure 方法论门需求

### 用户问题与价值

当同一业务事实由多个组件保存并各自解释时，系统在正常路径可能表现一致，却会在响应丢失、重启、缓存滞后、局部失败或迁移回滚时给出互相冲突的答案。用户需要在设计阶段明确唯一裁决者和所有派生副本的边界，而不是等事故发生后继续叠加 fallback。

价值是让“谁有权决定”在实现前可审阅、在提案阶段可阻断、在测试中可证伪、在部署时可验证，从而使投影陈旧成为可恢复问题，而非语义分叉。

### 范围与适用条件

1. 跨组件、跨进程或跨仓库共享的业务事实/完成谓词。
2. cache、index、marker、receipt、materialized view、状态摘要和同步副本等投影。
3. owner、writer、mutation entry、recovery source 或 cutover/rollback 发生变化。
4. 消费者可能通过扫描、mtime、存在性或启发式规则重新推导权威结论。

纯文案、纯视觉且不改变业务事实归属的变更可以声明不适用，但必须有可核验证据；缺省、空声明或“后续补充”不构成不适用。

### 核心需求

1. 架构设计必须为适用事实分配稳定 `fact_id`，并明确唯一 owner、canonical state、sole writer、mutation entry、decision/read API、投影、freshness proof、重建/恢复来源和 cutover exit。
2. proposal 必须包含唯一 `openlogos/authority-impact@1`；适用时引用架构 Registry，不适用时说明证据。proposal 不得复制一份独立 Registry。
3. 场景时序必须区分 command、authority write/read、projection refresh、consumer decision 和恢复路径；同一 fact 出现两个裁决者时回退架构阶段。
4. 部署方案必须关闭旧 writer、启用新入口、重建/校验投影并明确可逆/不可逆边界；无限期双写不得标为完成。
5. 测试必须覆盖冲突旧副本、滞后投影、并发 writer、响应丢失、重启重建和切换回滚。
6. 代码审查必须将旁路写权威、复制判据、投影反推、启发式恢复和未退出双写列为 Critical。
7. `change-lint`、status、next、flow 和 merge 前消费点必须共享同一个 Authority Closure evaluation，不维护第二份 parser/谓词。
8. 根 `spec/authority-closure.md` 是方法论唯一规范源；Skill、插件与 cache 是角色化或打包投影，并有 manifest/hash 新鲜度证明。

### 验收条件

- **GIVEN** 新提案适用 Authority Closure，**WHEN** 缺声明、fact 引用、writer/mutation/freshness/recovery/cutover/tests 任一闭包项，**THEN** `change-lint` exit 2、plan 不 ready，并返回稳定 violation 与修复提示。
- **GIVEN** 变更确实不适用，**WHEN** 声明 `not_applicable` 且证据完整，**THEN** evaluator 通过且不伪造空 Authority Registry。
- **GIVEN** 同一提案输入，**WHEN** 分别读取 change-lint、status、next 与 flow，**THEN** Authority Closure pass、问题集合和前沿来自同一 evaluation，不出现消费者局部重算。
- **GIVEN** authority 投影包含冲突旧值，**WHEN** 消费者决策或进程重启恢复，**THEN** 只按 authority identity/action 得出结论，旧投影不能覆盖或反向晋升。
- **GIVEN** writer ownership 迁移，**WHEN** 旧 writer 未关闭或 cutover exit 无证据，**THEN** plan/部署门失败；完成后只允许新 mutation entry 改权威。
- **GIVEN** candidate 包安装，**WHEN** 根规范、根 Skill、插件/cache 或 evaluator 资产漂移，**THEN** smoke 失败并允许恢复冻结版本。
- 所有自动化用例必须以真实 UT/ST/SMOKE ID 通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl` 或 `smoke-results.jsonl`。

### 兼容与非目标

- 已越过 plan 或已归档提案不倒退；新提案与仍 writing 的提案严格执行。
- 既有项目按触达 fact 渐进补齐，不批量伪造历史 Why。
- 不禁止缓存、CQRS、多数据库、事件日志、备份或跨区副本；只禁止它们独立裁决同一事实。
- 不引入全局 God service，不要求所有模块共享数据库或进程。
- 不修改 HTTP API、数据库 schema、远程发布语义或 RunLogos 代码。
