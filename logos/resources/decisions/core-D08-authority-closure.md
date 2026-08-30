# D08：以单一语义权威和可重建投影闭合业务事实

- **状态**：accepted
- **日期**：2026-08-30
- **来源**：`institutionalize-single-authority-design-gate`；`runlogos-adopt-openlogos-merge-transaction-root-fix-plan.md`；D07 merge transaction 事故复盘

## 背景

同一业务事实或完成谓词被多个组件分别保存、解析和裁决时，正常路径可能长期看似一致，但响应丢失、重启、投影滞后、部分写入和切换回滚会暴露分歧。继续增加 marker 扫描、mtime 判断或 fallback 只能产生更多影子权威，使 bug 难以彻底修复。

## 决策

OpenLogos 方法论采用 Authority Closure：每个稳定 `fact_id` 只能有一个语义权威、一个受控 mutation entry 和一个同源 decision/evaluator。允许多个物理副本、缓存、索引、receipt 和读模型，但它们必须声明单向血缘、freshness proof、重建规则和不可反向裁决边界。

`spec/authority-closure.md` 是方法论合同唯一规范源；项目架构中的 Authority Registry 是项目实例；Skill 只引用规范并承担角色动作；proposal `authority_impact` 只记录本次变更计划；Decision 只保存本次取舍理由。任何消费者不得复制 owner 表、状态机或完成谓词形成第二裁决者。

writer ownership 迁移必须有限：先冻结 authority identity 与 before facts，停止旧 writer，启用新 mutation entry，重建并校验投影，最后以可验证 exit evidence 结束切换。长期双写、双读择优或从投影猜测权威不构成兼容方案。

## 理由

该模型把“数据一致”问题前移为“谁有权裁决”的设计问题。只要投影可被丢弃并由权威重建，局部陈旧不会演变成语义分叉；只要消费者复用 authority action/evaluator，修复判据时不需跨仓同步多套逻辑。它同时保留缓存、CQRS、事件日志和多副本的工程自由度。

## 备选方案

1. **只要求文档写“单一事实源”**：拒绝。没有 owner/writer/mutation/freshness/recovery/cutover 的结构字段，无法设计测试或机器门。
2. **在六个 Skill 中复制完整检查表**：拒绝。规则会独立漂移，本次治理本身会制造多个规范源。
3. **建立一个全局权威服务或单数据库**：拒绝。单一语义权威不等于单一物理系统，会造成不必要耦合。
4. **迁移期长期双写并由读者择新**：拒绝。它保留两个 writer 和冲突裁决器，不能形成闭包。
5. **一次性回填所有历史项目**：拒绝。会伪造历史 Why；采用后续触达事实渐进闭合。

## 影响面

- 架构设计新增项目 Authority Registry。
- change proposal 新增 `openlogos/authority-impact@1` 声明和共享 Plan Package evaluator 门。
- 场景、部署、测试和代码审查通过稳定 fact ID 消费同一权威实例。
- 安装态必须证明根规范、根 Skill、插件/cache 投影与 evaluator hash/行为一致。
- 已越过 plan 的历史提案不倒退；新提案和仍 writing 的提案严格执行。

## 不变量

- 每个 `fact_id` 恰有一个 authority owner、canonical state、sole writer 和 mutation entry。
- projection 不能成为恢复源或决策 fallback；freshness 不得只靠存在性、mtime 或扫描顺序。
- status、next、flow、lint 等同一结论的消费者必须调用共享 evaluator。
- 无法关闭旧 writer 或证明 cutover exit 时，变更保持未闭合，不得批准交付。

## 追溯

- 规范：`spec/authority-closure.md`
- 架构：`core-01-architecture-overview.md` 第三十六章
- 场景：S04、S06、S07、S09、S12、S16、S19、S35
- 测试：UT-S04-01～UT-S35-120、ST-S04-01～ST-S35-21、SMOKE-core-163～SMOKE-core-167
