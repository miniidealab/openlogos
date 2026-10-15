# 环境登记表与部署账本规范

> 来源变更：environment-registry（决策 C01～C08）。本文件是环境登记表、`DEPLOY_DONE` 内容格式、本机部署账本、smoke 环境证据与环境视图的权威定义；功能规格 §2.93、架构「五十三、环境登记表与部署账本」、场景 S41 / S21 / S19 / S11 与 `spec/cli-json-output.md` 引用本文件，不另立口径。

## 1. 适用范围

- 环境管理是 **opt-in**：项目根下存在 `logos/environments.yaml` 即视为启用；文件不存在表示未启用，`deploy-done`、`smoke`、`status` 的输出与退出码与未引入本规范前逐字一致（唯一例外见 §4.2「非空损坏」）。`openlogos deploy` 要求登记表存在（§11）。
- 本规范只覆盖**单机**：环境定义进仓库（可共享），部署状态与历史只存在本机运行态目录，不进 git、不做同步（environment-registry 决策 C02）。
- 部署执行（来源变更 environment-deploy）：`openlogos deploy` 按登记表中每个环境的 `deploy` 配置执行部署（script / ci / agent 三种方式）、支持提案通道与版本通道、以重新部署上一个成功版本实现回滚，结果写入同一本机账本，见 §11。
- 晋级与审批（来源变更 environment-promotion-approval）：环境可配置晋级顺序 `promote_from` 与审批门禁 `require_approval`，`openlogos approve` 把审批写入同一本机账本，`deploy` 在前置链中检查两道门，见 §12。未配置这两个字段的项目，所有命令的输出、写入与行为与引入前逐字一致。
- **部署执行已启用**（来源变更 environment-deploy，review delta-r1 F3）：登记表存在且至少一个环境配置了 `deploy`，**或**账本中存在由 `openlogos deploy` 写出的记录（带 `channel` 字段）。后一条保证移除 `deploy` 配置后，已发生的版本通道事实仍进入身份核对。本规范中以下行为只在部署执行已启用时生效：smoke 的部署身份核对与无活跃提案时写账本（§4.2、§5.1）、环境视图的部署执行字段（§7.1）。部署执行未启用的项目（无登记表，或登记表中没有任何 `deploy` 且账本只有 `deploy-done` 写出的记录），`deploy-done`、`smoke`、`status`、`env` 的输出、退出码与写入与引入部署执行前逐字一致。

## 2. 登记表 `logos/environments.yaml`

### 2.1 结构

```yaml
schema_version: 1
environments:
  - id: test
    name: 测试环境
    tier: test
    aliases: [测试, qa]
    description: 内部联调环境
    health: https://test.example.com/healthz
    version: https://test.example.com/version
    secrets: [TEST_DEPLOY_TOKEN]
  - id: prod
    name: 生产环境
    tier: prod
    aliases: [生产, production]
```

### 2.2 字段

| 字段 | 必填 | 类型 | 约束 |
|---|---|---|---|
| `schema_version` | 是 | 整数 | 只接受 `1` |
| `environments` | 是 | 数组 | 可为空数组 |
| `environments[].id` | 是 | 字符串 | `^[a-z0-9][a-z0-9-]*$`，全表唯一 |
| `environments[].name` | 是 | 字符串 | 非空，显示名 |
| `environments[].tier` | 是 | 字符串 | `dev` \| `test` \| `staging` \| `prod` |
| `environments[].aliases` | 否 | 字符串数组 | 每项非空；与全部 id、alias **不区分大小写**地全局唯一 |
| `environments[].description` | 否 | 字符串 | — |
| `environments[].health` | 否 | 字符串 | `http://` 或 `https://` 开头的 URL |
| `environments[].version` | 否 | 字符串 | `http://` 或 `https://` 开头的 URL |
| `environments[].secrets` | 否 | 字符串数组 | 每项满足 `^[A-Za-z_][A-Za-z0-9_]*$`，只写环境变量名，**不得写值** |
| `environments[].deploy` | 否 | 映射 | 部署执行配置（来源变更 environment-deploy），结构与约束见 §11.2；未配置的环境不能用 `openlogos deploy` 部署，`deploy-done --env` 的既有用法不受影响 |
| `environments[].promote_from` | 否 | 字符串 | 晋级上游（来源变更 environment-promotion-approval，§12.1）：必须等于登记表中另一个环境的 `id`（不接受 alias），不得等于自身，各环境的 `promote_from` 不得成环；只在配置了 `deploy` 的环境上合法；须以普通键名书写（§12.1） |
| `environments[].require_approval` | 否 | 布尔 | 审批门禁（§12.1）：为 `true` 时部署须有未使用的审批；只在配置了 `deploy` 的环境上合法；须以普通键名书写（§12.1） |

- **未知字段**（顶层或环境项内，含 `deploy` 内未知的子字段）只产生 warning `ENV_UNKNOWN_FIELD`，不报错。`deploy` 本身不再是未知字段，按 §11.2 校验；`promote_from`、`require_approval` 自 environment-promotion-approval 起不再是未知字段，按 §12.1 校验。
- **`deploy` 不承载可执行命令**（决策 D13）：只允许引用仓库内脚本路径与 CI 工作流名，以及参数、超时等非执行性配置；出现命令字符串类字段（如 `run`、`command`、`shell`）按 `ENV_FIELD_INVALID` 拒绝，不按未知字段放行。
- **校验失败**（YAML 无法解析、顶层不是映射、`schema_version` 不为 1、必填字段缺失、字段类型或取值非法、id / alias 冲突、`deploy` 不合法、`promote_from` 引用非法或成环）统称 `ENV_REGISTRY_INVALID`，并在 `env check` 中逐条点名（`ENV_FIELD_INVALID`、`ENV_DUPLICATE_ID_OR_ALIAS`）。登记表存在但非法时 **fail-closed**：`deploy-done`、`smoke`、`deploy` 与 `approve` 拒绝执行（退出码 1，不写 marker、不写账本、不执行任何部署），不回落为「未启用」；`status` 不崩溃，输出 `environment_registry_error`（见 §7.3）。

### 2.3 与 `deployment_gates.<module>.environments` 的关系

`logos/logos-project.yaml` 中 `deployment_gates.<module>.environments` 保留原语义「本模块需要覆盖的环境」。登记表存在时，`env check` 校验其中每一项都能按 §3 解析到登记表中的环境，解析不到报 `ENV_GATE_REFERENCE_UNKNOWN`；登记表不存在时不做该校验。环境定义不写入 `logos-project.yaml`。

## 3. 环境解析（`--env`）

1. **登记表不存在**：`--env <label>` 为自由标签，不校验，原样使用。
2. **登记表存在**：输入先与各环境 `id` 不区分大小写比较，命中即得该 id；否则与各 `aliases` 项不区分大小写比较；仍未命中报 `ENV_UNKNOWN`（退出码 1，消息列出全部可用 id）。
3. **登记表存在但未传 `--env`**：`deploy-done` 与 `smoke` 报 `ENV_REQUIRED`（退出码 1，列出全部可用 id）。不做「只有一个环境就默认选它」的推断。
4. 解析失败与拒绝均零副作用：不勾选 `[deploy]`、不写任何 marker、不写账本、不运行 `smoke.command`。

## 4. `DEPLOY_DONE` 内容格式

### 4.1 写入（`openlogos deploy-done`）

成功时写入单行 JSON（末尾换行），重跑 `deploy-done` 时整体重写：

