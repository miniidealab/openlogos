## MODIFIED — 5.1 位置与写入者

- 路径：`logos/.openlogos-runtime/deployments.jsonl`（该目录已在 init 托管的 `.gitignore` 区块中，对 AI 编辑工具恒阻断，见 `spec/pretooluse-guard.md`）。**正常路径只追加**，不改写他人记录；写入失败时的补偿只撤销本次写入（见下文「写入顺序与失败补偿」）。
- 写入者只有以下 CLI 路径：
  - `openlogos deploy-done --env <…>` 成功时追加一行 deploy 记录（`deploy-done` 恒要求活跃提案）；
  - `openlogos deploy`（来源变更 environment-deploy，§11）：每次实际执行或登记的部署结束时追加一行 deploy 记录（成功、失败或结果未知都写）；`--reconcile` 为结果未知的部署补记同一 `deploy_id` 的终态记录；`--complete` 为 agent 方式写入结果记录；`--abandon` 追加一行说明放弃的记录。提案通道成功时经 `deploy-done` 的写入函数追加（账本只写一条）；
  - `openlogos approve`（来源变更 environment-promotion-approval，§12.2）：写入一行 `kind=approval` 记录；查重（同一环境同一 commit 是否已有未使用审批）与追加在同一次账本锁临界区内完成，已有未使用审批时不写；
  - `openlogos accept`（来源变更 smoke-manual-acceptance，§15.5）：每个用例写入一行 `kind=manual` 记录；部署身份（最近一条 deploy 记录且已确认）与清单成员的核对和追加在同一次账本锁临界区内完成，整批全部写入或零写入；提案通道删除 `SMOKE_PASS` 失败时按本节「写入顺序与失败补偿」撤销本次追加的全部行；
  - `openlogos smoke --env <…>` 在产生门禁结论（PASS 或 FAIL）时追加一行 smoke 记录：存在活跃提案时 `slug` 为该提案；**部署执行已启用**（§1）而无活跃提案时 `slug` 为 null，部署身份取自账本（§4.2「部署身份核对」）。部署执行未启用且无活跃提案时不写（不伪造 `slug`、`deploy_id`、`ref`），与引入部署执行前一致。
  - 环境开启人工验收时（来源变更 smoke-manual-acceptance，§15.6），smoke 的 `PENDING` 也是门禁结论，追加一行 `result=pending` 的 smoke 记录；人工阶段在账本锁内重读该部署的 manual 记录并重新判定后才追加。
  - 未传 `--env` 时 `deploy-done` 与 `smoke` 不写；任何拒绝路径不写。
- 每条记录以一次写入一整行 JSON 加换行；目录不存在时先创建。
- **账本锁**：全部写入方的追加与失败补偿都在同一把短临界区锁内进行。锁以独占创建 `logos/.openlogos-runtime/deployments.jsonl.lock` 实现，操作结束即删除；等锁上限 5 秒，超时报错且不写入；锁文件超过 30 秒未更新视为异常退出遗留，可回收。临界区的结果只由临界区内的写入决定：写入已完成而释放锁失败时不算写入失败。读取账本（§5.4）不取锁。
- **写入方式**：账本非空且末字节不是换行时拒绝追加（不改账本），避免本次记录与末行粘连；追加以「原内容 + 本行」写临时文件后原子替换账本，失败时账本保持调用前字节，不产生残片；账本不可写时拒绝。
- **写入顺序与失败补偿**（来源变更 fix-environment-registry-review-gaps，决策 C02、C03）：`deploy-done` 与 `smoke` 都是**先追加账本、最后写提案标记**，因此标记在场即蕴含对应账本记录已写入。
  - 本次已追加、后续步骤失败：按本次追加的**整行原文**在锁内定位并移除该行，其余行原样保留后原子写回；同一原文出现多次、或整行匹配不到但原文仍在账本中（与相邻行粘连）时不改账本并报告。**不按文件长度推断归属**，其他写入方在此期间成功追加的记录逐字节保留。
  - `deploy-done`：写入前快照 tasks.md、旧 `SMOKE_PASS` / `SMOKE_FAIL`、旧 `DEPLOY_DONE`；勾选 `[deploy]` → 清理旧 smoke marker → 追加账本 → 最后写 `DEPLOY_DONE`，任一步失败按快照恢复，本次追加过账本时再撤销本次账本行，以 `DEPLOY_DONE_WRITE_FAILED` 结束（§8）；该快照与恢复在未传 `--env`（不写账本）时同样执行。`openlogos deploy` 的提案通道成功时调用同一写入函数（§11.5）。
  - `smoke`：账本追加失败（含锁等待超时）时不写、不改任何 smoke marker，以 `SMOKE_LEDGER_WRITE_FAILED` 结束；账本已写时，变更 marker 前先快照两种 marker 的存在性与原始内容，标记阶段任一步失败（写目标 marker 失败，或目标 marker 已写成、删除对侧 marker 失败）按快照恢复两种 marker 并撤销本次账本行，同样以 `SMOKE_LEDGER_WRITE_FAILED` 结束。恢复动作逐项捕获，恢复未完成时如实报告未恢复的位置，不声称已完整恢复。无活跃提案时 smoke 只追加账本、不写提案 marker，没有标记阶段。
  - smoke 未传 `--env`，或部署执行未启用且无活跃提案时不写账本，也不做 smoke 标记快照与恢复，行为不变。`deploy-done` 不受此例外影响：无论是否传入 `--env`、有无登记表，都保留既有的 tasks.md / 旧 smoke 标记 / 旧 `DEPLOY_DONE` 快照与失败恢复，只在本次没有追加账本时跳过账本补偿。

