## ADDED — 2.107 冒烟阶段人工验收（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（Team 需求池 openlogos #3；决策 C01、C02、C03；评审 proposal-r1 F1～F6、proposal-r2 F3/F6 处置）。权威格式与判据见 `spec/environments.md` §15（字段、账本 `kind=manual` 记录、待验收清单、`openlogos accept`、门禁与标记、过期规则），`spec/test-results.md`「`[manual]` 标记用例」「Smoke 结果与覆盖预检」，`spec/pretooluse-guard.md`（受限命令与登记表保护），`spec/cli-json-output.md`（JSON 契约）；本节描述用户可见行为。场景：S46（新增）、S19、S41、S05、S09。配套需求：RunLogos #34。

### 2.107.1 问题

- 0.16.24 起 `[manual]` UT/ST 不进 verify（§2.106.2），但没有环节要求执行和记录它们。
- SMOKE 没有人工标记。`extractSmokeIdsFromContent` 只认首格恰好等于 SMOKE ID 的行，整份文件没有匹配行时退回全文扫描，所以带 `[manual]` 的 SMOKE 会随文件内容时有时无。
- proposal「验收标准 → 需要人参与的验收」只是文字（§2.106.8），部署、smoke、归档都不检查。
- 不部署的提案里新增的人工用例，没有机制带到下一次发布时验收。

### 2.107.2 人工用例与 SMOKE 人工标记

- **人工用例**：已合并测试规格（`logos/resources/test/**/*.md`）中首格为「裸 ID + `[manual]` 或 `[manual/<平台>]`」的 UT、ST、SMOKE 行，首格读法与 §2.82 同一正则（`MANUAL_MARKER_RE`）。判据与 §2.106.2 相同：保留预装的机器环境、换一个待验版本后，仍要人亲手做的，就是需要人参与。
- **SMOKE 读取**：
  - 首格为 `SMOKE-<…> [manual]` 或 `[manual/<平台>]` 的行，计入「文件存在表格用例行」。因此整份文件只有人工行时也不触发全文回退扫描。
  - 人工 SMOKE 不计入自动 defined 集合，不要求 runner，不计 uncovered，不进入 `changed_case_ids` 的必要证据判定（§2.48）。
  - 结果文件出现人工 SMOKE ID 时门禁 FAIL，诊断 `manual_smoke_result_id`，与 UT/ST 的 `manual_test_result_id` 同源。
  - 未带标记的行，读法与引入前逐字一致。
- verify 对 UT/ST `[manual]` 的排除语义（§2.82.4、§2.106.2）逐字不变。

### 2.107.3 登记表字段 `manual_acceptance`

```yaml
environments:
  - id: prod
    deploy: { mode: ci, provider: github-actions, workflow: release.yml }
    manual_acceptance:
      enabled: true
      regression: [ST-S01-05, SMOKE-core-12]
```

- 可选。缺省，或 `enabled` 为 `false`，即关闭。`enabled` 必须为布尔；`regression` 缺省为空数组，非空时每项必须是 `UT-` / `ST-` / `SMOKE-` 前缀、首格 ID 格式合法的字符串。违反时 `env check` 报 `ENV_FIELD_INVALID`，登记表按非法处理。
- 字段名必须以普通键名书写（转义键按 `ENV_FIELD_INVALID` 拒绝），规则与 `promote_from` / `require_approval` 相同（`spec/environments.md` §12.1）。这保证 guard 能按字段名识别。
- 字段不要求环境配置了 `deploy`；也**不**使环境成为受门环境（§2.95、`spec/environments.md` §12.1），不影响 `deploy-done` 与审批。
- **开关保护**：登记表任一环境写了 `manual_acceptance` 键，该登记表即按「已配置门禁的登记表」受 guard 保护（§2.95.5）。AI 的直接修改与删除须经宿主原生审批，无人值守时阻断。

### 2.107.4 待验收清单 P(E, D)

环境 E、当前部署 D：与 smoke 部署身份核对（`spec/environments.md` §4.2）同一身份，即 E 在账本中**最近一条** deploy 记录（任意 `result`）。D 的版本为 R（该记录的 `ref`）。D 的结果不是 `done` 时为「未确认」：清单无法确定，accept 拒绝，不退回更早的成功部署（评审 delta-r1 F4）。