```json
{"deploy_id":"6f1c…","environment":"test","ref":"<40 位 commit>","ref_source":"explicit","recorded_at":"2026-10-14T08:00:00.000Z"}
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `deploy_id` | 字符串 | 本次落标的随机 UUID（v4） |
| `environment` | 字符串 \| null | 有登记表时为解析后的 id；无登记表时为 `--env` 原始标签；未传 `--env` 时为 `null` |
| `ref` | 字符串 \| null | 实际部署版本：`--ref <revision>` 经 `git rev-parse <revision>^{commit}` 解析得到的 40 位小写十六进制 commit；未传 `--ref` 时为 `null`（版本未知） |
| `ref_source` | `explicit` \| `unknown` | 传入且解析成功为 `explicit`，未传为 `unknown` |
| `recorded_at` | 字符串 | ISO 8601 时间 |

- `--ref` 只声明「这次已完成的部署对应哪个版本」，不执行部署，与提案 B 中 `openlogos deploy` 的版本通道无关。
- `--ref` 无法解析（不存在、不是 git 仓库、解析结果不是 commit）报 `ENV_REF_UNRESOLVED`（退出码 1），零副作用。
- **调用时 HEAD 不是版本依据**：CLI 只把调用时 HEAD 作为观察信息写入账本（§5.2 `observed_head`），不写入 `DEPLOY_DONE.ref`，不以其代替未知版本。

### 4.2 读取分类（`openlogos smoke` 前置检查）

`DEPLOY_DONE` 存在性语义不变（存在即部署完成，flow 的 `done_when: marker:DEPLOY_DONE` 与 RunLogos completion-judge 不改）。

**活跃提案是 smoke 的可选上下文**：既有 `openlogos smoke` 允许在没有活跃提案（无 `logos/.openlogos-guard`）时运行，此时不做提案前置、不读取 `DEPLOY_DONE`、不写提案 marker。以下分类只在存在活跃提案、既有前置（§2.67.1 系列：smoke 需求、部署决策、`DEPLOY_DONE` 存在、`[deploy]` 全勾）通过后执行，按内容分三类：

| 类别 | 判定 | 处理 |
|---|---|---|
| 旧空格式 | 文件 0 字节，或只含空白字符（仅旧版 CLI 写出） | 环境未知，放行；`deploy_env_confirmed=false`；`deploy_id`、`ref` 视为 `null` |
| 合法新格式 | 一个 JSON 对象，且 §4.1 五个字段齐全、类型与取值合法 | 一致（`environment` 非空且等于本次环境）→ `deploy_env_confirmed=true`；不一致 → **登记表存在时**拒绝 `SMOKE_ENV_MISMATCH`，**登记表不存在时**不拒绝、门禁与退出码不变，仅 `deploy_env_confirmed=false`；`environment` 为 `null`（或本次未传 `--env`）→ 放行且 `deploy_env_confirmed=false` |
| 非空损坏 | 非空且不属上两类：不是 JSON、不是对象、缺字段、字段类型或取值非法 | 拒绝 `SMOKE_DEPLOY_MARKER_INVALID`（退出码 1，消息点名问题字段），**无论有无登记表** |

- 拒绝（`SMOKE_ENV_MISMATCH`、`SMOKE_DEPLOY_MARKER_INVALID`、`SMOKE_DEPLOY_SUPERSEDED`）均不运行 `smoke.command`、不写 `SMOKE_PASS` / `SMOKE_FAIL`、不写账本。`SMOKE_ENV_MISMATCH` 与 `SMOKE_DEPLOY_SUPERSEDED` 只在登记表存在时产生；无登记表项目唯一新增的拒绝是 `SMOKE_DEPLOY_MARKER_INVALID`。
- 非空损坏只可能来自新版 marker 被截断或改坏（旧版 CLI 只写空文件），无法证明属于历史格式，因此不按存在性放行。恢复方式：确认真实部署环境与版本后重新执行 `openlogos deploy-done --env <id> [--ref <revision>]` 重写 marker；CLI 不猜测、不自愈。
- `SMOKE_PASS` / `SMOKE_FAIL` 仍为空文件，环境信息只进账本。

**部署身份核对**（来源变更 environment-deploy，决策 C15）：**部署执行已启用**（§1）且传入 `--env` 时，smoke 以账本中该环境**最近一条 deploy 记录**（任意 `result`；同一 `deploy_id` 有多条时取最后一条，见 §5.4）作为环境当前部署身份。

- **有活跃提案**：合法新格式 `DEPLOY_DONE` 的 `deploy_id` 必须等于该记录的 `deploy_id`。不相等说明该环境在提案落标之后又被部署过（例如经版本通道发布了其他版本），smoke 以 `SMOKE_DEPLOY_SUPERSEDED` 拒绝（退出码 1，`error.details` 给出 marker 与账本最新记录的 `deploy_id`、`ref`），零副作用，不改写提案 marker；恢复方式为在提案通道重新部署。旧空格式 marker、或账本中该环境没有任何 deploy 记录时，不做本核对，沿用上表口径（部署环境未确认、不能 verified）。
- **无活跃提案**：部署身份（`deploy_id`、`ref`）取自该账本记录；该记录 `result=done` 时 `deploy_env_confirmed=true`，否则为 false；账本中该环境没有 deploy 记录时 `deploy_id`、`ref` 为 null、`deploy_env_confirmed=false`。smoke 照常运行并追加 smoke 记录（`slug` 为 null，见 §5.1），不写任何提案 marker。`verified` 规则（§5.3）不变：`ref` 为 null（版本未确认）时不成立。
- 部署执行未启用或未传 `--env` 时不做本核对，行为逐字不变：有活跃提案时按上表口径，无活跃提案时不读账本身份、不写账本。

## 5. 本机部署账本

### 5.1 位置与写入者

- 路径：`logos/.openlogos-runtime/deployments.jsonl`（该目录已在 init 托管的 `.gitignore` 区块中，对 AI 编辑工具恒阻断，见 `spec/pretooluse-guard.md`）。**正常路径只追加**，不改写他人记录；写入失败时的补偿只撤销本次写入（见下文「写入顺序与失败补偿」）。
- 写入者只有以下 CLI 路径：
  - `openlogos deploy-done --env <…>` 成功时追加一行 deploy 记录（`deploy-done` 恒要求活跃提案）；
  - `openlogos deploy`（来源变更 environment-deploy，§11）：每次实际执行或登记的部署结束时追加一行 deploy 记录（成功、失败或结果未知都写）；`--reconcile` 为结果未知的部署补记同一 `deploy_id` 的终态记录；`--complete` 为 agent 方式写入结果记录；`--abandon` 追加一行说明放弃的记录。提案通道成功时经 `deploy-done` 的写入函数追加（账本只写一条）；
  - `openlogos approve`（来源变更 environment-promotion-approval，§12.2）：写入一行 `kind=approval` 记录；查重（同一环境同一 commit 是否已有未使用审批）与追加在同一次账本锁临界区内完成，已有未使用审批时不写；
  - `openlogos smoke --env <…>` 在产生门禁结论（PASS 或 FAIL）时追加一行 smoke 记录：存在活跃提案时 `slug` 为该提案；**部署执行已启用**（§1）而无活跃提案时 `slug` 为 null，部署身份取自账本（§4.2「部署身份核对」）。部署执行未启用且无活跃提案时不写（不伪造 `slug`、`deploy_id`、`ref`），与引入部署执行前一致。
  - 未传 `--env` 时 `deploy-done` 与 `smoke` 不写；任何拒绝路径不写。
- 每条记录以一次写入一整行 JSON 加换行；目录不存在时先创建。
- **账本锁**：全部写入方的追加与失败补偿都在同一把短临界区锁内进行。锁以独占创建 `logos/.openlogos-runtime/deployments.jsonl.lock` 实现，操作结束即删除；等锁上限 5 秒，超时报错且不写入；锁文件超过 30 秒未更新视为异常退出遗留，可回收。临界区的结果只由临界区内的写入决定：写入已完成而释放锁失败时不算写入失败。读取账本（§5.4）不取锁。
- **写入方式**：账本非空且末字节不是换行时拒绝追加（不改账本），避免本次记录与末行粘连；追加以「原内容 + 本行」写临时文件后原子替换账本，失败时账本保持调用前字节，不产生残片；账本不可写时拒绝。
- **写入顺序与失败补偿**（来源变更 fix-environment-registry-review-gaps，决策 C02、C03）：`deploy-done` 与 `smoke` 都是**先追加账本、最后写提案标记**，因此标记在场即蕴含对应账本记录已写入。
  - 本次已追加、后续步骤失败：按本次追加的**整行原文**在锁内定位并移除该行，其余行原样保留后原子写回；同一原文出现多次、或整行匹配不到但原文仍在账本中（与相邻行粘连）时不改账本并报告。**不按文件长度推断归属**，其他写入方在此期间成功追加的记录逐字节保留。
  - `deploy-done`：写入前快照 tasks.md、旧 `SMOKE_PASS` / `SMOKE_FAIL`、旧 `DEPLOY_DONE`；勾选 `[deploy]` → 清理旧 smoke marker → 追加账本 → 最后写 `DEPLOY_DONE`，任一步失败按快照恢复，本次追加过账本时再撤销本次账本行，以 `DEPLOY_DONE_WRITE_FAILED` 结束（§8）；该快照与恢复在未传 `--env`（不写账本）时同样执行。`openlogos deploy` 的提案通道成功时调用同一写入函数（§11.5）。
  - `smoke`：账本追加失败（含锁等待超时）时不写、不改任何 smoke marker，以 `SMOKE_LEDGER_WRITE_FAILED` 结束；账本已写时，变更 marker 前先快照两种 marker 的存在性与原始内容，标记阶段任一步失败（写目标 marker 失败，或目标 marker 已写成、删除对侧 marker 失败）按快照恢复两种 marker 并撤销本次账本行，同样以 `SMOKE_LEDGER_WRITE_FAILED` 结束。恢复动作逐项捕获，恢复未完成时如实报告未恢复的位置，不声称已完整恢复。无活跃提案时 smoke 只追加账本、不写提案 marker，没有标记阶段。
  - smoke 未传 `--env`，或部署执行未启用且无活跃提案时不写账本，也不做 smoke 标记快照与恢复，行为不变。`deploy-done` 不受此例外影响：无论是否传入 `--env`、有无登记表，都保留既有的 tasks.md / 旧 smoke 标记 / 旧 `DEPLOY_DONE` 快照与失败恢复，只在本次没有追加账本时跳过账本补偿。

### 5.2 记录字段

公共字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `kind` | `deploy` \| `smoke` \| `approval` | 记录类型（`approval` 来源变更 environment-promotion-approval） |
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
| `result` | `pass` \| `fail` | smoke 门禁结论 |
| `env_evidence` | `declared` \| `missing` \| `mismatch` | 见 §6 |
| `fresh_results` | 布尔 | 本次 `openlogos smoke` 是否实际运行了 `smoke.command`，且计入门禁的结果行全部由这次运行产生（CLI 运行命令前清空结果文件，见 §6） |
| `deploy_env_confirmed` | 布尔 | 见 §4.2 |
| `verified` | 布尔 | 见 §5.3 |

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

### 5.3 已验证（`verified`）

smoke 记录的 `verified` 为 `true` 当且仅当同时满足：`result=pass`、`env_evidence=declared`、`fresh_results=true`、`deploy_env_confirmed=true`、`ref` 非 null。

`fresh_results` 是「结果属于这次部署」的证据：未配置 `smoke.command`（也无默认 dispatcher）时，既有门禁会直接汇总结果文件中已有的行，这些行可能是上一代部署留下的（例如 R1 通过后重新部署 R2，结果文件不会被清理），它们的 `target_environment` 一致也只证明当时验证过该环境，不证明验证过本次部署的版本。此类运行维持既有门禁兼容展示，但 `fresh_results=false`、`verified=false`。本规范不接受外部预生成结果作为版本证据；如未来需要，须让结果行显式携带并核对 `deploy_id` 或实际版本，不得仅从 marker 补上身份。只有 `verified=true` 的记录表示「该 ref 已在该环境通过 smoke」；环境视图与提案 B、C 的晋级判断只认 `verified=true`，其余记录只作兼容展示。

### 5.4 读取

- 顺序流式扫描**完整**账本，不设全局行数窗口；按环境只保留最近一次 deploy 记录、最近一次 smoke 记录、最近 20 条记录（任意 kind）的历史，以及 §7.1 的 `current_ref` / `previous_ref` 两个槽位，内存只随环境数与每环境历史条数增长。「最近」按文件中的行序（追加顺序）判定，不按 `recorded_at` 排序。
- **同一 `deploy_id` 的多条 deploy 记录**（结果未知后经 `--reconcile` / `--abandon` 补记，来源变更 environment-deploy）：以该 `deploy_id` 在文件中最后一条为准；前面的同 id 记录仍进入历史，但不再作为该次部署的结论。
- **逐行校验**（按 kind）：公共字段——`kind` 为 `deploy` / `smoke` / `approval`，`environment` 为非空字符串，`slug` 为非空字符串或 null，`recorded_at` 为字符串，`observed_head` 为 40 位小写十六进制字符串或 null，`observed_dirty` 为布尔或 null。deploy 行——`deploy_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串或 null，`ref_source` 为 `explicit` / `ci-reported` / `unknown` 且与 `ref` 一致（`ref` 非 null ⇔ `ref_source` 不为 `unknown`），`result` 为 `done` / `failed` / `unknown`；含扩展字段时各字段类型与枚举按 §5.2 校验，`slug` 为 null 时 `channel` 必须为 `version`。smoke 行——`deploy_id` 为非空字符串或 null，`ref` 同上，`result` 为 `pass` / `fail`，`env_evidence` 为三个枚举之一，`fresh_results`、`deploy_env_confirmed`、`verified` 为布尔，且 `verified` 等于按 §5.3 由同一行字段算出的值。
- **approval 行**（来源变更 environment-promotion-approval）：`approval_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串，`ref_input` 为字符串，`approver`、`note` 为字符串或 null；deploy 行的 `approval_id`、`promoted_from`、`promotion_override_reason` 出现时为字符串或 null。approval 记录进入历史，不进入 `last_deploy` / `last_smoke`，不影响 `current_ref` / `previous_ref`。
- **审批使用推导**（同一次流式扫描，来源变更 environment-promotion-approval，决策 C07）：一条审批在其后出现同一环境、`ref_requested` 等于审批 `ref`、`result=done` 的 deploy 记录时视为已使用。使用是单向事实，判定**不**按同一 `deploy_id` 取最后一条：只要曾出现过这样一条成功记录，同一 `deploy_id` 之后的 unknown / abandoned 等记录（如成功落账后未决记录清理失败或进程中断，再执行 `--abandon`）不撤销使用（review delta-r1 F1）；从未出现成功记录时，failed / unknown 不使用。不写额外的消费记录。同时按环境维护上游已验证 commit 集合（smoke 记录中 `verified=true` 的 `ref`）与晋级候选（最近一条 `verified=true` smoke 记录的 `ref`），供 §12 与 §7.1 使用。
- 不是 JSON 对象或未通过上述校验的行整行跳过、计入 `corrupt_lines`，**不更新**该环境的任何槽位与历史；之前的有效记录仍是最近状态。未知的额外字段保留兼容、不导致跳过。读取不崩溃。0.16.3 及更早的读取方会把 `slug` 为 null、`result` 不为 `done` 或 `ref_source` 为 `ci-reported` 的记录计入 `corrupt_lines` 并跳过，0.16.4 及更早的读取方会把 `kind=approval` 的记录计入 `corrupt_lines` 并跳过；单机升级后即消失。
- 账本不存在视为空账本。`env list`、`env show`、`status`、`deploy` 与 smoke 的部署身份核对使用同一读取实现。
- 后续如需性能优化，引入可从账本完整重建的投影；投影不得成为事实来源。

## 6. smoke 环境证据

- **注入**：登记表存在且传入 `--env` 时，`openlogos smoke` 以环境变量 `OPENLOGOS_SMOKE_ENV=<解析后的 id>` 运行 `smoke.command`（含沙箱内执行）；登记表不存在时不注入。
- **声明**：smoke 结果行（`spec/test-results.md`「Smoke 结果与覆盖预检」）新增可选字段 `target_environment`，runner 写入其**实际验证的**环境 id。既有字段 `environment` 是 runner 自定义的执行环境标签，语义不变、不参与本判定。
- **新鲜度**：CLI 在运行 `smoke.command` 之前清空结果文件（既有行为），因此运行了命令时计入门禁的结果行都来自本次运行，`fresh_results=true`；未运行命令（未配置 `smoke.command` 且无默认 dispatcher）时 `fresh_results=false`，环境证据照常计算但不能使 `verified` 为 true（§5.3）。
- **判定**（只看计入门禁的结果行）：
  - 任一行 `target_environment` 存在且不等于本次环境 → `env_evidence=mismatch`；登记表存在时门禁 FAIL，原因 `SMOKE_ENV_EVIDENCE_MISMATCH`，写 `SMOKE_FAIL`；
  - 否则全部行都有 `target_environment` 且等于本次环境 → `env_evidence=declared`；
  - 否则（存在缺少该字段的行，或没有任何结果行）→ `env_evidence=missing`，门禁按既有判据计算（兼容旧 runner，可写 `SMOKE_PASS`），但 `verified=false`。
- 登记表不存在时，`env_evidence` 仍按上述规则以原始标签计算并写入账本，但 `mismatch` 不改变门禁结论（保持无登记表行为逐字不变）。

## 7. 视图投影

### 7.1 环境视图对象（EnvView）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` / `name` / `tier` | — | 来自登记表 |
| `current_ref` | 字符串 \| null | 最近一条 `result=done` 的 deploy 记录（按同一 `deploy_id` 取最后一条后）的 `ref`；该记录 `ref` 为 null（成功但版本未确认）时为 null，**不沿用更早的版本**；从未成功部署时为 null（来源变更 environment-deploy，决策 C06） |
| `previous_ref` | 字符串 \| null | 在 `current_ref` 所依据记录之前、最近一条 `result=done`、`ref` 非 null 且不等于 `current_ref` 的记录的 `ref`；在完整流式扫描中维护，不受 20 条历史窗口限制；回滚目标（§11.6） |
| `deploy_mode` | `script` \| `ci` \| `agent` \| null | 登记表中该环境 `deploy.mode`；未配置为 null |
| `deploy_in_progress` | 对象 \| null | 该环境存在未结束占用时为 `{deploy_id, mode, started_at, run_id, run_url, unresolved}`（§11.8），否则为 null |
| `last_deploy` | 对象 \| null | 最近一条任意结果的 deploy 记录：`deploy_id`、`slug`、`ref`、`ref_source`、`result`、`channel`、`mode`、`ref_requested`、`failure_reason`、`observed_head`、`observed_dirty`、`recorded_at`（旧形态记录缺少的扩展字段为 null） |
| `last_smoke` | 对象 \| null | 最近一次 smoke 记录：`deploy_id`、`slug`、`ref`、`result`、`env_evidence`、`fresh_results`、`deploy_env_confirmed`、`verified`、`observed_head`、`recorded_at` |
| `promote_from` | 字符串 \| null | 登记表中该环境的 `promote_from`；未配置为 null（来源变更 environment-promotion-approval） |
| `require_approval` | 布尔 | 登记表中该环境的 `require_approval`；未配置为 false |
| `open_approvals` | 数组 | 该环境未使用的审批（§5.4），每项 `{approval_id, ref, approver, note, recorded_at}`，按记录顺序 |
| `promotion` | 对象 \| null | 配置了 `promote_from` 时为 `{from, candidate_ref}`，`candidate_ref` 为上游环境最近一条 `verified=true` smoke 记录的 `ref`（没有为 null）；未配置 `promote_from` 时为 null |

