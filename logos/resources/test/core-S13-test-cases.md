# S13: 运行测试验收并生成报告 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-01 | 解析 JSONL | parseJsonl | 结果文件内容 | JSONL | 返回测试结果 |
| UT-S13-02 | 兼容执行 pre_run_command | verify 预跑 | 配置了单阶段测试命令 | verify | 先执行预跑命令，再读取结果 |
| UT-S13-03 | 两阶段预跑按回归 → 增量顺序执行 | verify 预跑 | 同时配置 regression / incremental 命令 | verify | 两阶段按顺序执行，重复 ID 最后一次结果生效 |
| UT-S13-04 | 覆盖不足且无预跑配置时输出诊断 | verify 诊断 | 无预跑配置且 JSONL 覆盖不足 | verify | 产生 FAIL 和局部测试诊断 |
| UT-S13-05 | verify JSON 输出包含 pre_run 状态 | verify JSON | 传入 --format json | verify --format json | 返回 pre_run.mode、commands、diagnostics 和 suggestions |
| UT-S13-24 | release 摘要双语字段与回退原因 | release summary parser | CHANGELOG 含中英文摘要映射 | version list | 生成英文主摘要、中文原文摘要和英文缺失回退原因 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-01 | 生成验收报告 | Step 1→9 | 存在测试结果 | verify | 写入 acceptance-report.md |
| ST-S13-02 | 单阶段 pre_run_command 验收通过 | Step 1→9 | 配置 pre_run_command 且结果完整 | verify | 先跑预执行命令，再生成 PASS 报告 |
| ST-S13-03 | 两阶段 regression + incremental 验收通过 | Step 1→9 | 配置两阶段命令且阶段结果完整 | verify | 两阶段结果合并后生成 PASS 报告 |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-04 | 无预跑配置且覆盖不足 | Step 1→9 | 未配置任何预跑命令且结果不完整 | verify | FAIL，并输出可能只运行局部测试的诊断和配置建议 |

## 三、覆盖度校验
- [x] JSONL 解析：已覆盖（UT-S13-01）
- [x] 单阶段 pre_run_command 兼容：已覆盖（UT-S13-02 / ST-S13-02）
- [x] 两阶段 regression + incremental：已覆盖（UT-S13-03 / ST-S13-03）
- [x] 覆盖不足诊断：已覆盖（UT-S13-04 / ST-S13-04）
- [x] verify JSON 状态输出：已覆盖（UT-S13-05）

## 四、smoke 覆盖预检测试用例

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-SMOKE-01 | 提取当前提案新增 smoke case ID | smoke coverage precheck | 活跃提案 deltas/test/smoke 中新增 `SMOKE-NEW-01` | proposal slug | 返回新增 ID 列表，不包含历史 smoke ID |
| UT-S13-SMOKE-02 | verify/code gate 发现新增 smoke case uncovered | smoke coverage precheck | 新增 smoke ID 存在，`smoke-results.jsonl` 缺少对应结果 | precheck | 返回 FAIL，诊断 `smoke_cases_uncovered` 并列出缺失 ID |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-SMOKE-01 | code 完成前阻断遗漏 smoke runner 的提案 | S13 Step 7a→7d | 活跃提案新增 smoke 用例，`[code]` 任务已尝试完成但无 runner/reporter | smoke 覆盖预检或 verify | 输出 `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`，不允许把 code completion 视为通过 |

### 4.3 覆盖度校验补充
- [ ] smoke 覆盖预检提取新增 ID：UT-S13-SMOKE-01
- [ ] smoke 覆盖预检 uncovered 诊断：UT-S13-SMOKE-02、ST-S13-SMOKE-01

## 八、verify 证据分层回归

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S13-30 | focused reporter pass + global verify failed 输出可恢复诊断 | `test-results.jsonl` 中本片要求的 UT/ST 均 pass；acceptance report 中存在其它失败测试 | 读取 verify JSON / 派生自动诊断 | 输出 `reason="global-verify-failed"`、`completion_state="slice_done_global_verify_failed"`、`failed_tests` 非空、`human_action_required=false` |
| UT-S13-31 | reporter 缺失本片 test ID 不等价全量失败 | 本片要求 `UT-Sxx-*`，但 `test-results.jsonl` 无对应记录 | 派生自动诊断 | 输出 `reporter-missing` 或 `focused-tests-missing`，`missing_artifacts` 或 `required_test_ids` 指明缺口 |
| ST-S13-09 | verify 失败列表可驱动 repair | 全量 verify 失败，失败用例可解析 | `next --auto --format json` 或等价 driver 诊断 | `suggested_next_node` 指向 `code` / repair，携带 `failed_tests`，不输出 `retry-exhausted` |

