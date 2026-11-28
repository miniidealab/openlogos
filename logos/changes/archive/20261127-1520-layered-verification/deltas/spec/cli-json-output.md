## ADDED — verify 分层验收与发布级验收（layered-verification）

> 规则权威见功能规格 §2.109。以下字段、命令与取值全部为新增，既有字段的含义不变。

### verify `data` 的新增字段

```jsonc
{
  "level": "proposal",                 // "proposal" | "release"；0.16.27 起恒输出
  "layers": {                          // 只在分层开启的提案级验收输出
    "changed":   { "count": 1, "ids": ["UT-S01-04"] },
    "affected":  {
      "count": 5,
      "ids": ["UT-S01-01", "UT-S01-02", "UT-S01-03", "UT-S02-01", "UT-S02-02"],
      "scenarios": [
        { "id": "S01", "sources": ["delta"] },
        { "id": "S02", "sources": ["declared"] }
      ]
    },
    "main_path": {
      "count": 1,
      "limit": 50,
      "ids": ["UT-S03-01"],
      "problems": [],                  // 主链路小节的结构错误
      "flaky_ids": []                  // 本次被判为偶发的主链路用例
    },
    "total": { "count": 7, "ids": ["UT-S01-01", "…"] },       // 提案集合 P
    "execution": { "count": 7, "ids": ["UT-S01-01", "…"] },   // 本次执行集合 E；final 时等于 total
    "declaration": { "status": "usable", "detail": null },
    "expansion": { "level": "none", "reasons": [] },
    "outside_result_count": 0
  },
  "release": {                         // 只在发布级验收输出
    "commit": "c3c7a9e3772f3ffd56f33b35fd939c17ff6dce76",
    "platform": "darwin-arm64",
    "commit_unchanged": true,
    "worktree_clean": true,
    "head_at_finish": "c3c7a9e3772f3ffd56f33b35fd939c17ff6dce76"
  }
}
```

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `level` | string | 是 | `"proposal"`：`openlogos verify`；`"release"`：`openlogos verify --release` |
| `layers` | object | 否 | 分层开启（`verify.layered.enabled: true`）的提案级验收输出，含切片 checkpoint 与执行前判 FAIL 的响应；未开启或发布级时不出现 |
| `layers.changed` | object | 是 | 本提案用例：`count` 与按字典序的 `ids` |
| `layers.affected` | object | 是 | 受影响用例及其场景；`scenarios[].sources` 为 `"declared"`、`"delta"` 的非空子集。扩大到按模块或全量时 `ids` 为扩大后的取值，`scenarios` 仍列出声明与 delta 得到的场景 |
| `layers.main_path` | object | 是 | 主链路用例、生效上限、结构错误、本次偶发的主链路用例 |
| `layers.main_path.problems[]` | array | 是 | 每项 `{ file, id, code }`；`code` 为 `undefined_id` \| `manual_case` \| `not_ut_st` \| `duplicate_id` \| `duplicate_section` \| `item_without_id`；`id` 无法确定时为 null |
| `layers.total` | object | 是 | 提案集合 P（三层合集，或扩大后的集合）：`count` 与 `ids` |
| `layers.execution` | object | 是 | 本次执行集合 E：final 验收等于 `total`；切片 checkpoint 为当前 eligible（`total` 的子集，不含 pending）。注入测试入口的清单、`summary` 的已定义数、复跑集合都取它 |
| `layers.declaration` | object | 是 | 提案「受影响场景」段的可用性：`status` 为 `usable` \| `missing` \| `invalid` \| `unknown` \| `scenario_unknown`，没有活跃提案时为 `none`；`detail` 给出具体问题或 null。状态不是 `usable` 时，能读出的共享标志与已识别场景仍被采信（见 `expansion.reasons` 与 `affected.scenarios`） |
| `layers.expansion` | object | 是 | `level` 为 `"none"` \| `"module"` \| `"full"`；`reasons[]` 每项 `{ code, detail }` |
| `layers.outside_result_count` | integer | 是 | 结果文件中属于已定义用例但不在提案集合 `total` 内的行数；执行前判 FAIL 时为 0。checkpoint 中在 `total` 内但不在 `execution` 内的结果行（pending 被提前上报）不计入这里，照旧进入 `consistency.outside_eligible_result_ids`。`owned` 范围的 checkpoint 恒为 0：`execution` 之外的任何已定义用例的结果行都照旧进入 `outside_eligible_result_ids` |
| `release` | object | 否 | 发布级验收输出 |
| `release.commit` | string | 是 | 执行前固定的完整提交号 |
| `release.platform` | string | 是 | `<process.platform>-<process.arch>` |
| `release.commit_unchanged` / `release.worktree_clean` | boolean | 是 | 收尾复核结果；任一为 false 时 `gate.reason` 为 `release_commit_changed` |
| `release.head_at_finish` | string \| null | 是 | 收尾时读取到的 HEAD |

