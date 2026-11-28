## ADDED — 2.106 verify 自足：用例分类、环境预检与跳过分类（verify-self-sufficient-cases）

> 来源变更：verify-self-sufficient-cases（Team 需求池 openlogos #2；决策 C01、C02、C03；评审 proposal-r1 F1～F5、proposal-r2 F3/F5 处置）。需求见 `core-01-requirements.md`「verify 自足与用例分类需求（verify-self-sufficient-cases）」AC-VERIFY-SELF-01～12；场景见 `core-S13-verify-results.md`「S13 verify 自足：环境预检与跳过分类」、`core-S09-change-management.md`「S09 提案验收标准段」、`core-S35-change-lint.md`「S35 验收标准段检查」；格式与运行约定的权威见 `spec/test-results.md`。§2.7A「skip 语义」原文不变，本节为其补充例外；§2.48 的 smoke 跳过规则不变。

### 2.106.1 问题

| # | 现状 | 后果 |
|---|---|---|
| ① | 「自动用例」没有准入门槛：test-writer 3c 只对 ST 列出终端、跨窗口、视觉、硬件四类人工情形 | 每个版本都要人准备证据的用例被写成自动用例，再靠外部证据索引补交（markdown6 约 600 条，证据核对脚本 686 行） |
| ② | verify 只在统计时去掉人工 ID（`verify.ts` 统计集合），预跑命令整条执行，reporter 结束后才过滤 | 已标人工的用例仍可能被启动，等待输入或弹出确认框 |
| ③ | 没有任何地方声明自动用例依赖哪些环境 | 环境缺失时只看到一片失败或 skip，分不清是代码坏了还是机器没准备好，driver 会派修复 agent 去修修不好的问题 |
| ④ | UT/ST 的 `skip` 计为有效通过 | 自动用例因环境没准备好写一行 skip 即可通过 verify，没有任何证据 |
| ⑤ | proposal 没有写验收环境与人工事项的位置；生成的 AGENTS.md / CLAUDE.md 对整份 `logos.config.json` 写「不得直接修改」 | 用户批准方案时看不出要亲手做什么；实现代理没有写 `verify.requirements` 的合法途径 |

### 2.106.2 分类定义（只对 UT/ST）

1. **判据**：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令能自行产生适用于新版本的证据 → **不需要人参与**；否则 → **需要人参与**。
2. 机器自动签发、采集或获取的证据可用于自动验收；每个版本都要人重新准备的证据（例如带制品摘要的外部证据索引）归入需要人参与。
3. 一次性准备机器（安装 Docker、JDK、编译器等）不算人参与，但必须按 §2.106.4 声明并可由机器检查。
4. 标记沿用首格 `[manual]` / `[manual/<平台>]`（S13 不变量 1 的声明位与语法不变）；`[manual/<平台>]` 语义为「需要人参与，且在该平台上执行」。verify 对人工 ID 的既有处理不变：不计入 defined / executed，结果中出现即 `manual_test_result_id`。
5. SMOKE 的人工标记及其读取、待验与记录规则不在本节，由 openlogos #3 交付；本节不改 SMOKE 的任何读取与判定。

### 2.106.3 人工用例不被测试入口启动

- 项目的 verify 预跑命令（`pre_run_command` / `regression_command` / `incremental_command`，含 `verify.modules.<id>` 命令组）必须在**调度前**排除人工用例的测试代码：沿用项目已有的测试分组、独立文件命名或独立入口（如 vitest `exclude`、pytest marker 反选）。verify 不新增注入变量，也不据结果推断某用例是否被启动。
- 验收以哨兵用例证明：已标人工的用例一旦被启动就写哨兵文件；普通最终 verify 完成后，自动用例有结果、哨兵文件不存在。
- 人工用例的测试代码可以保留在仓库里，供人工验收时用独立入口启动。

### 2.106.4 环境要求声明

`logos/logos.config.json`：

