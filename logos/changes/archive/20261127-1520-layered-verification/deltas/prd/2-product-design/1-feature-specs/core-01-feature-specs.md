## ADDED — 2.109 分层验收：主链路、受影响场景、提案级与发布级（layered-verification）

> 来源变更：layered-verification（openlogos #5；决策 C01～C06）。需求见 `core-01-requirements.md`「verify 分层验收需求（layered-verification）」。设计依据：`runlogos` 仓库 `logos/resources/reference/layered-verification-design.md`。

### 2.109.1 两级验收

| 级别 | 命令 | 回答什么 | 验收集合 |
|---|---|---|---|
| 提案级 | `openlogos verify` | 改动做对了，而且没有破坏核心吗 | 分层开启：本提案用例 ∪ 受影响用例 ∪ 主链路用例；未开启：与引入前相同 |
| 发布级 | `openlogos verify --release` | 产品整体可以交付吗 | 全部不带 `[manual]` 的 UT/ST，恒为全量 |

切片 checkpoint（§2.101）仍属提案级之内。三者逐层包含：切片 ⊂ 提案 ⊂ 发布。

### 2.109.2 配置

`logos/logos.config.json`：

```jsonc
"verify": {
  "layered": {
    "enabled": false,        // 缺省 false
    "main_path_max": 50,     // 缺省 50，正整数
    "shared_paths": [        // 缺省如下；glob，语法同 modules[].paths（§2.96.1）
      "**/package.json", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
      "**/Cargo.toml", "**/Cargo.lock", "**/go.mod", "**/go.sum",
      "**/pyproject.toml", "**/requirements*.txt"
    ]
  }
}
```

- 整个对象可省略，省略等价于缺省值。配置了 `shared_paths` 时以配置值**替换**缺省清单（可以写空数组）。
- `logos/logos.config.json` 与 `logos/logos-project.yaml` 恒按共享配置处理（§2.96.3 的既有口径），不受 `shared_paths` 影响。
- `layered` 不是对象、`enabled` 不是布尔、`main_path_max` 不是正整数、`shared_paths` 不是合法 glob 字符串数组时：非法项按缺省值处理，`warnings` 增加 `layered_config_invalid` 并指出字段；不因此改变门禁结论。
- 只有项目级配置。发布级验收不读取 `enabled`。

### 2.109.3 主链路小节

主链路标记写在测试用例文档（`logos/resources/test/**/*-test-cases.md`）内的独立小节，**不写在用例表首格**（C05）。小节由一个标题行和其下的列表组成；例如在标题「主链路用例」之下写：

```markdown
- UT-S13-01 — verify 读取结果并给出门禁
- ST-S13-02
```

- **标题**：二级或三级标题，文本恰为 `主链路用例` 或 `Main Path Cases`（前后空白不计）。一个文档至多一个；出现多个属结构错误。
- **正文**：到下一个同级或更高级标题为止。只读取列表项（`-` 或 `*` 开头）；列表项以一个用例 ID 开头，ID 之后的文字是说明，不参与判定。小节内的其他文字忽略。
- **可列的用例**：本文档用例表中已定义、且首格不带 `[manual]` 的 UT/ST。
- **主链路集合 MP** = 全部测试用例文档主链路小节所列用例的并集。它属于规格，与分层开关无关；只有分层开启时才参与验收范围与门禁。
- **结构错误**（逐条记录，供 §2.109.10 与 change-lint 使用）：

  | 代码 | 情形 |
  |---|---|
  | `undefined_id` | 列表项的 ID 不在本文档的用例表中 |
  | `manual_case` | 所列用例首格带 `[manual]` |
  | `not_ut_st` | 所列 ID 是 SMOKE 或其他非 UT/ST 形态 |
  | `duplicate_id` | 同一 ID 在同一小节出现多次 |
  | `duplicate_section` | 同一文档有多个主链路小节 |
  | `item_without_id` | 列表项不以用例 ID 开头 |

- 既有读取方不受影响：小节在用例表之外，0.16.26 及更早的 CLI 与各项目的 reporter 都不把列表项当作用例定义。

### 2.109.4 提案的「受影响场景」段

`openlogos change` 的脚手架在「验收标准」之后生成「受影响场景」段（en：`Affected Scenarios`），内容为一个 fenced YAML：

