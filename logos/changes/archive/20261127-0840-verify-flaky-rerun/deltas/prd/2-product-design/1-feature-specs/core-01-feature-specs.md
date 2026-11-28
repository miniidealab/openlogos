## ADDED — 2.108 verify 失败用例复跑与偶发判定（verify-flaky-rerun）

> 来源变更：verify-flaky-rerun（openlogos #6；决策 C01～C03）。需求见 `core-01-requirements.md`「verify 失败用例复跑与偶发判定需求（verify-flaky-rerun）」。

### 2.108.1 问题

verify 把预跑命令产生的每个失败用例都当作真失败。负载导致的偶发失败因此触发一轮修复与重新验收；项目的替代做法是把用例放进自带的剔除清单，等于放弃验证。分层验收的每晚全量还会把偶发失败写成阻断发布的缺陷。

### 2.108.2 配置

`logos/logos.config.json`：

```jsonc
"verify": {
  "rerun_failed": {
    "enabled": true,     // 缺省 true
    "max_cases": 10      // 缺省 10，正整数
  }
}
```

- 整个对象可省略，省略等价于缺省值。
- `enabled` 不是布尔、`max_cases` 不是正整数，或 `rerun_failed` 不是对象时：非法项按缺省值处理，`warnings` 增加 `rerun_config_invalid` 并指出字段；不因此改变门禁结论。
- 只有项目级配置，不提供 `verify.modules.<id>` 下的覆盖。

### 2.108.3 触发条件

预跑命令全部执行完、结果读取并归一化之后、门禁计算之前，按下列顺序判断，命中第一条即不复跑，并把对应取值写入 `rerun.skipped_reason`：

| 顺序 | 情形 | `skipped_reason` |
|---|---|---|
| 1 | 环境预检类原因命中（§2.106.5），未执行预跑 | `precheck_failed` |
| 2 | `enabled` 为 false | `disabled` |
| 3 | 本次没有执行任何预跑命令（未配置，或只读取既有结果） | `no_command` |
| 4 | `test_change_set_invalid` 命中（§2.106.6 第 3 条） | `gate_blocked` |
| 5 | 归一化结果中没有 `status:"fail"` 的规格内 UT/ST | `no_failed_cases` |
| 6 | 复跑集合（§2.108.4）大小超过 `max_cases` | `too_many_failures` |
| 7 | 需要复跑的命令组，其首跑执行环境全部无法继续使用（§2.108.5 第 4 条） | `sandbox_unavailable` |

第 1～6 条在复跑前判定；第 7 条在执行复跑时判定。都未命中时执行复跑，`rerun.attempted` 为 true、`skipped_reason` 为 null。只有部分命令组的执行环境不可用时，其余命令组照常复跑，`attempted` 为 true，不可用的命令组在 `rerun.commands[]` 中单独标出（§2.108.9）。

第 5 条包含「预跑命令非零退出，但测试入口把结果账本回滚成了上一份完好结果」的形态（S13 EX-9.1）：verify 看不到失败用例，无从复跑，门禁照旧为 `pre_run_failed`。

### 2.108.4 复跑集合

复跑集合 R = 归一化结果中 `status:"fail"` 的用例 ∩ 规格中定义的 UT/ST ∩ 本轮应执行集合。

- 本轮应执行集合：切片 checkpoint 为本轮 eligible（§2.101）；启用模块范围时为范围内用例（§2.96）；其余为全部规格内 UT/ST。
- SMOKE、未知 ID、`[manual]` 用例不进入 R。
- R 按用例 ID 字典序排列后使用。

### 2.108.5 执行

1. **快照**：复跑前，verify 保存首跑的归一化结果，包括：
   - 每个用例 ID 的生效记录，以及该生效记录的**来源**（产生它的命令组与阶段，见第 2 条）；
   - 首跑中按本轮范围与既有规则应计入一致性检查的诊断——典型为非法行（`spec/test-results.md` 归一化规则第 6 条）的行号与原因。这些诊断随快照保留到最终门禁，不因复跑期间结果文件被清空或覆盖而消失（§2.108.6）。