## MODIFIED — 5.2 记录字段

公共字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `kind` | `deploy` \| `smoke` \| `approval` \| `manual` | 记录类型（`approval` 来源变更 environment-promotion-approval；`manual` 来源变更 smoke-manual-acceptance） |
| `environment` | 字符串 | 有登记表时为解析后的 id，无登记表时为原始标签 |
| `slug` | 字符串 \| null | 活跃提案 slug；版本通道的 deploy 记录与无活跃提案的 smoke 记录为 null（来源变更 environment-deploy）；approval 记录为执行 `approve` 时的活跃提案 slug，没有活跃提案时为 null |
| `recorded_at` | 字符串 | ISO 8601 |
| `observed_head` | 字符串 \| null | 调用时 git HEAD 的完整 commit（非 git 仓库或读取失败为 null），**仅作观察信息** |
| `observed_dirty` | 布尔 \| null | 调用时工作区是否有未提交改动，**仅作观察信息** |

deploy 记录另含：`deploy_id`、`ref`、`ref_source`、`result`。`deploy-done` 写出的记录中三者与本次写入的 `DEPLOY_DONE` 相同、`result` 为 `done`，且不含下表的扩展字段（读取时按 `channel=proposal`、`mode=null` 理解）。`openlogos deploy` 写出的记录另含扩展字段（来源变更 environment-deploy，决策 C04、C06）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `ref` | 字符串 \| null | **已确认的**实际部署版本（40 位 commit）；没有证据时为 null（证据规则见 §11.4） |
| `ref_source` | `explicit` \| `ci-reported` \| `unknown` | `explicit`：script 方式在请求 commit 的隔离工作树中执行，或 deploy-done / agent 方式由执行者声明；`ci-reported`：CI 运行回报的实际部署提交等于请求 commit；`unknown`：`ref` 为 null |
| `result` | `done` \| `failed` \| `unknown` | `unknown` 表示已触发但不知道结果（CI 观察超时、触发后拿不到运行身份、放弃未决部署） |
| `channel` | `proposal` \| `version` | 部署通道 |
| `mode` | `script` \| `ci` \| `agent` | 执行方式 |
| `ref_input` | 字符串 | 用户给出的原始版本写法（如 `v1.0.4`、`HEAD`） |
| `ref_requested` | 字符串 | 请求部署的版本解析出的 40 位 commit |
| `rollback` | 布尔 | 是否为 `--rollback` 发起 |
| `rollback_from` | 字符串 \| null | 回滚前的 `current_ref` |
| `duration_ms` | 整数 \| null | 执行耗时；agent 方式与放弃记录为 null |
| `ci_run_id` / `ci_run_url` | 字符串 \| null | CI 运行身份（ci 方式） |
| `ci_reported_ref` | 字符串 \| null | CI 回报的实际部署提交原值，仅作审计，不参与 `current_ref` 计算 |
| `failure_reason` | 字符串 \| null | `exit-code` \| `timeout` \| `ci-failure` \| `ci-run-id-missing` \| `ci-observe-timeout` \| `agent-reported` \| `abandoned` \| null |
| `log_path` | 字符串 \| null | 运行态相对路径的部署日志（§11.7） |
| `reconciled` | 布尔 | 是否由 `--reconcile` 补记 |

smoke 记录另含：

