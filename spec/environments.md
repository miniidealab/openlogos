# 环境登记表与部署账本规范

> 来源变更：environment-registry（决策 C01～C08）。本文件是环境登记表、`DEPLOY_DONE` 内容格式、本机部署账本、smoke 环境证据与环境视图的权威定义；功能规格 §2.93、架构「五十三、环境登记表与部署账本」、场景 S41 / S21 / S19 / S11 与 `spec/cli-json-output.md` 引用本文件，不另立口径。

## 1. 适用范围

- 环境管理是 **opt-in**：项目根下存在 `logos/environments.yaml` 即视为启用；文件不存在表示未启用，`deploy-done`、`smoke`、`status` 的输出与退出码与未引入本规范前逐字一致（唯一例外见 §4.2「非空损坏」）。
- 本规范只覆盖**单机**：环境定义进仓库（可共享），部署状态与历史只存在本机运行态目录，不进 git、不做同步（决策 C02）。
- 本规范不执行部署：`openlogos deploy` 执行器、版本通道与回滚归后续提案 B；晋级顺序与审批门禁归提案 C。

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

- **未知字段**（顶层或环境项内）只产生 warning `ENV_UNKNOWN_FIELD`，不报错，为提案 B（`deploy`）与 C（`promote_from`、`require_approval`）预留。
- **校验失败**（YAML 无法解析、顶层不是映射、`schema_version` 不为 1、必填字段缺失、字段类型或取值非法、id / alias 冲突）统称 `ENV_REGISTRY_INVALID`，并在 `env check` 中逐条点名（`ENV_FIELD_INVALID`、`ENV_DUPLICATE_ID_OR_ALIAS`）。登记表存在但非法时 **fail-closed**：`deploy-done` 与 `smoke` 拒绝执行（退出码 1，不写 marker、不写账本），不回落为「未启用」；`status` 不崩溃，输出 `environment_registry_error`（见 §7.3）。

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

**活跃提案是 smoke 的可选上下文**：既有 `openlogos smoke` 允许在没有活跃提案（无 `logos/.openlogos-guard`）时运行，此时不做提案前置、不读取 `DEPLOY_DONE`、不写提案 marker；本规范不改变这一点——无活跃提案时跳过本节分类，`deploy_env_confirmed=false`，且不写账本（§5.1）、不产生已验证事实。以下分类只在存在活跃提案、既有前置（§2.67.1 系列：smoke 需求、部署决策、`DEPLOY_DONE` 存在、`[deploy]` 全勾）通过后执行，按内容分三类：

| 类别 | 判定 | 处理 |
|---|---|---|
| 旧空格式 | 文件 0 字节，或只含空白字符（仅旧版 CLI 写出） | 环境未知，放行；`deploy_env_confirmed=false`；`deploy_id`、`ref` 视为 `null` |
| 合法新格式 | 一个 JSON 对象，且 §4.1 五个字段齐全、类型与取值合法 | 一致（`environment` 非空且等于本次环境）→ `deploy_env_confirmed=true`；不一致 → **登记表存在时**拒绝 `SMOKE_ENV_MISMATCH`，**登记表不存在时**不拒绝、门禁与退出码不变，仅 `deploy_env_confirmed=false`；`environment` 为 `null`（或本次未传 `--env`）→ 放行且 `deploy_env_confirmed=false` |
| 非空损坏 | 非空且不属上两类：不是 JSON、不是对象、缺字段、字段类型或取值非法 | 拒绝 `SMOKE_DEPLOY_MARKER_INVALID`（退出码 1，消息点名问题字段），**无论有无登记表** |

- 拒绝（`SMOKE_ENV_MISMATCH`、`SMOKE_DEPLOY_MARKER_INVALID`）均不运行 `smoke.command`、不写 `SMOKE_PASS` / `SMOKE_FAIL`、不写账本。`SMOKE_ENV_MISMATCH` 只在登记表存在时产生；无登记表项目唯一新增的拒绝是 `SMOKE_DEPLOY_MARKER_INVALID`。
- 非空损坏只可能来自新版 marker 被截断或改坏（旧版 CLI 只写空文件），无法证明属于历史格式，因此不按存在性放行。恢复方式：确认真实部署环境与版本后重新执行 `openlogos deploy-done --env <id> [--ref <revision>]` 重写 marker；CLI 不猜测、不自愈。
- `SMOKE_PASS` / `SMOKE_FAIL` 仍为空文件，环境信息只进账本。

