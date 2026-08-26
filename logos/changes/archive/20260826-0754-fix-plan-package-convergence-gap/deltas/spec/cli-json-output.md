## ADDED — Plan Package completion JSON 契约（contract 1.3.0）

### 契约版本

status/next 响应出现 `plan_package`、`completion_issues` 或 dispatch `completion` 时，`data.contract.version` 必须为 `1.3.0`。字段只增不改；1.0.0～1.2.0 消费方按未知字段保守兼容。

### PlanPackageEvaluation

```json
{
  "schema": "openlogos/plan-package-evaluation@1",
  "contract_version": "1",
  "ready": false,
  "proposal": {"filled": false, "issues": []},
  "tasks": {
    "plan_filled": true,
    "code_required": true,
    "code_slices_filled": false,
    "issues": []
  },
  "issues": []
}
```

status/next 的模块级 `plan_state.plan_package` 承载完整对象；为便于旧 consumer 渐进迁移，`plan_state` 同时可投影 `completion_contract_version`、`completion_issues`、`proposal_filled`、`tasks_plan_filled`、`tasks_code_required`、`tasks_code_slices_filled`。投影存在时必须与对象逐字段一致。

### CompletionIssue

| 字段 | 必需 | 语义 |
|---|---|---|
| `code` | 是 | 稳定机器问题码 |
| `path` | 是 | 项目根相对路径 |
| `message` | 是 | locale 人读说明 |
| `fix_hint` | 是 | 可执行修复建议 |
| `section_id` | 否 | locale-independent section 语义 ID |
| `line` | 否 | 1-based 行号 |
| `actual` | 否 | 脱敏实际值 |
| `expected` | 否 | 期望值或 canonical 标题 |

首版问题码至少包含 proposal required section missing/duplicate/empty、placeholder remaining、change type invalid、deployment fields invalid、clarification invalid、tasks template remaining、code entry before spec-complete、code section missing。数组按共享 evaluator 顺序稳定输出。

### change-lint

检查成功但 L0 未通过仍使用 stdout success envelope、`data.pass=false`、exit 2，并携带 `data.plan_package`。L0 通过后才继续 L1～L9；最终 pass 必须与 plan_package.ready 等价。操作错误仍 stderr error envelope、exit 1。

### dispatch completion

`next_node.dispatch.completion`：

```json
{
  "command": "openlogos change-lint --slug fix-x --format json",
  "expected": {
    "/data/pass": true,
    "/data/plan_package/ready": true
  },
  "expected_proposal_step": "ready-to-delta"
}
```

`expected` 的 key 为 RFC 6901 JSON Pointer，value 为期望标量。未知 completion 字段允许忽略；无法执行或无法证明全部期望时不得报告完成。

### 等价、挂载与兼容

- 单模块 legacy 顶层与 `modules[]` 同构时，plan package 内容必须相同。
- 历史已越过 plan 的响应可省略新诊断或给 warning，但不得回退 proposal_step。
- 旧 CLI 无 completion contract 时，新宿主提示升级/sync，不解析 Markdown 猜测。