| 字段 | 类型 | 含义 |
|---|---|---|
| `deploy_id` | 字符串 \| null | 本次 smoke 所依据部署的 `deploy_id`：有活跃提案时取自 `DEPLOY_DONE`（旧空格式为 null），无活跃提案时取自账本（§4.2「部署身份核对」） |
| `ref` | 字符串 \| null | **继承**所依据部署的 `ref`；不重新读取 HEAD |
| `result` | `pass` \| `fail` \| `pending` | smoke 门禁结论；`pending` 为等待人工验收（来源变更 smoke-manual-acceptance，§15.6），此时 `verified` 恒为 false |
| `env_evidence` | `declared` \| `missing` \| `mismatch` | 见 §6 |
| `fresh_results` | 布尔 | 本次 `openlogos smoke` 是否实际运行了 `smoke.command`，且计入门禁的结果行全部由这次运行产生（CLI 运行命令前清空结果文件，见 §6） |
| `deploy_env_confirmed` | 布尔 | 见 §4.2 |
| `verified` | 布尔 | 见 §5.3 |
| `manual_passed` | 布尔，可选 | 人工阶段判定通过（§15.6）时为 true；只出现在开启人工验收的环境的 `result=pass` 记录上 |
| `manual_pending` | 字符串数组，可选 | `result=pending` 时必有：锁内读取时 P(E, D) 中仍无该部署 manual 记录的用例 ID（§15.6） |

deploy 记录另含可选字段（来源变更 environment-promotion-approval，决策 C07）：只在目标环境为受门环境（§12.1）时写出，取值可为 null；未配置门的环境写出的记录不含这三个字段。

| 字段 | 类型 | 含义 |
|---|---|---|
| `approval_id` | 字符串 \| null | 本次部署所用审批；未要求审批时为 null |
| `promoted_from` | 字符串 \| null | 本次通过晋级检查所依据的上游环境 id；未配置 `promote_from`、`--rollback` 或越过时为 null |
| `promotion_override_reason` | 字符串 \| null | `--force-promote` 的理由；未越过时为 null |

approval 记录另含（来源变更 environment-promotion-approval，决策 C07）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `approval_id` | 字符串 | 随机 UUID（v4） |
| `ref` | 字符串 | 被批准的 40 位 commit（`--ref` 经 `git rev-parse <revision>^{commit}` 解析） |
| `ref_input` | 字符串 | 用户给出的原始版本写法 |
| `approver` | 字符串 \| null | `git config user.name` 与 `user.email` 组合（形如 `name <email>`），取不到时为操作系统用户名，再取不到为 null；**只作展示，不作身份认证** |
| `note` | 字符串 \| null | `--note` 的文字 |

manual 记录另含（来源变更 smoke-manual-acceptance，§15.5）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `deploy_id` | 字符串 | 记录所绑定的部署（锁内核对等于环境当前部署） |
| `ref` | 字符串 \| null | 继承该部署的 `ref` |
| `case_id` | 字符串 | 人工用例 ID（`UT-` / `ST-` / `SMOKE-`） |
| `result` | `pass` \| `fail` | 人工验收结果；同一部署同一用例以文件中最后一条为准 |
| `note` | 字符串 \| null | 说明；`result=fail` 时必须为非空字符串 |
| `evidence` | 字符串数组 | `--evidence` 的路径原文，可为空数组 |
| `recorder` | 字符串 \| null | 取法同 approval 记录的 `approver`；**只作展示，不作身份认证** |

## MODIFIED — 5.4 读取