## 5. 本机部署账本

### 5.1 位置与写入者

- 路径：`logos/.openlogos-runtime/deployments.jsonl`（该目录已在 init 托管的 `.gitignore` 区块中，对 AI 编辑工具恒阻断，见 `spec/pretooluse-guard.md`）。**正常路径只追加**，不改写他人记录；写入失败时的补偿只撤销本次写入（见下文「写入顺序与失败补偿」）。
- 写入者只有两条 CLI 路径：`openlogos deploy-done --env <…>` 成功时追加一行 deploy 记录（`deploy-done` 恒要求活跃提案）；`openlogos smoke --env <…>` 在**存在活跃提案**且产生门禁结论（PASS 或 FAIL）时追加一行 smoke 记录。未传 `--env` 时不写；任何拒绝路径不写；smoke 无活跃提案时照常执行既有流程、不写账本（不伪造 `slug`、`deploy_id`、`ref`）。
- 每条记录以一次追加写入一整行 JSON 加换行；目录不存在时先创建。
- **账本锁**：两个写入方的追加与失败补偿都在同一把短临界区锁内进行。锁以独占创建 `logos/.openlogos-runtime/deployments.jsonl.lock` 实现，操作结束即删除；等锁上限 5 秒，超时报错且不写入；锁文件超过 30 秒未更新视为异常退出遗留，可回收。读取账本（§5.4）不取锁。
- **写入顺序与失败补偿**（来源变更 fix-environment-registry-review-gaps，决策 C02、C03）：两个写入方都是**先追加账本、最后写提案标记**，因此标记在场即蕴含对应账本记录已写入。
  - 追加中途失败：在锁内截掉本次写出的残片（本次新建的账本文件则删除），其他记录不受影响。
  - 本次已追加、后续步骤失败：按本次追加的**整行原文**在锁内定位并移除该行，其余行原样保留后原子写回；同一原文出现多次无法确认归属时不改账本并报告。**不按文件长度推断归属**，其他写入方在此期间成功追加的记录逐字节保留。
  - `deploy-done`：写入前快照 tasks.md、旧 `SMOKE_PASS` / `SMOKE_FAIL`、旧 `DEPLOY_DONE`；勾选 `[deploy]` → 清理旧 smoke marker → 追加账本 → 最后写 `DEPLOY_DONE`，任一步失败按快照恢复，本次追加过账本时再撤销本次账本行，以 `DEPLOY_DONE_WRITE_FAILED` 结束（§8）；该快照与恢复在未传 `--env`（不写账本）时同样执行。
  - `smoke`：账本追加失败（含锁等待超时）时不写、不改任何 smoke marker，以 `SMOKE_LEDGER_WRITE_FAILED` 结束；账本已写时，变更 marker 前先快照两种 marker 的存在性与原始内容，标记阶段任一步失败（写目标 marker 失败，或目标 marker 已写成、删除对侧 marker 失败）按快照恢复两种 marker 并撤销本次账本行，同样以 `SMOKE_LEDGER_WRITE_FAILED` 结束。恢复动作逐项捕获，恢复未完成时如实报告未恢复的位置，不声称已完整恢复。
  - smoke 未传 `--env` 或无活跃提案时不写账本，也不做本次新增的 smoke 标记快照与恢复，行为不变。`deploy-done` 不受此例外影响：无论是否传入 `--env`、有无登记表，都保留既有的 tasks.md / 旧 smoke 标记 / 旧 `DEPLOY_DONE` 快照与失败恢复，只在本次没有追加账本时跳过账本补偿。

### 5.2 记录字段

公共字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `kind` | `deploy` \| `smoke` | 记录类型 |
| `environment` | 字符串 | 有登记表时为解析后的 id，无登记表时为原始标签 |
| `slug` | 字符串 | 活跃提案 slug |
| `recorded_at` | 字符串 | ISO 8601 |
| `observed_head` | 字符串 \| null | 调用时 git HEAD 的完整 commit（非 git 仓库或读取失败为 null），**仅作观察信息** |
| `observed_dirty` | 布尔 \| null | 调用时工作区是否有未提交改动，**仅作观察信息** |

