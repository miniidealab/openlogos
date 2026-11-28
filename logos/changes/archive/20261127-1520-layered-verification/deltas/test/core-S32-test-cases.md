## ADDED — S32 分层开启时切片 checkpoint 基线部分测试（layered-verification）

> 覆盖场景 `core-S32-slice-planning.md`「S32 分层开启时切片 checkpoint 的基线部分」（Step 1～5、EX-32.33～EX-32.37），以及 `core-S13-verify-results.md` 的 EX-13.54，功能规格 §2.109.6、§2.109.8、§2.109.9；需求 AC-VERIFY-TIER-13。
>
> **夹具 LS**：一次性 git 项目，单模块 `core`（launched）。已合并测试规格 `core-S01`（UT-S01-01～03）、`core-S02`（UT-S02-01、02）、`core-S03`（UT-S03-01、02，主链路小节列 UT-S03-01）、`core-S90`（本提案新增 UT-S90-01～03）。活跃提案有有效的切片清单：slice-a 拥有 UT-S90-01、02，slice-b 拥有 UT-S90-03；当前尝试 slice-a。提案声明 `scenarios: [S02]`；delta 触及 S90。记录型入口同 S13 夹具 LV。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S32-118 | baseline 范围的基线部分为受影响 ∪ 主链路 | §2.109.9、Step 1～5 | 夹具 LS；切片清单 `verify_scope: baseline`；`verify.layered.enabled: true` | `verify --format json` | `eligible_test_ids` = S02 的全部用例 ∪ {UT-S03-01} ∪ {UT-S90-01、02}；不含 S01 的用例与 UT-S03-02；`pending_test_ids=["UT-S90-03"]`；入口收到的清单等于 eligible（不是提案集合），`SLICE_SCOPE="baseline"`；`layers.execution.ids` 等于 eligible，`layers.total.ids` 为提案集合（含 UT-S90-03）；`summary.defined_count` 等于 eligible 的条数；入口没有上报 UT-S90-03，`uncovered_cases` 为空，checkpoint PASS |
| UT-S32-119 | owned 范围与分层无关，越界规则不变 | §2.109.8、EX-32.33 | 夹具 LS；`verify_scope: owned`；分层开启。① 入口按清单执行；② 入口零退出、UT-S90-01、02 都 pass，另外上报一条提案集合之外的基线用例 UT-S01-01（pass） | `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① `eligible_test_ids=["UT-S90-01","UT-S90-02"]`，入口收到的清单与之相同，与分层未开启时一致，checkpoint PASS；② `consistency.outside_eligible_result_ids` 含 UT-S01-01，原因含 `result_outside_eligible_scope`，`gate.result="FAIL"`，checkpoint 记为 FAIL；`layers.outside_result_count=0`，没有 `layered_runner_not_narrowed` |
| UT-S32-120 | 分层未开启时与引入前一致 | EX-32.34 | 夹具 LS；`verify_scope: baseline`；`enabled: false` | `verify --format json` | 基线部分为全部非本提案用例；输出与引入前 golden 一致（`level` 除外） |
| UT-S32-121 | 扩大时 checkpoint 随之扩大 | EX-32.35 | 夹具 LS；`verify_scope: baseline`；分层开启；声明改为 `shared_change: true` | `verify --format json` | 基线部分为全部非本提案用例；`layers.expansion.level="full"`，原因 `shared_change_declared` |
| UT-S32-122 | 受影响场景中的 pending 用例不提前进入 | EX-32.36 | 夹具 LS；`verify_scope: baseline`；分层开启；声明追加 S90 | `verify --format json` | UT-S90-03 仍在 `pending_test_ids`，不在 eligible 中 |
| UT-S32-124 | pending 被提前上报仍按 checkpoint 规则判越界 | §2.109.8、EX-32.36、EX-13.54 | 夹具 LS；`verify_scope: baseline`；分层开启；入口改为忽略清单。① 只额外上报 pending 的 UT-S90-03；② 只额外上报提案集合之外的 UT-S01-01 | `verify --format json` | ① `consistency.outside_eligible_result_ids` 含 UT-S90-03，原因含 `result_outside_eligible_scope`，checkpoint FAIL；`layers.outside_result_count=0`；② 不判越界，`outside_result_count=1`，警告 `layered_runner_not_narrowed`，checkpoint 按 eligible 判定为 PASS |
| UT-S32-125 | 按模块扩大的 baseline checkpoint 保留模块外已识别场景 | §2.109.7、§2.109.9、EX-32.35 | 多模块夹具（同 S13 的 LV-mod：`core`、`backend`、`web` 各有命令组，主链路在 `core-S03`），活跃提案有切片清单、`verify_scope: baseline`、当前切片拥有 `backend` 的一条本提案用例；代码只改动 `backend/**`；声明 `scenarios: [S07, S99]`（S07 属 `web`，S99 不存在）；分层开启 | `verify --format json`；读取各入口的调用记录 | `layers.expansion.level="module"`、原因 `scenario_unknown`；`web-S07` 的普通基线用例同时出现在 `web` 入口收到的清单与 `layers.execution.ids` 中；`backend` 模块的基线用例、主链路用例与本片 owned 也在其中；pending 的本提案用例不在；`web`、`backend`、`core` 三个命令组都被执行 |
| UT-S32-123 | checkpoint 同样受主链路约束 | EX-32.37 | 夹具 LS；分层开启；① `main_path_max: 1`、主链路共 2 条；② UT-S03-01 首跑 fail、复跑 pass | `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① 入口未被调用，`gate.reason="main_path_over_limit"`；② `gate.reason="main_path_flaky"`；两种情形 checkpoint 记为 FAIL，切片不计入已确认 |

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定。