2. **确定来源并选命令组**：首跑的每个命令组、每一段（单阶段的 `pre_run_command`，两阶段的 `regression_command` / `incremental_command`，启用模块范围时各模块命令组的各段）结束时，verify 都单独采集该次输出——两阶段共用 `result_path` 时同样逐段清空、逐段采集（既有行为）。因此每条有效记录都有确定的来源。同一 ID 在多个来源出现时（`spec/test-results.md` 允许跨阶段重复），按既有去重规则选出生效记录，并保留该生效记录的来源。
   - R 内每个用例只分派给其生效记录的来源，在该来源复跑一次；不向其他阶段或命令组分派。
   - 只再执行至少分派到一个用例的来源。
   - 来源无法确定的用例（防御性规则，正常不会出现）不复跑，维持失败。
3. **注入变量**（只对复跑生效，复跑结束后恢复）：
   - `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`：分派给该来源的 R 子集（JSON 数组）；
   - `OPENLOGOS_VERIFY_RERUN=1`；
   - 首跑时注入的其余变量（`OPENLOGOS_VERIFY_MODULES`、`OPENLOGOS_VERIFY_SLICE_SCOPE` 等）保持首跑取值。
4. **执行环境**：与首跑同一个执行环境，不重新创建、不重新准备依赖；沙箱写入白名单、超时与输出截获规则与首跑相同，隔离要求不放宽。
   - 首跑在沙箱副本内执行：复跑在同一副本内执行。为此，首跑所用副本须保留到本次复跑决策结束——一次性副本（`sandbox_reuse: false`，或持久沙箱被占用、不支持复用时退回的一次性副本）推迟删除：R 求出后，没有分派到用例的命令组副本立即删除，分派到用例的在其复跑结束后删除；持久副本在此期间保持本次占用。
   - 首跑在工作区执行（`sandbox_mode: off`，或既有规则下未使用沙箱）：复跑也在工作区原地执行。
   - 同一副本确实无法继续使用（目录已不存在或已被重置、本次占用无法保持等）：该命令组不复跑，不新建副本、不退回工作区执行；分派给它的用例维持失败，`error` 取首跑记录的，诊断说明首跑执行环境不可用。分派到用例的命令组全部不可用时，`rerun.attempted=false`、`skipped_reason="sandbox_unavailable"`（§2.108.3 第 7 条）。
5. **采集**：每次复跑执行前，verify 清空该来源对应的结果路径；执行结束后立即采集该路径，与首跑的逐段采集方式相同。这次采集即该来源的复跑输出。
6. 每个命令组最多复跑一次。复跑命令的退出码如实记录。

### 2.108.6 结果合并与偶发判定

复跑结束后，verify 以首跑快照为底合并：

- **R 之外的用例**：一律取首跑快照中的记录。复跑期间测试入口清空、覆盖结果文件，或写入了 R 之外的记录，都不改变这些用例的结论。
- **R 之内的用例**，只看**其来源**本次复跑采集（§2.108.5 第 5 条）中该 ID 的有效记录；同一次采集内同一 ID 有多条时，按既有去重规则选一条：
  - 为 `pass` → 该用例最终计为通过，并列入偶发用例；
  - 为 `fail` → 维持失败，`error` 取复跑记录的；
  - 为 `skip`，或该次采集中没有该 ID 的有效记录 → 维持失败，`error` 取首跑记录的，并在诊断中说明复跑未产生通过结果。
- 「新记录」以采集边界判定：出现在该来源复跑采集中的记录即为新记录，**不比较 timestamp**。复跑记录不写 timestamp、只精确到秒或与首跑同刻，都不影响采信；复跑没有任何输出时，分派给该来源的用例全部维持失败。