`previous_ref`、`deploy_mode`、`deploy_in_progress` 三个字段与 `last_deploy` 的扩展子字段（`result`、`channel`、`mode`、`ref_requested`、`failure_reason`）**只在部署执行已启用（§1）时输出**；未启用时 EnvView 的字段集与取值与引入部署执行前逐字一致（此时账本只有 `deploy-done` 的成功记录，`current_ref` 的新口径与旧口径结果相同）。

`promote_from`、`require_approval`、`open_approvals`、`promotion` 四个字段**只在该环境的登记表条目写有 `promote_from` 或 `require_approval`（含 `require_approval: false`）时输出**（来源变更 environment-promotion-approval，决策 C08）；未写这两个字段的环境 EnvView 字段集与取值与引入前逐字一致。

### 7.2 命令

- `openlogos env list`：列出全部环境的 EnvView（另含 `aliases`）；登记表不存在时返回空数组，退出码 0。
- `openlogos env show <id|alias>`：单个环境的登记表配置、EnvView 字段与最近 20 条历史（新到旧）；登记表不存在报 `ENV_REGISTRY_NOT_FOUND`，解析不到报 `ENV_UNKNOWN`。
- `openlogos env check [<id|alias>]`：校验格式、id / alias 冲突、`deployment_gates` 引用、`secrets` 声明的变量名在当前进程环境中是否存在（只报名字与是否存在，不读取、不输出值）；加 `--probe` 时对指定范围内环境的 `health` 与 `version` 发 HTTP GET（超时 5 秒，不跟随到非 http(s) 协议）；不加 `--probe` 不发起任何网络请求。登记表不存在报 `ENV_REGISTRY_NOT_FOUND`。存在任一 error 时退出码 1。
- 三个命令都只读，不要求活跃提案，都支持 `--format json`（合同见 `spec/cli-json-output.md`）。

