## ADDED — Authority Closure 与 Authority Registry（规范引用）

本 Skill 必须先读取 `spec/authority-closure.md`，不得在本文件维护 AC-01～AC-08 的独立副本。英文目标文件中的本段与中文 Skill 共享同一规范引用；若表述与根规范冲突，以根规范为准。

在技术选型前执行共享事实盘点：识别跨组件/进程/仓库的业务事实、完成谓词、缓存/marker/receipt/view，以及 owner/writer/recovery/cutover 变化。适用时在架构文档建立唯一 Authority Registry，逐 fact 填写 `fact_id`、semantic scope、authority owner、canonical state、sole writer、mutation entry、decision API、projections/freshness/rebuild、recovery source、forbidden shadow sources 和 cutover exit。

禁止把“双方保持同步”“最后写入胜出”“读取时择新”当作闭包。无法选出唯一 owner/writer、无法关闭旧 writer 或无法证明 projection freshness 时，明确报告未决并停止架构交付。交接 scenario-architect 时只传稳定 fact 引用，不复制 owner 表。

完成检查：每个适用 fact 通过 AC-01～AC-07 反例检查；Authority Registry 是项目实例唯一源；决策取舍必要时升格 Decision；测试设计入口已标注 AC-08。
