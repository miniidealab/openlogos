## ADDED — 失败用例复跑与偶发（verify-flaky-rerun）

> 规则权威见功能规格 §2.108。本节约定 verify 与项目测试入口（runner / reporter）之间的配合。

### verify 做什么

预跑命令执行完、结果里有失败的 UT/ST 时，verify 在同一个沙箱内把这些失败用例再跑一次。复跑通过的用例是**偶发用例**：最终计为通过，但在 JSON 输出、验收报告与验收历史中单独列出。复跑仍失败、被跳过或没有新结果的用例，维持失败。

复跑在首跑所用的同一个执行环境内进行：verify 把首跑的沙箱副本（含一次性副本）保留到复跑结束；副本确实无法继续使用时不复跑、不新建副本，相关用例维持失败。

每次 verify 最多复跑一次。失败用例数超过 `verify.rerun_failed.max_cases`（缺省 10）时不复跑。`verify.rerun_failed.enabled: false` 可关闭。

### 复跑时注入的变量

| 变量 | 取值 |
|---|---|
| `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` | 本次要复跑的用例 ID（JSON 数组）；已在切片或模块范围下求过交集 |
| `OPENLOGOS_VERIFY_RERUN` | `1`；首跑时不设置 |
| 首跑注入的其余变量 | 保持首跑取值 |

verify 执行的是同一条已配置的命令（`pre_run_command`，或对应阶段、对应模块的命令），不需要为复跑单独配置命令。每个失败用例只交给首跑中产生其生效记录的那一个命令（阶段），只复跑一次。

### 测试入口的义务

1. **按集合收窄**：收到 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 时，只执行、只输出集合内的用例。测试 ID 到测试文件的映射由各项目自行决定（与切片 checkpoint 的既有约定相同）。没有收窄时 verify 仍能得出正确结论——集合之外的记录不采信——但复跑会白跑一遍全量。
2. **失败时保留失败记录**：命令以非零状态退出时，结果文件中必须留有失败用例的 `status:"fail"` 记录。失败后把结果文件回滚成上一份完好结果、或清空结果文件的测试入口，verify 看不到失败用例，无从复跑，门禁只能给出 `pre_run_failed`。
3. **可以照常清空结果文件**：verify 在每次复跑前会清空该命令对应的结果路径、结束后立即读取（与首跑逐段读取相同）；测试入口启动时再按「清空策略」清空一次也无妨。verify 在复跑前保存了首跑结果的快照，集合之外的用例以快照为准。
4. **不要为复跑写 skip**：集合内的用例在复跑中写 skip，verify 按「未产生通过结果」处理，该用例维持失败。
5. **timestamp 不是复跑采信的前提**：复跑输出中出现的记录即视为本次复跑的新记录，不与首跑比较 timestamp；不写 timestamp 或只精确到秒的 reporter 同样适用。

### 结果怎么合并

- 集合之外的用例：取首跑结果，复跑期间写入的任何记录都不采信。
- 集合之内的用例：只看该用例生效记录来源（命令组与阶段）本次复跑的输出，其中出现的有效记录即为新记录（同一次输出内多条时按既有去重规则选一条）；没有新记录时维持首跑的失败。
- 首跑账本中的非法行：随快照保留到最终门禁，复跑清空结果文件不会抹掉它们；复跑输出中的非法行同样计入诊断。有非法行时即使全部失败用例都判为偶发，门禁仍 FAIL（命令组改判为通过时主原因为 `result_ledger_inconsistent`），不写 `VERIFY_PASS`。
- 合并后的有效记录写回 `result_path`（计入诊断的非法行按原文保留），是本次 verify 的最终结果。

### 偶发不等于没有问题

第一次运行改变了环境、使第二次恰好通过的缺陷，同样会被判为偶发（例如第一次运行创建了被测代码所需的目录）。所以：

- 偶发用例不并入普通通过，始终单独列出；
- 验收历史按运行记录 `flaky_ids`，同一条用例反复偶发时应排查，而不是继续依赖复跑；
- 是否把用例放进项目自带的剔除清单，仍由人决定；verify 不会自动剔除。

### 与项目自带剔除清单的关系

项目可以在自己的测试入口里维护一份「暂不执行」的清单（写出带原因的 skip）。它与复跑互不影响：剔除清单里的用例不执行，自然不会失败、不会复跑；复跑只针对执行了并且失败的用例。

## MODIFIED — 验收历史留存（verification-history） > 三层数据与字段边界

| 层 | 位置 | 内容 |
|---|---|---|
| 中央索引 | `logos/resources/verify/history/<run_id>.json` | 只含结构化白名单字段（功能规格 §2.104.3）：`schema`、`run_id`、`kind`、`started_at`、`finished_at`、`outcome`、`gate`、`error_code`、`proposal`、`module_scope`、`verify_mode`、`attempted_slice_id`、`environment`、`deploy_id`、`counts`、`failed_ids`、`skipped_ids`、`uncovered_ids`、`flaky_ids`（可选，verify-flaky-rerun）、`result_source`、`commit`、`cli_version`、`raw_location`；不含任何自由文本 |
| 提案完整记录 | `logos/changes/<slug>/verify-runs/<run_id>/` | `record.json`、`results.jsonl`、`report.md`；只在有活跃提案时写 |
| 本机原文 | `logos/.openlogos-runtime/verify-runs/<run_id>/` | `report.md`、`results-raw.jsonl`；只在有活跃提案且 `verify.history.raw_in_proposal: false` 时写 |

- 自由文本字段：结果行中 `id`、`status`、`scenario`、`timestamp`、`duration_ms`、`environment`、`target_environment` 以外的全部字段（典型为 `error`、`detail`、`evidence`、`not_applicable_reason`、`missing_requirements`），以及报告正文。
- `verify.history.raw_in_proposal` 缺省 `true`：提案完整记录的 `results.jsonl` 为本次实际采集的完整结果、`report.md` 为报告快照；为 `false` 时提案完整记录只保留结构化字段，自由文本字段（按用例 ID 对应）与报告快照写到本机原文层。
- 没有活跃提案时只写中央索引（`proposal: null`、`raw_location: "none"`）。
