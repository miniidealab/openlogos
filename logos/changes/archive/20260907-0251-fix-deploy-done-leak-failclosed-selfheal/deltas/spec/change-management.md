# spec/change-management.md delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — 生命周期命令前置链条语义（lifecycle-failclosed-reconciliation）

> 本节把「变更工作流」步骤 11、12 里已隐含的顺序依赖（`SMOKE_PASS` 后才能归档、`DEPLOY_DONE` 存在时才运行 smoke）升格为**命令自身的 fail-closed 前置校验**。20260907 事故证明：只把顺序写在流程说明里，而命令端不设防，一次漏跑 `openlogos deploy-done` 就会让 smoke 照常写 `SMOKE_PASS`、archive 照常归档，缺口被固化进 audit-only 归档记录。

### 不变量

**生命周期命令必须 fail-closed 校验其上游事实标记；`status` / `next` 检测到矛盾事实时必须显式输出对账建议，不得沉默停滞。**（决策记录 D12）

### `openlogos smoke` 前置链条

执行 `smoke.command` 之前校验，顺序 ①→②→③→④，命中即停：

1. 提案声明需要 smoke（`smoke_required=true`）；
2. 提案部署决策无冲突；
3. `DEPLOY_DONE` 存在；
4. `tasks.md` 的 `[deploy]` section 已全部勾选。

不满足即以稳定错误码拒绝（`SMOKE_NOT_REQUIRED` / `SMOKE_DEPLOY_DECISION_CONFLICT` / `SMOKE_DEPLOY_NOT_DONE` / `SMOKE_DEPLOY_TASKS_INCOMPLETE`，见 `spec/cli-json-output.md` §5.5、§6.3），**零副作用**：不执行 `smoke.command`、不写 `SMOKE_PASS` / `SMOKE_FAIL`、不生成报告、不追加结果 JSONL。

### `openlogos archive` 前置链条

移动提案目录之前校验，顺序 ①→②→③，命中即停：

| # | 条件 | 适用范围 | 错误码 |
|---|---|---|---|
| ① | `VERIFY_PASS` 存在且 `VERIFY_FAIL` 不存在 | 全部提案 | `ARCHIVE_VERIFY_NOT_PASSED` |
| ② | `DEPLOY_DONE` 存在 | 仅 `deployment_required=true` | `ARCHIVE_DEPLOY_NOT_DONE` |
| ③ | `SMOKE_PASS` 存在且 `SMOKE_FAIL` 不存在 | 仅 `deployment_required=true` 且 `smoke_required=true` | `ARCHIVE_SMOKE_NOT_PASSED` |

`deployment_required` / `smoke_required` 按「提案级部署决策优先级」解析（活跃提案 `proposal.md` 优先，`tasks.md` `[deploy]` section 为结构化证据，模块级默认值不得覆盖提案的明确决策）。

不满足即拒绝，**零副作用**：不移动提案目录、不删除 `logos/.openlogos-guard`、不建立 Windows 归档握手请求。校验位于握手之前——顺序为「链条校验 → 握手 → rename」。`openlogos archive` 保持纯文本命令，以稳定错误码文本写 stderr 并非零退出。

### 唯一 writer 与禁止 auto-heal

`DEPLOY_DONE` 的唯一 writer 仍是 `openlogos deploy-done`。任何消费者——`smoke`、`archive`、`status`、`next`——都**不得写入或补写**该 marker，也不得由「smoke 已过」反推「部署已完成」。消费者只能拒绝（fail-closed）或点名（对账投影）。

被否备选「smoke 检测到缺标时自动补写 `DEPLOY_DONE`」的否决理由：它绕过半自动模式下 `deploy-done` 的人类确认点语义，并把「人确认过部署完成」与「机器推断部署完成」混为同一事实，掩盖遗漏本身（详见决策记录 D12）。

### 矛盾事实的显式对账

`status` / `next`（及 `watch`）在派生停在 `ready-to-deploy` 且存在矛盾下游证据（`SMOKE_PASS` / `SMOKE_FAIL` 在场，或 `[deploy]` 已全勾）时，必须输出只读投影 `state_inconsistency`（`kind` / `evidence` / `remediation`，契约见 `spec/cli-json-output.md` §3.17），`next` 的人读引导同步给出补救命令 `openlogos deploy-done`。投影不落盘、不缓存、不改 `proposal_step` 派生、不写任何 marker；一致状态下字段不出现。

它治愈两类状态：本次事故遗留的历史僵死提案，以及任何未来因旁路产生的缺口。

### 两档模式语义

前置链条校验只关命令自身的上游事实，**不新增人类确认点**：

- **半自动 / 手动**：`smoke` / `archive` 仍各自停在人类确认点等明确授权；获授权后前置链条照常校验。
- **全自动 `--auto`**：standing 授权放行的是「运行该命令这个动作」，**不跳过前置链条**；链条不满足时同样 fail-closed 拒绝，`GATE_AUTO_PASSED` 审计行不构成对缺口状态的放行依据。这与「自动放行只发生在代码已绿之后」的既有前提一致——链条未闭合时，本就不存在可盖章的成果。
- **硬红线不变**：`gate:implement:loop-exhausted` 在任何模式下仍照常阻塞。
