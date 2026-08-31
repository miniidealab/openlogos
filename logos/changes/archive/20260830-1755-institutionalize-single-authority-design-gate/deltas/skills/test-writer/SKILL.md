## ADDED — Authority Closure 故障矩阵与追溯

### 输入

读取 `spec/authority-closure.md`、项目 Authority Registry 和有效时序图。按 required `fact_id` 生成测试，不复制 owner/writer 表。

### 每 fact 必测

- authority 正常路径；
- stale projection 与 conflicting old copy；
- legacy/concurrent writer；
- response lost + 新进程 restart；
- projection rebuild 与 freshness；
- cutover rollback；
- forbidden reverse inference。

不可发生项必须引用架构不变量形成证据化 SKIP。断言要证明 decision/恢复来自 authority identity/action；投影夹具必须与权威值冲突，restart 必须启动新进程并保留残留。

所有 UT/ST/smoke 使用真实 ID、建立 AC 追溯并接入 OpenLogos reporter。漏任一 required 维度时不得报告覆盖闭合。