- 顺序流式扫描**完整**账本，不设全局行数窗口；按环境只保留最近一次 deploy 记录、最近一次 smoke 记录、最近 20 条记录（任意 kind）的历史，以及 §7.1 的 `current_ref` / `previous_ref` 两个槽位，内存只随环境数与每环境历史条数增长。「最近」按文件中的行序（追加顺序）判定，不按 `recorded_at` 排序。
- **同一 `deploy_id` 的多条 deploy 记录**（结果未知后经 `--reconcile` / `--abandon` 补记，来源变更 environment-deploy）：以该 `deploy_id` 在文件中最后一条为准；前面的同 id 记录仍进入历史，但不再作为该次部署的结论。
- **逐行校验**（按 kind）：公共字段——`kind` 为 `deploy` / `smoke` / `approval` / `manual`，`environment` 为非空字符串，`slug` 为非空字符串或 null，`recorded_at` 为字符串，`observed_head` 为 40 位小写十六进制字符串或 null，`observed_dirty` 为布尔或 null。deploy 行——`deploy_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串或 null，`ref_source` 为 `explicit` / `ci-reported` / `unknown` 且与 `ref` 一致（`ref` 非 null ⇔ `ref_source` 不为 `unknown`），`result` 为 `done` / `failed` / `unknown`；含扩展字段时各字段类型与枚举按 §5.2 校验，`slug` 为 null 时 `channel` 必须为 `version`。smoke 行——`deploy_id` 为非空字符串或 null，`ref` 同上，`result` 为 `pass` / `fail` / `pending`（`pending` 时 `verified` 必须为 false、`manual_pending` 必须为字符串数组；`manual_passed` 出现时为布尔，来源变更 smoke-manual-acceptance），`env_evidence` 为三个枚举之一，`fresh_results`、`deploy_env_confirmed`、`verified` 为布尔，且 `verified` 等于按 §5.3 由同一行字段算出的值。
- **approval 行**（来源变更 environment-promotion-approval）：`approval_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串，`ref_input` 为字符串，`approver`、`note` 为字符串或 null；deploy 行的 `approval_id`、`promoted_from`、`promotion_override_reason` 出现时为字符串或 null。approval 记录进入历史，不进入 `last_deploy` / `last_smoke`，不影响 `current_ref` / `previous_ref`。
- **manual 行**（来源变更 smoke-manual-acceptance）：`deploy_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串或 null，`case_id` 为 `UT-` / `ST-` / `SMOKE-` 前缀的合法 ID，`result` 为 `pass` / `fail`，`result=fail` 时 `note` 为非空字符串、否则为字符串或 null，`evidence` 为字符串数组，`recorder` 为字符串或 null。manual 记录进入历史，不进入 `last_deploy`，不影响 `current_ref` / `previous_ref`；`result=pending` 的 smoke 记录进入 `last_smoke`。
- **人工验收推导**（同一次流式扫描，来源变更 smoke-manual-acceptance，§15.3、§15.7）：按环境维护当前部署（最近一条 deploy 记录，与 §4.2 同一身份）及其是否已确认、当前部署每个 `case_id` 的最后一条 manual 记录、通过记录的过期（`manual_passed=true` 的 smoke 记录之后出现同一 `deploy_id` 的 manual 记录即过期）、人工验收基线（`deploy_id` 不等于当前部署的部署中，最近一条未过期的 `manual_passed=true` 记录的 `ref`），以及等待状态与剩余清单。下一条「审批使用推导」中的「上游已验证 commit 集合」与「晋级候选」只认**未过期**的 `verified=true` smoke 记录。
- **审批使用推导**（同一次流式扫描，来源变更 environment-promotion-approval，决策 C07）：一条审批在其后出现同一环境、`ref_requested` 等于审批 `ref`、`result=done` 的 deploy 记录时视为已使用。使用是单向事实，判定**不**按同一 `deploy_id` 取最后一条：只要曾出现过这样一条成功记录，同一 `deploy_id` 之后的 unknown / abandoned 等记录（如成功落账后未决记录清理失败或进程中断，再执行 `--abandon`）不撤销使用（review delta-r1 F1）；从未出现成功记录时，failed / unknown 不使用。不写额外的消费记录。同时按环境维护上游已验证 commit 集合（smoke 记录中 `verified=true` 的 `ref`）与晋级候选（最近一条 `verified=true` smoke 记录的 `ref`），供 §12 与 §7.1 使用。
- 不是 JSON 对象或未通过上述校验的行整行跳过、计入 `corrupt_lines`，**不更新**该环境的任何槽位与历史；之前的有效记录仍是最近状态。未知的额外字段保留兼容、不导致跳过。读取不崩溃。0.16.3 及更早的读取方会把 `slug` 为 null、`result` 不为 `done` 或 `ref_source` 为 `ci-reported` 的记录计入 `corrupt_lines` 并跳过，0.16.4 及更早的读取方会把 `kind=approval` 的记录计入 `corrupt_lines` 并跳过，0.16.24 及更早的读取方会把 `kind=manual` 的记录与 `result=pending` 的 smoke 记录计入 `corrupt_lines` 并跳过；单机升级后即消失。
- 账本不存在视为空账本。`env list`、`env show`、`status`、`deploy` 与 smoke 的部署身份核对使用同一读取实现。
- 后续如需性能优化，引入可从账本完整重建的投影；投影不得成为事实来源。

## MODIFIED — 9. guard

- `logos/environments.yaml` 加入 `guard.exempt` 内置默认（environment-registry 决策 C07，见 `spec/pretooluse-guard.md`「guard.exempt 与内置默认」）：它是运维配置而非业务逻辑，修改不需立案。已显式配置 `guard.exempt` 的项目不自动获得该默认值，需由用户经保护范围命令手动添加。
- 账本、部署日志、环境锁、未决记录与隔离工作树都位于 `logos/.openlogos-runtime/`，对 AI 编辑工具恒阻断，只能由 CLI 写入。
- **部署只执行受保护的内容**（来源变更 environment-deploy，决策 D13）：登记表因 C07 豁免而可不经立案修改，因此 `deploy` 只能引用仓库内被 git 跟踪的脚本（默认放在 `deploy/` 下）与 `.github/workflows` 下的工作流；这些文件按「被 git 跟踪即受保护」的既有判定受 guard 保护，改变部署实际执行的内容必须修改它们、从而必须立案。CLI 以参数数组直接执行脚本、不经 shell，不新增保护规则。
- **门禁策略来源受保护**（来源变更 environment-promotion-approval，决策 C11，见 `spec/pretooluse-guard.md`「已配置门禁的环境登记表」）：只要 `logos/environments.yaml` 中出现 `promote_from`、`require_approval` 或 `manual_acceptance`（来源变更 smoke-manual-acceptance，§15.2）字段名，或出现反斜杠字符（guard 按文本保守识别，无法可靠证明无门禁时按已配置处理；§12.1 要求门禁字段以普通键名书写，CLI 认定的门禁因此在原文中必有字段名，review delta-r1 F2），该文件即为门禁策略来源——不适用内置默认豁免或 `guard.exempt`，不以活跃提案作为放行理由；AI 工具对它的直接修改（Edit / Write / MultiEdit、可识别写目标的 shell 写入）与删除 / 移动按宿主原生审批处理（交互模式由用户批准，其他模式阻断）。三个字段名都不出现、也不含反斜杠字符的登记表保持上述豁免。
- **审批与晋级越过只能由人产生**（来源变更 environment-promotion-approval，决策 C05，D14）：`openlogos approve` 与带 `--force-promote` 的 `openlogos deploy` 属 `spec/pretooluse-guard.md`「保护范围变更的宿主原生审批（C14）」的受限命令；审批写入运行态目录下的账本，AI 编辑工具不能直接伪造。
- **人工验收结果只能由人产生**（来源变更 smoke-manual-acceptance，D14 沿用）：`openlogos accept`（任何参数形态，含 `--help`）属同一受限命令清单；manual 记录写入运行态目录下的账本，AI 编辑工具不能直接伪造。

## ADDED — 15. 冒烟阶段人工验收（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（决策 C01～C03；proposal-r1 F1～F6、proposal-r2 F3/F6 处置）。功能规格 §2.107、架构「五十九」、场景 S46 / S19 / S41 / S05 / S09 与 `spec/cli-json-output.md` 引用本节，不另立口径。

### 15.1 人工用例

- 人工用例是已合并测试规格（`logos/resources/test/**/*.md`）中首格为「裸 ID + `[manual]` 或 `[manual/<平台>]`」的 `UT-*` / `ST-*` / `SMOKE-*` 行。首格读法见 `spec/test-results.md`「`[manual]` 标记用例」。
- 「行内容」指该表格行去掉首尾空白后的整行文本。

### 15.2 登记表字段 `manual_acceptance`

| 字段 | 类型 | 含义 |
|---|---|---|
| `manual_acceptance` | 对象，可选 | 该环境的冒烟验收是否执行人工用例 |
| `manual_acceptance.enabled` | 布尔，缺省 `false` | `true` 为开启 |
| `manual_acceptance.regression` | 字符串数组，缺省 `[]` | 每次发布必跑的回归人工用例 ID（`UT-` / `ST-` / `SMOKE-` 前缀，不得重复） |

- 结构或取值非法、出现转义键时报 `ENV_FIELD_INVALID`，登记表按非法处理（§2.2）；对象中的其他键出 `ENV_UNKNOWN_FIELD` 警告。
- 字段不要求环境配置了 `deploy`，**不**使环境成为受门环境（§12.1），不影响 `deploy-done`（§12.6）、审批与晋级。
- 任一环境写了该字段名，登记表即为门禁策略来源，受 guard 保护（§9）。

### 15.3 当前部署与基线

- **当前部署 D**（评审 delta-r1 F4）：与 §4.2「部署身份核对」同一身份——环境 E 在账本中**最近一条** deploy 记录（任意 `result`；同一 `deploy_id` 取最后一条，§5.4）。D 的 `ref` 记为 R，上一次部署的版本取 EnvView 的 `previous_ref`。
- **D 已确认**：D 的最终 `result=done`。D 为 `unknown` / `failed` 时，环境实际运行的版本未确定：accept 以 `ACCEPT_DEPLOYMENT_UNCONFIRMED` 拒绝；smoke 的人工阶段按清单无法确定处理（§15.6 顺序 1）；不得退回更早的成功部署。经 `--reconcile` 补记为 `done` 后，D 才可接受记录。
- **通过记录过期**：E 的一条 `manual_passed=true` smoke 记录之后，出现同一环境、同一 `deploy_id` 的 manual 记录时，该 smoke 记录过期。判定按账本行序。
- **基线 B**（评审 delta-r1 F2）：E 中 `deploy_id` **不等于 D** 的部署里，最近一条未过期的 `manual_passed=true` smoke 记录的 `ref`；不存在时为「无基线」。D 自己的通过记录不作为 D 的基线，因此 D 通过前后 P(E, D) 不变，通过后仍可对清单中的任一用例更正结果。

### 15.4 待验收清单 P(E, D)

1. D 未确认（§15.3），或 R 为 null，或 `git cat-file -e <R>^{commit}` 失败：清单无法确定（`scope_unresolved`）。不读取工作区；开启的环境由门禁判 FAIL（§15.6），关闭的环境只出警告 `manual_scope_unresolved`。
2. 枚举 R 版本的人工用例行：`git ls-tree -r --name-only <R> -- logos/resources/test` 下的 `.md` 文件，逐个 `git show <R>:<path>` 读取。
3. 有基线 B 且 B 可读：P₀ = R 版本中满足「在 B 版本不存在，或行内容不同」的人工用例。B 不可读时按无基线处理，并出警告 `manual_baseline_unavailable`。
4. 无基线（含 B 不可读）：P₀ = R 版本全部人工用例（决策 C02）。
5. 回归用例：`regression` 中每个 ID 在 R 版本的人工用例中存在者并入，P = P₀ ∪ 有效回归用例。不存在或不是人工用例的 ID 进入 `regression_unresolved`：开启的环境由门禁判 FAIL；关闭的环境出警告 `manual_regression_unknown`。
6. 关闭的环境改算「未执行的人工用例」`unexecuted`：R 版本相对 `previous_ref` 版本新增或行内容不同的人工用例，再并上有效回归用例；没有上一次部署，或 `previous_ref` 不可读时，取 R 版本全部人工用例。

### 15.5 `openlogos accept`

```
openlogos accept --env <id|alias> --deploy <deploy_id> --case <ID>[,<ID>…] --result pass|fail [--note <文字>] [--evidence <路径>]… [--format json]
```

- 前置（任一失败即零写入，退出码 1）：
  - 项目已初始化；
  - 登记表存在（`ENV_REGISTRY_NOT_FOUND`）且合法（`ENV_REGISTRY_INVALID`）；
  - `--env` 必填（`ENV_REQUIRED`）并按 §3 解析（`ENV_UNKNOWN`）；
  - `--deploy`、`--case`、`--result` 必填且合法（`ACCEPT_ARGS_INVALID`）；
  - `--result fail` 时 `--note` 非空（`ACCEPT_NOTE_REQUIRED`）；
  - E 开启人工验收（`ACCEPT_NOT_ENABLED`）；
  （部署身份与确认状态不在前置中检查，见下方判定顺序。）
- **判定顺序（锁外预检与锁内复核相同，评审 delta-r2 F4）**：参数与环境前置通过后，依次检查四项，取第一个失败项作为错误：
  1. **身份**：E 在账本中没有 deploy 记录 → `ACCEPT_NO_DEPLOYMENT`；E 最近一条 deploy 记录（§15.3 当前部署 D）的 `deploy_id` 不等于 `--deploy` → `ACCEPT_DEPLOY_CHANGED`（`details` 含 `expected`、`current`）；
  2. **确认状态**：D 未确认 → `ACCEPT_DEPLOYMENT_UNCONFIRMED`（`details` 含 `deploy_id`、`result`）；
  3. **清单可确定**：P(E, D) 无法确定 → `ACCEPT_CASE_NOT_PENDING`，`details.reason=scope_unresolved`；
  4. **清单成员**：任一 `--case` 不在 P 中 → `ACCEPT_CASE_NOT_PENDING`，`details.not_pending` 列出 ID。
  锁外按此顺序预检并计算 P，只用于提前报错；取得账本锁后重读账本，按同一顺序复核 1、2、4（P 沿用锁外结果，D 未变时清单不变），全部通过后再追加。因此 D1 成功、D2 结果未知时，用 D1 的清单得到 `ACCEPT_DEPLOY_CHANGED`，用 D2 的清单得到 `ACCEPT_DEPLOYMENT_UNCONFIRMED`。
- 在账本锁临界区内按上述顺序复核通过后，为每个用例追加一行 manual 记录（§5.2）。整批要么全部写入，要么零写入。
- 本次追加之前 D 已有未过期的 `manual_passed=true` smoke 记录时，输出 `expired_pass=true`（两种通道相同，账本侧过期由行序自动成立）。提案通道：活跃提案 `DEPLOY_DONE` 的 `deploy_id` 等于 D，且 `SMOKE_PASS` 在场时，追加账本之后删除 `SMOKE_PASS`。删除失败时按 §5.1「写入顺序与失败补偿」撤销本次追加的全部行，以 `ACCEPT_LEDGER_WRITE_FAILED` 结束。账本追加失败（含锁等待超时）同样报 `ACCEPT_LEDGER_WRITE_FAILED`，不改任何标记。
- `--evidence` 的路径不存在时出警告 `accept_evidence_missing`，不拒绝；路径原文写入记录。
- `accept` 是 guard 受限命令（§9）。

### 15.6 smoke 门禁接入

- **自动阶段**：存在自动 SMOKE 用例时按既有规则判定。自动用例为零、存在人工用例（任意 UT / ST / SMOKE；工作区或环境当前已确认部署的版本 R 中任一处存在即可，R 按全部人工用例判断、不只看本次增量，评审 code-r2 F5；R 取自账本中该环境最近一条 deploy 记录，与部署执行是否启用、是否有活跃提案无关——只经 `deploy-done` 登记部署的项目同样适用，smoke 是否写账本仍按部署执行开关，评审 code-r3 F5）时视为空通过，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`，配置了 `smoke.command` 时照常运行；两者都为零时报 `NO_SMOKE_CASES`。
- **人工阶段**（E 开启，且自动阶段 PASS）：
  1. 锁外计算 P(E, D)，并按下表预判，只用于报告。D 固定为本次 smoke 开始时解析出的部署身份，清单计算、锁内复核与证据写入都绑定 D（评审 code-r1 F1）；计算时环境当前部署已不是 D，按「P 无法确定」处理并出警告 `manual_deployment_replaced`，要求对当前部署重跑；此时 JSON 与报告中的 `deploy_id`、`ref`、`deploy_confirmed` 整组取自 D，更替后的部署只在警告中列出（评审 code-r2 F1）。
  2. 取得账本锁后、追加 smoke 行前，先核对环境当前部署的 `deploy_id`、`ref` 与确认状态仍与 D 一致（不一致同样按「P 无法确定」处理并出 `manual_deployment_replaced`），再重读 D 的 manual 记录并按下表重新判定，以锁内结论为准。
  3. 按结论追加 smoke 行，然后按 §5.1 处理标记。