### 7.3 `status`

登记表存在时 `status --format json` 新增顶层 `environments`（EnvView 数组）与 `environment_ledger`（`path`、`corrupt_lines`）；登记表非法时 `environments` 为空数组并新增 `environment_registry_error`（`code`、`message`）；登记表不存在时不输出这三个字段。`status` 不发起任何网络请求。

## 8. 错误码与警告

| 代码 | 级别 | 触发 | 退出码 |
|---|---|---|---|
| `ENV_REGISTRY_NOT_FOUND` | error | `env show` / `env check` / `deploy` / `approve` 时登记表不存在 | 1 |
| `ENV_REGISTRY_INVALID` | error | 登记表存在但非法（§2.2） | 1 |
| `ENV_FIELD_INVALID` | error | `env check` 中单个字段非法（含 `deploy` 子字段，§11.2；`promote_from` / `require_approval`，§12.1） | 1 |
| `ENV_DUPLICATE_ID_OR_ALIAS` | error | id / alias 不区分大小写冲突 | 1 |
| `ENV_GATE_REFERENCE_UNKNOWN` | error | `deployment_gates.<module>.environments` 引用未登记环境 | 1 |
| `ENV_SECRET_MISSING` | error | `secrets` 声明的变量名在当前进程环境中不存在 | 1 |
| `ENV_PROBE_FAILED` | error | `--probe` 时请求失败、超时或非 2xx | 1 |
| `ENV_UNKNOWN_FIELD` | warning | 登记表含未知字段 | 不影响 |
| `ENV_UNKNOWN` | error | `--env` 或 `env show` 参数解析不到 | 1 |
| `ENV_REQUIRED` | error | 登记表存在时 `deploy-done` / `smoke` / `deploy` / `approve` 未传 `--env` | 1 |
| `ENV_REF_UNRESOLVED` | error | `deploy-done --ref` / `deploy --ref` / `approve --ref` 无法解析为 commit | 1 |
| `SMOKE_ENV_MISMATCH` | error | 登记表存在时 `DEPLOY_DONE.environment` 与本次 `--env` 解析结果不一致（无登记表时不产生） | 1 |
| `SMOKE_DEPLOY_MARKER_INVALID` | error | `DEPLOY_DONE` 非空损坏或存在但无法读取；JSON 下 `error.details.problems` 为问题字段名数组，无法读取时为 `["unreadable"]` 并带 `error.details.reason`（`spec/cli-json-output.md`「`openlogos smoke`」） | 1 |
| `SMOKE_DEPLOY_SUPERSEDED` | error | 部署执行已启用（§1）、有活跃提案时 `DEPLOY_DONE.deploy_id` 不是账本中该环境最近一条 deploy 记录（§4.2「部署身份核对」）；`error.details` 给出两者的 `deploy_id`、`ref` | 1 |
| `SMOKE_LEDGER_WRITE_FAILED` | error | smoke 追加账本失败（含账本锁等待超时），或账本已写、随后标记阶段失败；按 §5.1 恢复，`error.details` 报告阶段、原因与恢复结果 | 1 |
| `DEPLOY_DONE_WRITE_FAILED` | error | deploy-done 写入阶段失败（快照读取、勾选 `[deploy]`、清理旧 smoke marker、追加账本或最后写 `DEPLOY_DONE`）；按 §5.1 恢复，`message` 说明恢复结果 | 1 |
| `SMOKE_ENV_EVIDENCE_MISMATCH` | gate reason | 结果行声明的 `target_environment` 与本次环境不一致（登记表存在时） | 1（门禁 FAIL） |
| `DEPLOY_NOT_CONFIGURED` | error | 目标环境未配置 `deploy`（§11.2） | 1 |
| `DEPLOY_ARGS_CONFLICT` | error | 参数互斥或组合非法（如 `--ref` 与 `--rollback` 同时给出，`--complete` / `--abandon` / `--reconcile` 与部署参数混用；`--force-promote` 理由为空、目标环境未配置 `promote_from` 或与 `--rollback` 同用，§12.3） | 1 |
| `DEPLOY_REF_REQUIRED` | error | 版本通道既未传 `--ref` 也未传 `--rollback` | 1 |
| `DEPLOY_ROLLBACK_TARGET_MISSING` | error | `--rollback` 时该环境没有 `previous_ref` | 1 |
| `DEPLOY_GIT_REQUIRED` | error | 项目不是 git 仓库 | 1 |
| `DEPLOY_WORKTREE_MISMATCH` | error | `workdir: in-place` 时 HEAD 不等于请求 commit 或工作区有未提交改动 | 1 |
| `DEPLOY_SCRIPT_MISSING` | error | 部署脚本（或 CI 适配脚本）在请求 commit 的树中不存在 | 1 |
| `DEPLOY_SCRIPT_NOT_EXECUTABLE` | error | 部署脚本在请求 commit 的树中不带可执行位 | 1 |
| `DEPLOY_CI_UNAVAILABLE` | error | ci 方式下 `gh` 不可用、未登录或工作流不存在 | 1 |
| `DEPLOY_CI_REF_NOT_DISPATCHABLE` | error | github-actions 调度 ref 在远端不可解析，或未配置 `workflow_ref` 时远端该 tag / 分支解析出的 commit 不等于请求 commit（只给了 commit 时同样拒绝） | 1 |
| `DEPLOY_SECRETS_MISSING` | error | 该环境 `secrets` 声明的变量名在当前进程环境中不存在（只列名字） | 1 |
| `DEPLOY_IN_PROGRESS` | error | 该环境已有未结束的部署占用（§11.8）；`error.details` 给出持有者信息 | 1 |
| `DEPLOY_PENDING_NOT_FOUND` | error | `--complete` / `--abandon` 的 `deploy_id` 不是该环境当前的未决记录；`--reconcile` 时该环境没有未决记录 | 1 |
| `DEPLOY_FAILED` | error | 部署已执行但失败、超时或 CI 结论非 success；账本已追加 `result=failed` 记录 | 1 |
| `DEPLOY_RESULT_UNKNOWN` | error | 已触发但结果未知（CI 观察超时、缺运行身份）；账本已追加 `result=unknown` 记录，环境保持占用 | 1 |
| `DEPLOY_RECORD_FAILED` | error | 部署已成功但账本或提案标记写入失败；`error.details.deployed=true` 并给出 `deploy_id`、`ref` 与未能写入的记录原文 | 1 |
| `DEPLOY_REF_UNCONFIRMED` | warning | 部署成功但实际部署版本未确认（§11.4），`ref` 记为 null | 不影响 |
| `DEPLOY_WORKTREE_CLEANUP_FAILED` | warning | 隔离工作树移除失败 | 不影响 |
| `DEPLOY_PROMOTION_UNVERIFIED` | error | 目标环境配置了 `promote_from`，上游环境账本中没有请求 commit 的 `verified=true` smoke 记录（§12.3）；`error.details` 含 `environment`、`promote_from`、`requested`、`upstream_current_ref`、`upstream_candidate_ref` | 1 |
| `DEPLOY_APPROVAL_REQUIRED` | error | 目标环境 `require_approval: true`，没有绑定该环境与请求 commit 的未使用审批（含取得环境锁后复核时发现审批已被使用，§12.4、§12.5）；`error.details` 含 `environment`、`requested`、`approve_command` | 1 |
| `DEPLOY_DONE_GATED_ENV` | error | `deploy-done --env` 的目标环境为受门环境（§12.6），提示改用 `openlogos deploy` | 1 |
| `APPROVAL_NOT_REQUIRED` | error | `approve` 的目标环境未配置 `require_approval: true`（§12.2） | 1 |
| `APPROVAL_REF_REQUIRED` | error | `approve` 未传 `--ref`（§12.2） | 1 |
| `APPROVAL_WRITE_FAILED` | error | `approve` 追加账本失败（含账本锁等待超时）；账本保持调用前字节（§12.2） | 1 |