### 覆盖度校验

- [ ] focused tests / reporter pass 与全量 verify failed 可同时表达：UT-S13-30
- [ ] reporter 缺失有独立诊断：UT-S13-31
- [ ] 全量失败可驱动 repair：ST-S13-09

## 九、verify 诊断传播边界测试

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S13-32` / `ST-S13-10` 等 ID，供 verify 抽取覆盖。

### 9.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S13-32 | verify JSON 保留本次失败诊断 | verify JSON | 全量 verify 失败且可解析失败测试 | `openlogos verify --format json` | 输出 `automation_diagnostic.reason=="global-verify-failed"`、`failed_tests` 非空 |
| UT-S13-33 | verify 诊断不在 plan/spec 前沿自动传播为 repair | 诊断传播 | 同 UT-S13-32 后，活跃提案回到 `ready-to-merge` fixture | `next --auto --format json` | 不消费该 verify 诊断为 `suggested_next_node:"code"`；保留 merge command |
| UT-S13-34 | 只有当前实现/验证前沿消费 global verify failed | 诊断传播 | A: `coding` 且当前失败测试存在；B: `ready-to-delta` 且只有历史失败 | 分别执行 `next --format json` | A 可输出 repair/code 诊断；B 不输出可驱动 repair/code 诊断 |

### 9.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S13-10 | verify 输出诊断但后续非实现前沿不被抢占 | Step 1→9 + status/next | 先产生一次 verify failed，再构造同提案 `ready-to-merge` | `verify --format json` → `next --auto --format json` | verify 响应含失败诊断；next 响应仍返回 `openlogos merge <slug>` |

### 9.3 覆盖度校验补充

- [ ] verify 本身输出全量失败诊断：UT-S13-32
- [ ] verify 诊断不跨前沿覆盖 plan/spec/merge：UT-S13-33、ST-S13-10
- [ ] 当前实现/验证前沿仍可消费 repair 诊断：UT-S13-34

## 十、verify 结果账本一致性回归

### 10.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-35 | 非法 status 不得被判 PASS | verify consistency | 已定义 1 个自动化用例且该用例 pass；JSONL 另含同轮非法 `status:"unknown"` 结果 | `collectVerifyData` / `verify --format json` | `gate.result="FAIL"`，`gate.reason` 非空，`consistency.reasons` 包含 `invalid_test_result_status` |
| UT-S13-36 | 未定义结果 ID 不得污染 PASS | verify consistency | 已定义用例全部 pass；JSONL 另含 `UT-S13-GHOST` pass | `collectVerifyData` / `verify --format json` | `gate.result="FAIL"`，`consistency.unknown_result_ids` 包含 `UT-S13-GHOST`，不得写 `VERIFY_PASS` |
| UT-S13-37 | 统计守恒不成立时 FAIL | verify consistency | 结果集合可构造 `executed_count > defined_count` 或 `passed + failed + skipped != executed` | `collectVerifyData` | 输出 `result_ledger_inconsistent`，`pass_rate_pct < 100` 时不得 PASS |
| UT-S13-38 | 合法重复 ID 保持 last-write-wins | parse / consistency | 同一已定义 ID 先 fail 后 pass，且无额外非法行 | `parseJsonl` / `collectVerifyData` | 只保留最后一次结果；若所有定义用例最终 pass，则 Gate PASS |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-11 | 不自洽 verify 账本阻断全自动归档 | Step 7→9 | 活跃提案处于 ready-to-verify；JSONL 中 defined 用例均 pass，但另有非法 status 或未定义 ID 造成 pass_rate < 100 / executed > defined | `openlogos verify --format json` 后由 driver 读取 Gate | verify 退出非零，`gate.result="FAIL"`，不写 `VERIFY_PASS`，driver 不得继续 archive |

### 10.3 覆盖度校验补充

- [ ] 非法 status 硬门：UT-S13-35
- [ ] 未定义结果 ID 硬门：UT-S13-36
- [ ] 统计守恒硬门：UT-S13-37
- [ ] last-write-wins 正常兼容：UT-S13-38
- [ ] 全自动归档阻断：ST-S13-11