`layers.expansion.reasons[].code` 取值：

| 取值 | 扩大到 | 含义 |
|---|---|---|
| `no_active_change` | 全量 | 没有活跃提案 |
| `base_ref_unavailable` | 全量 | 提案起点不可用或差异计算失败；`detail` 写明具体情形 |
| `shared_path_changed` | 全量 | 改动命中共享配置或 `verify.layered.shared_paths`；`detail` 列出文件 |
| `shared_change_declared` | 全量 | 声明 `shared_change: true`（只要该标志可读出即采信，不要求声明其余部分合法） |
| `declaration_missing` | 按模块 | 提案没有「受影响场景」段 |
| `declaration_invalid` | 按模块 | 该段未填写或结构非法 |
| `assessment_unknown` | 按模块 | 声明 `assessment: unknown` |
| `scenario_unknown` | 按模块 | 声明了不存在的场景；`detail` 点名编号 |
| `module_scope_unavailable` | 全量 | 需要按模块扩大，但按模块限定范围未启用或其自身回落到全量 |

既有字段在分层开启时的取值：

- `summary.defined_count` 等计数、`uncovered_cases`、`failed_cases`：以 `layers.execution` 为已定义集合。
- `consistency`：final 验收与 `baseline` 范围的 checkpoint 中，提案集合 `layers.total` 之外的已定义用例的结果不计入 `outside_eligible_result_ids`，不产生 `result_outside_eligible_scope`；checkpoint 中 pending 用例被提前上报时照旧计入并判定。`owned` 范围的 checkpoint 完全沿用既有规则：`layers.execution` 之外的任何已定义用例的结果都计入并判 `result_outside_eligible_scope`。
- `rerun.requested_ids`：在 `layers.execution` 之内。
- `pre_run.commands[].status`：不因忽略集合外结果行而改变；测试入口因集合外用例失败而非零退出时，门禁照旧为 `pre_run_failed`。
- `scope`（按模块限定范围）：照旧输出其自身的计算结果。
- `report_path`：提案级为 `logos/resources/verify/acceptance-report.md`，发布级为 `logos/resources/verify/release/acceptance-report.md`。

发布级验收对全部不带 `[manual]` 的 UT/ST 严格判定跳过：平台跳过列入 `platform_skipped_cases`，其余 skip 列入 `tier_mismatch_cases` 并使 `gate.reason` 为 `case_tier_mismatch`；发布级不输出 `unclassified_skipped_cases` 警告。

发布级验收的 `data` 不含 `layers`、`verify_mode`、`attempted_slice_id`、`eligible_test_ids`、`pending_test_ids`、`manifest`、`checkpoint`、`test_change_set`、`scope`、`automation_diagnostic`；`smoke_precheck` 为未执行的空结果；`history.run_dir` 为 null、`history.raw_location` 为 `"none"`。

### `gate.reason` 新增取值

| 取值 | 含义 |
|---|---|
| `"main_path_invalid"` | 分层开启：主链路小节有结构错误（见 `layers.main_path.problems`）；执行预跑命令之前判定 |
| `"main_path_over_limit"` | 分层开启：主链路用例数超过 `verify.layered.main_path_max`；执行预跑命令之前判定 |
| `"main_path_flaky"` | 分层开启：主链路用例首跑失败、复跑通过（见 `layers.main_path.flaky_ids`） |
| `"release_commit_changed"` | 发布级：收尾时 HEAD 与执行前固定的提交不同，或工作区已不干净 |

优先级（FAIL 时取第一个命中者）：