提案通道的前置拒绝沿用 `deploy-done` 的既有错误码（`NO_ACTIVE_CHANGE`、`CHANGE_NOT_FOUND`、`VERIFY_NOT_PASSED`、`DEPLOYMENT_DECISION_CONFLICT`、`DEPLOYMENT_NOT_REQUIRED`、`DEPLOY_TASKS_MISSING`）；agent 方式提案通道的 `--complete --result done` 另沿用 `DEPLOYMENT_REPORT_MISSING`，见 `spec/cli-json-output.md`「`openlogos deploy-done --format json`」。所有面向人的文案走 i18n，中英文都要提供。

## 9. guard

- `logos/environments.yaml` 加入 `guard.exempt` 内置默认（environment-registry 决策 C07，见 `spec/pretooluse-guard.md`「guard.exempt 与内置默认」）：它是运维配置而非业务逻辑，修改不需立案。已显式配置 `guard.exempt` 的项目不自动获得该默认值，需由用户经保护范围命令手动添加。
- 账本、部署日志、环境锁、未决记录与隔离工作树都位于 `logos/.openlogos-runtime/`，对 AI 编辑工具恒阻断，只能由 CLI 写入。
- **部署只执行受保护的内容**（来源变更 environment-deploy，决策 D13）：登记表因 C07 豁免而可不经立案修改，因此 `deploy` 只能引用仓库内被 git 跟踪的脚本（默认放在 `deploy/` 下）与 `.github/workflows` 下的工作流；这些文件按「被 git 跟踪即受保护」的既有判定受 guard 保护，改变部署实际执行的内容必须修改它们、从而必须立案。CLI 以参数数组直接执行脚本、不经 shell，不新增保护规则。
- **门禁策略来源受保护**（来源变更 environment-promotion-approval，决策 C11，见 `spec/pretooluse-guard.md`「已配置门禁的环境登记表」）：只要 `logos/environments.yaml` 中出现 `promote_from` 或 `require_approval` 字段名，或出现反斜杠字符（guard 按文本保守识别，无法可靠证明无门禁时按已配置处理；§12.1 要求门禁字段以普通键名书写，CLI 认定的门禁因此在原文中必有字段名，review delta-r1 F2），该文件即为门禁策略来源——不适用内置默认豁免或 `guard.exempt`，不以活跃提案作为放行理由；AI 工具对它的直接修改（Edit / Write / MultiEdit、可识别写目标的 shell 写入）与删除 / 移动按宿主原生审批处理（交互模式由用户批准，其他模式阻断）。既不出现这两个字段名、也不含反斜杠字符的登记表保持上述豁免。
- **审批与晋级越过只能由人产生**（来源变更 environment-promotion-approval，决策 C05，D14）：`openlogos approve` 与带 `--force-promote` 的 `openlogos deploy` 属 `spec/pretooluse-guard.md`「保护范围变更的宿主原生审批（C14）」的受限命令；审批写入运行态目录下的账本，AI 编辑工具不能直接伪造。

## 10. 追溯

- 需求：`core-01-requirements.md`「S41: 环境登记与查询」「S42: 按环境执行部署与回滚」「S43: 环境晋级与部署审批」、S21、S19、S11 验收条件。
- 功能规格：§2.93、§2.94、§2.95、§2.11。
- 架构：「五十三、环境登记表与部署账本」「五十四、环境部署执行器」「五十五、环境晋级与审批门」。
- 场景：`core-S41-environment-registry.md`、`core-S42-environment-deploy.md`、`core-S43-environment-promotion-approval.md`、`core-S21-deploy-done-marker.md`、`core-S19-smoke-gate.md`、`core-S11-status-progress.md`。
- 决策：`core-D13-deploy-runs-only-protected-scripts.md`、`core-D14-deploy-approval-human-only.md`。
- 测试：`core-S41-test-cases.md`、`core-S42-test-cases.md`、`core-S43-test-cases.md`、`core-S09-test-cases.md`、`core-S21-test-cases.md`、`core-S19-test-cases.md`、`core-S11-test-cases.md` 中 environment-registry、environment-deploy 与 environment-promotion-approval 新增用例。

