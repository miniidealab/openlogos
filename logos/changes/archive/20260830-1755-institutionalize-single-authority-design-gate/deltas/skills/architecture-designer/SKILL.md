## ADDED — Authority Closure 与 Authority Registry

### 规范源

执行本节前完整读取 `spec/authority-closure.md`。本 Skill 只定义 architecture-designer 的 producer 职责，不复制 AC-01～AC-08；冲突时根规范优先。

### 强制步骤：共享事实盘点

在技术选型前，从需求/场景提取跨组件、进程或仓库共享的业务事实和完成谓词，并盘点 cache/index/marker/receipt/view 等投影及 owner/writer/recovery/cutover 变化。适用 fact 必须进入架构 Authority Registry。

每行填写 `fact_id`、semantic scope、authority owner、canonical state、sole writer、mutation entry、decision/read API、projection consumer、freshness proof、rebuild rule、recovery source、forbidden shadow sources 和 cutover exit。`fact_id` 以业务语义命名，不绑定文件或类。

### Fail-closed

- 两个组件均可直接 write/decide：拆分 fact 或选择唯一 owner，不交付“共同权威”。
- projection 无 freshness/rebuild：降为 advisory 或移除，不能参与业务决策。
- 旧 writer 无法关闭或切换无终点：保持未决，不进入部署设计。
- 不得用“最后写入胜出”“读取时择新”“双方最终一致”替代 Authority Closure。

交接 scenario-architect、deployment-designer、test-writer 和 code-reviewer 时只传 `fact_id` 引用与适用范围；项目 Registry 保持唯一实例源。
