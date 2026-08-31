## ADDED — Shadow Authority Critical 审查门（规范引用）

审查前读取 `spec/authority-closure.md`、项目 Authority Registry、场景和测试追溯。本段只定义 reviewer 行为，不维护 owner/writer 的第二份清单。

逐 `fact_id` 验证：canonical state 只有 sole writer；所有写入经过 mutation entry；消费者调用 authority decision/共享 evaluator；projection 只读且校验 freshness；response lost/restart 从 authority/receipt 恢复；旧 writer、旧 parser 和 fallback scan 已删除或不可达；cutover 有 exit evidence。

以下均为 Critical：旁路写权威；复制完成谓词/状态机；从 marker、mtime、目录或 stale cache 反推决定；projection 覆盖 authority；feature flag 永久保留两个 writer；测试未制造冲突副本/新进程恢复。只加注释或声称“最终一致”不能关闭问题。

报告按 fact_id 给出证据、代码位置、违反的 AC、所需删除/收口动作和对应 UT/ST。AC-01～AC-07 任一 Critical 未清零即不得批准交付。