## 11. 部署执行（`openlogos deploy`）

> 来源变更：environment-deploy（决策 C01～C13、C15，D13）。功能规格 §2.94、架构「五十四、环境部署执行器」、场景 S42 与 `spec/cli-json-output.md`「`openlogos deploy --format json`」引用本节，不另立口径。

### 11.1 命令

```
openlogos deploy --env <id|alias> [--ref <revision>] [--rollback] [--channel proposal|version] [--force-promote "<理由>"] [--dry-run] [--format json]
openlogos deploy --env <id|alias> --complete <deploy_id> --result done|failed [--format json]   # agent 方式
openlogos deploy --env <id|alias> --abandon <deploy_id> [--format json]                         # agent / ci 未决记录
openlogos deploy --env <id|alias> --reconcile [--format json]                                   # ci 结果未知后补记
```

- **先分流，再按操作检查**（review delta-r1 F1）：参数解析后先判定操作类型——带 `--complete`、`--abandon` 或 `--reconcile` 的是**未决记录操作**，其余是**部署操作**（含 `--dry-run`）。两类操作的参数互不混用（`DEPLOY_ARGS_CONFLICT`）。
- **部署操作的前置**（任一失败即零执行、零写入）：项目已初始化；登记表存在（`ENV_REGISTRY_NOT_FOUND`）且合法（`ENV_REGISTRY_INVALID`）；`--env` 必填（`ENV_REQUIRED`）并按 §3 解析（`ENV_UNKNOWN`，不做单环境默认推断）；该环境配置了 `deploy`（`DEPLOY_NOT_CONFIGURED`）；项目是 git 仓库（`DEPLOY_GIT_REQUIRED`）；该环境没有未结束的占用（`DEPLOY_IN_PROGRESS`，§11.8）；按 §11.5 判定通道并解析请求版本；晋级检查与审批检查（来源变更 environment-promotion-approval，§12.3、§12.4；取得环境锁后另行复核，§12.5）；`secrets` 声明的变量名全部存在于进程环境（`DEPLOY_SECRETS_MISSING`，只列名字）；按执行方式检查脚本与 CI 可用性（§11.3）。
- **未决记录操作的前置**：项目已初始化；登记表存在且合法；`--env` 必填并可解析；该环境存在未决记录（`logos/.openlogos-runtime/deploy-pending/<env>.json`），`--complete` / `--abandon` 给出的 `deploy_id` 等于该记录的 `deploy_id`，否则 `DEPLOY_PENDING_NOT_FOUND`。**不做**「环境未被占用」检查（这些操作正是处理该占用）、不判定通道、不要求也不接受新的 `--ref` / `--rollback`、不检查脚本与部署密钥、不触发任何新的部署；通道、请求提交、provider、运行身份与 slug 一律取自未决记录。各操作的附加条件：
  - `--complete --result done`：记录方式为 agent；记录为提案通道时要求其 slug 仍是活跃提案（否则沿用 `deploy-done` 前置错误码 `NO_ACTIVE_CHANGE` / `CHANGE_NOT_FOUND`）且部署报告已存在（`DEPLOYMENT_REPORT_MISSING`），随后经 `deploy-done` 写入函数落标；`--result failed` 只追加失败记录。
  - `--reconcile`：记录方式为 ci；有 `run_id` 时 github-actions 要求 `gh` 可用且已登录（`DEPLOY_CI_UNAVAILABLE`），provider: script 要求 `status_script` 存在；没有 `run_id` 时只报告无法查询、保持占用。
  - `--abandon`：任何方式的未决记录都可放弃，不访问远程。
  - 未决记录操作在没有活跃提案时同样可用；提案通道的记录在 `--reconcile` 补记成功终态时，若其 slug 仍是活跃提案则经 `deploy-done` 写入函数落标，否则只追加账本记录。
- **`--dry-run`**：完成全部前置与可执行性检查，输出将要执行的内容（通道、请求 commit、脚本或工作流、参数展开结果、调度 ref），不建工作树、不执行、不写任何文件（含账本、日志、锁、报告）。晋级与审批检查同样执行，通过时 plan 给出将使用的 `approval_id` 与晋级依据；dry-run 不取环境锁、不做锁内复核，也不使用审批。

### 11.2 登记表 `deploy` 字段

| 字段 | 必填 | 适用方式 | 约束 |
|---|---|---|---|
| `mode` | 是 | 全部 | `script` \| `ci` \| `agent` |
| `script` | script 方式必填 | script | 仓库相对路径（不得为绝对路径、不得含 `..` 段、不得越出仓库）；须在请求 commit 的树中存在且带可执行位 |
| `args` | 否 | script | 字符串数组；支持占位符 `{env}`、`{ref}`（请求 commit）、`{ref_short}`（前 12 位）、`{deploy_id}`；未知占位符为字段非法 |
| `workdir` | 否 | script | `worktree`（默认）\| `in-place` |
| `timeout_sec` | 否 | script / ci | 正整数，默认 1800，上限 7200 |
| `provider` | ci 方式必填 | ci | `github-actions` \| `script` |
| `workflow` | github-actions 必填 | ci | `.github/workflows` 下的文件名 |
| `workflow_ref` | 否 | ci（github-actions） | 工作流运行所在的分支或 tag；缺省见 §11.4 |
| `inputs` | 否 | ci（github-actions） | 字符串到字符串的映射，值支持上述占位符 |
| `poll_interval_sec` | 否 | ci | 正整数，默认 10 |
| `trigger_script` / `status_script` | provider: script 必填 | ci | 同 `script` 的路径约束 |
| `plan_section` | agent 方式必填 | agent | 部署方案中对应章节的标题 |

- 不得出现命令字符串类字段（`run`、`command`、`shell` 等），按 `ENV_FIELD_INVALID` 拒绝（D13）；其他未知子字段只警告。
- 校验同时由 `env check` 与 `deploy` 执行，结论一致。

### 11.3 执行方式

所有方式都向子进程注入 `OPENLOGOS_DEPLOY_ENV`、`OPENLOGOS_DEPLOY_REF`（请求 commit）、`OPENLOGOS_DEPLOY_ID`、`OPENLOGOS_DEPLOY_CHANNEL`，子进程继承进程环境（含密钥变量）。

- **script**：
  - `workdir: worktree`（默认）：以 `git worktree add --detach` 在 `logos/.openlogos-runtime/deploy-work/<deploy_id>` 检出请求 commit，脚本路径在该工作树中解析并以该目录为工作目录执行，结束后移除工作树（移除失败只记 `DEPLOY_WORKTREE_CLEANUP_FAILED` 警告）。工作树中没有未跟踪文件（如依赖与构建产物），脚本需自行安装与构建。
  - `workdir: in-place`：仅当 HEAD 等于请求 commit 且工作区无未提交改动时允许，否则 `DEPLOY_WORKTREE_MISMATCH`。
  - 以参数数组直接执行、不经 shell；超过 `timeout_sec` 时终止整个进程树，记 `failure_reason=timeout`；非零退出记 `exit-code`。