deploy 记录另含：`deploy_id`、`ref`、`ref_source`（与本次写入的 `DEPLOY_DONE` 相同），`result`（恒为 `done`）。

smoke 记录另含：

| 字段 | 类型 | 含义 |
|---|---|---|
| `deploy_id` | 字符串 \| null | 本次 smoke 所依据 `DEPLOY_DONE` 的 `deploy_id`（旧空格式为 null） |
| `ref` | 字符串 \| null | **继承**所依据 `DEPLOY_DONE` 的 `ref`；不重新读取 HEAD |
| `result` | `pass` \| `fail` | smoke 门禁结论 |
| `env_evidence` | `declared` \| `missing` \| `mismatch` | 见 §6 |
| `fresh_results` | 布尔 | 本次 `openlogos smoke` 是否实际运行了 `smoke.command`，且计入门禁的结果行全部由这次运行产生（CLI 运行命令前清空结果文件，见 §6） |
| `deploy_env_confirmed` | 布尔 | 见 §4.2 |
| `verified` | 布尔 | 见 §5.3 |

### 5.3 已验证（`verified`）

smoke 记录的 `verified` 为 `true` 当且仅当同时满足：`result=pass`、`env_evidence=declared`、`fresh_results=true`、`deploy_env_confirmed=true`、`ref` 非 null。

`fresh_results` 是「结果属于这次部署」的证据：未配置 `smoke.command`（也无默认 dispatcher）时，既有门禁会直接汇总结果文件中已有的行，这些行可能是上一代部署留下的（例如 R1 通过后重新部署 R2，结果文件不会被清理），它们的 `target_environment` 一致也只证明当时验证过该环境，不证明验证过本次部署的版本。此类运行维持既有门禁兼容展示，但 `fresh_results=false`、`verified=false`。本规范不接受外部预生成结果作为版本证据；如未来需要，须让结果行显式携带并核对 `deploy_id` 或实际版本，不得仅从 marker 补上身份。只有 `verified=true` 的记录表示「该 ref 已在该环境通过 smoke」；环境视图与提案 B、C 的晋级判断只认 `verified=true`，其余记录只作兼容展示。

### 5.4 读取

