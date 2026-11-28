## ADDED — S35 受影响场景声明与主链路小节检查测试（layered-verification）

> 覆盖场景 `core-S35-change-lint.md`「S35 受影响场景声明与主链路小节的结构检查」（Step 1～6、EX-35T.1～EX-35T.4），功能规格 §2.109.3、§2.109.4；需求 AC-VERIFY-TIER-21。
>
> **夹具 LL**：一次性 launched 项目，已合并场景文档与测试用例文档 `core-S01`、`core-S02`；活跃提案 `ll-demo` 的各 canonical 段填写完整，「受影响场景」段按用例设置。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S35-231 | 缺段只警告 | Step 3、EX-9J.1 | 夹具 LL；删除「受影响场景」段 | `change-lint --format json` | `warnings` 含 `affected_scenarios_missing`；不计违规；退出码 0；`pass=true` |
| UT-S35-232 | 合法声明通过 | Step 3 | 夹具 LL；`assessment: assessed`、`scenarios: [S01]`（带理由）；另一情形 `scenarios: []` | `change-lint --format json` | 两种情形都没有该段相关的违规与警告 |
| UT-S35-233 | 未填写与结构非法报违规 | Step 3 | 夹具 LL；依次为：`assessment: pending`、YAML 损坏、没有 fenced YAML、`assessment: maybe`、`shared_change` 不是布尔、`scenarios` 项缺 `reason`、`reason` 为空、编号重复、`id` 不是场景编号形态 | `change-lint --format json` | 各情形违规 `affected_scenarios_invalid`，`detail` 指出具体问题并带 `fix_hint`；退出码 2 |
| UT-S35-234 | 场景不存在报违规 | Step 3 | 夹具 LL；`scenarios: [S01, S99]` | `change-lint --format json` | 违规 `affected_scenarios_invalid`，点名 S99 |
| UT-S35-235 | 引用本提案新建的场景合法 | EX-35T.1 | 夹具 LL；提案 `deltas/` 有 `core-S07-*.md` 场景文档；`scenarios: [S07]` | `change-lint --format json` | 没有该段相关的违规 |
| UT-S35-236 | 无法评估通过但提示 | Step 3 | 夹具 LL；`assessment: unknown` | `change-lint --format json` | 不计违规；`warnings` 含 `affected_scenarios_unknown` |
| UT-S35-237 | 主链路小节结构错误给出警告 | Step 6、EX-35T.4 | 夹具 LL；① 已合并的 `core-S01-test-cases.md` 主链路小节列未定义 ID；② 本提案 `deltas/test/core-S02-test-cases.md` 新增主链路小节并列一条 `[manual]` 用例 | `change-lint --format json` | 两种情形 `warnings` 含 `main_path_invalid`，给出文档、ID 与错误代码；不计违规，退出码不因此改变 |
| UT-S35-238 | 主链路超过上限给出警告 | Step 6、EX-35T.3 | 夹具 LL；`verify.layered.main_path_max: 1`；主链路共 2 条；另一情形项目没有任何主链路小节 | `change-lint --format json` | 前者 `warnings` 含 `main_path_over_limit`，给出上限与实际数量；后者没有主链路相关警告；分层开启与否都给出该警告，开启时文案注明 verify 会判 FAIL |
| UT-S35-239 | 与 verify 同一判定 | §2.109.4 | 夹具 LL；取 UT-S35-232～236 的各声明 | 分别调用声明读取与 `change-lint` | lint 报违规的声明，读取结果为 `invalid` 或 `scenario_unknown`；lint 通过的声明，读取结果为 `usable` 或 `unknown`；两者没有不一致的情形 |

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定。