```yaml
schema: openlogos/affected-scenarios@1
assessment: pending          # pending（脚手架占位）| assessed | unknown
shared_change: false         # 本次是否涉及共享代码、配置或依赖
scenarios: []                # 每项 { id: "S13", reason: "<为什么受波及>" }
```

- `assessment`：`assessed` 表示已逐个评估，`scenarios` 即结论（可以为空数组，表示除本提案自身触及的场景外没有其他受影响场景）；`unknown` 表示无法评估；`pending` 是未填写。
- `scenarios[].id`：`S` 加数字的场景编号；`reason` 非空。同一编号不得重复。
- **场景存在**的判定：已合并资源中存在该编号的场景文档（`prd/3-technical-plan/2-scenario-implementation/*-SXX-*.md`）或测试用例文档（`test/*-SXX-test-cases.md`），或本提案的 delta 中有该编号的同类文件。
- 该段不进 canonical 必填章节（`PLAN_SECTION_REGISTRY` 不变）。段缺失不是错误——0.16.27 之前创建的提案没有它——verify 按「评估不可用」处理（§2.109.7）。
- 声明在「批准方案」时随方案一起由人审视。实现过程中发现影响面扩大时，更新该段。
- **声明的可用性**（verify 与 change-lint 同一判定）：

  | 状态 | 条件 |
  |---|---|
  | `usable` | 段在场、YAML 可解析、`schema` 正确、`assessment: assessed`、`shared_change` 为布尔、`scenarios` 每项合法且场景都存在 |
  | `missing` | 段不存在 |
  | `invalid` | YAML 缺失或损坏、字段缺失或类型不对、`assessment` 为 `pending` 或其他非法值、`reason` 为空、编号重复 |
  | `unknown` | 结构合法且 `assessment: unknown` |
  | `scenario_unknown` | 结构合法但有不存在的场景编号 |

  不论状态如何，下面两项只要能读出就独立采信（只扩大不缩小）：
  - **共享标志**：YAML 可解析且 `shared_change` 是布尔值 `true` 时，视为声明了共享改动——即使 `assessment` 是 `unknown`、`pending`，或 `scenarios` 有错。
  - **已识别场景**：`scenarios` 中结构合法（`id` 是场景编号形态、`reason` 非空）且场景存在的项。状态为 `scenario_unknown`、`unknown` 或 `invalid` 时，这些项仍然计入受影响场景。

### 2.109.5 受影响场景与受影响用例

- **场景与用例文档的对应**：测试用例文档 `<module>-SXX-test-cases.md` 属于场景 SXX（场景编号全局唯一）。文件名中没有场景编号的测试用例文档不属于任何场景。
- **受影响场景集合 AS** = 声明中的已识别场景（来源 `declared`；声明 `usable` 时即全部 `scenarios`，§2.109.4）∪ 本提案 delta 触及的场景（来源 `delta`）。
  - delta 触及：提案目录 `deltas/prd/3-technical-plan/2-scenario-implementation/` 与 `deltas/test/` 下，文件名含 `-SXX-` 的文件所对应的场景。提案已合并时仍按 `deltas/` 下的文件判断。
  - 同一场景两种来源都有时，两种都记录。
- **受影响用例 A** = AS 中每个场景的测试用例文档里全部首格不带 `[manual]` 的 UT/ST。场景没有测试用例文档时贡献为空。

### 2.109.6 提案级验收集合

分层开启、存在活跃提案、且未扩大到全量时：

**P = C ∪ A ∪ MP**

- **C（本提案用例）**：经校验的 `SPEC_MERGED.test_change_set` 中的 UT/ST（§2.106.6 的同一读取结果）。提案尚未合并时为空集；变更集无效时照旧由 `test_change_set_invalid` 处理。
- **A（受影响用例）**：§2.109.5；评估不可用时按 §2.109.7 第 2 级取值。
- **MP（主链路用例）**：§2.109.3。
- 三层有重叠时去重；P 按用例 ID 字典序使用。
- **提案集合 P 与本次执行集合 E 是两个集合**：
  - final 验收：E = P。
  - 切片 checkpoint：E = 本次 checkpoint 的 eligible（§2.109.9），它是 P 的子集，不含尚未轮到的本提案用例（pending）。
- E 是本次 verify 的「已定义」集合：注入测试入口的清单、统计、未覆盖、失败复跑的复跑集合（§2.108.4）都以 E 为准。P 之外的已定义用例不计未覆盖；P 之内、E 之外的用例（checkpoint 的 pending）按既有 checkpoint 规则处理（§2.109.8）。