- 顺序流式扫描**完整**账本，不设全局行数窗口；按环境只保留最近一次 deploy 记录、最近一次 smoke 记录与最近 20 条记录（任意 kind）的历史，内存只随环境数与每环境历史条数增长。「最近」按文件中的行序（追加顺序）判定，不按 `recorded_at` 排序。
- **逐行校验**（按 kind）：公共字段——`kind` 为 `deploy` / `smoke`，`environment` 为非空字符串，`slug` 为非空字符串，`recorded_at` 为字符串，`observed_head` 为 40 位小写十六进制字符串或 null，`observed_dirty` 为布尔或 null。deploy 行——`deploy_id` 为非空字符串，`ref` 为 40 位小写十六进制字符串或 null，`ref_source` 为 `explicit` / `unknown` 且与 `ref` 一致（`explicit` ⇔ `ref` 非 null），`result` 为 `done`。smoke 行——`deploy_id` 为非空字符串或 null，`ref` 同上，`result` 为 `pass` / `fail`，`env_evidence` 为三个枚举之一，`fresh_results`、`deploy_env_confirmed`、`verified` 为布尔，且 `verified` 等于按 §5.3 由同一行字段算出的值。
- 不是 JSON 对象或未通过上述校验的行整行跳过、计入 `corrupt_lines`，**不更新**该环境的最近 deploy / smoke 槽位与历史；之前的有效记录仍是最近状态。未知的额外字段保留兼容、不导致跳过。读取不崩溃。
- 账本不存在视为空账本。`env list`、`env show`、`status` 使用同一读取实现。
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
| `current_ref` | 字符串 \| null | 最近一次 deploy 记录的 `ref`；null 表示版本未知或从未部署 |
| `last_deploy` | 对象 \| null | 最近一次 deploy 记录：`deploy_id`、`slug`、`ref`、`ref_source`、`observed_head`、`observed_dirty`、`recorded_at` |
| `last_smoke` | 对象 \| null | 最近一次 smoke 记录：`deploy_id`、`slug`、`ref`、`result`、`env_evidence`、`fresh_results`、`deploy_env_confirmed`、`verified`、`observed_head`、`recorded_at` |

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
| `ENV_REGISTRY_NOT_FOUND` | error | `env show` / `env check` 时登记表不存在 | 1 |
| `ENV_REGISTRY_INVALID` | error | 登记表存在但非法（§2.2） | 1 |
| `ENV_FIELD_INVALID` | error | `env check` 中单个字段非法 | 1 |
| `ENV_DUPLICATE_ID_OR_ALIAS` | error | id / alias 不区分大小写冲突 | 1 |
| `ENV_GATE_REFERENCE_UNKNOWN` | error | `deployment_gates.<module>.environments` 引用未登记环境 | 1 |
| `ENV_SECRET_MISSING` | error | `secrets` 声明的变量名在当前进程环境中不存在 | 1 |
| `ENV_PROBE_FAILED` | error | `--probe` 时请求失败、超时或非 2xx | 1 |
| `ENV_UNKNOWN_FIELD` | warning | 登记表含未知字段 | 不影响 |
| `ENV_UNKNOWN` | error | `--env` 或 `env show` 参数解析不到 | 1 |
| `ENV_REQUIRED` | error | 登记表存在时 `deploy-done` / `smoke` 未传 `--env` | 1 |
| `ENV_REF_UNRESOLVED` | error | `deploy-done --ref` 无法解析为 commit | 1 |
| `SMOKE_ENV_MISMATCH` | error | 登记表存在时 `DEPLOY_DONE.environment` 与本次 `--env` 解析结果不一致（无登记表时不产生） | 1 |
| `SMOKE_DEPLOY_MARKER_INVALID` | error | `DEPLOY_DONE` 非空损坏或存在但无法读取；JSON 下 `error.details.problems` 为问题字段名数组，无法读取时为 `["unreadable"]` 并带 `error.details.reason`（`spec/cli-json-output.md`「`openlogos smoke`」） | 1 |
| `SMOKE_LEDGER_WRITE_FAILED` | error | smoke 追加账本失败（含账本锁等待超时），或账本已写、随后标记阶段失败；按 §5.1 恢复，`error.details` 报告阶段、原因与恢复结果 | 1 |
| `DEPLOY_DONE_WRITE_FAILED` | error | deploy-done 写入阶段失败（快照读取、勾选 `[deploy]`、清理旧 smoke marker、追加账本或最后写 `DEPLOY_DONE`）；按 §5.1 恢复，`message` 说明恢复结果 | 1 |
| `SMOKE_ENV_EVIDENCE_MISMATCH` | gate reason | 结果行声明的 `target_environment` 与本次环境不一致（登记表存在时） | 1（门禁 FAIL） |

所有面向人的文案走 i18n，中英文都要提供。

## 9. guard

- `logos/environments.yaml` 加入 `guard.exempt` 内置默认（决策 C07，见 `spec/pretooluse-guard.md`「guard.exempt 与内置默认」）：它是运维配置而非业务逻辑，修改不需立案。已显式配置 `guard.exempt` 的项目不自动获得该默认值，需由用户经保护范围命令手动添加。
- 账本位于 `logos/.openlogos-runtime/`，对 AI 编辑工具恒阻断，只能由 CLI 写入。

## 10. 追溯

- 需求：`core-01-requirements.md`「S41: 环境登记与查询」、S21、S19、S11 验收条件。
- 功能规格：§2.93、§2.11。
- 架构：「五十三、环境登记表与部署账本」。
- 场景：`core-S41-environment-registry.md`、`core-S21-deploy-done-marker.md`、`core-S19-smoke-gate.md`、`core-S11-status-progress.md`。
- 测试：`core-S41-test-cases.md`、`core-S21-test-cases.md`、`core-S19-test-cases.md`、`core-S11-test-cases.md` 中 environment-registry 新增用例。