```json
{
  "verify": {
    "requirements": {
      "env": ["DB_URL"],
      "commands": ["docker"],
      "checks": [{ "name": "db-ready", "command": "node scripts/check-db.mjs" }]
    },
    "modules": {
      "backend": { "requirements": { "commands": ["mvn"] } }
    }
  }
}
```

| 字段 | 类型 | 满足条件 |
|---|---|---|
| `env` | 字符串数组（变量名） | 变量存在且值非空 |
| `commands` | 字符串数组（命令名，不含路径与参数） | 能在 `PATH` 上解析到可执行文件 |
| `checks` | `{name, command}` 数组；`name` 唯一、匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$` | 以 shell 执行 `command`，限时 60 秒内退出码为 0 |

- **生效集合（先按模块确定，再合并；评审 delta-r1 F3）**：
  1. 按模块范围未启用（单模块，或无模块声明非空 `paths`）时，生效集合即项目级 `verify.requirements`。
  2. 启用时，先沿用既有命令组选择（`selectVerifyCommandGroups`）得到本次**实际执行的**命令组；对这些命令组服务的每个模块 m 求 E(m)（覆盖范围内、但三个命令字段全空且项目级也无命令而被选择器跳过的模块，不在其列，其模块级要求不检查；评审 delta-r2 F3）：`env`、`commands` 为项目级与 `verify.modules.<m>.requirements` 的并集；`checks` 以项目级为底，m 的模块级同名 check **只替换 m 自己的**那一项。
  3. 合并各 E(m)：`env`、`commands` 取并集；`checks` 中名称与命令都相同的项合并为一项，归属模块取并集；名称相同但命令不同的项**分别执行**，各自记录归属模块，诊断按 `{name, modules}` 区分。未被覆盖或未被任何实际执行的命令组服务的模块，其要求不检查。
  4. 「实际执行的命令组」只用于选择**模块级**要求（评审 delta-r3 F3）。本次没有任何预跑命令执行（未配置预跑命令、只读取既有结果）时，模块级要求一律不检查，但显式声明的**项目级**要求仍照常预检，缺项即在读取任何结果文件之前判 `verify_env_not_ready`，不得凭旧账本通过；结构校验与验收标准对账照常执行。
- 字段缺省视为空；结构非法（类型不符、`name` 重复或非法）时按配置错误报 `verify_requirements_invalid`，门禁 FAIL，不执行预跑命令。
- 不过滤未声明的环境变量：沙箱照旧继承调用时的环境（`cli/src/lib/sandbox.ts`）。
- **执行环境（评审 delta-r1 F2）**：
  - `env` 按预跑命令将继承的环境判定。
  - `commands` 按同一环境的 `PATH` 解析。
  - `checks` 经与预跑命令**同一个沙箱执行器**（`runSandboxedCommand`）执行，规则如下：
    - 沿用 `verify.sandbox_mode` / `sandbox_root` / `sandbox_deny_workspace_write` 与沙箱复用配置；
    - 工作目录为（沙箱工作副本中的）项目根，与预跑命令一致；
    - 写回白名单为空：沙箱隔离生效时，检查命令对工作副本的写入不回收到源工作区；
    - 注入 `OPENLOGOS_VERIFY_MODULES` 为该 check 的归属模块（未启用模块范围时不注入）。
  - 隔离失败时遵循既有沙箱模式规则：`always` 以既有沙箱诊断判 FAIL、不执行预跑；`auto` 按既有规则降级。
  - **无隔离时的保证（评审 delta-r2 F2）**：`sandbox_mode: off`，或 `auto` 降级后，检查命令与预跑命令一样直接在源工作区的项目根执行，**不承诺源工作区保护**。因此检查命令必须是只读的——只读取环境、文件或服务状态，不创建、不修改文件（`spec/test-results.md`、test-writer 3c 同步要求）。verify 在 JSON（`data.requirements.isolation: "sandboxed" | "unisolated"`）与验收报告中如实标注本次检查是否隔离；源工作区保护只在 `isolation: "sandboxed"` 时成立。
  - 检查命令只执行一次，不因并发命令组重复执行。
- 平台限定用例的前置工具写成 `checks`，其触发条件必须与用例的完整适用条件同源（同一判定）：适用条件任一不成立时 check 直接通过、用例写平台跳过，避免一条用例的前置工具挡住整轮预跑。

### 2.106.5 验收标准对账与环境预检

执行顺序（任何预跑命令之前，按序执行，前一步失败不再执行后一步）：

1. **配置合法性**：`verify_requirements_invalid`（§2.106.4）。
2. **验收标准对账**：有活跃提案且其 proposal「验收标准」段的「自动验收环境要求」列出条目时，每个条目 `env:<名>` / `command:<名>` / `check:<名>` 必须出现在生效集合的对应字段中；缺任一项 → `acceptance_requirement_undeclared`，诊断逐项点名。无活跃提案、无该段或该字段为「无」时不对账。
3. **环境预检**：逐项检查生效集合；缺任一项 → `verify_env_not_ready`，诊断逐项列出 `{kind: "env"|"command"|"check", name, detail}`。`env` 只写变量名，**不得**写变量值；check 失败时 `detail` 只写退出码或「超时」，不写命令输出。

任一步失败时：

- 门禁 FAIL，`gate.reason` 为该诊断码，标记文件按既有 FAIL 处理；
- **不执行任何预跑命令**，不截断、也不读取任何结果文件，上次留下的账本不成为本轮证据；
- 共用验收报告写明原因与缺失项，计数显示为「未执行」；
- 受影响的模块验收报告按 §2.106.7A 改写为 FAIL；
- 验收历史记一条 `outcome: "completed"`、`result_source: "none"`、门禁 FAIL 的记录：
  - `counts` 各项为 null，`failed_ids` / `skipped_ids` / `uncovered_ids` 为空数组；
  - 报告快照的落点沿用既有留存策略（§2.104，评审 delta-r2 F5）：无活跃提案时只写中央索引，不写快照；有活跃提案且 `verify.history.raw_in_proposal` 为 `true`（缺省）时，提案完整记录写 `record.json` 与 `report.md`；为 `false` 时，提案完整记录只写结构化的 `record.json`，`report.md` 写本机原文目录；
  - 任何情况下都不写本轮 `results.jsonl` / `results-raw.jsonl`，不复制上次留下的结果文件（字段定义见 §2.104.3 的修改）。

三步全部通过或均不适用时，进入既有预跑流程。

JSON（`--format json`）新增 `data.requirements`：`{ declared: {env, commands, checks}, acceptance_entries: [...], missing_declarations: [...], missing_environment: [...] }`；未声明任何要求且无对账条目时该字段缺省。

### 2.106.6 跳过分类

1. **结果字段**：UT/ST 结果行新增可选字段 `reason_code`（string）与 `detail`（string），旧记录原样有效。
2. **平台跳过**：`status:"skip"` 且 `reason_code === "platform-unavailable"` 且 `detail` 为非空字符串（说明需要的平台或执行条件，如 `requires win32`）——判据与 §2.48 逐字同源。
3. **严格判定集合**（评审 delta-r1 F4、delta-r2 F4）：活跃提案 `SPEC_MERGED.test_change_set.changed_test_ids` 中的 UT/ST ID，经正式读取器（`readTestChangeSet`，与 verify 范围读取同源）取得。按读取状态分三种：
   - **尚未 merge**（无活跃提案，或活跃提案没有 `SPEC_MERGED`）：严格集合为空，只出警告不收紧；
   - **读取器判有效**：取其 `changed_test_ids`；读取器认可的合法空集（如 `no_delta_spec_complete` 且确无 mergeable Delta）即为空集；
   - **已有 `SPEC_MERGED` 但读取器判无效**（缺 change set、摘要不符、schema 不支持等，`spec/test-slice-manifest.md` §13.3）：拒绝采信、不推导为空集，报完整性诊断 `test_change_set_invalid`（`detail` 带读取器给出的原因码），门禁 FAIL，本次不得产生最终 PASS。

   切片 checkpoint 模式下与本次可计入集合（eligible）求交，pending 用例没有结果仍为合法状态（既有规则不变）。
4. 严格集合内的 skip：平台跳过放行，计入 `platform_skipped_cases`（`{id, detail}`）并在报告单独列出；其余 skip（无 `reason_code`、取其他值、`detail` 缺失或为空）计入 `tier_mismatch_cases`（`{id, reason_code?, detail?}`），门禁 FAIL，`gate.reason = "case_tier_mismatch"`，`fix_hint` 为「准备好环境并声明到 verify.requirements，或改标 `[manual]`」。
5. 严格集合外（存量）与无活跃提案时的非平台 skip：口径按 §2.7A 不变（计入 executed 与有效通过），另出警告 `unclassified_skipped_cases`（列出 ID），不改变门禁结论与退出码。
6. 统计不变量与 `skipped_count` / `skipped_cases` 口径不变；`platform_skipped_cases`、`tier_mismatch_cases`、`unclassified_skipped_cases` 都是 `skipped_cases` 的子集。

### 2.106.7 门禁原因优先级

在 §2.75.1 两支优先级之前，先取 §2.106.5 的预检类原因：

1. `verify_requirements_invalid` → `acceptance_requirement_undeclared` → `verify_env_not_ready`（此三者命中时不执行预跑，下列各项不计算）；
1A. `test_change_set_invalid`（§2.106.6 第 3 条；预跑与统计照常执行，其余诊断照常输出，但门禁以它为主原因，不得产生最终 PASS）；
2. 预跑命令非零退出时：`failed_cases` → `case_tier_mismatch` → `pre_run_failed`；
3. 预跑命令全部成功或未配置时：`result_ledger_inconsistent` → `failed_cases` → `case_tier_mismatch` → 其余既有原因（`incomplete_coverage` 等）相对顺序不变。

主原因之外的诊断照常输出。

### 2.106.7A 模块验收报告（评审 delta-r1 F1）

多模块项目的 initial 模块验收报告（`spec/test-results.md`「多模块项目的模块验收报告与模块冒烟报告」）会被 `launch` 当作完成证据，新拒绝原因必须进入模块 Gate，不能只写进共用报告：

- **预检类原因**（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`）：
  - 归属规则：
    - 项目级要求缺失，或对账失败、结构非法：计入本次覆盖的每个 initial 模块；
    - 只属于某些模块的 check 失败：计入该 check 的归属模块；未被计入的覆盖模块，模块 Gate 也为 FAIL，原因是「本次未执行测试」（预检失败时没有任何模块的结果可判定）。
  - 预检失败时，本次覆盖的每个 initial 模块的报告都整份改写为 FAIL：「模块」行照常，Gate 行为 FAIL，正文写明原因、缺失项与「本次未执行测试」，不读取旧账本计算子集统计。旧的 PASS 报告因此被撤销。