### 2.109.7 扩大规则

只扩大，不缩小。按下表从上到下判断，取**范围最大**的一级；命中的原因全部记录。扩大不是失败，不改变门禁结论。

| 级 | 扩大到 | 条件 | 原因代码 |
|---|---|---|---|
| 1 | 全量 | 没有活跃提案 | `no_active_change` |
| 1 | 全量 | 提案起点不可用：不是 git 仓库、guard 缺 `baseRef`、`baseRef` 不可达、差异计算失败（§2.96.6 的同一判定） | `base_ref_unavailable` |
| 1 | 全量 | 改动文件（`baseRef` → 工作区，§2.96.3 的同一集合）命中共享配置或 `shared_paths` | `shared_path_changed` |
| 1 | 全量 | 声明的共享标志为真（§2.109.4；不要求声明 `usable`） | `shared_change_declared` |
| 2 | 按模块 | 声明为 `missing` | `declaration_missing` |
| 2 | 按模块 | 声明为 `invalid` | `declaration_invalid` |
| 2 | 按模块 | 声明为 `unknown` | `assessment_unknown` |
| 2 | 按模块 | 声明为 `scenario_unknown` | `scenario_unknown` |

- **第 1 级（全量）**：验收集合为全部不带 `[manual]` 的 UT/ST，与分层未开启时相同。`layers.expansion.level` 为 `"full"`。
- **第 2 级（按模块）**：A 改为「§2.96 的范围内用例集（范围 M 内各模块的全部用例）∪ AS 中各场景的用例」——已识别的场景与 delta 触及的场景即使在范围 M 之外也保留，保证结果是未扩大时集合的超集；P = C ∪ A ∪ MP。§2.96 未启用（单模块或没有模块声明 `paths`），或其自身回落到全量（`fallback-full`）时，结果即全量，`level` 为 `"full"`，并追加原因 `module_scope_unavailable`；否则 `level` 为 `"module"`。
- 都未命中时 `level` 为 `"none"`，P 按 §2.109.6。

### 2.109.8 执行与核对

- **收窄通道**：`level` 为 `"none"` 或 `"module"` 时，verify 在执行预跑命令前注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`=E（JSON 数组，字典序；final 时即 P，checkpoint 时为当前 eligible），执行结束后恢复。变量格式与切片 checkpoint 的既有约定相同，不新增变量。提案级 final 验收不注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`；checkpoint 照旧注入。`level` 为 `"full"` 时的注入行为与引入前相同。
- **测试入口的义务**：收到 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 时按清单选择要执行的测试文件。verify 无法强制这一点：测试入口照旧执行全量时门禁仍然正确，只是不省时。项目开启分层的前置条件是其测试入口按清单选文件，且不以 `OPENLOGOS_VERIFY_SLICE_SCOPE` 为条件。
- **集合外的结果**：
  - 属于已定义用例但**不在 P 内**的结果行：不采信、不计入统计、不判 `result_outside_eligible_scope`，只计数为 `layers.outside_result_count`。该计数大于 0 时 `warnings` 增加 `layered_runner_not_narrowed`。这个警告只能发现「执行并上报了集合外用例」的测试入口；执行了集合外文件但过滤了上报的测试入口，verify 无从得知。
  - 切片 checkpoint 中**在 P 内但不在 E 内**的结果行（即 pending 用例被提前上报）：既有的 checkpoint 越界判定不变，计入 `outside_eligible_result_ids` 并判 `result_outside_eligible_scope`。pending 用例没有结果是正常的，不计未覆盖。
  - **`owned` 范围的 checkpoint 完全沿用既有越界规则**：上面第一条「P 之外只计数」只适用于 final 验收与 `baseline` 范围的 checkpoint。`owned` 范围下，E 之外的任何已定义用例的结果行——无论在不在 P 内——都计入 `outside_eligible_result_ids` 并判 `result_outside_eligible_scope`，`layers.outside_result_count` 恒为 0，不给出 `layered_runner_not_narrowed`。
  - 未定义的 ID 照旧按账本一致性判定。
  - **结果行与命令退出状态是两份证据**：忽略集合外的结果行不改变命令组的状态。测试入口因集合外用例失败而非零退出时，没有集合内的失败可供复跑改判（§2.108.7），门禁照旧为 `pre_run_failed`。
