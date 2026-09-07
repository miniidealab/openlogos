# core-01-feature-specs delta — fix-deploy-done-leak-failclosed-selfheal

## MODIFIED — 2.11 deploy-done 受控落标命令

- `openlogos deploy-done` 是部署完成状态的唯一推荐落标入口，用于替代 AI 直接手写 `logos/changes/<slug>/DEPLOY_DONE`。
- 命令只标记“部署已完成”，不得执行实际部署动作；build、push、ssh、npm publish、Cloudflare deploy 等仍属于部署方案和人类确认点。
- 命令必须支持：
  - `openlogos deploy-done`
  - `openlogos deploy-done --env staging`
  - `openlogos deploy-done --format json`
- 命令成功前必须校验：
  - 当前目录存在 `logos/logos.config.json`
  - `logos/.openlogos-guard` 指向有效活跃提案
  - 活跃提案存在 `VERIFY_PASS` 且不存在 `VERIFY_FAIL`
  - 提案部署决策无冲突，且 `deployment_required=true`
  - `tasks.md` 存在 `[deploy]` section 且至少有一个部署任务
  - `logos/resources/verify/deployment-report.md` 已存在
- 命令成功后必须：
  - 将当前提案 `tasks.md` 的 `[deploy]` section 任务勾选为 `[x]`
  - 写入 `logos/changes/<slug>/DEPLOY_DONE`
  - 清理同一提案中旧的 `SMOKE_PASS` 和 `SMOKE_FAIL`
  - 根据 `smoke_required` 输出下一步：需要 smoke 时提示 `openlogos smoke --env <env>`，无需 smoke 时提示 `openlogos archive <slug>`
- 命令失败时不得产生部分状态更新；特别是不得只写 marker 而未勾选 `[deploy]` 任务。

#### 2.11.1 消费侧收口（`DEPLOY_DONE` 的唯一 writer 与全部读者）

`DEPLOY_DONE` 是「部署已完成」的**唯一权威事实**，`openlogos deploy-done` 是其**唯一 writer**。本小节把该事实的消费侧收口固化，杜绝「写者漏跑 → 读者不设防 → 缺口沉默扩散」的事故路径：

| 消费者 | 消费方式 | 缺 `DEPLOY_DONE` 时的行为 |
|---|---|---|
| `openlogos smoke` | 前置 fail-closed 校验（见 §2.67.1） | 拒绝执行、不写任何 smoke marker、提示 `openlogos deploy-done` |
| `openlogos archive` | 链条 fail-closed 校验（见 §2.67.2） | 需部署提案拒绝归档、不移动目录、不删 guard |
| `openlogos status` | 只读派生 + 矛盾对账投影（见 §2.67.3） | 停在 `ready-to-deploy`；有矛盾下游证据时挂 `state_inconsistency` |
| `openlogos next` | 只读派生 + 矛盾对账引导（见 §2.67.3） | 建议部署授权；有矛盾下游证据时显式给出补救命令 |

不变量：**任何消费者都不得写 `DEPLOY_DONE`**——不得 auto-heal、不得推断「既然 smoke 过了那部署一定完成了」而代写。消费者只能拒绝（fail-closed）或点名（对账投影）。

## ADDED — 2.67 生命周期命令 fail-closed 与状态对账（含 0.14.25 候选发布验收）

### 2.67.0 问题：单点漏标经三处不设防放大为长期僵死

20260907 事故（提案 `fix-guard-check-bash-write-target-jurisdiction`，runlogos 面板僵死复盘）：部署与 smoke 全部实际完成，但执行 Agent 漏跑 `openlogos deploy-done`，`DEPLOY_DONE` 缺失。三处防线依次失效——

1. **smoke 不设防**：S19「smoke 前置依赖 deploy-done」章节早已强制要求四项前置（提案声明需 smoke、部署决策无冲突、`DEPLOY_DONE` 存在、`[deploy]` 全勾），但 `cli/src/commands/smoke.ts` 完全没有该校验，smoke 照常执行并写入 `SMOKE_PASS`——**规格已定、实现缺失**。
2. **archive 不设防**：`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS`，带缺口的提案被成功归档，缺陷被固化进归档记录。
3. **派生沉默停滞**：`flow-derive` 在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永不被评估；面板长期显示「请执行部署任务」，无任何对账线索。

