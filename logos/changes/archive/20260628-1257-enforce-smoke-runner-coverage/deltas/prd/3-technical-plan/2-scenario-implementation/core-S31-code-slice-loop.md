## ADDED — smoke 用例变更下的切片闭环规则

当 `[code]` 切片对应的 delta 新增或修改 `logos/resources/test/smoke/*.md` 时，该切片的完成条件扩展为：

```text
slice_done = business_code_done
  ∧ ut_st_reporter_done
  ∧ smoke_runner_done
  ∧ smoke_reporter_done
  ∧ smoke_dispatcher_reachable
```

### 规则
1. `slice_state.current` 指向的 `[code]` 行若标注了 `SMOKE-*`，宿主注入给 code-implementor 的上下文必须包含这些 smoke ID。
2. code-implementor 开始实现前必须列出本片覆盖的 UT/ST/SMOKE ID。
3. 对新增 smoke ID，切片必须交付 runner、写入 `smoke-results.jsonl` 的 reporter、以及 `smoke.command` 或统一 dispatcher 接入。
4. 宿主只能在相关 UT/ST 通过、OpenLogos verify reporter 写入完整、smoke runner 覆盖预检通过后勾选该 `[code]` 行。
5. `verify` 仍跑全量回归；smoke 覆盖预检只阻止遗漏 runner/reporter 的切片被误勾，不替代部署后 `openlogos smoke`。

### 异常
- 如果 runner 已实现但 dispatcher 未接入，切片保持未完成，诊断为 `smoke_runner_missing`。
- 如果 dispatcher 已运行但没有写入新增 smoke ID 的结果，切片保持未完成，诊断为 `smoke_reporter_missing` 或 `smoke_cases_uncovered`。
- 如果新增 smoke case 被标记为 manual，仍必须明确写入 skip 结果并说明原因；不能让 ID 静默进入 uncovered。
