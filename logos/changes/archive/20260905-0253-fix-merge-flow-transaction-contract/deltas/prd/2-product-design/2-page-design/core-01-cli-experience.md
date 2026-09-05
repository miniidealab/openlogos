## ADDED — 2.41 merge 事务引导与前沿推进反馈体验

### 2.41.1 merge 收尾提示（有 delta 情形）

`openlogos merge <slug>` 创建（或幂等返回 / 重建）合并事务后，收尾提示必须引导事务链，**不得再指向「执行 MERGE_PROMPT.md」**（生产路径不存在该文件）：

```text
✓ 合并事务已创建：mtx_<id>（phase: collecting）
下一步由 merge-executor 按事务合同执行：
  openlogos merge transaction submit-content --slot <id> --file <path>   # 逐 slot 提交最终内容
  openlogos merge transaction seal                                        # 冻结内容
  openlogos merge transaction apply                                       # 原子落盘并写 SPEC_MERGED
提示：openlogos next 已推进到 apply-merge 节点；status/next 的 data.merge_transaction 可随时查看事务相位。
```

- 幂等返回既有非终态事务时，提示体现「返回既有事务 + 当前 phase + next_action」；终态归档让位重建时体现「旧事务已归档，新事务已创建」。
- no-delta 情形保持既有「已写入 SPEC_MERGED」提示不变。

### 2.41.2 前沿推进反馈

- merge exit 0 后立刻执行 `openlogos next`：输出的当前步骤为 `merge-generated`、下一节点为 `apply-merge`（派 merge-executor），不再滞留「生成合并指令」。
- 事务各相位下 `next` 的引导语与事务 `next_action` 一致（collecting→submit-content、ready→seal、sealed→apply、failed 按 classification 给 recover/abort 指引、completed→SPEC_MERGED 已写），不改写事务动作语义。

### 2.41.3 存量事务失配与错误反馈

- 读到 contract/schema 摘要失配的存量事务时，错误文案必须包含：双方版本与摘要（事务内记录 vs 当前 CLI）、稳定错误码、标准恢复动作：

```text
Error [merge_transaction_contract_unsupported]: 存量事务合同与当前 CLI 不一致
  事务记录：schema sha256:6b55…（0.14.11）
  当前 CLI：schema sha256:556a…（0.14.19）
  处置：openlogos merge transaction abort 后重跑 openlogos merge <slug> 重开事务（不支持就地迁移）
```

- `status` / `next` 任何失败路径的默认文本输出必须携带稳定错误码前缀（`Error [<code>]: …`），`--format json` 走 stderr error envelope；不得出现无码纯文本失败。

### 2.41.4 非目标

- 本节是 CLI 文本体验，不改变事务动作语义与人类确认点；路径、ID、命令、协议字段、版本和错误码不翻译。
