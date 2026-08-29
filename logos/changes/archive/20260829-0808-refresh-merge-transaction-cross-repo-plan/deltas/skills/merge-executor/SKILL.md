## ADDED — 0.14.0 Merge transaction 执行合同（规范性覆盖）

> 本节适用于由 OpenLogos 0.14.0 创建或恢复的 merge transaction，并覆盖本 Skill 中与 `MERGE_APPLY_MANIFEST.json`、Base64 payload、Agent 直接写正式 target/metadata/marker 有关的旧步骤。历史协议仅可只读诊断。

### 角色边界

merge-executor 是 content slot 的语义合成者，不是正式目标 writer。执行者只能：

1. 读取事务提示、proposal/tasks、声明的 Delta、对应 canonical target 当前字节以及事务只读投影；
2. 为每个已声明 slot 计算最终文件字节；
3. 通过事务提供的受控 slot 提交入口写入该 slot；
4. 读回 slot 摘要，确认 `slot_id`、内容 SHA-256 与提交结果一致；
5. 停止并等待 Driver/核心执行 seal 与 apply。

执行者严禁创建、修改或补全 `MERGE_APPLY_MANIFEST.json`，严禁自行写 canonical target、metadata、dogfood、`SPEC_MERGED`、journal 或 receipt，严禁把工作单 done 宣称为 merge completed。

### 必须验证的身份

处理 slot 前必须逐字核对 transaction id、slug、slot id、delta path、target path、mode、source SHA-256 与 MODIFY 的 before SHA-256。任一事实漂移、slot 未声明、target 越界或 transaction phase 不允许 `submit_content` 时立即 fail-closed，并报告稳定 classification；不得改名、重排、增删目标或自动采用新基线。

### 内容合成

- Markdown Delta 按 ADDED/MODIFIED/REMOVED 指令与当前 target 语义合成最终态；不把控制 marker 写入正式内容。
- non-Markdown Delta 按首行整文件协议剥离 marker，剩余字节即 slot 最终态；不得局部拼接。
- CREATE 必须在 target 不存在的事实下生成完整文件；MODIFY 必须基于冻结的 before hash。
- metadata 由核心从 sealed resource closure 确定性生成，不为其开放人工 slot。
- no-delta 没有资源 slot；执行者不得为“完成任务”伪造空文件或 manifest。

### 交付与停止条件

全部必需 slot 提交并读回一致后，只报告：transaction id、已提交 slot id、每个 content SHA-256、缺失 slot 列表和当前只读 phase。此时 prepare/collecting 工作单完成，但 merge 节点尚未完成。只有核心完成 seal/apply 并持久化有效 completed receipt 后，Driver 才能宣告合并成功。

### 恢复

重试前先读取 transaction status，并仅执行 `allowed_actions` 许可的 slot 操作。sealed/applying/completed 状态禁止重写 slot；completed 时返回已有 receipt 摘要，不重复合成或写入。若看到旧 manifest 指令与本节冲突，返回 `legacy_manifest_rejected`，不得兼容降级。

### 跨仓与版本门

RunLogos 派发前必须冻结全局 `openlogos` 命令路径、精确版本 0.14.0、transaction schema hash 与 contract hash。任一不一致时停止；不得使用源码 checkout 或 0.13.x Skill 替代随包 0.14.0 合同。
