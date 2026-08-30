## ADDED — Delta closure 与 merge transaction 目标身份

### 三方身份对账

进入 merge transaction 前，proposal canonical target set、tasks `[delta]` 条目与磁盘 Delta 必须继续满足 `P = T = D`。核心据此创建不可变 target identity；每项至少包含：

- `delta_path` 与 canonical `target_path`；
- `mode=CREATE|MODIFY`；
- category/root ownership；
- 原始 Delta 的 `source_sha256`；
- MODIFY 的 `before_sha256`，CREATE 则明确目标不存在；
- 唯一 `slot_id`。

缺项、重复 target、路径越界、mode 与事实不符或 hash 漂移时不得创建可 seal 的事务。

### checkbox 语义

`[x] [delta]` 只表示该 Delta 已按当前目标基线写完、读回并通过 change-lint；它不表示内容已经进入正式 target。正式合并完成只由 completed receipt 证明。事务 collecting 阶段可消费已勾选任务建立 slot，但不得反向修改 tasks 来伪造 slot 完成。

### content slot 与职责

每个需要语义合成的 Delta 恰好对应一个资源 content slot。Agent 只能提交 slot 最终字节及其 hash；事务核心验证 slot identity，生成 metadata closure，并拥有所有正式写入。tasks 不得要求 Agent 创建/填写外部 manifest、写 metadata、写 `SPEC_MERGED` 或直接修改 canonical target。

### merge 后 `[code]` 切片

仅当事务 phase=`completed` 且 receipt 校验通过时，slice-planner 才能基于合并后的正式规格生成 `[code]`。每个切片必须引用正式规格中真实存在的 UT/ST ID；不得从未合并 Delta、Agent 回报或外部 manifest 推断测试集合。

### no-delta 与兼容

no-delta 仍创建空资源集合事务并生成 receipt；tasks 应明确记录 SKIP 理由，不能把无 `[delta]` 条目等同于 merge completed。历史任务可只读展示旧协议，但 0.14.0 新任务若要求 manifest/Base64 apply 必须被 lint 拒绝。本节覆盖本文档中与此冲突的旧任务模板。
