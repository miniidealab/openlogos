## ADDED — Authority Closure / Shadow Authority 审查

### 输入

先读 `spec/authority-closure.md`、项目 Authority Registry、有效场景和测试规格。Registry 是 fact ownership 唯一实例源，reviewer 不另建 owner 表。

### 逐 fact 检查

1. canonical state 只有 sole writer，写入只经 mutation entry。
2. consumer 调用 authority decision/共享 evaluator，不复制谓词或状态机。
3. projection 只读、校验 freshness、可由 authority 重建。
4. response lost/restart 只从 authority/receipt 恢复。
5. 旧 writer、旧 parser、fallback scan 已删除或不可达。
6. cutover 有退出证据，迁移 feature flag 不永久保留双写。

### Critical

旁路写、复制完成判据、marker/mtime/目录扫描反推、stale cache fallback、projection 覆盖 authority、两个 writer 都能成功、缺少冲突/重启负向测试，均按 Critical 报告。报告必须含 `fact_id`、代码位置、违反的 AC、修复动作和测试 ID；注释或“最终一致”声明不能关闭问题。

AC-01～AC-07 Critical 未清零不得批准；风格类问题仍按 Info/Warning，不扩大本门范围。