- **ci，github-actions**：dry-run 与执行前检查 `gh` 可用、`gh auth status` 已登录、工作流存在、调度 ref 在远端可解析（`DEPLOY_CI_UNAVAILABLE`、`DEPLOY_CI_REF_NOT_DISPATCHABLE`）。以 `gh api` 调用 workflow dispatch 接口并带 `return_run_details=true`，从响应取得 `run_id` 与运行 URL；**不做触发前快照与差集扫描**。响应缺少运行身份时记 `result=unknown`、`failure_reason=ci-run-id-missing`，环境保持未解决占用（§11.8）。之后以确定的 `run_id` 按 `poll_interval_sec` 轮询 `gh run view`，直到运行完成或 `timeout_sec` 到期：`conclusion=success` 记 `done`，其余结论记 `failed`（`failure_reason=ci-failure`），观察超时记 `unknown`（`ci-observe-timeout`）。
- **ci，provider: script**（GitLab 等其他 CI）：`trigger_script` 最后一行输出 JSON `{"run_id": "…", "url": "…"}`（缺 `run_id` 按 `ci-run-id-missing` 处理）；`status_script` 以 `run_id` 为参数输出 JSON `{"status": "queued|in_progress|completed", "conclusion": "…", "deployed_ref": "<可选 40 位 commit>"}`，结论映射与 github-actions 相同。
- **agent**：完成 §11.1 前置后，在 `logos/.openlogos-runtime/deploy-pending/<env>.json` 登记未决记录（`deploy_id`、环境、请求 commit、通道、slug、`plan_section`），返回 `status: awaiting-agent` 与部署方案位置，退出码 0，不写账本。AI 按方案执行后以 `--complete <deploy_id> --result done|failed` 写入 `mode=agent` 的记录（`ref` 为请求 commit、`ref_source=explicit`；`failed` 时 `ref` 为 null、`failure_reason=agent-reported`）并删除未决记录；放弃用 `--abandon <deploy_id>`。

### 11.4 部署版本的证据

账本区分请求版本与已确认部署版本：`ref_requested` 恒为请求 commit；`ref` 只写有证据的实际部署版本，否则为 null、`ref_source=unknown`，不得仅凭执行成功把请求版本写成已部署版本（决策 C04）。

- **script**：在请求 commit 的隔离工作树中执行（in-place 时 HEAD 等于请求 commit 且工作区干净），成功即 `ref=ref_requested`、`ref_source=explicit`。
- **ci（两种 provider 共用同一回报合同）**：运行的 `headSha`、`workflow_ref` 与 `inputs` 中传入的版本都**不构成证据**——`headSha` 只是 dispatch 所在分支 / tag 的提交，工作流中的 checkout 可以另行检出其他 ref。证据只来自该次运行回报的实际部署提交：
  - github-actions：运行上传固定名称为 `openlogos-deploy-result` 的 artifact，其中 `result.json` 为 `{"deployed_ref": "<40 位 commit>"}`，值为实际被构建并部署的提交（deployment-designer 要求取自部署所用 `actions/checkout` 步骤的 `commit` 输出）；运行以 success 结束后，CLI 以 `gh run download <run_id> -n openlogos-deploy-result` 读取；
  - provider: script：`status_script` 在 `completed` 时输出的 `deployed_ref`。
  - 回报值为 40 位 commit 且等于 `ref_requested` 时 `ref=ref_requested`、`ref_source=ci-reported`；回报缺失、内容不合法或不相等时 `ref` 为 null、`ref_source=unknown`，回报原值存入 `ci_reported_ref`，并输出 `DEPLOY_REF_UNCONFIRMED` 警告列出请求版本与回报值。
  - github-actions 的调度 ref：配置了 `workflow_ref` 时在该分支 / tag 上调度；缺省时以请求版本本身的 tag 或分支名调度，并要求远端该 tag / 分支解析出的 commit 等于请求 commit，否则 `DEPLOY_CI_REF_NOT_DISPATCHABLE`（只给了 commit 且未配置 `workflow_ref` 时同样拒绝）。
- **agent**：由执行者声明，与 `deploy-done --ref` 同一口径。

### 11.5 通道

- **默认通道**：存在活跃提案且其 `proposal_step` 为 `ready-to-deploy` 时为提案通道，否则为版本通道；`--channel` 可显式指定，指定提案通道而条件不满足时按 `deploy-done` 的既有前置错误码拒绝。
- **版本**：`--ref` 一律经 `git rev-parse <revision>^{commit}` 解析为完整 commit（失败 `ENV_REF_UNRESOLVED`）。提案通道未传 `--ref` 时取 HEAD；版本通道必须传 `--ref`（`DEPLOY_REF_REQUIRED`）或 `--rollback`，两者互斥（`DEPLOY_ARGS_CONFLICT`）。
- **提案通道**：把「可以执行部署」与「可以记录完成」两类检查拆开。执行前只做可执行性检查——活跃提案、verify 通过、部署决策无冲突、存在 `[deploy]` 任务、部署报告的输出位置可写；**不要求部署报告已存在**。script / ci 方式执行结束后（成功或失败）由 CLI 按本次实际结果向 `logos/resources/verify/deployment-report.md` 追加一节本次部署报告（时间、目标环境、通道与执行方式、`deploy_id`、`ref_requested` 与已确认的 `ref`、执行的脚本或工作流与运行 URL、耗时、结果与 `failure_reason`、`log_path`、回滚点 `previous_ref`），不覆盖既有内容；agent 方式仍由 AI 写报告，`--complete --result done` 时才要求报告存在。部署成功且报告写出后，调用 `deploy-done` 的既有写入函数（快照、勾选 `[deploy]`、清理旧 smoke 标记、追加账本、最后写 `DEPLOY_DONE`、失败按快照恢复，§5.1），写入的 `DEPLOY_DONE` 与账本记录使用同一 `deploy_id`，账本只写一条。部署失败只追加 `result=failed` 记录，不勾选、不写 `DEPLOY_DONE`，以 `DEPLOY_FAILED` 结束。
- **版本通道**：不依附提案，`slug` 为 null；不读写任何提案文件与部署报告，结果只进账本与部署日志。
- 部署成功但记录失败（账本或提案标记写入失败）时以 `DEPLOY_RECORD_FAILED` 结束，`details.deployed=true` 并给出 `deploy_id`、`ref` 与未能写入的记录原文，提示重新执行 `deploy`（或在提案通道执行 `deploy-done --env --ref`）补记。

### 11.6 回滚

`openlogos deploy --env <id> --rollback`：目标版本取该环境的 `previous_ref`（§7.1；无则 `DEPLOY_ROLLBACK_TARGET_MISSING`，零执行），恒走版本通道，执行方式与普通部署相同，账本记 `rollback: true` 与 `rollback_from`（回滚前的 `current_ref`）。回滚到的版本执行它自己那一版的脚本（§11.3）。回滚到更早的指定版本直接用 `--ref`。不新增独立机制、不保存部署快照。

### 11.7 日志与密钥遮盖

- 完整输出写入 `logos/.openlogos-runtime/deploy-logs/<deploy_id>.log`；文本模式实时输出到终端，JSON 模式只带末尾 80 行或 8 KiB（取先到者）并给出 `log_path`。不做日志清理。
- 密钥只从进程环境提供，CLI 不读取 `.env.<env>.local` 等本地密钥文件。捕获的输出、部署日志与 JSON 输出尾部中，凡出现已声明密钥（`secrets`）的值一律替换为 `***`；值长度不足 4 个字符的不做替换。脚本自行打印的其他敏感内容无法识别。

### 11.8 环境占用

同一环境同一时间只允许一次部署，冲突时 `DEPLOY_IN_PROGRESS`（`details` 给出持有者 `deploy_id`、方式、开始时间与运行身份）。

- **本地锁**：`logos/.openlogos-runtime/deploy-locks/<env>.lock`（记录 `pid`、`deploy_id`、开始时间）。script 方式全程、ci 方式在发出触发请求之前只依靠本地锁；持有者进程已不存在时视为遗留，可回收。
- **未决记录**：`logos/.openlogos-runtime/deploy-pending/<env>.json`。本地进程只能证明本机状态，不能证明远程 CI 已结束，因此 ci 方式在**发出触发请求之前**先写入未决记录（`deploy_id`、环境、请求 commit、provider、`run_id` 待填），取得 `run_id` 后补写；此后环境占用以该记录为准，**不随本地进程退出而解除**。观察到终态并写完账本后删除记录；观察超时或拿不到 `run_id` 时账本记 `unknown`，记录保留，环境保持占用。agent 方式的未决记录同样占用环境。
- **恢复**：`--reconcile` 在有 `run_id` 时按 `run_id` 查询远程状态——已完成则为同一 `deploy_id` 追加终态记录（`reconciled: true`，结果映射与版本证据同 §11.3、§11.4）并删除未决记录；仍在运行则保持占用并报告。没有 `run_id`，或用户已确认远程不会再运行时，用 `--abandon <deploy_id>` 显式解除：账本追加 `result=unknown`、`failure_reason=abandoned` 的记录，删除未决记录。