1. **基线 B**：账本中 E 的、`deploy_id` **不等于 D** 的部署里，最近一条**未过期**（§2.107.7）的人工验收通过 smoke 记录（`manual_passed=true`）的 `ref`。D 自己的通过记录不作为 D 的基线，因此 D 通过前后 P(E, D) 不变，通过后仍能对清单中任一用例更正结果（评审 delta-r1 F2）。
2. **增量**：R 版本测试规格中的人工用例行，满足以下任一条件即计入：在 B 版本不存在；或在 B 版本存在，但去掉首尾空白后行内容不同。规格行按 `git show <commit>:<path>` 读取，规格文件集合取 `git ls-tree -r <commit> logos/resources/test`。
3. **首次开启（C02）**：B 不存在（E 从未通过人工验收）时，增量 = R 版本全部人工用例。
4. **回归用例**：并上 E 的 `regression`。每个 ID 在 R 版本上解析：开启的环境中，任一 ID 在 R 版本不存在或不是人工用例，进入 `regression_unresolved`，门禁不能通过（§2.107.6）；关闭的环境只出警告 `manual_regression_unknown`。
5. **目标版本必须确认且可读（评审 proposal-r1 F2、delta-r1 F4）**：D 未确认、R 为 null（如 CI 未回报实际部署提交，`spec/environments.md` §11.4），或 R 的对象在本地不可读（如浅克隆）时，不退回工作区：
   - 开启的环境，清单无法确定，原因 `manual_scope_unresolved`，提示取得 R 的提交（如 `git fetch --unshallow`）后重跑；
   - 关闭的环境，只出同名警告，不列清单。
6. **基线不可读**：B 有记录但对象不可读时，按 B 不存在处理，取全部人工用例（只多验、不漏验），并出警告 `manual_baseline_unavailable`。
7. 工作区与 HEAD 只作观察信息，不参与 P 的计算。

累积语义：不部署的提案合并后，它的规格进入下一次部署的版本 R，因此自动进入 P，不需要额外记账。

### 2.107.5 记录命令 `openlogos accept`

```
openlogos accept --env <id|alias> --deploy <deploy_id> --case <ID>[,<ID>…] --result pass|fail [--note <文字>] [--evidence <路径>]… [--format json]
```

- `--case` 可重复，也可以用逗号分隔；一次调用记录的多条用例必须是同一结果。
- `--result fail` 必须带非空 `--note`（否则 `ACCEPT_NOTE_REQUIRED`）；`pass` 时 `--note` 可选。
- `--evidence` 可重复，记录路径原文，只检查路径是否存在，不存在时出警告 `accept_evidence_missing`，不拒绝。
- **前置**（任一失败即零写入，退出码 1）：
  - 项目已初始化；
  - 登记表存在（`ENV_REGISTRY_NOT_FOUND`）且合法（`ENV_REGISTRY_INVALID`）；
  - `--env` 必填（`ENV_REQUIRED`）并可解析（`ENV_UNKNOWN`）；
  - `--deploy`、`--case`、`--result` 必填且取值合法（`ACCEPT_ARGS_INVALID`）；
  - E 开启了人工验收（`ACCEPT_NOT_ENABLED`）；
  - 部署身份与确认状态不作为前置，按下方锁内核对的顺序判定。
- **判定顺序与锁内核对（评审 proposal-r1 F1、delta-r2 F4）**：锁外预检与锁内复核用同一顺序，取第一个失败项，任一失败都整批零写入：
  1. 身份：E 没有任何 deploy 记录 → `ACCEPT_NO_DEPLOYMENT`；`--deploy` 不等于 E 最近一条 deploy 记录的 `deploy_id` → `ACCEPT_DEPLOY_CHANGED`，即使两次部署是同一提交；
  2. 确认状态：该记录未确认 → `ACCEPT_DEPLOYMENT_UNCONFIRMED`；
  3. 清单可确定：P(E, D) 无法确定 → `ACCEPT_CASE_NOT_PENDING`（`reason=scope_unresolved`）；
  4. 清单成员：任一 `--case` 不在 P(E, D) 中 → `ACCEPT_CASE_NOT_PENDING`，并列出不在清单中的 ID。

  锁外预检只用于提前报错；取得追加所用的账本锁后重读账本，按同一顺序复核，全部通过才追加。

  身份核对沿用 `spec/environments.md` §11.1 未决记录操作「给出的 `deploy_id` 必须等于记录的 `deploy_id`」的先例。
- **写入**：为每个用例追加一条 `kind=manual` 账本记录，字段为 `deploy_id`、`ref`、`case_id`、`result`、`note`、`evidence`、`recorder`。`recorder` 取 git 用户，只作展示。同一部署同一用例重复记录时，以最后一条为准。
- **撤销已有通过**：见 §2.107.7。
- `accept` 是 guard 受限命令（§2.107.10）。

