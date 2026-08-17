## ADDED — 场景 CREATE canonical 结构与兼容校验

### 适用与输出所有权

当 change-writer 依据 on-touch-v1 把场景目标标为 CREATE 并咨询本 Skill 时，返回的完整文档必须遵循 `spec/baseline-closure.md` §17。change-writer 仍是目标唯一 Delta writer；本 Skill 不另写第二份文件。

### canonical 章节与内容门

新场景固定使用：`场景目标`、`参与者`、`前置条件`、`成功后置条件`、`时序图`、`步骤说明`、`异常与边界`、`追溯`。其中步骤标题只能写 `## 步骤说明`，不得为新文档选择同义标题。

步骤说明必须满足：

1. 唯一一个步骤章节；
2. 至少 3 个非空有序列表项；
3. 每项有明确主语；
4. 与 Mermaid `Step N` 主路径一一对应；
5. 异常只在正常步骤中引用，详细内容放 `异常与边界`。

时序图必须位于合法 `mermaid` fence，声明 `sequenceDiagram`、至少两个适用参与者和至少一条消息；每条消息保持单行并带 `Step N:`。异常/边界与追溯章节都必须包含非空权威正文，不得用注释、代码样例或占位文本满足完整度。

### 兼容读取说明

CLI 为读取存量文档兼容 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path` 的精确标题。该集合不改变本 Skill 的 canonical 输出，也不允许用“标题或散文包含步骤二字”代替真实有序列表。

### 返回前检查

- 从磁盘或待返回最终文本重读：标题唯一、至少 3 步、列表非空、Mermaid 参与者/消息齐备、异常/追溯非空。
- 明确 API/RPC/消息与持久化派生结论，供 api-designer/db-designer 判定适用或 SKIP。
- 给出需求 AC、EX 与真实 UT/ST ID 追溯；不使用通配或占位 ID。
- 将检查结论交回 change-writer；最终由 change-writer 运行 `openlogos change-lint` 到 exit 0。
