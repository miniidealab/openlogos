## ADDED — 2.44 合并事务单一权威与跨仓消费功能规格

### 2.44.1 功能目标与角色边界

OpenLogos 提供 `openlogos/merge-transaction@1` 作为规格合并唯一公共合同。OpenLogos 负责计划、canonical targets、metadata、状态机、校验、原子 apply、receipt 和 marker；Agent 只负责生产声明 slot 的最终原始字节；RunLogos 只读取 envelope、调度 Agent、等待 WorkUnit quiescent，并执行 OpenLogos 明确允许的下一动作。

旧 `MERGE_APPLY_MANIFEST.json`、Base64 payload、RunLogos 私有 target-set/preflight/prepared/receipt/error 表均不再是成功路径事实。

### 2.44.2 Transaction 状态与动作

phase 固定为：

- `collecting`：事务已计划，等待全部必需 content slot 可用且可校验；
- `sealed`：所有输入与 hash 已冻结，只允许 apply 或 status；
- `applying`：OpenLogos 按 journal 执行原子提交或恢复；
- `completed`：正式目标、metadata 和 marker 已全部提交，receipt 不可变；
- `failed`：发生不可恢复错误，当前 transaction 终止。

每个输出必须携带 `allowed_actions` 与 `next_action`。调用方只能执行该集合中的动作；phase 文本、deadline、文件存在性或本地重试表都不能覆盖动作权威。

### 2.44.3 Content slot 合同

每个 Agent slot 至少包含稳定 `slot_id`、opaque `target_ref`、项目内 `content_path`、`required` 与 `content_encoding="utf8-raw"`。Agent 不接收 canonical target 的写权限，只能在 transaction 指定目录按同目录临时文件加原子 rename 规则替换 slot。

OpenLogos 在 seal 时拒绝：缺失、多余、空文件、超限、symlink、路径逃逸、遗留临时文件、非法编码、validator 失败和 plan/hash 漂移。API/DB validator、decision/counter/index、resource index、根 spec/skill dogfood、UI prototype 绑定、test change set 和 marker 等确定性内容声明为 `producer=openlogos`，不分配 Agent slot。

### 2.44.4 错误与恢复体验

公共错误至少包含 `classification`、`code`、`stage`、`field_path`、`detail`、`next_safe_action`、`retryable` 与 `transaction_id`：

- 必需内容尚未到位：`collecting + waiting`，允许继续写 slot；
- Agent 内容语义或 validator 失败：`collecting + retryable`，允许原子替换对应 slot 后重新 seal；
- transaction schema、identity、路径越权、plan 漂移、内部 hash 不变量或不可恢复 journal 错误：`failed + fatal`；
- failed 为终态，不能对同一 transaction 宣称 `regenerate-content`，只能人工诊断、升级 candidate 或由 OpenLogos 显式创建新 transaction。

### 2.44.5 原子 apply 与 receipt

apply 复用 `applyBaselineClosureBatch()` 的预演、staging、backup、journal、原子 rename、回滚和崩溃恢复，但 manifest 仅为内部实现细节。正式批次包含 resources、metadata、prototype/dogfood、test change set 与 `SPEC_MERGED`；marker 最后提交。

completed receipt 至少冻结：schema/contract hash、transaction/plan/change/module identity、最终 phase、changed/created paths、final SHA-256、metadata summaries、test change set identity、`SPEC_MERGED` hash、精确 `commit_paths` 与完成时间。content slots、临时文件和私有 journal 不得进入 `commit_paths`。

### 2.44.6 no-delta、UI 与状态消费

- no-delta 使用零 Agent slot transaction，由 OpenLogos 直接 seal/apply，完成后产生同形 receipt；
- UI prototype 必须成为同批 OpenLogos target，或以不可变 UI receipt 绑定同一 `plan_hash` 并进入最终 receipt；
- status 只读返回同一 transaction 视图；next/flow 只投影动作权威；
- Plan Package completion 的 schema、identity、journal、dispatch 和 UI 投影与 merge transaction 完全分离。

### 2.44.7 0.14.0 与 RunLogos 验收

本功能以 `0.14.0` breaking candidate 交付。verify 通过后构建 npm tarball、记录 SHA-256、安装到本机全局并验证命令路径、版本、随包 schema/Skill 与 contract hash。RunLogos 必须调用该全局二进制完成 CREATE、MODIFY、mixed、no-delta、validator retry、崩溃恢复和 response-lost E2E；源码直连或 mock 不算验收。

本地全局 candidate 不构成 npm publish、tag、GitHub Release、官网发布或 push 授权。