本节按「fail-closed 收口 + 对账自愈投影」两层修复：让漏标造不出来，即使因历史或旁路已存在也藏不住。

### 2.67.1 smoke 前置 fail-closed 校验（实现对齐 S19 既有规格）

`openlogos smoke` 在执行 `smoke.command` **之前**完成前置校验，四项全满足才放行：

| # | 前置 | 不满足时的错误码 |
|---|---|---|
| ① | 提案声明需要 smoke（`smoke_required=true`） | `SMOKE_NOT_REQUIRED` |
| ② | 提案部署决策无冲突（`deployment_decision_conflict=false`） | `SMOKE_DEPLOY_DECISION_CONFLICT` |
| ③ | `DEPLOY_DONE` 存在 | `SMOKE_DEPLOY_NOT_DONE` |
| ④ | `tasks.md` 的 `[deploy]` section 已全部勾选 | `SMOKE_DEPLOY_TASKS_INCOMPLETE` |

判定顺序固定 ①→②→③→④，命中即停并只报第一个错误码（错误确定性，便于机器消费与 golden 锚定）。

**fail-closed 语义（强制）**：拒绝时**不执行 `smoke.command`、不写 `SMOKE_PASS` / `SMOKE_FAIL`、不生成 `smoke-report.md`、不追加 `smoke-results.jsonl`**——零副作用。错误以稳定错误码信封写 stderr 并非零退出（`--format json` 走 `spec/cli-json-output.md` §6 通用错误 envelope），message 必须携带**一条可直接执行的补救命令**：③ 与 ④ 均指向 `openlogos deploy-done`（④ 附「先补齐 `[deploy]` 任务」）。

**禁止 auto-heal（红线）**：smoke 检测到缺标时**不得自动补写 `DEPLOY_DONE`**。auto-heal 会绕过半自动模式下 `deploy-done` 的人类确认点语义，并把「人真的确认过部署完成」与「机器推断部署完成」混为同一事实，掩盖遗漏本身。

**零回归边界**：四项前置全满足时，既有 sandbox 执行、runner / reporter 覆盖预检、gate 判定与 `gate.reason` 取值、skip 统计口径、`--auto` 下 `auto_execute` 信号逐项不变；本节只在既有流程**最前面**加了一道门。

### 2.67.2 archive 链条 fail-closed 校验

`openlogos archive <slug>` 在移动提案目录**之前**校验完成链条：

| # | 条件 | 适用范围 | 不满足时的错误码 |
|---|---|---|---|
| ① | `VERIFY_PASS` 存在且 `VERIFY_FAIL` 不存在 | 全部提案 | `ARCHIVE_VERIFY_NOT_PASSED` |
| ② | `DEPLOY_DONE` 存在 | 仅 `deployment_required=true` 的提案 | `ARCHIVE_DEPLOY_NOT_DONE` |
| ③ | `SMOKE_PASS` 存在且 `SMOKE_FAIL` 不存在 | 仅 `deployment_required=true` 且 `smoke_required=true` 的提案 | `ARCHIVE_SMOKE_NOT_PASSED` |

判定顺序固定 ①→②→③，命中即停。

**fail-closed 语义（强制）**：拒绝时**不移动提案目录、不删除 `logos/.openlogos-guard`、不产生任何部分状态更新**。`openlogos archive` 保持**纯文本命令**（不新增 stdout JSON envelope），以稳定错误码文本写 stderr 并非零退出，携补救命令：① → `openlogos verify`；② → `openlogos deploy-done`；③ → `openlogos smoke`。

**零回归边界**：无需部署的提案链条只到 ①，`VERIFY_PASS` 后照常归档；`deployment_decision_conflict=true` 时 archive 本就不得作为主动作（`spec/change-management.md`「提案级部署决策优先级」第 6 条），语义不变；Windows 归档握手协议（`ARCHIVE_WATCH_*`）在链条校验通过后才进入，顺序为「链条校验 → 握手 → rename」。

### 2.67.3 status / next 的 `state_inconsistency` 只读对账投影