- **`test_change_set_invalid`**：无法按用例归属，计入本次覆盖的每个 initial 模块（同既有「切片核验失败」口径）。
- **`case_tier_mismatch`**：按用例归属计入。`tier_mismatch_cases` 中属于 U(m) 的 ID 使模块 m 的 Gate 为 FAIL，不属于的模块不受影响。
- 未被本次覆盖的模块，已有报告保持不动（既有规则）；切片 checkpoint 下模块报告的写入边界不变。
- `launch` 的完成判据（只读「模块」行与 Gate 行）不变；上述改写保证受影响模块不能再凭旧 PASS 报告通过上线检查。

### 2.106.8 proposal「验收标准」段

`openlogos change` 的 proposal 脚手架在「决策澄清」与「变更概述」之间生成：

```markdown
## 验收标准
- 自动验收环境要求：[无 / `env:<变量名>`、`command:<命令名>`、`check:<检查名>` 条目，即预期写入 verify.requirements 的配置差异]
- 平台限定用例：[无 / 用例 ID 与适用平台或执行条件]
- 需要人参与的验收：[无 / 人工验收事项与执行环节]
```

（en locale 段名 `Acceptance Criteria`，三个字段 `Automated verification requirements` / `Platform-limited cases` / `Human-involved acceptance`。）

