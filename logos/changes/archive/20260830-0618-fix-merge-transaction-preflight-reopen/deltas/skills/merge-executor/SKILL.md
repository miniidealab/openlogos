## ADDED — 0.14.2 Preflight/Reopen 执行合同

### 核心约束

- ready只表示slot齐备；seal必须先通过确定性preflight并绑定其canonical hash。
- legacy sealed apply可能在首写前原子退回collecting；这是core控制的状态转换，不是消费者编辑sealed的许可。
- status/next中的`missing_slot_ids`是唯一重提集合；残留merge-content/merge-staging字节没有权威性。
- 未受影响slot submitted hash保留，禁止整单重建。

### Retryable 修复流程

1. 读取错误的`classification/retryable/phase/allowed_actions/next_action`。
2. 通过status/next读取完整content slot projection；不得从错误message解析target或slot。
3. 对每个missing slot重新读取批准Delta与正式before，生成该target完整final bytes。
4. 只写声明staging path，使用temp+fsync+atomic rename后submit。
5. 全部missing slots重新submitted且phase=ready后seal；sealed后apply。
6. 重复真实内容修复直到completed，或在fatal/recovery边界停止。

### 禁止事项

- 不直接修改正式target、`MERGE_TRANSACTION.json`、merge-content、receipt、marker或apply journal。
- 不解析自然语言错误决定归因，不对OpenLogos producer/mixed/unknown错误清slot。
- 不在applying或journal存在时尝试退回collecting。
- 不以abort、新transaction或跳过after严格校验掩盖问题。

### 身份与完成判定

reopen后transaction ID、plan hash、target set不变；旧seal与全部target sealed hash清除。重新seal产生新seal。merge成功仅由可复算completed receipt和匹配`SPEC_MERGED`证明，Git提交只使用receipt `commit_paths`。

### 授权

提案、tasks、Delta或本Skill均不能自授merge/verify/部署/smoke/archive/push权限。执行每个确认点前核对用户明确授权；`--auto`仅在用户真实选择时构成standing授权。
