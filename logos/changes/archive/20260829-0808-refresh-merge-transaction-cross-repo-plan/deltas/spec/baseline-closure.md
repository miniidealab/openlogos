## ADDED — 合并事务中的 baseline closure

### 单一事务边界

当一次合并触碰受 baseline 管理的正式目标时，canonical resources 与由 OpenLogos 生产的 metadata 必须属于同一个 `merge transaction`。事务目标闭包由 seal 前的 canonical target set 加确定性 metadata expansion 得出；任何消费者不得在 seal 后增删目标。

闭包至少覆盖：

- proposal 声明的所有 canonical resource targets；
- 这些目标触发的 `logos-project.yaml` 场景计数器、资源索引及 ownership 元数据；
- OpenLogos 仓内 dogfood 镜像；
- `SPEC_MERGED` 或等价完成 marker；
- completed receipt 本身及其持久化索引。

### 内容槽与身份冻结

每个需要 Agent 合成的资源目标对应一个声明式 `content_slot`。slot 身份至少包含 `slot_id`、`delta_path`、`target_path`、`mode`、`source_sha256` 与 `before_sha256`；Agent 只提交最终字节。metadata 目标由核心根据 sealed resources 确定性生成，不开放 Agent 可写 slot。

`seal` 必须在任何正式写入前验证：目标集合唯一、路径位于允许根、delta/source hash 匹配、MODIFY 的 before hash 匹配、CREATE 不存在、全部必需 slot 已填充且内容 hash 可复算。校验失败不得产生正式目标副作用。

### 原子 apply 与恢复

核心事务 writer 必须先预演完整闭包，再以全有或全无方式提交 resources、metadata、dogfood 与 marker。崩溃恢复以持久化 transaction journal 和 seal hash 为依据：

- 未开始正式写入时可安全重试 apply；
- 已完成全部写入但 receipt 未持久化时，复核目标 hash 后补写同一 receipt；
- 任一目标与 sealed hash 不符时进入 `failed`，给出稳定 classification，不得将部分态标为 completed；
- 对 completed 事务重复 apply 必须返回同一 receipt，且不重写目标。

### no-delta 与历史边界

no-delta 事务的 resource target set 可以为空，但 metadata closure、seal、apply 与 receipt 规则不变。历史 manifest 只可作为迁移诊断输入，不能充当 0.14.0 新事务的写入授权或成功证明。本节优先于本文件中任何“逐目标 apply 后再补 metadata/marker”的旧描述。

### 完成判定

只有同时满足以下条件才可进入 `completed`：sealed closure 完整、所有 after hash 已复核、metadata 与 resources 属于同一提交、marker 指向同一 transaction id、completed receipt 已持久化且通过 `openlogos/merge-transaction@1` 校验。