- 三个字段的取值：「无」，或具体内容。「自动验收环境要求」的具体内容必须由一个及以上反引号条目组成，条目形如 `env:<名>` / `command:<名>` / `check:<名>`（名称规则同 §2.106.4），条目后可跟说明文字。
- 「需要人参与的验收」在 openlogos #3 落地前用文字写明事项与预期执行环节，不产生机器判定。
- 本段是**非 canonical 段**（不进 `PLAN_SECTION_REGISTRY`）：缺段时 change-lint 只出警告 `acceptance_criteria_missing`（进 `warnings`、不计违规、不改退出码，与 UI/UX 声明段降级后的口径一致）；段在场时，字段缺失、为空、仍为占位文字，或环境要求条目格式非法，报违规 `acceptance_criteria_invalid` 并给出 `fix_hint`（详见 S35「S35 验收标准段检查」）。

### 2.106.9 配置差异的交付与生成指令口径

- 分工：change-writer 在「验收标准」记录预期配置差异；test-writer 补齐具体要求；merge 后的 `[code]` 实现任务在活跃提案内写入 `logos/logos.config.json` 的 `verify.requirements`（guard 对该文件在有活跃提案时按提案范围处理）；verify 按 §2.106.5 对账。
- 生成的 AGENTS.md / CLAUDE.md「保护范围配置」条款（`spec/agents-md.md`）改为与 guard 同口径：`.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段决定保护范围，不得直接修改，走 `openlogos ignore|exempt`；`logos.config.json` 其他字段（如 `verify.requirements`）在已立案且属于当前提案范围时由实现任务直接修改。

### 2.106.10 兼容性

- 未声明 `verify.requirements`、活跃提案验收标准未列环境要求条目、测试变更集内没有 skip 的项目：verify 的判定、`gate.reason` 与退出码与引入前一致；新增的只有可能出现的 `unclassified_skipped_cases` 警告。
- 结果账本只新增可选字段；`spec/logos.config.schema.json` 只新增可选字段 `verify.requirements` 与 `verify.modules.<id>.requirements`。
- 验收历史的 `result_source` 新增取值 `"none"`（§2.104.3 修改），JSON 契约同步见 `spec/cli-json-output.md`「共用对象：run」；模块验收报告新增两类 FAIL 归属（§2.106.7A），文件格式与 `launch` 判据不变。
- smoke（含 §2.48 跳过规则、覆盖预检、结果格式）全部不变。
- 本仓：ST-S08-45、ST-S09-219、ST-S19-35、ST-S19-36、ST-S19-37 在非 Windows 上写平台跳过；ST-S13-26 的适用条件（Linux、非 root、沙箱复用能力可用，复用能力取自 `detectLivenessCapability`）抽成单一判定，用例跳过条件与本仓 `verify.requirements.checks` 中的 `linux-nondump-cc` 共用。

### 2.106.11 验收

UT-S13-157 起、ST-S13-40 起（verify）；UT-S09-490 起（脚手架）；UT-S35-225 起（change-lint）；UT-S08-90 起（生成指令）；安装态 SMOKE-core-338 起。

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
| `result_source` | `"executed"`（本次调用执行了预跑 / 两阶段命令或 smoke 命令）\| `"reused"`（只读取既有结果文件）\| `"none"`（verify 环境预检类原因判 FAIL，既未执行命令也未读取结果；verify-self-sufficient-cases，§2.106.5） |
| `commit` | `{ "head": string \| null, "dirty": boolean \| null }`，非 git 项目为 null |
| `cli_version` | 产生该记录的 CLI 版本 |
| `raw_location` | `"proposal"` \| `"local"` \| `"none"`（无活跃提案时） |

中央索引**不得**包含 runner `detail`、断言 `error`、命令输出、报告正文或任何其他自由文本。

读取兼容：0.16.24 起的读取方接受 `result_source` 的三个取值；更早版本的读取方把含 `"none"` 的记录当作损坏记录跳过并提示（既有「损坏的历史文件在查询时被跳过」规则），不影响其他记录。
