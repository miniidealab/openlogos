## ADDED — 分层验收（layered-verification）

> 规则权威见功能规格 §2.109。本节约定用例文档的主链路小节、两级验收，以及 verify 与项目测试入口（runner / reporter）之间的配合。

### 两级验收

| 级别 | 命令 | 验收集合 | 报告 |
|---|---|---|---|
| 提案级 | `openlogos verify` | 分层开启（`verify.layered.enabled: true`）：本提案用例 ∪ 受影响用例 ∪ 主链路用例；未开启：与原来相同 | `logos/resources/verify/acceptance-report.md` |
| 发布级 | `openlogos verify --release` | 全部不带 `[manual]` 的 UT/ST，恒为全量 | `logos/resources/verify/release/acceptance-report.md` |

提案级通过不等于可以发布。发布级结论与提交号绑定，提交变了即作废；用 `openlogos verify --release --check` 查询。

### 主链路小节

主链路用例是「坏了就等于产品不可用」的核心路径上的用例：少、快、绝对稳定。它写在测试用例文档里，是规格的一部分，随提案的 delta 评审。

写法：在测试用例文档中加一个二级或三级标题，标题文本为「主链路用例」（英文项目用 `Main Path Cases`），其下用列表列出本文档中属于主链路的用例 ID，ID 之后可以写说明：

```markdown
- UT-S01-01 — 用户能登录
- ST-S01-02
```

规则：

1. 只能列**本文档用例表中已定义**、且首格不带 `[manual]` 的 UT/ST。不能列 SMOKE，不能列人工用例。
2. 一个文档至多一个主链路小节；同一 ID 不重复。
3. **不在用例表首格加任何主链路标记**。首格语法不变，既有 reporter 与旧版 CLI 不需要任何修改。
4. 全项目主链路用例总数不超过 `verify.layered.main_path_max`（缺省 50）。
5. 主链路用例不得依赖复跑：分层开启时，主链路用例首跑失败、复跑通过不按偶发放行，verify 判 FAIL（`main_path_flaky`）。
6. 分层开启时，小节写错（`main_path_invalid`）或超过上限（`main_path_over_limit`）在执行任何预跑命令之前判 FAIL。分层未开启时，这些问题只由 `openlogos change-lint` 以警告给出。

### 三层集合与扩大

- **本提案用例**：已合并提案的测试变更集中的 UT/ST。
- **受影响用例**：受影响场景的测试用例文档（`<module>-SXX-test-cases.md`）中全部不带 `[manual]` 的 UT/ST。受影响场景 = 提案「受影响场景」段声明的场景 ∪ 提案 delta 触及的场景。
- **主链路用例**：全部主链路小节所列用例。

只扩大，不缩小：

| 情形 | 扩大到 |
|---|---|
| 没有活跃提案；提案起点不可用；改动命中共享配置或 `verify.layered.shared_paths`；声明写明涉及共享改动 | 全量 |
| 提案没有「受影响场景」段、该段非法或未填写、写了无法评估、声明了不存在的场景 | 按模块（按模块限定范围的结果，并保留声明中已识别的场景与 delta 触及的场景；不可用时为全量） |

声明中的共享标志只要能读出且为真就扩大到全量，即使声明的其余部分不可用。扩大不是失败，不改变门禁结论；原因写在 JSON `layers.expansion` 与验收报告中。

### 测试入口的义务