### 2.107.6 smoke 门禁

**自动阶段（评审 proposal-r1 F4）**：
- 存在自动用例时，按既有规则判定；缺结果文件仍报 `NO_SMOKE_RESULTS`。
- 自动用例数为零但存在人工用例时，自动阶段视为空通过：不要求 runner 与结果文件，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`；配置了 `smoke.command` 时照常运行。
- `NO_SMOKE_CASES` 只在既没有自动用例也没有人工用例时报出。
- 全人工项目的 smoke 记录没有结果行，`env_evidence=missing`、`verified=false`，不能作为晋级依据；需要晋级的项目须至少有一条自动 smoke 用例。

**人工阶段（E 开启，且自动阶段 PASS）**，按顺序取第一条成立的：

| 条件 | gate.result | gate.reason |
|---|---|---|
| 清单无法确定（§2.107.4 第 5 条） | FAIL | `manual_scope_unresolved` |
| `regression_unresolved` 非空 | FAIL | `manual_regression_unresolved` |
| P 中任一用例在 D 上的最后结果为 `fail` | FAIL | `manual_cases_failed` |
| P 中用例在 D 上的最后结果全部为 `pass`（含 P 为空） | PASS | null |
| 其余（有未记录的用例） | PENDING | `manual_acceptance_pending` |

- **锁内复核（评审 proposal-r2 F3）**：取得账本锁后、追加 smoke 记录前，重读 D 的 manual 记录并重新判定人工阶段；锁外判定只用于提前报告，与 §2.95.3 审批锁内复核同一做法。因此账本中任何 PASS 记录之前的 manual 记录，都已被这条 PASS 采纳。
- **FAIL / PASS**：账本与标记写入照旧（`spec/environments.md` §5.1）；PASS 时 smoke 记录带 `manual_passed=true`。
- **PENDING 是一次门禁结论（评审 proposal-r1 F6）**：
  - 账本追加 smoke 记录：`result=pending`、`verified=false`，带 `deploy_id` 与 `manual_pending`。`manual_pending` 是在同一次锁内读取时 P 中仍无 D 记录的用例 ID（评审 proposal-r2 F6）。
  - 提案通道清除旧的 `SMOKE_PASS` / `SMOKE_FAIL`，沿用先账本后标记与快照恢复，不写新标记；版本通道只写账本。
  - 退出码与 FAIL 相同（1）。
- 重跑 smoke 会重新执行自动用例；人工结果按 `deploy_id` 保留，不需要重新记录。

**关闭时**（含没有登记表的项目）：
- 门禁结论只由自动阶段决定。
- 报告与 JSON 列出「未执行的人工用例」：R 版本相对 E 上一次部署版本（`previous_ref`）新增或内容有变化的人工用例，再加上 `regression`。E 没有上一次部署时，列 R 版本全部人工用例。
- 这些用例会在开启环境的 P 中自然累积。

### 2.107.7 结论过期（评审 proposal-r1 F3、proposal-r2 F3）

一次 PASS 结论只采纳在它之前记录的人工结果。

- **账本侧**：E 的一条 `manual_passed=true` smoke 记录，其后出现同一环境、同一 `deploy_id` 的 manual 记录时即**过期**。过期记录不作为基线 B，也不作为晋级依据：§2.95.1 的晋级判定与晋级候选只认未过期的 `verified=true` 记录。
- **提案通道**：活跃提案 `DEPLOY_DONE` 的 `deploy_id` 等于 D 时，`accept` 在追加账本后删除 `SMOKE_PASS`（先账本后标记；删除失败时撤销本次账本行，并以 `ACCEPT_LEDGER_WRITE_FAILED` 结束）。
- **archive 以账本为准再核对一次**：标记只是投影，交错执行时可能被并发的 smoke 重跑写回，也可能由同一提案此前部署的 smoke 在重新部署之后写回（评审 delta-r1 F1）。因此 `DEPLOY_DONE` 的环境 E 开启了人工验收（即使该部署 D 没有任何 manual 记录），或账本中存在 D 的 manual 记录时，archive 除 `SMOKE_PASS` 外还要求：D 自己的最近一条 smoke 记录为 `pass`（E 开启时还须 `manual_passed=true`），且其后没有 D 的 manual 记录；其他部署的记录不算。不满足时以 `ARCHIVE_SMOKE_NOT_PASSED` 拒绝，`details.reason` 为 `smoke_pass_expired`。
- next / status 把同一情况派生为「需要重跑 smoke」，不派生为可归档。
- E 未开启人工验收且 D 没有 manual 记录时，archive 与 next / status 的判据逐字不变。

### 2.107.8 等待人工验收的派生

- 等待状态只保存在账本，不新增提案标记。
- 以「环境 + 当前 `deploy_id`」（当前部署即最近一条 deploy 记录）匹配该环境最近一条 smoke 记录：`result=pending` 即为等待人工验收；当前部署被更新的部署取代后，旧 pending 不再生效。
- **剩余清单** = 该记录的 `manual_pending` 减去该记录之后同一部署 manual 记录覆盖的用例。只读账本、不读 git。多次重跑仍等待时，不会把已记录的用例重新列为待验。
- **提案通道**：活跃提案已部署、没有 `SMOKE_PASS` / `SMOKE_FAIL`，且 `DEPLOY_DONE` 的环境与 `deploy_id` 对应的最近 smoke 记录为 `pending` 时，`next` / `status` 驻留态为 `awaiting-manual-acceptance`（标签「等待人工验收」）：
  - 剩余非空：建议列出剩余用例与 `openlogos accept --env <E> --deploy <deploy_id> --case …` 原文，注明需要人执行；`auto_execute=false`，`--auto` 不放行。
  - 剩余为空：建议重跑 `openlogos smoke --env <E>`；`--auto` 下 driver 可重新驱动。
- **版本通道**：`env show` / `env list` / `status` 的环境视图给出同样的剩余清单。两个通道重启后都能恢复。

### 2.107.9 `--auto` 硬停点

- 「等待人工验收」且剩余清单非空，是继 `loop-exhausted`、部署审批 / 晋级（§2.95.4）之后的又一条硬停点：任何模式、含 `--auto`，都不自动放行。
- AI 不得执行 `openlogos accept`，不得修改 `manual_acceptance` 来关闭人工验收。
- 人记录后，宿主重新驱动 smoke 即可继续，不新增恢复机制或 flow 节点。
- 生成的 AGENTS.md / CLAUDE.md 硬红线与 `spec/change-management.md` 同步写入本条。

### 2.107.10 guard

- `openlogos accept`（任何参数形态，含 `--help`）加入受限命令清单，与 `openlogos approve` 同一宿主原生审批路径：
  - Claude Code `default` / `acceptEdits` 下由宿主对这一次调用弹出审批；
  - 其他模式、字段缺失、非交互运行与复合命令形态（含 `bash -c "…"` 内嵌）一律阻断，提示用户在终端以 `! <命令原文>` 自行执行，或经 RunLogos 界面执行。
- 宿主 driver 不得代替用户批准。
- qoder / workbuddy / zcode 适配层不能保证可靠的原生审批：在生命周期与安全命令的任何提前放行之前，对含 `openlogos accept` 的命令一律拒绝，initial 与 launched 结论相同（评审 delta-r1 F3）。
- 「已配置门禁的登记表」识别字段新增 `manual_acceptance`（§2.107.3）。

### 2.107.11 JSON 契约

- `openlogos smoke --format json`：
  - `gate.result` 新增 `PENDING`；
  - `gate.reason` 新增 `manual_scope_unresolved` / `manual_regression_unresolved` / `manual_cases_failed` / `manual_acceptance_pending`；
  - 新增 `data.manual_acceptance = {enabled, deploy_id, baseline_ref, pending[], passed[], failed[{id, note}], remaining[], regression_unresolved[], unexecuted[], warnings[]}`。开启时 `unexecuted` 为空数组；关闭时 `pending` / `passed` / `failed` / `remaining` 为空数组。
  - 没有任何人工用例且未配置该字段时，`data.manual_acceptance` 为 `{enabled:false, …, unexecuted:[]}`。
- `openlogos accept --format json`：`{environment, deploy_id, recorded[{case_id, result}], remaining[], expired_pass, warnings[]}`。`expired_pass` 表示本次追加前 D 是否已有未过期的通过记录（两种通道相同；提案通道另删除 `SMOKE_PASS`）。
- EnvView（`env show` / `env list` / `status`）：
  - 只在配置了 `manual_acceptance` 的环境上新增 `manual_acceptance = {enabled, regression, waiting: {deploy_id, remaining[]} | null}`；
  - `last_smoke.result` 可为 `pending`。
- `next --format json`：新增驻留态 `awaiting-manual-acceptance`，`auto_execute=false`（剩余为空时为重跑 smoke 的建议）。
- 完整字段见 `spec/cli-json-output.md`；`spec/schema/status.schema.json`（EnvView、`last_smoke.result`）与 `spec/schema/next.schema.json`（驻留态）同步。smoke、accept、env 的 JSON 没有独立 schema 文件，以 `spec/cli-json-output.md` 为准。

### 2.107.12 与既有规则的关系

- §2.106.8「需要人参与的验收在 openlogos #3 落地前用文字写明事项」由本节取代：change-writer 在该字段写出人工用例 ID，以及将在哪个开启人工验收的环境执行（尚无开启环境时，写明累积到下一次开启的环境）。
- `spec/test-results.md`「`[manual]` 标记用例」中「SMOKE 部分由 openlogos #3 交付」的过渡说明删除。
- §2.48 的平台跳过、必要证据判定只作用于自动 SMOKE；人工 SMOKE 的平台限定沿用 `[manual/<平台>]`，不新增跳过原因。

### 2.107.13 兼容性

- 未配置 `manual_acceptance` 且没有人工用例的项目：smoke、env、next、status、archive 的输出、写入与退出码与引入前一致。唯一新增是 smoke JSON 中值为默认的 `data.manual_acceptance`，以及报告中「未执行的人工用例 0 条」行；后者只在存在人工用例时出现。
- 有人工 UT/ST 但未开启人工验收的项目：门禁结论不变，报告新增「未执行的人工用例 N 条」。
- 账本只新增 `kind=manual` 记录、smoke 记录的 `result=pending` 取值与可选字段 `manual_passed` / `manual_pending`，旧记录原样有效。0.16.24 及更早的读取方把 manual 行与 pending 行计为坏行并跳过，单机升级后即消失。
- 此前 test-writer 禁止给 SMOKE 写 `[manual]`，存量项目没有人工 SMOKE 行；未带标记的 SMOKE 行读法逐字不变。

### 2.107.14 实现映射与追溯

| 能力 | 主要代码路径 | 主要测试路径 |
|---|---|---|
| SMOKE 首格读法、人工集合、`manual_smoke_result_id` | `cli/src/lib/smoke-coverage.ts`、`cli/src/commands/smoke.ts` | `cli/test/s19-*.test.ts` |
| `manual_acceptance` 字段校验、账本 manual 行与 pending 行的读写与校验、过期推导、EnvView 字段 | `cli/src/lib/environments.ts`、`cli/src/commands/env.ts`、`cli/src/commands/status.ts` | `cli/test/s41-*.test.ts`、`cli/test/s46-*.test.ts` |
| 待验收清单计算（两个 commit 间规格行对比） | `cli/src/lib/manual-acceptance.ts`（新增） | `cli/test/s46-*.test.ts` |
| `accept` 命令 | `cli/src/commands/accept.ts`（新增）、`cli/src/index.ts` | `cli/test/s46-*.test.ts` |
| smoke 空自动阶段、人工阶段、锁内复核、`PENDING` 落账与旧标记清除 | `cli/src/commands/smoke.ts` | `cli/test/s19-*.test.ts`、`cli/test/s46-*.test.ts` |
| archive 账本核对、晋级只认未过期记录 | `cli/src/lib/lifecycle-gate.ts`、`cli/src/commands/archive.ts`、`cli/src/commands/deploy.ts` | `cli/test/s46-*.test.ts` |
| `awaiting-manual-acceptance` 驻留态 | `cli/src/lib/flow-derive.ts`、`cli/src/commands/next.ts`、`cli/src/commands/status.ts` | `cli/test/s05-*.test.ts` |
| guard 受限命令与开关字段保护 | `plugin/bin/guard-check`、`plugin-cursor/hooks/runtime.cjs`、`plugin-qoder/hooks/runtime.cjs`、`plugin-workbuddy/hooks/runtime.cjs`、`plugin-zcode/runtime/hook-runtime.js` | `cli/test/s09-*.test.ts` |
| 生成指令硬红线 | `cli/src/commands/init.ts` | `cli/test/s08-*.test.ts` |
| JSON schema | `spec/schema/status.schema.json`、`spec/schema/next.schema.json` | `cli/test/s46-*.test.ts`、`cli/test/s05-*.test.ts` |

- 场景：S46（新增）、S19、S41、S05、S09。测试：`core-S46-test-cases.md` 全部用例，以及 `core-S19-test-cases.md`、`core-S41-test-cases.md`、`core-S05-test-cases.md`、`core-S09-test-cases.md`、`core-S08-test-cases.md` 中 smoke-manual-acceptance 新增用例；安装态 SMOKE-core-342 起。
