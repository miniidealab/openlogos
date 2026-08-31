## ADDED — Authority Closure 可证伪测试矩阵（规范引用）

测试设计前读取 `spec/authority-closure.md`、Authority Registry 和有效 sequence diagram。按 required `fact_id` 生成矩阵，不另建 owner/writer 清单。

每个 fact 至少覆盖 authority happy path、stale projection、conflicting old copy、legacy/concurrent writer、response lost + new-process restart、projection rebuild、cutover rollback、forbidden reverse inference。确实不可发生的维度必须引用架构不变量给证据，不能静默省略。

断言必须证明最终 decision/恢复来源是 authority identity/action；故意让投影与权威值不同，restart 必须启新进程并保留旧残留。所有自动化 UT/ST/smoke 使用真实 ID 并接入 OpenLogos reporter；漏任一 required 维度时测试规格不完成。