## 12. 晋级与审批

> 来源变更：environment-promotion-approval（决策 C01～C11，D14）。功能规格 §2.95、架构「五十五、环境晋级与审批门」、场景 S43 与 `spec/cli-json-output.md`「`openlogos approve --format json`」引用本节，不另立口径。

### 12.1 字段与受门环境

- `promote_from`（字符串）与 `require_approval`（布尔）只在配置了 `deploy` 的环境上合法；`promote_from` 只接受登记表中另一个环境的 `id`（不接受 alias），不得指向自身，沿各环境的 `promote_from` 前进不得回到出发环境。违反时 `env check` 报 `ENV_FIELD_INVALID`（成环时环上每个环境各一条），登记表按非法处理（§2.2）。
- **门禁字段必须以普通键名书写**（review delta-r1 F2）：解析结果中某环境含 `promote_from` 或 `require_approval`，而登记表原文中不出现该字段名的字面量（如以 `\u`、`\x` 转义或双引号续行写出的键，`"require_\u0061pproval": true` 即解析为 `require_approval`）时，按 `ENV_FIELD_INVALID` 拒绝，登记表按非法处理。单引号、双引号但不含转义的键原文含字面量，照常合法。这保证 CLI 认定的门禁在原文中必有可被 guard 识别的字段名（§9）。
- **受门环境**：配置了 `promote_from`，或 `require_approval` 为 `true` 的环境。只写了 `require_approval: false` 且未配置 `promote_from` 的环境不是受门环境。
- 未写这两个字段的项目，所有命令的输出、写入与行为与引入本节前逐字一致。

### 12.2 `openlogos approve`

```
openlogos approve --env <id|alias> --ref <revision> [--note <文字>] [--format json]
```

- 前置（任一失败即零写入，退出码 1）：项目已初始化；登记表存在（`ENV_REGISTRY_NOT_FOUND`）且合法（`ENV_REGISTRY_INVALID`）；`--env` 必填（`ENV_REQUIRED`）并按 §3 解析（`ENV_UNKNOWN`）；目标环境 `require_approval` 为 `true`（`APPROVAL_NOT_REQUIRED`）；`--ref` 必填（`APPROVAL_REF_REQUIRED`），经 `git rev-parse <revision>^{commit}` 解析为 40 位 commit（`ENV_REF_UNRESOLVED`）。
- 在账本锁临界区内重新扫描账本：该环境已有 `ref` 等于该 commit 的未使用审批时，返回其 `approval_id`（`created=false`）、不写新行；否则追加一行 approval 记录（§5.2），返回新 `approval_id`（`created=true`）。并发执行的多个 `approve` 只写出一条。
- 不提供撤销与过期：审批绑定精确 commit，成功部署一次即使用（§12.4）。
- `approve` 是 guard 受限命令（§12.7）：AI 调用时须经宿主原生审批，无人值守时阻断；用户在终端执行或经 RunLogos 界面执行。

### 12.3 晋级检查

- 适用：目标环境配置了 `promote_from`，且本次不是 `--rollback`、未给 `--force-promote`。
- 判据：账本中上游环境（`promote_from` 所指）存在一条 `kind=smoke`、`verified=true`（§5.3）且 `ref` 等于请求 commit 的记录。不要求该 commit 是上游当前版本；只校验直接上游，不做多级传递。
- 不满足：`DEPLOY_PROMOTION_UNVERIFIED`，零执行、零写入；`details.upstream_current_ref` 为上游 EnvView 的 `current_ref`，`details.upstream_candidate_ref` 为上游最近一条 `verified=true` smoke 记录的 `ref`（没有为 null）。
- `--force-promote "<理由>"`：理由非空、目标环境配置了 `promote_from`、不与 `--rollback` 同用，否则 `DEPLOY_ARGS_CONFLICT`；越过时跳过晋级检查，本次 deploy 记录 `promotion_override_reason` 为该理由、`promoted_from` 为 null。带 `--force-promote` 的 `deploy` 是 guard 受限命令（§12.7）。
- `--rollback` 不做晋级检查（回滚目标是本环境曾成功部署过的版本），但仍做审批检查。

### 12.4 审批检查与使用

- 适用：目标环境 `require_approval` 为 `true`（含 `--rollback`）。
- 判据：账本中存在该环境、`ref` 等于请求 commit 的未使用审批（§5.4）；有多份时取最早的一份。
- 不满足：`DEPLOY_APPROVAL_REQUIRED`，零执行、零写入；`details.approve_command` 为可直接执行的 `openlogos approve --env <id> --ref <40 位 commit>`。
- 使用：本次 deploy 记录写入所用审批的 `approval_id`；账本中出现使用该审批的 `result=done` 记录（§5.4）时审批视为已使用，再次部署同一 commit 需要重新审批。使用单向、不可撤销：同一 `deploy_id` 之后的 `--abandon`（例如成功落账后未决记录清理失败或进程中断，再处理遗留占用）或重复补记都不让审批重新有效（review delta-r1 F1）；从未成功时 failed / unknown 不使用，ci 结果未知后经 `--reconcile` 补记 `done` 时才使用。对其他 commit 的审批不能放行请求 commit。

### 12.5 检查位置与并发

- 位置：§11.1 部署操作前置中，版本解析之后、密钥与脚本 / CI 检查之前，依次做晋级检查与审批检查；任一失败零执行、零写入。
- **锁外检查只用于提前报错**：取得环境锁（§11.8）之后、script 执行 / ci 触发 / 登记未决记录（agent、ci）之前，CLI 重读账本，重新执行 §12.3、§12.4：原审批已被其他部署使用时按当时账本改选该 commit 的另一份未使用审批，没有则释放环境锁并以 `DEPLOY_APPROVAL_REQUIRED` 零执行结束；晋级检查同理。这一最终授权与随后的执行、成功记录或未决占用处在同一环境互斥边界内；部署期间不持有账本锁。
- `--dry-run` 执行锁外检查，不取环境锁、不做锁内复核、不使用审批。
- agent 方式：锁内复核通过后把 `approval_id`、`promoted_from`、`promotion_override_reason` 写入未决记录；`--complete --result done` 写出的记录携带这些字段并使用审批。`--complete` / `--abandon` / `--reconcile` 不重新检查晋级与审批。

### 12.6 `deploy-done` 对受门环境

- `deploy-done --env <label>` 的目标环境为受门环境时以 `DEPLOY_DONE_GATED_ENV` 拒绝：判定在登记表加载与 `--env` 解析之后、`--ref` 解析与任何写入之前，零写入，提示改用 `openlogos deploy`。未传 `--env`、无登记表或目标环境不是受门环境时行为不变。提案通道下 `openlogos deploy` 成功时调用的 deploy-done 写入函数不经过本命令前置，不受影响。

### 12.7 「人批过」的证明与 `--auto`

- 审批、晋级越过与门禁配置的修改只能由人经宿主原生审批产生（D14）：`openlogos approve` 与带 `--force-promote` 的 `openlogos deploy` 属 guard 受限命令；已配置门禁的登记表的直接修改与删除同样须经宿主原生审批（§9）。不使用任何本地凭据文件证明「人批过」；`approver` 只作展示。
- `--auto` 的 standing 授权不覆盖上述动作：目标环境要求审批而该版本未获审批，或晋级检查未通过，是任何模式都不自动放行的硬停点（`spec/change-management.md`）。部署停在「等待审批」或「晋级未满足」；审批写入后宿主重新驱动即可继续，不新增恢复机制。宿主 driver 不得代替用户批准宿主审批。

### 12.8 兼容性

- 账本只新增 `approval` 记录类型与 deploy 记录的三个可选字段，旧记录原样有效；0.16.4 及更早的读取方把审批记录计为坏行并跳过。
- 已写了这两个字段的项目此前只得 `ENV_UNKNOWN_FIELD` 警告，升级后开始生效（§2.2 预留时的约定语义）。