- **启用了按模块限定范围（§2.96）时的命令组**：
  - `level` 为 `"none"`：执行「P 中用例所属模块」的命令组；P 中有不带已登记模块前缀的用例文档中的用例时，执行全部模块的命令组。
  - `level` 为 `"module"`：执行 §2.96 范围 M 的命令组，加上 MP 与 AS 中用例所属模块的命令组。
  - `level` 为 `"full"`：与 §2.96 回落全量时相同。
  - 每条命令仍注入 `OPENLOGOS_VERIFY_MODULES`；`data.scope` 照旧输出 §2.96 的计算结果。
- **先定命令组，再做环境预检**：主链路小节、声明、P、扩大级别与本次要执行的命令组，都在环境预检之前以只读方式算出。环境预检（§2.106.4）与执行使用**同一组**命令组及其服务的模块：分层因主链路或已识别场景多带出的模块，其环境要求同样被预检；最终不执行的模块不参与预检。门禁原因优先级不变（环境预检类原因仍排在最前）。
- **失败复跑（§2.108）**：复跑集合与 E 求交；其余规则不变。

### 2.109.9 切片 checkpoint

分层开启时：

- `verify_scope` 为 `owned`：不变（已确认切片与本片的 owned 用例）；集合、注入与越界判定都与分层未开启时相同（§2.109.8）。
- `verify_scope` 为 `baseline`：eligible =（基线部分）∪ 已确认切片的 owned ∪ 本片的 owned，其中**基线部分**由「全部非本提案用例」改为「(A ∪ MP) 去掉尚未轮到的本提案用例（pending）」。扩大到全量时基线部分与引入前相同；扩大到按模块时 A 取 §2.109.7 第 2 级算出的值——即「模块范围内用例 ∪ 已识别场景与 delta 触及场景的用例」，模块范围之外的已识别场景同样保留在基线部分。
- 冻结在切片清单中的 `verify_scope` 取值与判定规则（§2.101）不变；`OPENLOGOS_VERIFY_SLICE_SCOPE` 的取值不变。
- final verify 即提案级验收，执行集合 E 等于 P。
- checkpoint 的执行集合 E 即上面的 eligible：注入、已定义集合、复跑都取它；`layers.total` 仍输出提案集合 P，`layers.execution` 输出 E。pending 用例的越界判定不变（§2.109.8）。
- 三层集合只在一处计算，verify 与切片状态派生共用。

### 2.109.10 主链路约束与门禁原因

只在分层开启的提案级验收中进入门禁；分层未开启时只由 change-lint 以警告给出。

1. **结构与规模（执行预跑命令之前）**：主链路小节在环境预检之前读取（§2.109.8）；环境预检（§2.106.5）通过之后、执行任何预跑命令之前判定：
   - 主链路小节有结构错误 → `main_path_invalid`；
   - MP 的大小超过 `main_path_max` → `main_path_over_limit`。

   命中任一即判 FAIL：不执行预跑命令、不读取结果文件，验收历史 `result_source` 为 `"none"`，验收报告写明原因、逐条列出结构错误或上限与实际数量。两者同时命中取 `main_path_invalid`。此时若已合并提案的测试变更集无效，`gate.reason` 取 `test_change_set_invalid`，主链路问题仍在 `layers.main_path` 中列出。
2. **不得偶发（执行之后）**：MP 中的用例被 §2.108 判为偶发（首跑失败、复跑通过）时，不按偶发放行：门禁 FAIL，原因 `main_path_flaky`。该用例仍列在 `flaky_cases` 中，并列入 `layers.main_path.flaky_ids`；不写 `VERIFY_PASS`。报告提示：修复该用例，或把它移出主链路。
3. **原因优先级**（分层开启的提案级验收；其余取值的相对顺序不变）：

   环境预检类原因 → `test_change_set_invalid` → `main_path_invalid` → `main_path_over_limit` → `main_path_flaky` → 预跑失败一支（`failed_cases` / `case_tier_mismatch` / `pre_run_failed`）→ `result_ledger_inconsistent` → `failed_cases` → `case_tier_mismatch` → `incomplete_coverage`。

发布级验收不检查主链路约束。

### 2.109.11 发布级验收

`openlogos verify --release [--format json]`