1. **变量不变**：分层收窄时 verify 注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（JSON 数组），格式与切片 checkpoint 相同；不新增变量。清单是**本次执行集合**：final 验收为三层合集；切片 checkpoint 为当前 eligible（三层合集的子集，不含尚未轮到的本提案用例）。提案级 final 验收**不**注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`，checkpoint 照旧注入。
2. **收到清单就按清单选文件**：只要收到 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`，就只启动覆盖清单内用例的测试文件，不以 `OPENLOGOS_VERIFY_SLICE_SCOPE` 或其他条件为前提。只在切片 checkpoint 才选文件的测试入口，在分层开启后仍会执行全量：门禁正确，但不省时。项目开启分层之前应先完成这项适配。
3. **verify 只采信清单内的结果**：三层合集之外的已定义用例的结果行不采信、不计入统计，也不判账本不自洽。verify 统计这些行的数量（`layers.outside_result_count`），大于 0 时给出警告 `layered_runner_not_narrowed`。这个警告只能发现「执行并上报了集合外用例」的入口；执行了集合外的文件但过滤了上报的入口，verify 无从得知。切片 checkpoint 的既有规则不变：尚未轮到的本提案用例（pending）不应执行，被提前上报时仍判 `result_outside_eligible_scope`；`owned` 范围的 checkpoint 只应执行并上报清单内的用例，额外上报任何其他已定义用例（包括基线用例）都判 `result_outside_eligible_scope`，不降为警告。
   **退出状态照常计入**：忽略集合外的结果行不等于忽略命令失败。入口因集合外用例失败而非零退出时，门禁仍为 `pre_run_failed`——这也是入口应当按清单收窄的原因之一。
4. **发布级必须实际执行**：`openlogos verify --release` 要求配置了可执行的测试命令，不接受只读取已有结果；执行时不注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_SLICE_SCOPE`，测试入口应执行全部用例。发布级对全部自动化用例严格判定跳过：只有带平台原因的跳过（`reason_code: "platform-unavailable"` 加非空 `detail`）被接受，其余 skip 判 `case_tier_mismatch`——不能用无理由的 skip 得到发布级通过。
5. 失败时保留失败记录、可以照常清空结果文件等既有义务（「失败用例复跑与偶发」）不变。

### 发布级验收的运行约定

- 前置：git 仓库、工作区干净（验收报告、结果文件、提案目录等 lifecycle 路径不算）、配置了测试命令。不满足时拒绝，不执行、不留记录。
- 提交号在执行前固定。运行期间不要切换分支、提交或修改源码；收尾时提交或工作区变了，这次运行判 FAIL（`release_commit_changed`），不算该提交的通过。
- 发布级验收不写、不删任何提案标记，不改写提案级验收报告与模块验收报告；`result_path` 会被本次全量结果覆盖。
- 环境预检没通过的运行不是发布级结论：不推翻此前的结论，也不算通过。
- 同一提交、同一平台上，以最近一次有结论的运行为准。

## MODIFIED — 验收历史留存（verification-history） > 三层数据与字段边界

| 层 | 位置 | 内容 |
|---|---|---|
| 中央索引 | `logos/resources/verify/history/<run_id>.json` | 只含结构化白名单字段（功能规格 §2.104.3）：`schema`、`run_id`、`kind`、`started_at`、`finished_at`、`outcome`、`gate`、`error_code`、`proposal`、`module_scope`、`verify_mode`、`attempted_slice_id`、`environment`、`deploy_id`、`counts`、`failed_ids`、`skipped_ids`、`uncovered_ids`、`flaky_ids`（可选，verify-flaky-rerun）、`level`、`platform`（可选，layered-verification）、`result_source`、`commit`、`cli_version`、`raw_location`；不含任何自由文本 |
| 提案完整记录 | `logos/changes/<slug>/verify-runs/<run_id>/` | `record.json`、`results.jsonl`、`report.md`；只在有活跃提案时写。发布级验收（`level: "release"`）不写 |
| 本机原文 | `logos/.openlogos-runtime/verify-runs/<run_id>/` | `report.md`、`results-raw.jsonl`；只在有活跃提案且 `verify.history.raw_in_proposal: false` 时写。发布级验收不写 |

- 自由文本字段：结果行中 `id`、`status`、`scenario`、`timestamp`、`duration_ms`、`environment`、`target_environment` 以外的全部字段（典型为 `error`、`detail`、`evidence`、`not_applicable_reason`、`missing_requirements`），以及报告正文。
- `verify.history.raw_in_proposal` 缺省 `true`：提案完整记录的 `results.jsonl` 为本次实际采集的完整结果、`report.md` 为报告快照；为 `false` 时提案完整记录只保留结构化字段，自由文本字段（按用例 ID 对应）与报告快照写到本机原文层。
- 没有活跃提案时只写中央索引（`proposal: null`、`raw_location: "none"`）。发布级验收无论有没有活跃提案都只写中央索引。