**一致性诊断不被复跑抹掉**：首跑快照中的一致性诊断原样保留到最终门禁；复跑采集中的非法行同样计入诊断（注明来自复跑）。偶发判定不抵消这些诊断——首跑账本有非法行时，即使 R 内用例全部判为偶发、合并后没有失败与未覆盖、命令组改判为通过，门禁仍按既有优先级为 `result_ledger_inconsistent`，验收报告保留非法行原因，不写 `VERIFY_PASS`。

合并后的有效记录与保留的一致性诊断共同构成本次 verify 的最终结果，后续的统计、一致性检查、跳过分类（§2.106.6）与门禁都以它为输入。写回 `result_path` 时写入合并后的有效记录，并按原文保留首跑与复跑中计入诊断的非法行，使之后只读取既有结果的 verify 得出相同的一致性结论。

### 2.108.7 命令组状态

- 首跑命令组非零退出，且该命令组对应的 R 子集非空、复跑命令零退出、子集内用例全部判为偶发 → 该命令组在门禁中按通过计。
- 其余情况，命令组状态取首跑的——包括因首跑执行环境不可用而未执行复跑的命令组（§2.108.5 第 4 条）：首跑零退出的仍按通过计，首跑非零退出的仍按失败计，不因 `sandbox_unavailable` 另行改判。
- `pre_run.commands[]` 中的 `status` 与 `exit_code` 始终是首跑的事实，不改写；改判结果记在 `rerun.commands[]`（§2.108.9）。

残余风险：首跑的非零退出若还有用例失败之外的原因（例如某个测试文件崩溃），这条改判会放过它。由既有检查兜底——崩溃的测试文件会留下未覆盖用例（`incomplete_coverage`）或不自洽的账本（`result_ledger_inconsistent`）。

### 2.108.8 门禁

复跑不新增门禁原因，只改变既有优先级（§2.75.1、§2.106.7）的输入：

- 「预跑命令是否非零退出」取 §2.108.7 改判后的命令组状态；
- 「失败用例」取 §2.108.6 合并后的结果。

因此：仍有失败用例时照旧 `failed_cases`；全部变为偶发且命令组改判为通过时，进入「预跑命令全部成功」一支，按其余判据继续。

门禁 PASS 且存在偶发用例时：`warnings` 增加 `flaky_cases_present`，`VERIFY_PASS` 照常写入。门禁 FAIL 时偶发用例照常列出，不加该警告。

### 2.108.9 输出

**JSON**（`verify --format json` 的 `data`，字段定义见 `spec/cli-json-output.md`）：

- `rerun`：0.16.26 起恒输出。`attempted`、`skipped_reason`、`max_cases`、`requested_ids`（R）、`commands[]`（每个分派到用例的命令组：阶段、模块、分派的用例、首跑退出码、复跑退出码、改判后状态；因首跑执行环境不可用而未复跑时，该项仍保留，复跑退出码为 null，并标出 `sandbox_unavailable`，改判后状态取首跑的命令组状态）。
- `flaky_cases[]`：每项 `{ id, module, first_error }`；为空时不出现。`first_error` 取首跑记录的 `error`，没有则为 null。

**验收报告**：存在偶发用例时，`acceptance-report.md` 增加「偶发用例」小节，逐条列出用例 ID、所属模块与首跑错误摘要，并注明「首跑失败、同一沙箱内复跑通过；请确认不是首次运行改变了环境」。报告不写命令输出（EX-9.5 不变）。多模块项目的模块验收报告按用例所属模块各自列出。

**文本模式**：门禁结论之后输出偶发用例清单与同一句提示。

**验收历史**：中央索引记录新增 `flaky_ids`（§2.104.3）。偶发用例计入 `counts.passed`，不计入 `counts.failed`，不进入 `failed_ids`。

### 2.108.10 与既有规则的关系

- **项目自带的剔除清单**：是项目测试入口写出的 skip，用例不执行，不受本节影响。
- **跳过分类（§2.106.6）**：在合并后的结果上进行；R 内用例复跑记录为 skip 时已按 §2.108.6 维持失败，不进入跳过分类。
- **切片 checkpoint**：复跑发生在 checkpoint 判定之前；偶发用例按通过计入 checkpoint。
- **结果路径运行锁（§2.104.6）**：复跑在同一把锁内进行。
- **smoke**：不受影响。

