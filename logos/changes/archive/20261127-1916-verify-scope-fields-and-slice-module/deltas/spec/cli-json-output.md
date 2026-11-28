## MODIFIED — verify `scope` 按模块限定范围字段 > 字段

```jsonc
"scope": {
  "mode": "module",                  // "module" | "all" | "fallback-full"
  "modules": ["core", "portal-web"],   // 本次范围内的模块 id，按 logos-project.yaml 中的顺序
  "reasons": [                       // mode=module 时列出每个模块进入范围的依据；其余模式为 []
    { "module": "portal-web", "source": "proposal", "ref": "module-scoped-demo" },
    { "module": "portal-web", "source": "delta", "ref": "deltas/test/portal-web-S50-test-cases.md" },
    { "module": "core", "source": "path", "ref": "src-tauri/src/protocol.rs" }
  ],
  "fallback_reason": null,           // mode=fallback-full 时为 { "code", "detail" }，否则 null
  "out_of_scope_result_count": 0     // 被忽略的范围外结果行数
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | `module`：按范围 M 执行与核对。`all`：传入 `--all`，按全部模块执行与核对。`fallback-full`：已启用模块范围，但本次无法可靠确定范围，按全部模块执行与核对。 |
| `modules` | string[] | 本次范围内的模块 id，按 `logos-project.yaml` 中的顺序。`all` / `fallback-full` 时为全部已登记模块。 |
| `reasons` | object[] | 仅 `mode=module` 时非空，每条为 `{ module, source, ref }`。`source` 取 `proposal`（提案归属模块，`ref` 为提案 slug）、`delta`（delta 目标文件前缀，`ref` 为 delta 相对提案目录的路径）、`spec`（`logos/resources/` 下带模块前缀的规格文件被改动，`ref` 为文件路径）或 `path`（改动文件命中 `modules[].paths`，`ref` 为文件路径）。同一模块可以有多条依据。 |
| `fallback_reason` | object \| null | 仅 `mode=fallback-full` 时为 `{ code, detail }`，否则为 `null`。`code` 取值见下表；`detail` 写明具体文件或原因。 |
| `out_of_scope_result_count` | integer | 结果文件中属于范围外模块用例的行数。这些行被忽略：不判未定义、不判 `outside_eligible`、不计入 `summary` 统计。`all` / `fallback-full` 时恒为 0。 |

`fallback_reason.code` 取值：

| code | 含义 |
|------|------|
| `no_active_change` | 没有活跃提案，无法确定提案归属与改动 |
| `base_ref_missing` | guard 没有 `baseRef`（引入前创建的提案） |
| `not_git_repository` | 项目不是 git 仓库 |
| `base_ref_unreachable` | `baseRef` 指向的提交不存在（如历史被改写） |
| `diff_failed` | 计算改动文件集合的 git 命令失败 |
| `shared_config_changed` | `logos/logos.config.json` 或 `logos/logos-project.yaml` 按字段判断为相关变化：相关字段或清单未列出的字段有变化，或任一侧原文无法严格解析（功能规格 §2.96.3.1）。只有无关字段变化时不产生本原因。`detail` 逐个文件写明：`<路径>（<字段>、<字段>…）`（字段按字典序），或 `<路径>（提案起点中的内容<原因>）` / `<路径>（工作区中的内容<原因>）`，原因为 `不存在`、`读取失败`、`无法解析`、`顶层不是对象` 之一；两个文件都命中时用 `、` 连接，`logos/logos.config.json` 在前 |
| `unmapped_file` | 有改动文件一个模块也归不到；`detail` 为首个文件路径与总数 |
| `module_paths_invalid` | 某模块的 `paths` 不合法；`detail` 点名模块与非法项 |

## MODIFIED — verify `data` 的新增字段

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
| `shared_path_changed` | 全量 | 改动命中 `verify.layered.shared_paths`，或两个共享验收配置文件按字段判断为相关变化（功能规格 §2.96.3.1，含无法判断；只有无关字段变化时不命中）；`detail` 列出命中的文件，共享验收配置文件的写法同 `scope.fallback_reason` 的 `shared_config_changed`，被 `shared_paths` 显式列出的只写路径 |
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

## MODIFIED — openlogos slice plan 输出合同 > 稳定错误码

| 错误码 | 触发 |
|---|---|
| `SLICE_PLAN_INPUT_INVALID` | `slices.json` 非法 JSON、非数组、数组为空、缺必需字段 |
| `SLICE_PLAN_DUPLICATE_SLICE_ID` | `slice_id` 在提案内重复 |
| `SLICE_PLAN_UNKNOWN_TEST_ID` | `owned_test_ids` 含未在已合并测试规格中定义的 ID；或本提案变更用例没有被任何切片认领、被多个切片认领（validator 违规 `test-slice-test-id-unknown` / `test-slice-test-id-missing` / `test-slice-test-id-duplicate`，现行口径，行为不变）。exit 1，明细在 stderr 错误信封顶层的 `violations` |
| `SLICE_PLAN_NO_ACTIVE_CHANGE` | 无活跃提案、提案目录缺失，或 `--slug` 指向的不是活跃提案（guard 的 `activeChange` 与之不同、没有 guard 或 guard 无法解析；功能规格 §2.110.1）。拒绝时 `tasks.md` 与切片清单保持原内容（exit 1） |
| `SLICE_PLAN_VERIFY_SCOPE_AMBIGUOUS` | 旧 manifest 缺失或不可用，且 checkpoint 账本中当前划分在 `baseline` 与 `owned` 两个候选身份下都有 PASS 行，无法唯一恢复冻结的验收范围；错误 envelope 点名两个候选身份与命中的 `slice_id`（exit 1） |
| `SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID` | 需要判定验收范围时，`verify.slice_scope` 不在 `auto` / `baseline` / `owned` 内，或 `verify.slice_scope_threshold` 不是正整数；沿用与账本恢复路径不触发（exit 1） |

**零副作用（强制）**：任一错误码触发时，`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 均不得被修改。