- 提案级（分层开启）：环境预检类原因 → `test_change_set_invalid` → `main_path_invalid` → `main_path_over_limit` → `main_path_flaky` → 既有顺序（预跑失败一支的 `failed_cases` / `case_tier_mismatch` / `pre_run_failed`；否则 `result_ledger_inconsistent` → `failed_cases` → `case_tier_mismatch` → `incomplete_coverage`）。
- 发布级：环境预检类原因 → `release_commit_changed` → 既有顺序。
- 分层未开启的提案级：与引入前逐字一致。

`main_path_invalid` / `main_path_over_limit` 判 FAIL 的响应没有执行任何命令：`summary` 各计数为 0，`pre_run.commands` 为空，`rerun.skipped_reason` 为 `"precheck_failed"`，验收历史 `result_source` 为 `"none"`。

### `warnings` 新增取值

| 警告码 | 含义 |
|---|---|
| `layered_runner_not_narrowed` | 分层收窄生效，但结果文件中有验收集合之外的已定义用例的结果行（`layers.outside_result_count` 大于 0）；测试入口没有按清单收窄。执行了集合外文件但没有上报的入口不会触发 |
| `layered_config_invalid` | `verify.layered` 取值非法，非法项已按缺省值处理；`fields` 指出字段 |

### `openlogos verify --release [--format json]`

发布级全量验收。成功进入执行后，输出信封与 `openlogos verify --format json` 相同，`data.level` 为 `"release"` 并含 `data.release`。退出码：`gate.result` 为 PASS 时 0，否则 1。

前置条件不满足时输出错误信封，退出码 2，不执行任何命令、不写验收历史：

| 错误码 | 含义 | `error.details` |
|---|---|---|
| `RELEASE_VERIFY_NOT_GIT` | 项目不是 git 仓库，或 HEAD 无法解析为提交 | — |
| `RELEASE_VERIFY_DIRTY` | 工作区有未提交改动或未跟踪文件（lifecycle 路径除外） | `paths`：至多 20 条；`total`：总条数 |
| `RELEASE_VERIFY_NO_COMMAND` | 没有配置可执行的测试命令；发布级不接受只读取既有结果 | — |

### `openlogos verify --release --check [--commit <sha>] [--format json]`

只读查询：目标提交在当前平台上是否有有效的发布级结论。

```jsonc
{
  "level": "release",
  "commit": "c3c7a9e3772f3ffd56f33b35fd939c17ff6dce76",   // 目标提交的完整提交号
  "platform": "darwin-arm64",
  "valid": true,
  "reason": null,              // 见下表
  "latest": { /* 共用对象：run */ }   // 判定所依据的运行；没有时为 null
}
```

| `reason` | `valid` | 含义 |
|---|---|---|
| null | true | 目标提交在当前平台上最近一次有结论的发布级运行为 PASS |
| `"latest_failed"` | false | 该运行为 FAIL（此前即使有 PASS 也不再有效） |
| `"other_platform_only"` | false | 目标提交只在其他平台有结论 |
| `"other_commit_only"` | false | 只有其他提交的结论（提交变了即作废） |
| `"no_conclusive_run"` | false | 没有任何有结论的发布级运行 |

- 「有结论的发布级运行」：`kind=verify`、`level=release`、`outcome=completed`、`result_source=executed` 的记录。环境预检类原因判 FAIL 的运行（`result_source=none`）不是结论。
- `latest` 在 `other_platform_only`、`other_commit_only` 时为最近的那条其他平台 / 其他提交的结论，供调用方展示。
- 退出码：`valid` 为 true 时 0，否则 1。
- 错误信封（退出码 2）：`RELEASE_VERIFY_NOT_GIT`（未给 `--commit` 且不是 git 仓库）、`RELEASE_CHECK_COMMIT_INVALID`（`--commit` 无法解析为提交）。
- `--check` 与 `--commit` 只能与 `--release` 同用；`--commit` 只能与 `--check` 同用。否则为用法错误。

### `openlogos history list` 的新增筛选

`openlogos history list [--level proposal|release] [--commit <sha>] …`

- `--level`：只列出该级别的 verify 记录（缺少 `level` 字段的旧记录按 `proposal`）；smoke 记录不匹配任何 `--level`。
- `--commit`：`commit.head` 以给定值为前缀的记录。
- 与既有筛选（`--kind`、`--slug`、`--result`、`--module`、`--limit`）可以组合。`--level` 取值非法时为用法错误。

