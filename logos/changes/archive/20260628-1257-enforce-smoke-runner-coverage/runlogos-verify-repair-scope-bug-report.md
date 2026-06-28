# Bug Report: RunLogos verify repair 路由为 verify-infra 时未放开 checklist 源文件，导致 checklist_incomplete 无法自动修复

## 背景

OpenLogos 提案 `enforce-smoke-runner-coverage` 在 code 阶段已完成实现与测试。

driver 随后运行 canonical verify：

```bash
openlogos verify --format json
```

verify 的运行时测试结果全部通过：

- `defined_count=617`
- `executed_count=968`
- `failed_count=0`
- `uncovered_count=0`
- `coverage_pct=100`
- `pass_rate_pct=100`
- `pre_run.commands[0].status=pass`
- `sandbox.status=pass`

但 Gate 仍失败：

```json
{
  "gate": {
    "result": "FAIL",
    "reason": "checklist_incomplete"
  },
  "checklist": {
    "total": 69,
    "checked": 66,
    "unchecked_items": [
      {
        "text": "smoke 切片任务描述完整：UT-S31-SMOKE-01",
        "file": "core-S31-test-cases.md"
      },
      {
        "text": "smoke 覆盖预检阻止误勾切片：UT-S31-SMOKE-02",
        "file": "core-S31-test-cases.md"
      },
      {
        "text": "smoke 切片端到端闭环：ST-S31-SMOKE-01",
        "file": "core-S31-test-cases.md"
      }
    ]
  }
}
```

这些 checklist 项对应的自动化测试已经通过，并已写入 `logos/resources/verify/test-results.jsonl`：

- `UT-S31-SMOKE-01`
- `UT-S31-SMOKE-02`
- `ST-S31-SMOKE-01`

## 现象

RunLogos driver 将本次失败路由为：

```text
[verify-infra] canonical verify 未通过
verifyReason: exit-nonzero
gate.reason=checklist_incomplete
```

但下发给 AI 的允许修改范围为：

```text
- logos/logos.config.json
- scripts/
- test/
- tests/
- logos/resources/verify/
```

同时禁止事项包含：

```text
不要修改规格文档来规避失败
```

因此 AI 无法修改真正的阻断源文件：

```text
logos/resources/test/core-S31-test-cases.md
```

该文件中的 3 个 checklist 行仍为未勾选：

```markdown
- [ ] smoke 切片任务描述完整：UT-S31-SMOKE-01
- [ ] smoke 覆盖预检阻止误勾切片：UT-S31-SMOKE-02
- [ ] smoke 切片端到端闭环：ST-S31-SMOKE-01
```

结果是：自动修复轮次只能修 verify infra 相关问题，不能修复当前 Gate 的真实失败原因，driver 自动重跑 verify 后仍会失败。

## 根因

RunLogos repair router 对 `gate.reason=checklist_incomplete` 的分类不正确。

`checklist_incomplete` 不是 verify infra 问题，也不是运行时代码测试失败。它表示 `openlogos verify` 解析到 `logos/resources/test/*-test-cases.md` 中的「三、覆盖度校验」仍有未勾项。

因此修复动作必须允许修改对应的测试规格文档 checklist，至少包括 verify 输出里的 `checklist.unchecked_items[].file` 对应文件。

当前 driver 将该失败归为 `[verify-infra]`，但 `[verify-infra]` 的修改范围不包含 `logos/resources/test/`，导致自动修复无法收敛。

## 期望行为

当 canonical verify 返回：

```json
{
  "gate": {
    "result": "FAIL",
    "reason": "checklist_incomplete"
  },
  "checklist": {
    "unchecked_items": [
      { "file": "core-S31-test-cases.md", "text": "..." }
    ]
  }
}
```

RunLogos driver 应该：

1. 不将该失败路由为 `verify-infra`。
2. 路由为类似 `[spec-checklist-repair]` / `[test-spec-repair]` / `[coverage-checklist-repair]` 的修复类型。
3. 允许修改范围包含对应文件：

   ```text
   logos/resources/test/core-S31-test-cases.md
   ```

   或通用放开：

   ```text
   logos/resources/test/**/*.md
   ```

4. 提示 AI 只能在满足以下条件时勾选 checklist：
   - 对应 UT/ST ID 已在 `test-results.jsonl` 中存在；
   - 对应结果为 `pass`；
   - checklist 文本与已通过用例语义一致；
   - 不得新增或伪造 `test-results.jsonl`；
   - 不得为了绕过 gate 删除 checklist 项。

5. 修复完成后等待 driver 自动重跑 `openlogos verify --format json`。

## 建议修复规则

### 路由规则

```text
if gate.reason == "checklist_incomplete":
  repair_type = "coverage-checklist-repair"
  allowed_paths = checklist.unchecked_items[].file mapped under logos/resources/test/
```

### AI 修复提示词建议

```text
[coverage-checklist-repair] canonical verify 未通过，请根据 checklist.unchecked_items 修复测试规格覆盖度勾选。

允许修改范围：
- logos/resources/test/<unchecked_items[].file>

禁止事项：
- 禁止修改源码来规避 checklist
- 禁止删除 checklist 项来规避 gate
- 禁止直接写入或伪造 logos/resources/verify/test-results.jsonl
- 禁止直接写入或伪造 acceptance-report.md / LOOP_ITERS / VERIFY_PASS / VERIFY_FAIL

要求：
- 仅当对应 UT/ST 用例已在 test-results.jsonl 中存在且 status=pass 时，才允许将 checklist 从 [ ] 改为 [x]
- 修改后停止，等待 driver 重跑 openlogos verify --format json
```

## 验收标准

- 当 verify 因 `checklist_incomplete` 失败时，driver 不再进入 `verify-infra` 修复分支。
- driver 下发的允许修改范围包含 `checklist.unchecked_items[].file` 对应测试规格文件。
- AI 能将已通过测试对应的 checklist 项勾选为 `[x]`。
- driver 重跑 `openlogos verify --format json` 后，不再因同一批 checklist 项失败。