| 顺序 | 条件 | gate.result / reason | smoke 行 | 提案标记 |
|---|---|---|---|---|
| 1 | P 无法确定 | FAIL / `manual_scope_unresolved` | `result=fail` | 写 `SMOKE_FAIL` |
| 2 | `regression_unresolved` 非空 | FAIL / `manual_regression_unresolved` | `result=fail` | 写 `SMOKE_FAIL` |
| 3 | P 中任一用例在 D 上的最后结果为 `fail` | FAIL / `manual_cases_failed` | `result=fail` | 写 `SMOKE_FAIL` |
| 4 | P 中用例在 D 上的最后结果全部为 `pass`（含 P 为空） | PASS / null | `result=pass`、`manual_passed=true` | 写 `SMOKE_PASS` |
| 5 | 其余 | PENDING / `manual_acceptance_pending` | `result=pending`、`verified=false`、`manual_pending` = P 中锁内读取时仍无 D 记录的 ID | 清除 `SMOKE_PASS` / `SMOKE_FAIL`，不写新标记 |

- PENDING 的退出码为 1。版本上下文（§14.3）不读不写提案标记，只追加账本行。
- 关闭时（含没有登记表）：门禁结论只由自动阶段决定；报告与 JSON 列出 `unexecuted`。

### 15.7 等待状态与剩余清单