### 消费方约定

- 0.16.27 之前的输出没有 `level`，按 `"proposal"` 处理。
- 宿主展示验收结果时必须标明级别：提案级通过不等于可以发布。
- 判断「某个提交是否可以发布」时使用 `verify --release --check` 或按上面的口径读取历史，不要用提案级的 `gate.result`，也不要只看是否存在某条 PASS 记录。
- 多个目标平台的聚合由调用方完成：对每个平台分别取 `history list --level release --commit <sha>` 中最近一次有结论的运行。

## MODIFIED — 共用对象：run

`history list` 的元素与 `history show` 的 `run` 为中央索引记录本身（`schema: "openlogos/verification-run@1"`，字段闭合，见功能规格 §2.104.3）：

```jsonc
{
  "schema": "openlogos/verification-run@1",
  "run_id": "20261122T061530123Z-verify-a1b2c3",
  "kind": "verify" | "smoke",
  "started_at": "2026-11-22T06:15:30.123Z",
  "finished_at": "2026-11-22T06:16:02.004Z",
  "outcome": "completed" | "aborted",
  "gate": { "result": "PASS" | "FAIL" | null, "reason": "failed_cases" },
  "error_code": null,
  "proposal": { "slug": "vh-demo", "run_dir": "verify-runs/20261122T061530123Z-verify-a1b2c3" },  // 或 null
  "module_scope": ["core"],                // 或 null
  "verify_mode": "slice-checkpoint" | "final" | null,
  "attempted_slice_id": "slice-01-demo",   // 或 null
  "environment": null,                     // smoke 为目标环境 id
  "deploy_id": null,                       // smoke 为核对的 deploy_id
  "counts": { "defined": 3, "executed": 3, "passed": 1, "failed": 2, "skipped": 0, "uncovered": 0 },
  "failed_ids": ["UT-S01-01", "UT-S01-02"],
  "skipped_ids": [],
  "uncovered_ids": [],
  "flaky_ids": [],                         // 可选；verify 判为偶发的用例 ID（verify-flaky-rerun）
  "level": "proposal" | "release",         // 可选；verify 的验收级别（layered-verification）
  "platform": "darwin-arm64",              // 可选；verify 运行所在平台（layered-verification）
  "result_source": "executed" | "reused" | "none",
  "commit": { "head": "000ac05…", "dirty": false },
  "cli_version": "0.16.20",
  "raw_location": "proposal" | "local" | "none"
}
```

`result_source: "none"`（verify-self-sufficient-cases）出现在 verify 没有执行任何命令、也没有读取结果就判 FAIL 的记录中：环境预检类原因（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`），以及分层验收在执行前判定的 `main_path_invalid`、`main_path_over_limit`（layered-verification）。这类记录 `outcome` 为 `"completed"`，`gate.result` 为 `"FAIL"`、`gate.reason` 为该原因，`counts` 各项为 null，各 ID 数组为空。`history show` 对这类记录不给出逐用例结果；报告快照按既有留存策略提供——有活跃提案时从提案完整记录（`raw_in_proposal: true`）或本机原文目录（`raw_in_proposal: false`）读取，无活跃提案时只有中央索引、注明本次没有完整记录。0.16.24 之前的读取方把它当作损坏记录跳过并提示。

`flaky_ids`（verify-flaky-rerun）：0.16.26 起的 verify 记录恒写入，没有偶发用例时为空数组；smoke 记录不写。数组内的用例计入 `counts.passed`，不在 `failed_ids` 中。读取方遇到缺少该字段的记录按空数组处理；0.16.26 之前的读取方忽略该字段，照常读取记录。

`level`、`platform`（layered-verification）：0.16.27 起的 verify 记录恒写入；smoke 记录不写。发布级记录（`level: "release"`）的 `proposal` 为 null、`raw_location` 为 `"none"`、`verify_mode` 与 `module_scope` 为 null，`commit.head` 是执行前固定的提交号、`commit.dirty` 为 false；`history show` 对它不提供提案完整记录。读取方遇到缺少 `level` 的记录按 `"proposal"` 处理，缺少 `platform` 的按 null 处理；0.16.27 之前的读取方忽略这两个字段，照常读取记录。
