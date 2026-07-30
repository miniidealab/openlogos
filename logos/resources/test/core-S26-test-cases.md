# S26: cmd: 谓词在 next 求值 — 测试用例

> 复用 S22 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`）。
> 不改 `spec/flow/*.yaml`、真实 `logos/flow/`、`golden-baseline.test.ts` fixture。含 OpenLogos reporter。
> spawn 失败用 mock `child_process.spawn` 触发 `'error'` 或经 `opts.shell` 注入不可执行 shell。

## 一、单元测试用例
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S26-01 | done_when:cmd exit 0 → 节点 done、next 续推 | overlay add cmd:true（或退出 0 命令） | `next` | current 续推；结果字段 `cmd_satisfied:true`/`cmd_exit_code:0` |
| UT-S26-02 | done_when:cmd 非 0 → 保持 active + success envelope | cmd:exit 3 | `next --format json` | success envelope；`cmd_exit_code:3`/`cmd_satisfied:false`；节点 active |
| UT-S26-03 | done_when:cmd 超时 → 未 done 不崩溃 | cmd:sleep 5 + cmd_timeout_seconds:1 | `next` | `cmd_timed_out:true`；保持 active；进程被杀、不挂住 |
| UT-S26-04 | fail_when:cmd exit 0 → 节点 failed | fail_when cmd:true | `next` | `current_node.state:"failed"`、`cmd_predicate_field:"fail_when"` |
| UT-S26-05 | fail_when:cmd 非 0/超时（未命中）→ 继续评 done_when | fail_when cmd:false + done_when:file: | `next` | fail 未命中、按 done_when 求值 |
| UT-S26-06 | status 遇 cmd 节点 → pending、不执行命令 | overlay add cmd: 节点 | `status --format json` | `overlay_nodes[].state:"pending"`；命令未被调用（断言无副作用） |
| UT-S26-07 | watch 遇 cmd 节点 → pending、不执行 | 同上 | `watch`（初次 tick） | 同 status，pending、无副作用 |
| UT-S26-08 | next 求值瞬态：exit 0 后不写 marker、status 仍 pending | cmd:true | `next` 后再 `status` | 磁盘无新增 marker；status 仍 `pending`；再次 next 重新执行 |
| UT-S26-09 | cmd budget=1：两相邻 cmd 节点，单次 next 只执行第一个 | add 两个相邻 cmd 节点 | `next` | 只第一个被执行；第二个输出 current/pending、命令未调用 |
| UT-S26-10 | G1：命令大量 stdout（>64KiB）→ next --format json 单条合法 envelope 且不挂住 | cmd 打印大量输出后 exit 0 | `next --format json` | 单条 JSON、不挂住（drain 生效）|
| UT-S26-11 | 命令不存在（exit 127/9009）→ success envelope，非 spawn 失败 | cmd:nonexistent-cmd-xyz | `next --format json` | success envelope、`cmd_satisfied:false`；**不**报 FLOW_CMD_SPAWN_FAILED |
| UT-S26-12 | shell 起不来（'error' 事件）→ FLOW_CMD_SPAWN_FAILED | mock spawn / opts.shell 注入不可执行 shell | `next --format json` | error envelope、`code:"FLOW_CMD_SPAWN_FAILED"`、非零退出 |
| UT-S26-13 | 决策 A：cmd: 用于 builtin（modify）→ FLOW_SCHEMA_INVALID | overlay modify code.done_when=cmd: | 派生 | FLOW_SCHEMA_INVALID |
| UT-S26-14 | 决策 B：同节点 done_when + fail_when 双 cmd → FLOW_SCHEMA_INVALID | add 节点 done_when:cmd + fail_when:cmd | 派生 | FLOW_SCHEMA_INVALID |
| UT-S26-15 | cmd: 空命令 → FLOW_SCHEMA_INVALID | done_when:"cmd:" | 派生 | FLOW_SCHEMA_INVALID |
| UT-S26-16 | cmd_timeout_seconds = 0 / 负数 / 非整数 → FLOW_SCHEMA_INVALID | add 节点 cmd_timeout_seconds:0 | 派生 | FLOW_SCHEMA_INVALID |
| UT-S26-17 | 两级超时优先级：节点级 > 项目级 > 60s | 同时设节点级与 flow.cmd_timeout_seconds | 求值器取值 | 取节点级 |
| UT-S26-18 | 结果字段归属：done 后 current 续推，cmd_node_id 仍指被求值节点 | cmd:true | `next --format json` | `cmd_node_id` = 被求值的 cmd 节点 id |

## 二、场景测试用例
| ID | 描述 | 覆盖 Steps | 操作 | 预期 |
|----|------|-----------|------|------|
| ST-S26-01 | cmd 节点 next 通过 → 续推 | Step 1→4(done) | overlay add cmd:true → `next` | done 续推、结果字段正确 |
| ST-S26-02 | cmd 节点 next 未通过 → 重试提示 | Step 1→4(非0) | cmd:false → `next` | active、修复后重试、success envelope |
| ST-S26-03 | status/watch 显示 pending 不执行 | 观察派生 | `status` / `watch` | pending、无副作用 |
| ST-S26-04 | 无 cmd 项目 golden 零漂移 | golden | 同 fixture 无 cmd | `status`/`next --format json` 与 golden 锚点逐字节一致 |
| ST-S26-05 | stdout 隔离 + budget=1 端到端 | G1 + budget | 大输出 cmd + 相邻 cmd | 单 envelope、只执行第一个 cmd |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 操作 | 预期 |
|----|------|----------|------|------|
| ST-S26-EX-1 | 命令不存在 | EX-1 | cmd:nonexistent-xyz | 非 0 success envelope（非 spawn 失败）|
| ST-S26-EX-2 | shell 起不来 | EX-2 | mock spawn 'error' | FLOW_CMD_SPAWN_FAILED error envelope + 非零退出 |
| ST-S26-EX-3 | builtin cmd / 双 cmd / timeout<1 | EX-3 | 各非法 overlay | FLOW_SCHEMA_INVALID |

## 四、覆盖度校验清单
- [ ] 求值结果矩阵（done exit0/非0/超时、fail exit0/非命中）：UT-S26-01~05、ST-S26-01/02
- [ ] 观察 pending 不执行：UT-S26-06、UT-S26-07、ST-S26-03
- [ ] 瞬态 + budget=1：UT-S26-08、UT-S26-09、ST-S26-05
- [ ] G1 stdout 隔离/容量：UT-S26-10、ST-S26-05
- [ ] spawn 失败两类分界：UT-S26-11、UT-S26-12、ST-S26-EX-1、ST-S26-EX-2
- [ ] 决策 A/B + 谓词/超时校验：UT-S26-13~16、ST-S26-EX-3
- [ ] 超时优先级 + 结果字段归属：UT-S26-17、UT-S26-18
- [ ] golden 零漂移：ST-S26-04