- E 的当前部署 D（§15.3，最近一条 deploy 记录）在账本中最近一条 smoke 记录为 `result=pending` 时，E 处于等待人工验收；D 被更新的部署取代后，旧 pending 不再生效。
- 剩余清单 = 该记录的 `manual_pending` 减去其后 D 的 manual 记录覆盖的 `case_id`。
- 只读账本，由 §5.4 的同一次流式扫描得出；EnvView 的 `manual_acceptance.waiting` 与 next 的驻留态 `awaiting-manual-acceptance` 都使用这一结果。

### 15.8 archive 核对

设 `DEPLOY_DONE` 的环境为 E、`deploy_id` 为 D。满足以下任一条件时，archive 除既有的 `SMOKE_PASS` 判定外，还以账本核对 D 自己的最近有效结论（评审 delta-r1 F1）：

- E 在登记表中开启了人工验收——**即使 D 没有任何 manual 记录**也核对；
- 账本中存在 D 的 manual 记录。

核对要求：D 最近一条 smoke 记录为 `result=pass`（E 开启人工验收时还须 `manual_passed=true`），且其后没有 D 的 manual 记录。只认 `deploy_id` 等于 D 的记录，其他部署（包括同一提案此前的部署）留下的通过记录与标记都不算。不满足时以 `ARCHIVE_SMOKE_NOT_PASSED` 拒绝，`details.reason=smoke_pass_expired`。两个条件都不满足时（未开启人工验收且 D 没有 manual 记录），archive 判据逐字不变。