- **前置条件**（按顺序检查；不满足即以错误信封拒绝，退出码 2，不获取运行锁、不执行任何命令、不写历史、不产生发布级结论）：

  | 顺序 | 条件 | 错误码 |
  |---|---|---|
  | 1 | 项目是 git 仓库，且 HEAD 可解析为提交 | `RELEASE_VERIFY_NOT_GIT` |
  | 2 | 工作区干净：`git status --porcelain` 中，除 lifecycle 路径（`spec/change-impact.md` 的 `lifecycle` 类）之外没有任何条目（含未跟踪文件） | `RELEASE_VERIFY_DIRTY`（`details.paths` 列出至多 20 条） |
  | 3 | 配置了可执行的测试命令（`pre_run_command`、两阶段命令，或任一模块命令组） | `RELEASE_VERIFY_NO_COMMAND` |

  发布级不支持只读取既有结果：没有命令时拒绝，磁盘上已有的结果文件不能充当证据。
- **提交身份在执行前固定**：前置条件通过后、执行任何命令（含环境预检的检查命令）之前，解析当前 HEAD 的完整提交号 R。发布级报告、JSON、验收历史共用 R，不在收尾时重新读取 HEAD。
- **执行范围**：全部首格不带 `[manual]` 的 UT/ST。不读取 `verify.layered.enabled`；不计算模块范围（命令组选择等同 `--all`，§2.96.5）；不进入切片模式；不注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_SLICE_SCOPE`，并清除父进程中的同名变量。有没有活跃提案结论相同。
- **沿用**：环境预检（§2.106.4～§2.106.5，取项目级与全部模块的要求）、沙箱（§2.91）、结果路径运行锁（§2.104.6）、失败复跑与偶发判定（§2.108）。
- **跳过一律严格判定**：发布级的严格判定集合（§2.106.6）是全部不带 `[manual]` 的 UT/ST，不依赖活跃提案与测试变更集。集合内的 skip：
  - 平台跳过（`reason_code: "platform-unavailable"` 且 `detail` 非空）→ 允许，列入 `platform_skipped_cases` 与发布级报告；
  - 其余 skip（没有原因，或原因不是平台跳过）→ `case_tier_mismatch`，门禁 FAIL。

  发布级不存在「未分类跳过只警告」的情形：没有说明平台原因的 skip 不能构成有效的发布级通过。
- **不触碰**：提案目录中的任何标记与账本（`VERIFY_PASS`、`VERIFY_FAIL`、`DEPLOY_DONE`、`SMOKE_PASS`、`SLICE_CHECKPOINTS.jsonl`、`LOOP_ITERS`）、共用验收报告 `acceptance-report.md`、模块验收报告、提案完整记录目录。smoke 覆盖预检不执行。结果文件 `result_path` 照常被本次全量结果覆盖。
- **收尾复核**：最终门禁之前再次读取 HEAD 与工作区状态。HEAD 不等于 R，或工作区已不干净 → 门禁 FAIL，原因 `release_commit_changed`（优先于其他原因）；历史记录的提交号仍是 R。
- **门禁**：除 `release_commit_changed` 外，判据与原因优先级同引入前的全量 verify。退出码与 `gate.result` 一致。

### 2.109.12 发布级结论的查询

`openlogos verify --release --check [--commit <sha>] [--format json]`

- 只读：不执行命令、不获取运行锁、不写任何文件；不要求工作区干净。
- **目标提交**：`--commit` 给出时解析为完整提交号（可以是缩写；解析失败报 `RELEASE_CHECK_COMMIT_INVALID`，退出码 2）；缺省为当前 HEAD（不是 git 仓库时报 `RELEASE_VERIFY_NOT_GIT`）。
- **当前平台**：`<process.platform>-<process.arch>`，例如 `darwin-arm64`。
- **有结论的发布级运行**：验收历史中 `kind=verify`、`level=release`、`outcome=completed`、`result_source=executed` 的记录。环境预检类原因判 FAIL 的运行（`result_source=none`）不是结论：它不推翻此前的结论，也不算通过。
- **判定**：在「目标提交 + 当前平台」下取最近一次有结论的发布级运行（按 `started_at`，同刻按 `run_id`）：

  | 情形 | `valid` | `reason` | 退出码 |
  |---|---|---|---|
  | 该运行 `gate.result` 为 PASS | true | null | 0 |
  | 该运行 `gate.result` 为 FAIL | false | `latest_failed` | 1 |
  | 该提交在当前平台没有结论，但在其他平台有 | false | `other_platform_only` | 1 |
  | 该提交没有任何结论，但其他提交有 | false | `other_commit_only` | 1 |
  | 没有任何有结论的发布级运行 | false | `no_conclusive_run` | 1 |

- 提交变了即作废：结论只对记录中的提交号有效。同一提交先 PASS 后 FAIL 判无效，先 FAIL 后 PASS 判有效。
- 多个平台是否都有有效结论，由调用方按 `platform` 自行聚合（`history list --level release --commit <sha>`）。

### 2.109.13 报告与文本输出

- **提案级报告**（`logos/resources/verify/acceptance-report.md`）：
  - 分层未开启：字节与引入前相同。
  - 分层开启：Summary 增加一行「级别 / Level」，取值「提案级（分层）/ proposal (layered)」；新增小节「验收范围 / Verification Scope」，列出本提案用例数、受影响场景清单（含来源）与受影响用例数、主链路用例数、合计、扩大级别与原因、集合外结果行数；并注明「提案级通过不等于可以发布；发布前须有该提交的发布级全量结论」。
  - 主链路约束判 FAIL 时，写明原因与明细；在执行前判 FAIL 的，计数显示「未执行」。
- **发布级报告**（`logos/resources/verify/release/acceptance-report.md`）：独立文件，每次发布级运行覆盖。Summary 含「级别 / Level：发布级（全量）/ release (full)」、提交号 R、平台；其余小节同全量 verify 的报告。`release_commit_changed` 时写明收尾时的 HEAD 与工作区状态。
  - 该路径放在独立子目录，不与模块验收报告 `<module>-acceptance-report.md` 同形（模块名可以合法地叫 `release`）。它纳入报告保留路径集合：`result_path`、阶段结果路径或 smoke 路径配置落在其上时，按既有保留路径规则改写并提示；沙箱写入白名单包含它。
- **文本模式**：门禁结论行带级别；提案级（分层）通过时追加一行「提案级通过不等于可以发布」；发布级输出提交号与平台。
- 报告不写命令输出（EX-9.5 不变）。

### 2.109.14 JSON 与验收历史

字段定义见 `spec/cli-json-output.md`「verify 分层验收与发布级验收（layered-verification）」。

- `data.level`：`"proposal"` | `"release"`，0.16.27 起恒输出。
- `data.layers`：只在分层开启的提案级验收输出，含三层各自的计数与 ID、受影响场景及来源、声明状态、扩大级别与原因、主链路上限与问题、集合外结果行数。
- `data.release`：只在发布级验收输出，含 `commit`、`platform`、收尾复核结果。
- `gate.reason` 新增 `main_path_invalid`、`main_path_over_limit`、`main_path_flaky`、`release_commit_changed`。
- `warnings` 新增 `layered_runner_not_narrowed`、`layered_config_invalid`。
- 验收历史中央索引新增可选字段 `level`、`platform`（§2.104.3）。发布级记录的 `proposal` 为 null、`raw_location` 为 `"none"`、`verify_mode` 与 `module_scope` 为 null、`commit.head` 为 R、`commit.dirty` 为 false。
- `openlogos history list` 新增筛选 `--level proposal|release` 与 `--commit <sha>`（前缀匹配 `commit.head`）。

### 2.109.15 兼容性与已知限制

- 分层未开启、且不使用 `--release` 的项目：验收范围、门禁、报告、退出码与 0.16.26 相同；JSON 只多出 `level: "proposal"`，历史记录只多出 `level`、`platform`。
- 主链路小节与受影响场景段对旧版 CLI 是普通文本，不影响其行为。
- 0.16.27 之前创建的提案没有「受影响场景」段：分层开启时按 `declaration_missing` 扩大，不报错。
- **已知限制**：声明的受影响场景是写提案时的评估。实现过程中改到声明之外的场景，verify 无法从代码差异发现（仓库中没有代码文件到场景的对应关系，C01）。缓解：delta 触及的场景自动并入；共享改动扩大到全量；发布级全量兜底。
- **省时取决于测试入口**（§2.109.8）。本仓的 vitest 入口按 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 过滤用例；RunLogos 的测试入口需要配套适配，属 RunLogos 的需求。

### 2.109.16 实现映射与追溯

| 能力 | 位置 |
|---|---|
| 配置 `verify.layered` | `cli/src/lib/verify-config.ts`、`spec/logos.config.schema.json` |
| 主链路小节读取与结构错误 | 新模块（供 verify 与 change-lint 共用） |
| 受影响场景声明读取与可用性 | 新模块（供 verify 与 change-lint 共用） |
| 三层集合与扩大规则 | 新模块（供 verify 与切片状态派生共用）；复用 `cli/src/lib/verify-scope.ts` |
| 提案级执行、门禁、报告 | `cli/src/commands/verify.ts` |
| 切片 checkpoint 的基线部分 | `cli/src/lib/test-slice-manifest.ts` |
| 发布级验收与查询 | `cli/src/commands/verify.ts`、`cli/src/index.ts`（参数） |
| 历史字段与筛选 | `cli/src/lib/verification-history.ts`、`cli/src/commands/history.ts` |
| 提案脚手架 | `cli/src/commands/change.ts` |
| change-lint 检查 | `cli/src/lib/change-lint.ts` |
| 发布级报告保留路径 | `cli/src/lib/module-phase-report.ts` |

追溯：AC-VERIFY-TIER-01～22；场景 S13、S09、S35、S32 的本提案新增小节；测试 UT-S13-217 起、ST-S13-48 起、UT-S09-504 起、UT-S35-231 起、UT-S32-118 起；安装态 smoke SMOKE-core-352 起。

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
| `proposal` | `{ "slug": string, "run_dir": "verify-runs/<run_id>" }` 或 null；`run_dir` 是提案目录内相对位置，不含归档日期或绝对路径。发布级验收恒为 null |
| `module_scope` | 本次有效模块范围（模块 id 升序数组；未启用按模块区分时为 null） |
| `verify_mode` / `attempted_slice_id` | verify 的 `"slice-checkpoint"` \| `"final"` \| null 与对应切片 id；smoke 为 null |
| `environment` / `deploy_id` | smoke 的目标环境与核对的 deploy_id；verify 为 null |
| `counts` | `{ defined, executed, passed, failed, skipped, uncovered }`，早退时只填已取得的项、其余为 null；`result_source` 为 `"none"` 时各项为 null |
| `failed_ids` / `skipped_ids` / `uncovered_ids` | 用例 ID 数组，按 ID 字典序；`result_source` 为 `"none"` 时为空数组 |
| `flaky_ids` | 可选。verify 判为偶发的用例 ID 数组（§2.108），按 ID 字典序；0.16.26 起的 verify 记录恒写入，没有偶发时为空数组；smoke 记录不写。这些用例计入 `counts.passed`，不在 `failed_ids` 中（verify-flaky-rerun） |
| `level` | 可选。`"proposal"` \| `"release"`（§2.109）；0.16.27 起的 verify 记录恒写入；smoke 记录不写（layered-verification） |
| `platform` | 可选。运行所在平台 `<process.platform>-<process.arch>`；0.16.27 起的 verify 记录恒写入；smoke 记录不写（layered-verification） |
| `result_source` | `"executed"`（本次调用执行了预跑 / 两阶段命令或 smoke 命令）\| `"reused"`（只读取既有结果文件）\| `"none"`（verify 环境预检类原因判 FAIL，或分层验收的主链路结构 / 规模检查在执行前判 FAIL，既未执行命令也未读取结果；§2.106.5、§2.109.10） |
| `commit` | `{ "head": string \| null, "dirty": boolean \| null }`，非 git 项目为 null。发布级验收的 `head` 是执行前固定的提交号（§2.109.11），不在收尾时重新读取 |
| `cli_version` | 产生该记录的 CLI 版本 |
| `raw_location` | `"proposal"` \| `"local"` \| `"none"`（无活跃提案时；发布级验收恒为 `"none"`） |

中央索引**不得**包含 runner `detail`、断言 `error`、命令输出、报告正文或任何其他自由文本。

读取兼容：0.16.24 起的读取方接受 `result_source` 的三个取值；更早版本的读取方把含 `"none"` 的记录当作损坏记录跳过并提示（既有「损坏的历史文件在查询时被跳过」规则），不影响其他记录。`flaky_ids` 缺失时读取方按空数组处理；该字段存在但不是字符串数组时按损坏记录处理。0.16.26 之前的读取方忽略该字段，照常读取记录。`level` 缺失时读取方按 `"proposal"` 处理，`platform` 缺失时按 null 处理；`level` 存在但不是两个取值之一、或 `platform` 存在但不是字符串时按损坏记录处理。0.16.27 之前的读取方忽略这两个字段。