**触发条件（全部成立）**：活跃提案存在、`proposal_step` 派生停在 `ready-to-deploy`（即 `DEPLOY_DONE` 缺失）、且发现至少一项**矛盾的下游证据**：

- `SMOKE_PASS` 在场；
- `SMOKE_FAIL` 在场；
- `tasks.md` 的 `[deploy]` section 已全部勾选。

**投影内容**：挂在 `modules[].active_change.state_inconsistency`（legacy 单模块输出可回退顶层 `state_inconsistency`），三字段齐备：

```jsonc
{
  "kind": "deploy_done_missing_with_downstream_evidence",
  "evidence": ["smoke_pass_marker_present", "deploy_tasks_all_checked"],
  "remediation": "openlogos deploy-done"
}
```

`evidence` 为**按固定顺序**去重输出的证据枚举（`smoke_pass_marker_present` → `smoke_fail_marker_present` → `deploy_tasks_all_checked`），保证同一磁盘事实下输出稳定可 golden。

**next 的人读引导**：命中投影时，`next` 的 detail 文案在既有部署授权引导之后**追加一行**显式对账建议，点明矛盾事实与补救命令（`openlogos deploy-done`），不再沉默重复「请执行部署任务」。

**只读不变量（强制）**：

1. **不落盘、不缓存**——每次 `status` / `next` 调用即时派生，无新鲜度问题、无 shadow source。
2. **不改 `proposal_step` 派生本身**——`ready-to-deploy` 仍是 `ready-to-deploy`，投影是旁挂说明，不是状态跃迁。
3. **不写任何 marker**——尤其不写 `DEPLOY_DONE`；投影只点名，落标仍只能由 `openlogos deploy-done` 完成。
4. **零漂移**——一致状态下字段**不出现**（不是输出 `null`），既有 golden 逐字不变。
5. `watch` 复用 `collectStatusData`，自动继承该投影，无需单独实现。

### 2.67.4 与 D12 不变量的对应

本节三小节共同兑现 D12「生命周期命令 fail-closed 与显式对账不变量」：**生命周期命令（smoke/archive 等）必须 fail-closed 校验其上游事实标记；status/next 检测到矛盾事实时必须显式输出对账建议，不得沉默停滞**。被否备选「smoke 检测到缺标时自动补写 `DEPLOY_DONE`（auto-heal）」的否决理由见决策记录。

### 2.67.5 OpenLogos 0.14.25 候选内容与发布验收

`@miniidealab/openlogos@0.14.25` 相对 0.14.24 的全部行为差异即本节修复（提案 `fix-deploy-done-leak-failclosed-selfheal`）：

| # | 内容 | 生效面 |
|---|---|---|
| ① | smoke 前置 fail-closed 校验（四项前置 + 零副作用 + 补救命令） | 安装态 `openlogos smoke` |
| ② | archive 链条 fail-closed 校验（VERIFY_PASS / DEPLOY_DONE / SMOKE_PASS） | 安装态 `openlogos archive` |
| ③ | `state_inconsistency` 只读对账投影 + next 对账引导 | 安装态 `openlogos status` / `next` / `watch` |
| ④ | S21 场景文档补齐（规格闭包，无运行时行为） | 仓库规格 |

发布验收口径：

- **身份**：UT-S19-45 tripwire 钉 `LOCAL_RELEASE_CANDIDATE_VERSION=0.14.25` / `LOCAL_RELEASE_ROLLBACK_VERSION=0.14.24` 与全源一致。
- **安装态行为**：SMOKE-core-196 承载——fail-closed 拒绝矩阵（缺标 smoke 拒绝、`[deploy]` 未全勾 smoke 拒绝、缺 `VERIFY_PASS` / 缺 `DEPLOY_DONE` / 缺 `SMOKE_PASS` 的 archive 拒绝且零副作用）、对账投影在场、补标后全链放行、固定 0.14.24 对照（复现 smoke 照常写 `SMOKE_PASS`、archive 照常成功、无投影字段，防断言空转）、roundtrip 无混装。
- **发布边界**：仅本机全局；部署与 smoke 各为独立人类确认点；矩阵失败停止部署回实现，全局异常按固定 0.14.24 tarball 回滚。
