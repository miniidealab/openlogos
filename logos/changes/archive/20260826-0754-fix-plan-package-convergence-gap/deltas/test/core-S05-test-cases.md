## ADDED — Plan Package completion 驱动的 next 测试

> 以下测试实现必须使用 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，ID 必须逐字匹配。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S05-30 | ready evaluation 推进 plan 前沿 | S05 Step 2→5 | 合法 proposal/tasks，无 Delta/approval | `resolveNext` 注入 `ready:true` | `proposal_step=ready-to-delta`，前沿为 plan-exit/write-delta 契约 |
| UT-S05-31 | 非 ready 保持 writing | EX-3.1 | evaluation 含 summary missing issue | 求值 next | `proposal_step=writing`，issue 原样保留，不出现可写 Delta 文案 |
| UT-S05-32 | completion command 自描述 | 完成声明 | plan producer dispatch | resolve next_node | command、两个 JSON Pointer expected、expected step 完整 |
| UT-S05-33 | 旧 CLI completion 缺失保守兼容 | EX-3.2 | contract <1.3.0 | 解析 next | 不伪造 completion；consumer 可识别升级路径 |
| UT-S05-34 | history bypass 不回退 | 兼容要求 | `SPEC_MERGED` 在场但旧模板非法 | 求值 next | 保持 post-plan 前沿；模板 warning 不改 proposal_step |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S05-14 | next 与 lint/status/flow 对合法及双反例一致 | Step 1→6、EX-3.1 | 合法、缺 summary、code checkbox 三 fixture | 分别运行四消费者 | 合法 ready；两反例 writing，issue code/path/section 一致 |
| ST-S05-15 | dispatch completion 可由宿主独立执行 | Step 6、EX-3.2 | 合法 plan 与损坏 plan | 读取 completion 并执行 command/JSON Pointer 断言 | 仅合法 plan 满足全部 expected；损坏 plan 不被 Agent 文案覆盖 |

### 追溯与覆盖

- S05-AC-Plan-01 合法 plan 下一步：UT-S05-30、ST-S05-14。
- S05-AC-Plan-02 非法 plan 不早报完成：UT-S05-31、ST-S05-14。
- S05-AC-Plan-03 宿主独立 completion：UT-S05-32、UT-S05-33、ST-S05-15。
- S05-AC-Plan-04 历史不回退：UT-S05-34。
