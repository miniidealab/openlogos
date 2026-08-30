## ADDED — completed receipt 驱动的切片规划

### 激活门

`TEST_SLICE_MANIFEST` 只能在对应 merge transaction 为 `completed` 且 completed receipt 通过 schema、seal、target set、after hash 与 metadata closure 复核后创建或刷新。`SPEC_MERGED`、外部 manifest、Agent done 或 Delta checkbox 不得单独开启切片规划。

### 输入权威

slice-planner 的规格输入是 receipt 指向的正式 canonical targets；测试输入是这些正式目标中真实存在的 UT/ST ID。规划器必须：

1. 从 receipt 读取 transaction id、seal hash、target set hash 与 receipt hash；
2. 在同一正式快照中扫描测试规格并验证每个引用 ID 唯一存在；
3. 将上述四个事务指纹写入 manifest provenance；
4. 拒绝仅存在于未合并 Delta、历史 checkout 或自然语言计划中的测试 ID。

### 自闭环切片

每个 `[code]` 切片继续同时包含业务代码、对应 UT/ST 测试代码和 OpenLogos reporter。切片必须显式列出真实 ID、覆盖的正式规格 target，以及对事务行为的可观察断言；跨切片依赖必须有序，不能把事务核心、原子 writer 或恢复测试全部推迟到最后一片。

### 漂移与恢复

若 receipt hash、正式 target hash、tasks `[code]` 或真实测试 ID 集合发生漂移，既有 manifest 立即失效并返回稳定诊断。只有新的 completed receipt 或在同一 receipt 下重新生成完全一致的 manifest 才可恢复；不得通过编辑 fingerprint 绕过。

### no-delta 与历史兼容

no-delta 若后续确实需要代码，仍以其 completed receipt 为规划输入。旧 manifest 缺少 transaction provenance 时只能用于历史只读展示，不能驱动 0.14.0 的实现、verify 或 archive。本节覆盖本文档中把 `SPEC_MERGED` 单独视为切片激活门的旧规则。