### 15.9 错误码与警告

| 码 | 级别 | 触发 | 退出码 |
|---|---|---|---|
| `ACCEPT_ARGS_INVALID` | error | `--deploy` / `--case` / `--result` 缺失或取值非法 | 1 |
| `ACCEPT_NOTE_REQUIRED` | error | `--result fail` 未带非空 `--note` | 1 |
| `ACCEPT_NOT_ENABLED` | error | 目标环境未开启人工验收 | 1 |
| `ACCEPT_NO_DEPLOYMENT` | error | 目标环境在账本中没有任何 deploy 记录 | 1 |
| `ACCEPT_DEPLOYMENT_UNCONFIRMED` | error | 目标环境最近一条 deploy 记录的结果不是 `done`（`unknown` / `failed`）；`details` 含 `deploy_id`、`result` | 1 |
| `ACCEPT_DEPLOY_CHANGED` | error | `--deploy` 不等于锁内读取的当前部署；`details` 含 `expected`、`current` | 1 |
| `ACCEPT_CASE_NOT_PENDING` | error | 有 `--case` 不在 P(E, D) 中，或 P 无法确定；`details` 含 `not_pending` / `reason` | 1 |
| `ACCEPT_LEDGER_WRITE_FAILED` | error | 账本追加失败，或删除 `SMOKE_PASS` 失败后已撤销本次追加 | 1 |
| `accept_evidence_missing` | warning | `--evidence` 路径不存在 | — |
| `manual_smoke_result_id` | diagnostic（门禁 FAIL） | smoke 结果含人工 SMOKE ID | — |
| `manual_scope_unresolved` | gate reason / warning | 当前部署未确认，或已部署版本为 null / 不可读（开启 → FAIL；关闭 → 警告） | — |
| `manual_regression_unresolved` | gate reason | 开启环境的回归 ID 在 R 版本不存在或不是人工用例 | — |
| `manual_regression_unknown` | warning | 关闭环境的回归 ID 失效 | — |
| `manual_baseline_unavailable` | warning | 基线 B 不可读，按全量计算 | — |
| `manual_deployment_replaced` | warning | 本次 smoke 期间环境当前部署已不是开始时的 D；开启时伴随 `manual_scope_unresolved` 的 FAIL，不为 D 签发人工通过 | — |
| `manual_cases_failed` | gate reason | P 中有用例最后结果为 `fail` | — |
| `manual_acceptance_pending` | gate reason | P 中有用例尚无记录 | — |

所有面向人的文案走 i18n，中英文都要提供。

### 15.10 兼容性

- 未写 `manual_acceptance`、没有人工用例的项目：所有命令的输出、写入与行为逐字不变。
- 账本只新增 `kind=manual` 记录、smoke `result=pending` 取值与可选字段 `manual_passed` / `manual_pending`，旧记录原样有效。0.16.24 及更早的读取方把 manual 行与 pending 行计入 `corrupt_lines` 并跳过。