### 2.108.11 兼容性

- 首跑没有失败用例的 verify：除新增 `rerun` 字段外，输出、门禁与退出码不变。
- 升级后「首跑失败、复跑通过」由 FAIL 变为带警告的 PASS（C03，默认开启）；`enabled: false` 恢复 0.16.25 的行为。
- JSON 只新增字段与警告码；历史记录只新增可选字段。

### 2.108.12 验收

AC-VERIFY-RERUN-01～13；测试 `core-S13-test-cases.md`（UT-S13-180 起、ST-S13-44 起）；安装态 smoke SMOKE-core-347 起。

## MODIFIED — 2.104.3 中央索引字段（白名单）

`schema: "openlogos/verification-run@1"`，闭合字段：

| 字段 | 说明 |
|---|---|
| `run_id` | `<UTC 时间戳 YYYYMMDDTHHMMSSmmmZ>-<kind>-<6 位小写十六进制随机>`，全局唯一，同时是文件名 |
| `kind` | `"verify"` \| `"smoke"` |
| `started_at` / `finished_at` | ISO 8601 UTC |
| `outcome` | `"completed"`（到达最终门禁）\| `"aborted"`（进入执行后早退） |
| `gate` | `{ "result": "PASS" \| "FAIL" \| null, "reason": string \| null }`，取同一次调用的最终判定；`aborted` 时 `result` 为 null |
| `error_code` | 早退时沿用的既有错误码；`completed` 时为 null |
| `proposal` | `{ "slug": string, "run_dir": "verify-runs/<run_id>" }` 或 null；`run_dir` 是提案目录内相对位置，不含归档日期或绝对路径 |
| `module_scope` | 本次有效模块范围（模块 id 升序数组；未启用按模块区分时为 null） |
| `verify_mode` / `attempted_slice_id` | verify 的 `"slice-checkpoint"` \| `"final"` \| null 与对应切片 id；smoke 为 null |
| `environment` / `deploy_id` | smoke 的目标环境与核对的 deploy_id；verify 为 null |
| `counts` | `{ defined, executed, passed, failed, skipped, uncovered }`，早退时只填已取得的项、其余为 null；`result_source` 为 `"none"` 时各项为 null |
| `failed_ids` / `skipped_ids` / `uncovered_ids` | 用例 ID 数组，按 ID 字典序；`result_source` 为 `"none"` 时为空数组 |
| `flaky_ids` | 可选。verify 判为偶发的用例 ID 数组（§2.108），按 ID 字典序；0.16.26 起的 verify 记录恒写入，没有偶发时为空数组；smoke 记录不写。这些用例计入 `counts.passed`，不在 `failed_ids` 中（verify-flaky-rerun） |
| `result_source` | `"executed"`（本次调用执行了预跑 / 两阶段命令或 smoke 命令）\| `"reused"`（只读取既有结果文件）\| `"none"`（verify 环境预检类原因判 FAIL，既未执行命令也未读取结果；verify-self-sufficient-cases，§2.106.5） |
| `commit` | `{ "head": string \| null, "dirty": boolean \| null }`，非 git 项目为 null |
| `cli_version` | 产生该记录的 CLI 版本 |
| `raw_location` | `"proposal"` \| `"local"` \| `"none"`（无活跃提案时） |

中央索引**不得**包含 runner `detail`、断言 `error`、命令输出、报告正文或任何其他自由文本。

读取兼容：0.16.24 起的读取方接受 `result_source` 的三个取值；更早版本的读取方把含 `"none"` 的记录当作损坏记录跳过并提示（既有「损坏的历史文件在查询时被跳过」规则），不影响其他记录。`flaky_ids` 缺失时读取方按空数组处理；该字段存在但不是字符串数组时按损坏记录处理。0.16.26 之前的读取方忽略该字段，照常读取记录。
